import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createE2eApp, E2E_HOOK_TIMEOUT } from './support/e2e-app';
import { createTestCompany, purgeTestCompany, TestCompany } from './support/e2e-company';

/**
 * Purchase cost (price + GST paid + transport) is the owner's by default (inventory.cost): nobody else receives
 * it from any endpoint or may set it. Controller / charger numbers: optional, locked after sale once recorded.
 */
describe('Inventory purchase cost & controller / charger numbers (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let co: TestCompany;
  const stamp = Date.now().toString().slice(-8);
  const http = () => request(app.getHttpServer());
  let serial = 0;
  const COST_KEYS = ['purchaseCost', 'purchasePrice', 'purchaseGst', 'purchaseGstRateBp', 'transportCharge'];

  const create = (token: string, extra: Record<string, unknown> = {}) => {
    const n = serial++;
    return http().post('/api/v1/inventory/units').set('Authorization', token)
      .send({ modelId: co.modelId, variant: `PC-${stamp}`, colour: 'Teal', vin: `PCV${stamp}${n}`, motorNumber: `PCM${stamp}${n}`, batteryNumber: `PCB${stamp}${n}`, ...extra });
  };

  beforeAll(async () => {
    app = await createE2eApp();
    prisma = app.get(PrismaService);
    co = await createTestCompany(app, 'PCost', { roles: ['MANAGER', 'SALES_EXECUTIVE'] });
  }, E2E_HOOK_TIMEOUT);

  afterAll(async () => {
    await purgeTestCompany(prisma, co?.id);
    await app.close();
  }, E2E_HOOK_TIMEOUT);

  it('the owner records price + GST (from a rate, or typed) + transport; the total is the purchase cost', async () => {
    const byRate = (await create(co.auth(), { purchasePrice: 10_000_000, purchaseGstRate: 5, transportCharge: 150_000 }).expect(201)).body;
    expect(byRate).toMatchObject({ purchasePrice: '10000000', purchaseGstRateBp: 500, purchaseGst: '500000', transportCharge: '150000', purchaseCost: '10650000' });
    // A new price recomputes GST from the stored rate; a typed amount then replaces the rate.
    const repriced = (await http().patch(`/api/v1/inventory/units/${byRate.id}`).set('Authorization', co.auth()).send({ purchasePrice: 8_000_000 }).expect(200)).body;
    expect(repriced).toMatchObject({ purchaseGst: '400000', purchaseCost: '8550000' });
    const typed = (await http().patch(`/api/v1/inventory/units/${byRate.id}`).set('Authorization', co.auth()).send({ purchaseGst: 412_345 }).expect(200)).body;
    expect(typed).toMatchObject({ purchaseGstRateBp: null, purchaseGst: '412345', purchaseCost: '8562345' });
  });

  it('only the owner receives purchase cost — from inventory, bookings and lists alike', async () => {
    const unit = (await create(co.auth(), { purchasePrice: 9_000_000, purchaseGstRate: 5 }).expect(201)).body;
    const customer = (await http().post('/api/v1/customers').set('Authorization', co.auth()).send({ name: 'PC Customer', phone: `93${stamp}` }).expect(201)).body;
    const booking = (await http().post('/api/v1/bookings').set('Authorization', co.auth()).send({ customerId: customer.id, unitId: unit.id, exShowroom: 11_000_000 }).expect(201)).body;
    const hasCost = (body: unknown): boolean => COST_KEYS.some((k) => JSON.stringify(body).includes(`"${k}"`));

    for (const role of ['MANAGER', 'SALES_EXECUTIVE'] as const) {
      const auth = co.auth(role);
      if (role === 'MANAGER') {
        expect(hasCost((await http().get(`/api/v1/inventory/units/${unit.id}`).set('Authorization', auth).expect(200)).body)).toBe(false);
        expect(hasCost((await http().get('/api/v1/inventory/units?pageSize=50').set('Authorization', auth).expect(200)).body)).toBe(false);
      }
      expect(hasCost((await http().get(`/api/v1/bookings/${booking.id}`).set('Authorization', auth).expect(200)).body)).toBe(false);
    }
    const asOwner = (await http().get(`/api/v1/bookings/${booking.id}`).set('Authorization', co.auth()).expect(200)).body;
    expect(asOwner.unit).toMatchObject({ purchasePrice: '9000000', purchaseCost: '9450000' });
  });

  it('a manager adds stock without the cost; sending one is refused; the owner fills it in later', async () => {
    const refused = await create(co.auth('MANAGER'), { purchasePrice: 100 }).expect(403);
    expect(refused.body.message).toBe('Only the owner can set the purchase cost');
    const unit = (await create(co.auth('MANAGER')).expect(201)).body;
    await http().patch(`/api/v1/inventory/units/${unit.id}`).set('Authorization', co.auth('MANAGER')).send({ transportCharge: 1 }).expect(403);
    await http().patch(`/api/v1/inventory/units/${unit.id}`).set('Authorization', co.auth('MANAGER')).send({ location: 'Bay 2' }).expect(200);
    const filled = (await http().patch(`/api/v1/inventory/units/${unit.id}`).set('Authorization', co.auth()).send({ purchasePrice: 5_000_000, purchaseGstRate: 5, transportCharge: 50_000 }).expect(200)).body;
    expect(filled.purchaseCost).toBe('5300000');
  });

  it('controller and charger numbers: optional, upper-cased; once invoiced a recorded one is locked but a blank one can be filled in', async () => {
    const unit = (await create(co.auth(), { controllerNumber: 'ctl-1' }).expect(201)).body;
    expect(unit).toMatchObject({ controllerNumber: 'CTL-1', chargerNumber: null });
    const customer = (await http().post('/api/v1/customers').set('Authorization', co.auth()).send({ name: 'PC Lock', phone: `94${stamp}` }).expect(201)).body;
    const booking = (await http().post('/api/v1/bookings').set('Authorization', co.auth()).send({ customerId: customer.id, unitId: unit.id, exShowroom: 11_000_000 }).expect(201)).body;
    await http().post(`/api/v1/bookings/${booking.id}/invoice`).set('Authorization', co.auth()).expect(201);

    const patch = (body: Record<string, unknown>) => http().patch(`/api/v1/inventory/units/${unit.id}`).set('Authorization', co.auth()).send(body);
    await patch({ controllerNumber: 'CTL-2' }).expect(409);
    await patch({ controllerNumber: null }).expect(409);
    expect((await patch({ chargerNumber: 'chg-7' }).expect(200)).body.chargerNumber).toBe('CHG-7');
    await patch({ chargerNumber: 'CHG-8' }).expect(409);
  });
});
