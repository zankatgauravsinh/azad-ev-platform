import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Role } from '@azad/shared';
import { PrismaService } from '../src/prisma/prisma.service';
import { createE2eApp, E2E_HOOK_TIMEOUT } from './support/e2e-app';
import { createTestCompany, purgeTestCompany, TestCompany } from './support/e2e-company';

function textParser(res: request.Response, callback: (err: Error | null, body: unknown) => void): void {
  const chunks: Buffer[] = [];
  (res as unknown as NodeJS.ReadableStream).on('data', (c: Buffer) => chunks.push(Buffer.from(c)));
  (res as unknown as NodeJS.ReadableStream).on('end', () => callback(null, Buffer.concat(chunks).toString('utf8')));
}

/**
 * The Audit Log screen's API: Owner and Manager search the whole log (filters, newest first, paginated); one
 * record's history is open to whoever may view that record; purchase-cost changes reach only inventory.cost
 * holders (list, detail, export); a company never sees another's entries; exporting is itself recorded.
 */
describe('Audit log (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let A: TestCompany;
  let B: TestCompany;
  const http = () => request(app.getHttpServer());
  const get = (url: string, as = A.auth()) => http().get(`/api/v1${url}`).set('Authorization', as);
  let customerId = '';
  let vendorId = '';
  let costEntryId = '';

  beforeAll(async () => {
    app = await createE2eApp();
    prisma = app.get(PrismaService);
    A = await createTestCompany(app, 'AuL', { roles: [Role.MANAGER, Role.SALES_EXECUTIVE] });
    B = await createTestCompany(app, 'AuLB');
    customerId = (await http().post('/api/v1/customers').set('Authorization', A.auth(Role.SALES_EXECUTIVE)).send({ name: 'Priya Shah', phone: `97${Date.now().toString().slice(-8)}` }).expect(201)).body.id;
    vendorId = (await http().post('/api/v1/vendors').set('Authorization', A.auth()).send({ name: 'Audit Log Vendor' }).expect(201)).body.id;
    // A scooter cost change, as Group 4 will write it (purchase cost is the owner's).
    costEntryId = (await prisma.activityLog.create({
      data: { companyId: A.id, actorId: A.user().id, actorName: 'Owner', actorRole: 'OWNER', action: 'UPDATE', entityType: 'InventoryUnit', entityId: '00000000-0000-4000-8000-0000000000aa', entityLabel: 'VINCOST1', summary: 'Updated scooter VINCOST1: purchaseCost changed; sellingPrice 100 → 120', changes: { purchaseCost: { from: '5000000', to: '5100000' }, sellingPrice: { from: '100', to: '120' } } },
    })).id;
  }, E2E_HOOK_TIMEOUT);

  afterAll(async () => {
    await purgeTestCompany(prisma, A?.id);
    await purgeTestCompany(prisma, B?.id);
    await app.close();
  }, E2E_HOOK_TIMEOUT);

  it('Owner and Manager search the whole log, newest first; others may not', async () => {
    const owner = await get('/audit-log?pageSize=100').expect(200);
    expect(owner.body.meta.total).toBeGreaterThanOrEqual(4);
    const times = owner.body.data.map((e: { createdAt: string }) => e.createdAt);
    expect([...times].sort().reverse()).toEqual(times);
    expect(owner.body.data.find((e: { entityId: string }) => e.entityId === customerId)).toMatchObject({ action: 'CREATE', entityType: 'Customer', actor: { name: expect.any(String), role: 'SALES_EXECUTIVE' } });
    await get('/audit-log', A.auth(Role.MANAGER)).expect(200);
    await get('/audit-log', A.auth(Role.SALES_EXECUTIVE)).expect(403);
    await get(`/audit-log/${costEntryId}`, A.auth(Role.SALES_EXECUTIVE)).expect(403);
  });

  it('filters: action, record type (with its automatic entries), person, text, date range', async () => {
    await http().get(`/api/v1/vendors/${vendorId}/ledger.pdf`).set('Authorization', A.auth()).buffer().expect(200); // a download, filed under the route "vendors"
    expect((await get('/audit-log?action=LOGIN').expect(200)).body.data.every((e: { action: string }) => e.action === 'LOGIN')).toBe(true);
    const vendors = (await get('/audit-log?entityType=Vendor').expect(200)).body.data;
    expect(vendors.map((e: { entityId: string }) => e.entityId)).toContain(vendorId);
    // The record type includes entries filed under its route (downloads, automatic entries): wait for the download's.
    let types: string[] = [];
    for (let i = 0; i < 40 && !types.includes('vendors'); i += 1) {
      types = (await get(`/audit-log?entityType=Vendor&entityId=${vendorId}`).expect(200)).body.data.map((e: { entityType: string }) => e.entityType);
      if (!types.includes('vendors')) await new Promise((r) => setTimeout(r, 25));
    }
    expect(types).toEqual(expect.arrayContaining(['Vendor', 'vendors']));
    const mine = (await get(`/audit-log?actorId=${A.user(Role.SALES_EXECUTIVE).id}`).expect(200)).body.data;
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((e: { actor: { id: string } }) => e.actor.id === A.user(Role.SALES_EXECUTIVE).id)).toBe(true);
    expect((await get('/audit-log?q=priya').expect(200)).body.data.some((e: { entityId: string }) => e.entityId === customerId)).toBe(true);
    const today = new Date().toISOString().slice(0, 10);
    expect((await get(`/audit-log?from=2000-01-01&to=2000-01-31`).expect(200)).body.meta.total).toBe(0);
    expect((await get(`/audit-log?from=${today}&to=${today}`).expect(200)).body.meta.total).toBeGreaterThan(0);
    await get('/audit-log?from=yesterday').expect(400);
  });

  it('a record’s history is open to anyone who may view the record — not to others', async () => {
    const hist = await get(`/audit-log/history?entityType=Customer&entityId=${customerId}`, A.auth(Role.SALES_EXECUTIVE)).expect(200);
    expect(hist.body.data[0]).toMatchObject({ entityId: customerId, action: 'CREATE' });
    await get(`/audit-log/history?entityType=Vendor&entityId=${vendorId}`, A.auth(Role.SALES_EXECUTIVE)).expect(403);
    await get(`/audit-log/history?entityType=Vendor&entityId=${vendorId}`, A.auth(Role.MANAGER)).expect(200);
  });

  it('purchase-cost changes reach only callers with inventory.cost', async () => {
    const owner = (await get(`/audit-log/${costEntryId}`).expect(200)).body;
    expect(owner.changes).toEqual({ purchaseCost: { from: '5000000', to: '5100000' }, sellingPrice: { from: '100', to: '120' } });
    const manager = (await get(`/audit-log/${costEntryId}`, A.auth(Role.MANAGER)).expect(200)).body;
    expect(manager.changes).toEqual({ sellingPrice: { from: '100', to: '120' } });
    expect(manager.summary).not.toMatch(/5000000|5100000/);
    const csv = (await get('/audit-log/export?format=csv&q=VINCOST1', A.auth(Role.MANAGER)).buffer().parse(textParser).expect(200)).body as string;
    expect(csv).toContain('VINCOST1');
    expect(csv).not.toContain('5100000');
    const ownerCsv = (await get('/audit-log/export?format=csv&q=VINCOST1').buffer().parse(textParser).expect(200)).body as string;
    expect(ownerCsv).toContain('purchaseCost: 5000000 → 5100000');
  });

  it('exports Excel / PDF; each export is itself recorded', async () => {
    const xlsx = await get('/audit-log/export?format=xlsx').buffer().expect(200);
    expect(xlsx.headers['content-type']).toContain('spreadsheetml');
    const pdf = await get('/audit-log/export?format=pdf&action=LOGIN').buffer().expect(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    const exports = await prisma.activityLog.findMany({ where: { companyId: A.id, action: 'EXPORT', entityType: 'AuditLog' } });
    expect(exports.length).toBeGreaterThanOrEqual(2);
    expect(exports.some((e) => e.summary.startsWith('Exported the audit log (PDF'))).toBe(true);
  });

  it('filter choices list the people and record types in this company’s log', async () => {
    const facets = (await get('/audit-log/facets').expect(200)).body;
    expect(facets.actors.map((a: { id: string }) => a.id)).toEqual(expect.arrayContaining([A.user().id, A.user(Role.SALES_EXECUTIVE).id]));
    expect(facets.entityTypes).toEqual(expect.arrayContaining(['Customer', 'Vendor']));
  });

  it('a company never sees another company’s entries', async () => {
    const theirs = (await get('/audit-log?pageSize=100', B.auth()).expect(200)).body.data;
    expect(theirs.some((e: { entityId: string }) => [customerId, vendorId].includes(e.entityId))).toBe(false);
    await get(`/audit-log/${costEntryId}`, B.auth()).expect(404);
    expect((await get(`/audit-log/history?entityType=Customer&entityId=${customerId}`, B.auth()).expect(200)).body.data).toHaveLength(0);
    expect((await get('/audit-log/facets', B.auth()).expect(200)).body.actors.map((a: { id: string }) => a.id)).not.toContain(A.user().id);
  });
});
