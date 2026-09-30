import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Vehicle return workflow (Group 3) e2e — state machine, permissions, self-approval
 * block and audit. No financial completion is exercised (Group 4).
 */
describe('Vehicle Returns (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ownerToken = '';
  let managerToken = '';
  let salesToken = '';
  const email = process.env.SEED_OWNER_EMAIL ?? 'owner@azadev.in';
  const password = process.env.SEED_OWNER_PASSWORD ?? 'Azad@12345';
  const stamp = Date.now().toString().slice(-8);
  const http = () => request(app.getHttpServer());
  const auth = (t: string): string => `Bearer ${t}`;
  const login = async (e: string, p: string): Promise<string> =>
    (await http().post('/api/v1/auth/login').send({ email: e, password: p }).expect(200)).body.accessToken;

  const createdUserIds: string[] = [];
  const saleIds: string[] = [];
  let modelId = '';

  let saleSeq = 0;
  // Creates unit → customer → booking → pay in full → invoice → deliver; returns the delivered sale id.
  const makeDeliveredSale = async (suffix: string): Promise<string> => {
    const phone = `9${stamp}${saleSeq++}`.slice(0, 10);
    const unit = await http().post('/api/v1/inventory/units').set('Authorization', auth(ownerToken))
      .send({ modelId, variant: `RV-${suffix}`, colour: 'Blue', vin: `RVN${suffix}`, motorNumber: `RVM${suffix}`, batteryNumber: `RVB${suffix}` }).expect(201);
    const customer = await http().post('/api/v1/customers').set('Authorization', auth(ownerToken)).send({ name: `Ret Cust ${suffix}`, phone }).expect(201);
    const booking = await http().post('/api/v1/bookings').set('Authorization', auth(ownerToken))
      .send({ customerId: customer.body.id, unitId: unit.body.id, exShowroom: 10000000, rto: 500000, advanceAmount: 1000000 }).expect(201);
    const bId = booking.body.id;
    const balance = Number(booking.body.paymentSummary.balance);
    await http().post(`/api/v1/bookings/${bId}/payments`).set('Authorization', auth(ownerToken)).send({ amount: balance, mode: 'UPI' }).expect(201);
    await http().post(`/api/v1/bookings/${bId}/invoice`).set('Authorization', auth(ownerToken)).send({}).expect(201);
    await http().post(`/api/v1/bookings/${bId}/deliver`).set('Authorization', auth(ownerToken)).send({}).expect(201);
    const detail = await http().get(`/api/v1/bookings/${bId}`).set('Authorization', auth(ownerToken)).expect(200);
    saleIds.push(detail.body.sale.id);
    return detail.body.sale.id;
  };

  let saleA = '';
  let saleB = '';
  let saleC = '';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
    prisma = app.get(PrismaService);

    const owner = await prisma.user.findUniqueOrThrow({ where: { email: email.toLowerCase() } });
    const hash = await bcrypt.hash('Test@12345', 12);
    const manager = await prisma.user.create({ data: { companyId: owner.companyId, name: 'Ret Mgr', email: `ret.mgr.${stamp}@e2e.test`, role: 'MANAGER', passwordHash: hash } });
    const sales = await prisma.user.create({ data: { companyId: owner.companyId, name: 'Ret Sales', email: `ret.sales.${stamp}@e2e.test`, role: 'SALES_EXECUTIVE', passwordHash: hash } });
    createdUserIds.push(manager.id, sales.id);

    ownerToken = await login(email, password);
    managerToken = await login(manager.email, 'Test@12345');
    salesToken = await login(sales.email, 'Test@12345');

    const models = await http().get('/api/v1/inventory/models').set('Authorization', auth(ownerToken)).expect(200);
    modelId = models.body[0].id;

    saleA = await makeDeliveredSale(`A${stamp}`);
    saleB = await makeDeliveredSale(`B${stamp}`);
    saleC = await makeDeliveredSale(`C${stamp}`);
  });

  afterAll(async () => {
    try {
      for (const sid of saleIds) {
        await prisma.$executeRaw`DELETE FROM "Refund" WHERE "saleId" = ${sid}`;
        await prisma.$executeRaw`DELETE FROM "CreditNote" WHERE "saleId" = ${sid}`;
        await prisma.$executeRaw`DELETE FROM "VehicleReturn" WHERE "saleId" = ${sid}`;
      }
    } catch {
      /* best-effort */
    }
    if (createdUserIds.length) await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await app.close();
  });

  it('blocks unauthenticated access', async () => {
    await http().get('/api/v1/returns').expect(401);
  });

  // ── Sale A: request (sales) → role denials → guards → inspect → approve ──
  let returnA = '';
  it('lets SALES request a return (→ REQUESTED)', async () => {
    const res = await http().post('/api/v1/returns').set('Authorization', auth(salesToken)).send({ saleId: saleA, reason: `Faulty ${stamp}` }).expect(201);
    expect(res.body.status).toBe('REQUESTED');
    expect(res.body.returnNumber).toBeTruthy();
    expect(res.body.saleTotal).toBe('10500000');
    expect(res.body.amountPaid).toBe('10500000');
    returnA = res.body.id;
  });

  it('forbids SALES from inspecting, approving, rejecting or cancelling', async () => {
    await http().post(`/api/v1/returns/${returnA}/inspect`).set('Authorization', auth(salesToken)).send({ inspectionOk: true }).expect(403);
    await http().post(`/api/v1/returns/${returnA}/approve`).set('Authorization', auth(salesToken)).send({}).expect(403);
    await http().post(`/api/v1/returns/${returnA}/reject`).set('Authorization', auth(salesToken)).send({ reason: 'no' }).expect(403);
    await http().post(`/api/v1/returns/${returnA}/cancel`).set('Authorization', auth(salesToken)).send({}).expect(403);
  });

  it('cannot approve before inspection', async () => {
    await http().post(`/api/v1/returns/${returnA}/approve`).set('Authorization', auth(ownerToken)).send({}).expect(400);
  });

  it('records the inspection (→ INSPECTION), then approves (→ APPROVED)', async () => {
    const inspected = await http().post(`/api/v1/returns/${returnA}/inspect`).set('Authorization', auth(managerToken)).send({ inspectionOk: true, notes: 'minor scratch' }).expect(201);
    expect(inspected.body.status).toBe('INSPECTION');
    expect(inspected.body.inspectionOk).toBe(true);
    // Owner approves a sales-requested return (not self-approval).
    const approved = await http().post(`/api/v1/returns/${returnA}/approve`).set('Authorization', auth(ownerToken)).send({}).expect(201);
    expect(approved.body.status).toBe('APPROVED');
    // No financial effects yet (Group 4).
    expect(approved.body.creditNote).toBeNull();
    expect(approved.body.refunds).toEqual([]);
    expect(approved.body.disposition).toBeNull();
  });

  it('allows only one active return per sale', async () => {
    await http().post('/api/v1/returns').set('Authorization', auth(salesToken)).send({ saleId: saleA, reason: 'dup' }).expect(409);
  });

  // ── Sale B: self-approval block ──
  it('blocks self-approval — the requester cannot approve their own return', async () => {
    const req = await http().post('/api/v1/returns').set('Authorization', auth(managerToken)).send({ saleId: saleB, reason: 'manager raised' }).expect(201);
    const rid = req.body.id;
    await http().post(`/api/v1/returns/${rid}/inspect`).set('Authorization', auth(ownerToken)).send({ inspectionOk: true }).expect(201);
    // Manager is the requester → cannot self-approve.
    await http().post(`/api/v1/returns/${rid}/approve`).set('Authorization', auth(managerToken)).send({}).expect(403);
    // A different manager/owner can.
    await http().post(`/api/v1/returns/${rid}/approve`).set('Authorization', auth(ownerToken)).send({}).expect(201);
  });

  // ── Sale C: reject → terminal immutability → re-request → cancel ──
  it('rejects a return, then treats it as immutable; a fresh return can then be raised and cancelled', async () => {
    const req = await http().post('/api/v1/returns').set('Authorization', auth(salesToken)).send({ saleId: saleC, reason: 'change of mind' }).expect(201);
    const rid = req.body.id;
    const rejected = await http().post(`/api/v1/returns/${rid}/reject`).set('Authorization', auth(ownerToken)).send({ reason: 'not eligible' }).expect(201);
    expect(rejected.body.status).toBe('REJECTED');
    // Terminal: nothing more can happen to it.
    await http().post(`/api/v1/returns/${rid}/inspect`).set('Authorization', auth(ownerToken)).send({ inspectionOk: true }).expect(400);
    await http().post(`/api/v1/returns/${rid}/approve`).set('Authorization', auth(ownerToken)).send({}).expect(400);
    await http().post(`/api/v1/returns/${rid}/cancel`).set('Authorization', auth(ownerToken)).send({}).expect(400);

    // A terminal return frees the sale for a new one, which we then cancel.
    const again = await http().post('/api/v1/returns').set('Authorization', auth(salesToken)).send({ saleId: saleC, reason: 're-raised' }).expect(201);
    const cancelled = await http().post(`/api/v1/returns/${again.body.id}/cancel`).set('Authorization', auth(ownerToken)).send({ reason: 'withdrawn' }).expect(201);
    expect(cancelled.body.status).toBe('CANCELLED');
    await http().post(`/api/v1/returns/${again.body.id}/inspect`).set('Authorization', auth(ownerToken)).send({ inspectionOk: true }).expect(400);
  });

  it('rejects a return request for a non-delivered / unknown sale', async () => {
    await http().post('/api/v1/returns').set('Authorization', auth(ownerToken)).send({ saleId: '00000000-0000-0000-0000-000000000000', reason: 'x' }).expect(404);
  });

  it('writes an audit entry for the request and each transition', async () => {
    const entries = await prisma.activityLog.findMany({ where: { entityType: 'VehicleReturn', entityId: returnA }, orderBy: { createdAt: 'asc' } });
    const actions = entries.map((e) => e.action);
    expect(actions).toContain('CREATE');
    expect(actions.filter((a) => a === 'STATUS_CHANGE').length).toBeGreaterThanOrEqual(2); // inspect + approve
    expect(entries.every((e) => Boolean(e.actorId) && Boolean(e.createdAt))).toBe(true);
  });
});
