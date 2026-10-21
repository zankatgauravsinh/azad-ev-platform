import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Role } from '@azad/shared';
import { PrismaService } from '../src/prisma/prisma.service';
import { createE2eApp, E2E_HOOK_TIMEOUT } from './support/e2e-app';
import { createTestCompany, purgeTestCompany, TestCompany } from './support/e2e-company';

/**
 * Correcting a booking's terms before it is invoiced (PATCH /bookings/:id/terms, bookings.terms — owner-only):
 * price / offer with the total recalculated, another scooter (the old one back in stock), another customer or
 * sales executive — always with a reason, recorded old → new. Never below what was received, never once
 * invoiced, and the scooter / customer stay put once an RTO invoice names them.
 */
describe('Booking terms (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let A: TestCompany;
  const http = () => request(app.getHttpServer());
  const stamp = Date.now().toString().slice(-7);
  let serial = 0;
  const post = (url: string, body: object = {}, as = A.auth()) => http().post(`/api/v1${url}`).set('Authorization', as).send(body);
  const terms = (id: string, body: object, as = A.auth()) => http().patch(`/api/v1/bookings/${id}/terms`).set('Authorization', as).send(body);
  const unitStatus = async (id: string) => (await prisma.inventoryUnit.findUniqueOrThrow({ where: { id } })).status;
  let customerId = '';
  let otherCustomerId = '';
  const addUnit = async (): Promise<string> => {
    const k = `${stamp}${(serial++).toString().padStart(2, '0')}`;
    return (await post('/inventory/units', { modelId: A.modelId, variant: 'Max', colour: 'Red', vin: `BTV${k}`, motorNumber: `BTM${k}`, batteryNumber: `BTB${k}` }).expect(201)).body.id;
  };
  const book = async (body: object = {}) => (await post('/bookings', { customerId, unitId: await addUnit(), exShowroom: 10_000_000, rto: 500_000, advanceAmount: 0, ...body }).expect(201)).body;

  beforeAll(async () => {
    app = await createE2eApp();
    prisma = app.get(PrismaService);
    A = await createTestCompany(app, 'BkT', { roles: [Role.MANAGER, Role.SALES_EXECUTIVE] });
    customerId = (await post('/customers', { name: 'Ravi Patel', phone: `94${stamp}1` }).expect(201)).body.id;
    otherCustomerId = (await post('/customers', { name: 'Ravina Patel', phone: `94${stamp}2` }).expect(201)).body.id;
  }, E2E_HOOK_TIMEOUT);

  afterAll(async () => {
    await purgeTestCompany(prisma, A?.id);
    await app.close();
  }, E2E_HOOK_TIMEOUT);

  it('the owner changes the price and offer: total recalculated, recorded old → new with the reason', async () => {
    const b = await book();
    const res = await terms(b.id, { discount: 200_000, exShowroom: 10_500_000, reason: 'Diwali offer ₹2,000 added' }).expect(200);
    expect(res.body).toMatchObject({ discount: '200000', exShowroom: '10500000', total: '10800000' });
    const entry = await prisma.activityLog.findFirstOrThrow({ where: { companyId: A.id, entityId: b.id, action: 'UPDATE' } });
    expect(entry).toMatchObject({ reason: 'Diwali offer ₹2,000 added', actorId: A.user().id, entityLabel: b.code });
    expect(entry.changes).toEqual({ exShowroom: { from: '10000000', to: '10500000' }, discount: { from: '0', to: '200000' }, total: { from: '10500000', to: '10800000' } });
  });

  it('a reason is required, something must change, and only the owner may do it', async () => {
    const b = await book();
    await terms(b.id, { discount: 100_000 }).expect(400);
    expect((await terms(b.id, { discount: 0, reason: 'No change' }).expect(400)).body.message).toMatch(/Nothing was changed/);
    await terms(b.id, { discount: 100_000, reason: 'Manager try' }, A.auth(Role.MANAGER)).expect(403);
    await http().get('/api/v1/bookings/sales-executives').set('Authorization', A.auth(Role.MANAGER)).expect(403);
    await http().patch(`/api/v1/bookings/${b.id}`).set('Authorization', A.auth(Role.MANAGER)).send({ notes: 'Still editable' }).expect(200); // the everyday edit is unchanged
  });

  it('moves the booking to another scooter: the new one is booked, the old one back in stock; a taken scooter is refused', async () => {
    const b = await book();
    const next = await addUnit();
    const res = await terms(b.id, { unitId: next, reason: 'Customer wants the other unit' }).expect(200);
    expect(res.body.unit.id).toBe(next);
    expect(await unitStatus(next)).toBe('BOOKED');
    expect(await unitStatus(b.unit.id)).toBe('AVAILABLE');
    const taken = await book();
    await terms(b.id, { unitId: taken.unit.id, reason: 'Wrong unit' }).expect(409);
    expect(await unitStatus(next)).toBe('BOOKED'); // nothing moved
  });

  it('moves the booking to another customer and sales executive, in both customers’ timelines', async () => {
    const b = await book();
    const execs = (await http().get('/api/v1/bookings/sales-executives').set('Authorization', A.auth()).expect(200)).body as { id: string }[];
    const exec = A.user(Role.SALES_EXECUTIVE).id;
    expect(execs.map((e) => e.id)).toContain(exec);
    const res = await terms(b.id, { customerId: otherCustomerId, salesExecutiveId: exec, reason: 'Booked under the wrong customer' }).expect(200);
    expect(res.body).toMatchObject({ customer: { id: otherCustomerId }, salesExecutive: { id: exec } });
    const titles = async (c: string) => (await prisma.customerTimelineEntry.findMany({ where: { customerId: c, entityId: b.id } })).map((t) => t.title);
    expect(await titles(customerId)).toContain(`Booking ${b.code} moved to Ravina Patel`);
    expect(await titles(otherCustomerId)).toContain(`Booking ${b.code} moved from Ravi Patel`);
    const entry = await prisma.activityLog.findFirstOrThrow({ where: { companyId: A.id, entityId: b.id, action: 'UPDATE' } });
    expect(entry.changes).toMatchObject({ customer: { from: 'Ravi Patel', to: 'Ravina Patel' } });
    await terms(b.id, { salesExecutiveId: '00000000-0000-4000-8000-000000000001', reason: 'Unknown person' }).expect(400);
  });

  it('the total may not fall below what was already received', async () => {
    const b = await book({ advanceAmount: 5_000_000 });
    const res = await terms(b.id, { discount: 6_000_000, reason: 'Big discount' }).expect(400);
    expect(res.body.message).toMatch(/less than the ₹50,000.00 already received/);
    await terms(b.id, { discount: 5_500_000, reason: 'Allowed discount' }).expect(200);
  });

  it('an invoiced booking is final; once an RTO invoice exists, only the price may change', async () => {
    const invoiced = await book();
    await post(`/bookings/${invoiced.id}/invoice`).expect(201);
    expect((await terms(invoiced.id, { discount: 100_000, reason: 'Too late' }).expect(409)).body.message).toMatch(/already invoiced/);

    const b = await book();
    await post('/rto-invoices', { customerId, bookingId: b.id, listPrice: 9_000_000, gstRate: 5, supplyType: 'INTRA' }).expect(201);
    await terms(b.id, { customerId: otherCustomerId, reason: 'Wrong customer' }).expect(409);
    await terms(b.id, { unitId: await addUnit(), reason: 'Other unit' }).expect(409);
    await terms(b.id, { discount: 100_000, reason: 'Offer' }).expect(200);
  });

  it('none of these routes fell back to an automatic audit entry', async () => {
    expect(await prisma.activityLog.count({ where: { companyId: A.id, source: 'AUTO' } })).toBe(0);
  });
});
