import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Role } from '@azad/shared';
import { PrismaService } from '../src/prisma/prisma.service';
import { createE2eApp, E2E_HOOK_TIMEOUT } from './support/e2e-app';
import { createTestCompany, purgeTestCompany, TestCompany } from './support/e2e-company';

/** A 1×1 PNG. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

/**
 * Audit trail, inventory / stock / purchasing: scooter edits record every field old → new (purchase cost only
 * for inventory.cost holders), photos are recorded, spare parts and labour items record their changes, job-card
 * parts record the stock they move, purchase orders record edits (hidden from managers without purchase cost),
 * accessories and the catalogue use the standard change list — and none of it needs the automatic fallback.
 */
describe('Audit — inventory, stock, purchasing (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let A: TestCompany;
  const http = () => request(app.getHttpServer());
  const stamp = Date.now().toString().slice(-7);
  const post = (url: string, body: object = {}, as = A.auth()) => http().post(`/api/v1${url}`).set('Authorization', as).send(body);
  const patch = (url: string, body: object, as = A.auth()) => http().patch(`/api/v1${url}`).set('Authorization', as).send(body);
  const del = (url: string) => http().delete(`/api/v1${url}`).set('Authorization', A.auth());
  const entries = (entityId: string) => prisma.activityLog.findMany({ where: { companyId: A.id, entityId }, orderBy: { createdAt: 'asc' } });
  let unitId = '';
  let variantId = '';

  beforeAll(async () => {
    app = await createE2eApp();
    prisma = app.get(PrismaService);
    A = await createTestCompany(app, 'AuS', { roles: [Role.MANAGER] });
    const unit = (await post('/inventory/units', { modelId: A.modelId, variant: 'Max', colour: 'Red', vin: `ASV${stamp}`, motorNumber: `ASM${stamp}`, batteryNumber: `ASB${stamp}`, purchasePrice: 5_000_000, sellingPrice: 9_000_000 }).expect(201)).body;
    unitId = unit.id;
    variantId = unit.variant.id;
  }, E2E_HOOK_TIMEOUT);

  afterAll(async () => {
    await purgeTestCompany(prisma, A?.id);
    await app.close();
  }, E2E_HOOK_TIMEOUT);

  it('a scooter edit records every field old → new; purchase cost only for those who may see it', async () => {
    expect((await entries(unitId))[0]).toMatchObject({ action: 'CREATE', entityLabel: `ASV${stamp}`, changes: expect.objectContaining({ sellingPrice: { from: null, to: '9000000' }, purchaseCost: { from: null, to: '5000000' } }) });
    await patch(`/inventory/units/${unitId}`, { sellingPrice: 9_500_000, location: 'Bay 2', keyNumber: 'k-77', purchasePrice: 5_200_000 }).expect(200);
    const edit = (await entries(unitId)).find((e) => e.action === 'UPDATE')!;
    expect(edit.changes).toMatchObject({ sellingPrice: { from: '9000000', to: '9500000' }, location: { from: null, to: 'Bay 2' }, keyNumber: { from: null, to: 'K-77' }, purchasePrice: { from: '5000000', to: '5200000' }, purchaseCost: { from: '5000000', to: '5200000' } });
    expect(edit.summary).not.toMatch(/5000000|5200000/); // cost named, never valued, in the summary
    const asManager = (await http().get(`/api/v1/audit-log/${edit.id}`).set('Authorization', A.auth(Role.MANAGER)).expect(200)).body;
    expect(asManager.changes).toMatchObject({ sellingPrice: { from: '9000000', to: '9500000' } });
    expect(asManager.changes).not.toHaveProperty('purchaseCost');
    expect(asManager.changes).not.toHaveProperty('purchasePrice');
  });

  it('a scooter photo added and removed is recorded', async () => {
    const photo = (await http().post(`/api/v1/inventory/units/${unitId}/photos`).set('Authorization', A.auth()).attach('file', PNG, { filename: 'front.png', contentType: 'image/png' }).field('label', 'Front').expect(201)).body;
    await del(`/inventory/units/${unitId}/photos/${photo.id}`).expect(204);
    const log = await entries(unitId);
    expect(log.find((e) => e.summary.startsWith('Added a photo (Front)'))).toBeTruthy();
    expect(log.find((e) => e.action === 'DELETE' && e.summary.startsWith('Removed a photo (Front)'))).toBeTruthy();
  });

  it('spare parts: create, edit (quantity / cost / price) old → new, delete keeps the last state', async () => {
    const part = (await post('/service/spare-parts', { name: 'Brake pad', sku: `BP${stamp}`, quantity: 10, cost: 20_000, sellingPrice: 35_000 }).expect(201)).body;
    await patch(`/service/spare-parts/${part.id}`, { quantity: 8, sellingPrice: 40_000 }).expect(200);
    await del(`/service/spare-parts/${part.id}`).expect(204);
    const log = await entries(part.id);
    expect(log.map((e) => e.action)).toEqual(['CREATE', 'UPDATE', 'DELETE']);
    expect(log[1]!.changes).toEqual({ quantity: { from: 10, to: 8 }, sellingPrice: { from: '35000', to: '40000' } });
    expect(log[2]!.changes).toMatchObject({ quantity: { from: 8, to: null } });
  });

  it('labour items and accessories use the standard change list', async () => {
    const item = (await post('/service/labour-items', { name: 'Wheel alignment', defaultCost: 30_000 }).expect(201)).body;
    await patch(`/service/labour-items/${item.id}`, { defaultCost: 35_000 }).expect(200);
    expect((await entries(item.id)).find((e) => e.action === 'UPDATE')!.changes).toEqual({ defaultCost: { from: '30000', to: '35000' } });

    const acc = (await post('/accessories', { name: `Helmet ${stamp}`, sellPrice: 150_000 }).expect(201)).body;
    await patch(`/accessories/${acc.id}`, { sellPrice: 160_000 }).expect(200);
    expect((await entries(acc.id)).find((e) => e.action === 'UPDATE')).toMatchObject({ entityLabel: `Helmet ${stamp}`, changes: { sellPrice: { from: '150000', to: '160000' } } });
  });

  it('a purchase order edit records the lines and totals — hidden from a manager without purchase cost', async () => {
    const vendorId = (await post('/vendors', { name: 'Audit PO Vendor' }).expect(201)).body.id;
    const po = (await post('/purchase-orders', { vendorId, lines: [{ kind: 'SCOOTER', variantId, quantity: 2, unitCost: 5_000_000, gstRate: 5 }] }).expect(201)).body;
    await patch(`/purchase-orders/${po.id}`, { piNumber: 'PI-42', lines: [{ id: po.lines[0].id, kind: 'SCOOTER', variantId, quantity: 3, unitCost: 5_000_000, gstRate: 5 }] }).expect(200);
    const edit = (await entries(po.id)).find((e) => e.action === 'UPDATE')!;
    expect(edit.changes).toMatchObject({ piNumber: { from: null, to: 'PI-42' }, lines: { from: expect.stringContaining('× 2'), to: expect.stringContaining('× 3') } });
    const asManager = (await http().get(`/api/v1/audit-log/${edit.id}`).set('Authorization', A.auth(Role.MANAGER)).expect(200)).body;
    expect(asManager.changes).toBeNull();
    expect(asManager.summary).toContain(po.poNumber);
  });

  it('the catalogue records its changes in the standard list, labelled with the record', async () => {
    await patch(`/inventory/models/${A.modelId}`, { description: 'Audit edition' }).expect(200);
    expect((await entries(A.modelId)).find((e) => e.action === 'UPDATE')).toMatchObject({ entityLabel: expect.stringContaining('E2E Model'), changes: { description: { from: null, to: 'Audit edition' } } });
  });

  it('none of these routes fell back to an automatic entry', async () => {
    const auto = await prisma.activityLog.findMany({ where: { companyId: A.id, source: 'AUTO' }, select: { summary: true } });
    expect(auto.map((a) => a.summary)).toEqual([]);
  });
});
