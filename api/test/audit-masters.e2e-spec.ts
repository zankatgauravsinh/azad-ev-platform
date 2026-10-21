import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Role, isValidAadhaar } from '@azad/shared';
import { PrismaService } from '../src/prisma/prisma.service';
import { createE2eApp, E2E_HOOK_TIMEOUT } from './support/e2e-app';
import { createTestCompany, purgeTestCompany, TestCompany } from './support/e2e-company';

/** A valid (checksummed) Aadhaar number starting with `prefix` (11 digits). */
const aadhaar = (prefix: string): string => {
  for (let d = 0; d <= 9; d += 1) if (isValidAadhaar(`${prefix}${d}`)) return `${prefix}${d}`;
  throw new Error('no check digit');
};

/**
 * Audit trail, masters / settings / warranty / access: customer edits (Aadhaar masked), notes (their text kept
 * after a delete), follow-ups and logged interactions; staff, vendor, settings and expense-category edits as
 * old → new; every PDF download and report export; each customer opening a shared link (with IP); the warranty
 * issued on delivery and its automatic expiry, as the system's own entries.
 */
describe('Audit — masters, settings, warranty, access (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let A: TestCompany;
  const http = () => request(app.getHttpServer());
  const stamp = Date.now().toString().slice(-7);
  const post = (url: string, body: object = {}) => http().post(`/api/v1${url}`).set('Authorization', A.auth()).send(body);
  const patch = (url: string, body: object) => http().patch(`/api/v1${url}`).set('Authorization', A.auth()).send(body);
  const get = (url: string) => http().get(`/api/v1${url}`).set('Authorization', A.auth());
  const entries = (entityId: string) => prisma.activityLog.findMany({ where: { companyId: A.id, entityId }, orderBy: { createdAt: 'asc' } });
  let customerId = '';
  /** Downloads are recorded just after the file is sent: wait (briefly) for the entry. */
  const eventually = async <T>(read: () => Promise<T>, ok: (v: T) => boolean): Promise<T> => {
    for (let i = 0; i < 40; i += 1) {
      const v = await read();
      if (ok(v)) return v;
      await new Promise((r) => setTimeout(r, 25));
    }
    return read();
  };

  beforeAll(async () => {
    app = await createE2eApp();
    prisma = app.get(PrismaService);
    A = await createTestCompany(app, 'AuX', { roles: [Role.MANAGER] });
    customerId = (await post('/customers', { name: 'Kiran Desai', phone: `95${stamp}3` }).expect(201)).body.id;
  }, E2E_HOOK_TIMEOUT);

  afterAll(async () => {
    await purgeTestCompany(prisma, A?.id);
    await app.close();
  }, E2E_HOOK_TIMEOUT);

  it('a customer edit records old → new with the Aadhaar number masked', async () => {
    const number = aadhaar('23456789012'.slice(0, 11));
    await patch(`/customers/${customerId}`, { city: 'Una', aadhaarNumber: number }).expect(200);
    const edit = (await entries(customerId)).find((e) => e.action === 'UPDATE')!;
    expect(edit.changes).toMatchObject({ city: { from: null, to: 'Una' }, aadhaarNumber: { from: null, to: expect.stringMatching(new RegExp(`${number.slice(-4)}$`)) } });
    expect(JSON.stringify(edit)).not.toContain(number);
  });

  it('notes, follow-ups and logged interactions appear in the customer’s history; a deleted note keeps its text', async () => {
    const note = (await post(`/customers/${customerId}/notes`, { body: 'Wants a red Mars' }).expect(201)).body;
    await patch(`/customers/${customerId}/notes/${note.id}`, { body: 'Wants a red Mars Plus' }).expect(200);
    await http().delete(`/api/v1/customers/${customerId}/notes/${note.id}`).set('Authorization', A.auth()).expect(204);
    const fu = (await post(`/customers/${customerId}/follow-ups`, { dueAt: new Date(Date.now() + 86_400_000).toISOString(), note: 'Call about finance' }).expect(201)).body;
    await post(`/customers/${customerId}/follow-ups/${fu.id}/cancel`).expect(201);
    await post(`/customers/${customerId}/interactions`, { type: 'PHONE_CALL', note: 'Asked for the on-road price' }).expect(201);
    const log = await entries(customerId);
    expect(log.find((e) => e.summary.startsWith('Edited a note'))!.changes).toEqual({ note: { from: 'Wants a red Mars', to: 'Wants a red Mars Plus' } });
    expect(log.find((e) => e.action === 'DELETE' && e.summary.startsWith('Deleted a note'))!.changes).toEqual({ note: { from: 'Wants a red Mars Plus', to: null } });
    expect(log.find((e) => e.action === 'CANCEL')!.changes).toEqual({ status: { from: 'PENDING', to: 'CANCELLED' } });
    expect(log.find((e) => e.summary.startsWith('Logged phone call'))!.summary).toContain('on-road price');
  });

  it('staff, vendor, company settings and expense categories record old → new', async () => {
    await patch(`/users/staff/${A.user(Role.MANAGER).id}`, { name: 'Asha Manager' }).expect(200);
    expect((await entries(A.user(Role.MANAGER).id)).find((e) => e.action === 'UPDATE' && e.summary.startsWith('Updated staff'))!.changes).toMatchObject({ name: { to: 'Asha Manager' } });

    const vendor = (await post('/vendors', { name: 'Masters Vendor' }).expect(201)).body;
    await patch(`/vendors/${vendor.id}`, { creditDays: 15, city: 'Rajkot' }).expect(200);
    expect((await entries(vendor.id)).find((e) => e.action === 'UPDATE')!.changes).toEqual({ creditDays: { from: 0, to: 15 }, city: { from: null, to: 'Rajkot' } });

    await patch('/settings/company', { tagline: 'Ride electric', defaultWarrantyMonths: 24 }).expect(200);
    const settings = await prisma.activityLog.findFirstOrThrow({ where: { companyId: A.id, entityType: 'CompanySetting', summary: { startsWith: 'Updated company settings' } }, orderBy: { createdAt: 'desc' } });
    expect(settings.changes).toMatchObject({ tagline: { to: 'Ride electric' }, defaultWarrantyMonths: { to: 24 } });

    const cat = (await post('/finance/categories', { name: `Diwali ${stamp}` }).expect(201)).body;
    await patch(`/finance/categories/${cat.id}`, { active: false }).expect(200);
    expect((await entries(cat.id)).map((e) => e.action)).toEqual(['CREATE', 'UPDATE']);
  });

  it('every document download and report export is recorded against its record', async () => {
    const unit = (await post('/inventory/units', { modelId: A.modelId, variant: 'Max', colour: 'Red', vin: `AXV${stamp}`, motorNumber: `AXM${stamp}`, batteryNumber: `AXB${stamp}` }).expect(201)).body;
    const q = (await post('/quotations', { customerId, variantId: unit.variant.id, exShowroom: 9_000_000 }).expect(201)).body;
    await get(`/quotations/${q.id}/pdf`).buffer().expect(200);
    const log = await eventually(() => entries(q.id), (l) => l.some((e) => e.action === 'DOWNLOAD'));
    expect(log.find((e) => e.action === 'DOWNLOAD')).toMatchObject({ summary: 'Downloaded Quotation', entityType: 'quotations' });
    await get('/reports/sales/export?format=csv').buffer().expect(200);
    const count = () => prisma.activityLog.count({ where: { companyId: A.id, action: 'DOWNLOAD', summary: 'Downloaded Report export' } });
    expect(await eventually(count, (n) => n > 0)).toBe(1);
  });

  it('a customer opening a shared link is recorded in the company log, with IP, as a customer-link entry', async () => {
    const unit = (await post('/inventory/units', { modelId: A.modelId, variant: 'Max', colour: 'Red', vin: `AXS${stamp}`, motorNumber: `AXN${stamp}`, batteryNumber: `AXC${stamp}` }).expect(201)).body;
    const q = (await post('/quotations', { customerId, variantId: unit.variant.id, exShowroom: 9_000_000 }).expect(201)).body;
    const link = (await post('/share-links', { docType: 'QUOTATION', entityId: q.id }).expect(201)).body;
    const token = (link.url as string).split('/public/documents/')[1]!;
    await http().get(`/api/v1/public/documents/${token}`).set('User-Agent', 'WhatsApp/2.24').buffer().expect(200);
    const open = (await eventually(() => entries(q.id), (l) => l.some((e) => e.action === 'SHARE_OPEN'))).find((e) => e.action === 'SHARE_OPEN')!;
    expect(open).toMatchObject({ source: 'PUBLIC', actorId: null, userAgent: 'WhatsApp/2.24', entityLabel: 'Quotation' });
    expect(open.ip).toBeTruthy();
  });

  it('the warranty issued on delivery and its automatic expiry are the system’s own entries; a cancellation is the user’s', async () => {
    const unit = (await post('/inventory/units', { modelId: A.modelId, variant: 'Max', colour: 'Red', vin: `AXW${stamp}`, motorNumber: `AXO${stamp}`, batteryNumber: `AXD${stamp}` }).expect(201)).body;
    const b = (await post('/bookings', { customerId, unitId: unit.id, exShowroom: 9_000_000, advanceAmount: 0 }).expect(201)).body;
    await post(`/bookings/${b.id}/invoice`).expect(201);
    await post(`/bookings/${b.id}/deliver`, {}).expect(201);
    const warranty = await prisma.warranty.findFirstOrThrow({ where: { companyId: A.id, unitId: unit.id } });
    expect((await entries(warranty.id))[0]).toMatchObject({ action: 'CREATE', source: 'SYSTEM', entityLabel: warranty.warrantyNumber, metadata: expect.objectContaining({ trigger: 'delivery' }) });

    await prisma.warranty.update({ where: { id: warranty.id }, data: { endDate: new Date(Date.now() - 86_400_000) } });
    await get('/warranties').expect(200);
    expect((await entries(warranty.id)).find((e) => e.summary.includes('expired'))).toMatchObject({ source: 'SYSTEM', actorId: null, changes: { status: { from: 'ACTIVE', to: 'EXPIRED' } } });
    await get('/warranties').expect(200);
    expect((await entries(warranty.id)).filter((e) => e.summary.includes('expired'))).toHaveLength(1); // once, not on every read

    await post(`/warranties/${warranty.id}/cancel`).expect(201);
    expect((await entries(warranty.id)).find((e) => e.action === 'CANCEL')).toMatchObject({ source: 'USER', actorId: A.user().id, changes: { status: { from: 'EXPIRED', to: 'CANCELLED' } } });
  });

  it('none of these routes fell back to an automatic entry', async () => {
    const auto = await prisma.activityLog.findMany({ where: { companyId: A.id, source: 'AUTO' }, select: { summary: true } });
    expect(auto.map((a) => a.summary)).toEqual([]);
  });
});
