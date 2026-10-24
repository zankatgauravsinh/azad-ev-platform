import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Role } from '@azad/shared';
import { PrismaService } from '../src/prisma/prisma.service';
import { createE2eApp, E2E_HOOK_TIMEOUT } from './support/e2e-app';
import { createTestCompany, purgeTestCompany, TestCompany } from './support/e2e-company';
import { TEST_GSTIN } from './support/gst-setup';

/**
 * The incident: a manager (who cannot see purchase orders) added scooters straight into Inventory; the owner's order
 * then showed nothing received and could not take the same VINs again. The owner links the scooters already in stock
 * to the order line: they count as received, get the order's vendor and — where none was recorded — its price and GST,
 * so the vendor bill and input GST appear. Wrong model, another vendor, expensed or already linked scooters are not
 * offered and refused; never more than the line expects; filed GSTR-3B months stay closed; all audited.
 */
describe('Purchase order — link scooters already in stock (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let A: TestCompany;
  const http = () => request(app.getHttpServer());
  const stamp = Date.now().toString().slice(-6);
  let serial = 0;
  const post = (url: string, body: object = {}, who = A.auth()) => http().post(`/api/v1${url}`).set('Authorization', who).send(body);
  const get = (url: string, who = A.auth()) => http().get(`/api/v1${url}`).set('Authorization', who);
  const unit = async (variant = 'Max', who = A.auth(Role.MANAGER), extra: object = {}) => {
    const k = `${stamp}${serial++}`;
    return (await post('/inventory/units', { modelId: A.modelId, variant, colour: 'Red', vin: `PLV${k}`, motorNumber: `PLM${k}`, batteryNumber: `PLB${k}`, ...extra }, who).expect(201)).body as { id: string; vin: string; variant: { id: string } };
  };
  let vendorId = '';
  let orderId = '';
  let lineId = '';
  const direct: { id: string; vin: string }[] = [];

  beforeAll(async () => {
    app = await createE2eApp();
    prisma = app.get(PrismaService);
    A = await createTestCompany(app, 'PoL', { roles: [Role.MANAGER] });
    vendorId = (await post('/vendors', { name: 'Comptech Motors', gstNumber: TEST_GSTIN.buyerGujarat }).expect(201)).body.id;
    // The manager adds three scooters directly — no vendor, no cost (a manager cannot enter purchase cost).
    for (let i = 0; i < 3; i += 1) direct.push(await unit());
    const variantId = (await prisma.inventoryUnit.findUniqueOrThrow({ where: { id: direct[0]!.id } })).variantId;
    const po = (await post('/purchase-orders', { vendorId, lines: [{ kind: 'SCOOTER', variantId, quantity: 2, unitCost: 7_000_000, gstRate: 5 }] }).expect(201)).body;
    orderId = po.id;
    lineId = po.lines[0].id;
    await post(`/purchase-orders/${orderId}/order`).expect(201);
  }, E2E_HOOK_TIMEOUT);

  afterAll(async () => {
    await purgeTestCompany(prisma, A?.id);
    await app.close();
  }, E2E_HOOK_TIMEOUT);

  it('receiving the same VIN against the order is refused — the scooter already exists', async () => {
    await post('/inventory/units', { modelId: A.modelId, variant: 'Max', colour: 'Red', vin: direct[0]!.vin, motorNumber: `X${stamp}`, batteryNumber: `Y${stamp}`, purchaseOrderLineId: lineId }).expect(409);
  });

  it('lists only the scooters that can belong to the line', async () => {
    const other = await unit('Pro'); // another variant
    const otherVendor = (await post('/vendors', { name: 'Other Motors' }).expect(201)).body.id;
    const elsewhere = await unit('Max', A.auth(), { vendorId: otherVendor }); // bought from someone else
    const expensed = await unit();
    await prisma.inventoryUnit.update({ where: { id: expensed.id }, data: { costInExpenses: true } });
    const list = (await get(`/purchase-orders/${orderId}/lines/${lineId}/stock`).expect(200)).body as { vin: string; costMissing: boolean }[];
    expect(list.map((c) => c.vin)).toEqual(direct.map((d) => d.vin));
    expect(list.every((c) => c.costMissing)).toBe(true);
    await post(`/purchase-orders/${orderId}/lines/${lineId}/link`, { unitIds: [other.id] }).expect(400);
    await post(`/purchase-orders/${orderId}/lines/${lineId}/link`, { unitIds: [elsewhere.id] }).expect(400);
    await post(`/purchase-orders/${orderId}/lines/${lineId}/link`, { unitIds: [expensed.id] }).expect(400);
  });

  it('only the owner (purchase cost), and never more than the line expects', async () => {
    await get(`/purchase-orders/${orderId}/lines/${lineId}/stock`, A.auth(Role.MANAGER)).expect(403);
    await post(`/purchase-orders/${orderId}/lines/${lineId}/link`, { unitIds: [direct[0]!.id] }, A.auth(Role.MANAGER)).expect(403);
    await post(`/purchase-orders/${orderId}/lines/${lineId}/link`, { unitIds: direct.map((d) => d.id) }).expect(409); // 3 > 2 expected
  });

  it('links two: received on the line, vendor + price + GST from the order, vendor bill and input GST appear, order closes', async () => {
    const res = (await post(`/purchase-orders/${orderId}/lines/${lineId}/link`, { unitIds: [direct[0]!.id, direct[1]!.id] }).expect(201)).body;
    expect(res.lines[0]).toMatchObject({ received: 2 });
    expect(res.status).toBe('CLOSED');
    const u = await prisma.inventoryUnit.findUniqueOrThrow({ where: { id: direct[0]!.id } });
    expect(u).toMatchObject({ purchaseOrderLineId: lineId, vendorId, supplier: 'Comptech Motors', purchasePrice: 7_000_000n, purchaseGstRateBp: 500, purchaseGst: 350_000n, purchaseCost: 7_350_000n });
    expect(u.purchaseDate).toBeInstanceOf(Date);
    const bills = (await get(`/vendors/${vendorId}/bills`).expect(200)).body as { id: string }[] | { data: { id: string }[] };
    const billIds = (Array.isArray(bills) ? bills : bills.data).map((b) => b.id);
    expect(billIds).toEqual(expect.arrayContaining([direct[0]!.id, direct[1]!.id]));
    const period = u.purchaseDate!.toISOString().slice(0, 7);
    const register = (await get(`/gst/purchases?period=${period}`).expect(200)).body as { reference: string; itc: string; cgst: string }[];
    expect(register.find((r) => r.reference === direct[0]!.vin)).toMatchObject({ itc: 'ELIGIBLE', cgst: '175000' });
    // The third is no longer offered: the line is full and the order closed.
    await post(`/purchase-orders/${orderId}/lines/${lineId}/link`, { unitIds: [direct[2]!.id] }).expect(409);
  });

  it('is audited on the order and on each scooter (old → new)', async () => {
    const onOrder = await prisma.activityLog.findFirstOrThrow({ where: { companyId: A.id, entityId: orderId, summary: { startsWith: 'Linked 2 scooters already in stock' } } });
    expect(onOrder.summary).toContain(direct[0]!.vin);
    const onUnit = await prisma.activityLog.findFirstOrThrow({ where: { companyId: A.id, entityId: direct[0]!.id, summary: { startsWith: 'Linked scooter' } } });
    expect(onUnit.changes).toMatchObject({ vendor: { from: null, to: 'Comptech Motors' }, purchasePrice: { from: '0', to: '7000000' } });
    expect(await prisma.activityLog.count({ where: { companyId: A.id, source: 'AUTO' } })).toBe(0);
  });
});
