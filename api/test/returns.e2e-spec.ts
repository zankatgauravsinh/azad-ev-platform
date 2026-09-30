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
  interface Sold { saleId: string; bookingId: string; unitId: string; customerId: string }
  // Creates unit → customer → booking → (optionally pay balance) → invoice → deliver.
  // Advance ₹10,000 is always paid; total is ₹1,05,000 (ex-showroom 1,00,000 + rto 5,000).
  const makeDeliveredSale = async (suffix: string, payBalance = true): Promise<Sold> => {
    const phone = `9${stamp.slice(-6)}${String(saleSeq++).padStart(3, '0')}`; // 10 digits, unique per run
    const unit = await http().post('/api/v1/inventory/units').set('Authorization', auth(ownerToken))
      .send({ modelId, variant: `RV-${suffix}`, colour: 'Blue', vin: `RVN${suffix}`, motorNumber: `RVM${suffix}`, batteryNumber: `RVB${suffix}` }).expect(201);
    const customer = await http().post('/api/v1/customers').set('Authorization', auth(ownerToken)).send({ name: `Ret Cust ${suffix}`, phone }).expect(201);
    const booking = await http().post('/api/v1/bookings').set('Authorization', auth(ownerToken))
      .send({ customerId: customer.body.id, unitId: unit.body.id, exShowroom: 10000000, rto: 500000, advanceAmount: 1000000 }).expect(201);
    const bId = booking.body.id;
    if (payBalance) {
      const balance = Number(booking.body.paymentSummary.balance);
      await http().post(`/api/v1/bookings/${bId}/payments`).set('Authorization', auth(ownerToken)).send({ amount: balance, mode: 'UPI' }).expect(201);
    }
    await http().post(`/api/v1/bookings/${bId}/invoice`).set('Authorization', auth(ownerToken)).send({}).expect(201);
    await http().post(`/api/v1/bookings/${bId}/deliver`).set('Authorization', auth(ownerToken)).send({}).expect(201);
    const detail = await http().get(`/api/v1/bookings/${bId}`).set('Authorization', auth(ownerToken)).expect(200);
    saleIds.push(detail.body.sale.id);
    return { saleId: detail.body.sale.id, bookingId: bId, unitId: unit.body.id, customerId: customer.body.id };
  };

  // Drives a delivered sale's return to APPROVED (request by sales, inspect + approve by owner).
  const makeApprovedReturn = async (saleId: string): Promise<string> => {
    const req = await http().post('/api/v1/returns').set('Authorization', auth(salesToken)).send({ saleId, reason: `ret ${saleId.slice(0, 6)}` }).expect(201);
    await http().post(`/api/v1/returns/${req.body.id}/inspect`).set('Authorization', auth(ownerToken)).send({ inspectionOk: true }).expect(201);
    await http().post(`/api/v1/returns/${req.body.id}/approve`).set('Authorization', auth(ownerToken)).send({}).expect(201);
    return req.body.id;
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

    saleA = (await makeDeliveredSale(`A${stamp}`)).saleId;
    saleB = (await makeDeliveredSale(`B${stamp}`)).saleId;
    saleC = (await makeDeliveredSale(`C${stamp}`)).saleId;
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

  // ─────────────── Group 4 — completion / finalization ───────────────
  describe('completion', () => {
    const unitStatus = async (unitId: string): Promise<string> =>
      (await http().get(`/api/v1/inventory/units/${unitId}`).set('Authorization', auth(ownerToken)).expect(200)).body.status;

    let f1Return = '';
    let f1Sale = '';

    it('full paid → credit note = sale total, full refund, disposition AVAILABLE (sellable); originals unchanged', async () => {
      const s = await makeDeliveredSale(`CF${stamp}`); // paid in full = 10,500,000
      f1Sale = s.saleId;
      f1Return = await makeApprovedReturn(s.saleId);
      const res = await http().post(`/api/v1/returns/${f1Return}/complete`).set('Authorization', auth(ownerToken))
        .send({ disposition: 'AVAILABLE', deductionAmount: 0, refundMethod: 'UPI' }).expect(201);
      expect(res.body.status).toBe('COMPLETED');
      expect(res.body.creditNote.total).toBe('10500000');
      expect(res.body.refunds).toHaveLength(1);
      expect(res.body.refunds[0].amount).toBe('10500000');
      expect(res.body.disposition).toBe('AVAILABLE');
      expect(await unitStatus(s.unitId)).toBe('AVAILABLE');
      // Original booking/sale/payments untouched.
      const booking = await http().get(`/api/v1/bookings/${s.bookingId}`).set('Authorization', auth(ownerToken)).expect(200);
      expect(booking.body.status).toBe('CONVERTED'); // never CANCELLED after delivery
      const pays = await http().get(`/api/v1/bookings/${s.bookingId}/payments`).set('Authorization', auth(ownerToken)).expect(200);
      expect(pays.body).toHaveLength(2); // advance + balance, unchanged
      expect(pays.body.reduce((sum: number, p: { amount: string }) => sum + Number(p.amount), 0)).toBe(10500000);
    });

    it('partially paid → refund only the amount actually paid, disposition IN_SERVICE (not sellable)', async () => {
      const s = await makeDeliveredSale(`CP${stamp}`, false); // only advance 1,000,000 paid
      const rid = await makeApprovedReturn(s.saleId);
      const res = await http().post(`/api/v1/returns/${rid}/complete`).set('Authorization', auth(ownerToken))
        .send({ disposition: 'IN_SERVICE', deductionAmount: 0, refundMethod: 'CASH' }).expect(201);
      expect(res.body.creditNote.total).toBe('10500000');
      expect(res.body.refunds[0].amount).toBe('1000000');
      expect(await unitStatus(s.unitId)).toBe('IN_SERVICE');
    });

    it('partial payment + approved deduction → refund = paid − deduction', async () => {
      const s = await makeDeliveredSale(`CD${stamp}`, false); // paid 1,000,000
      const rid = await makeApprovedReturn(s.saleId);
      const res = await http().post(`/api/v1/returns/${rid}/complete`).set('Authorization', auth(ownerToken))
        .send({ disposition: 'AVAILABLE', deductionAmount: 200000, deductionReason: 'minor scratch', refundMethod: 'UPI' }).expect(201);
      expect(res.body.deductionAmount).toBe('200000');
      expect(res.body.refunds[0].amount).toBe('800000');
    });

    it('deduction equal to amount paid → no refund created; disposition SCRAP stays RETURNED (non-sellable)', async () => {
      const s = await makeDeliveredSale(`CS${stamp}`, false); // paid 1,000,000
      const rid = await makeApprovedReturn(s.saleId);
      const res = await http().post(`/api/v1/returns/${rid}/complete`).set('Authorization', auth(ownerToken))
        .send({ disposition: 'SCRAP', deductionAmount: 1000000, deductionReason: 'heavy use', refundMethod: 'CASH' }).expect(201);
      expect(res.body.refunds).toEqual([]);
      expect(res.body.creditNote.total).toBe('10500000');
      expect(await unitStatus(s.unitId)).toBe('RETURNED');
    });

    it('deduction greater than amount paid → rejected, return stays APPROVED', async () => {
      const s = await makeDeliveredSale(`CG${stamp}`, false); // paid 1,000,000
      const rid = await makeApprovedReturn(s.saleId);
      await http().post(`/api/v1/returns/${rid}/complete`).set('Authorization', auth(ownerToken))
        .send({ disposition: 'AVAILABLE', deductionAmount: 1500000, deductionReason: 'x', refundMethod: 'UPI' }).expect(400);
      const after = await http().get(`/api/v1/returns/${rid}`).set('Authorization', auth(ownerToken)).expect(200);
      expect(after.body.status).toBe('APPROVED');
    });

    it('cannot complete before APPROVED', async () => {
      const s = await makeDeliveredSale(`CB${stamp}`);
      const req = await http().post('/api/v1/returns').set('Authorization', auth(salesToken)).send({ saleId: s.saleId, reason: 'x' }).expect(201);
      await http().post(`/api/v1/returns/${req.body.id}/inspect`).set('Authorization', auth(ownerToken)).send({ inspectionOk: true }).expect(201);
      await http().post(`/api/v1/returns/${req.body.id}/complete`).set('Authorization', auth(ownerToken))
        .send({ disposition: 'AVAILABLE', deductionAmount: 0, refundMethod: 'UPI' }).expect(400);
    });

    it('second completion is safely rejected with no duplicate credit note / refund', async () => {
      await http().post(`/api/v1/returns/${f1Return}/complete`).set('Authorization', auth(ownerToken))
        .send({ disposition: 'AVAILABLE', deductionAmount: 0, refundMethod: 'UPI' }).expect(400);
      expect(await prisma.creditNote.count({ where: { saleId: f1Sale } })).toBe(1);
      expect(await prisma.refund.count({ where: { saleId: f1Sale } })).toBe(1);
    });

    it('completion failure does not leave the vehicle incorrectly returned (atomic rollback)', async () => {
      const s = await makeDeliveredSale(`CR${stamp}`);
      const rid = await makeApprovedReturn(s.saleId);
      // Move the unit out of DELIVERED via the generic API so applyReturnDisposition fails.
      await http().patch(`/api/v1/inventory/units/${s.unitId}/status`).set('Authorization', auth(ownerToken)).send({ toStatus: 'IN_SERVICE' }).expect(200);
      await http().post(`/api/v1/returns/${rid}/complete`).set('Authorization', auth(ownerToken))
        .send({ disposition: 'AVAILABLE', deductionAmount: 0, refundMethod: 'UPI' }).expect(409);
      // Rolled back: return still APPROVED, no financial records, unit unchanged.
      const after = await http().get(`/api/v1/returns/${rid}`).set('Authorization', auth(ownerToken)).expect(200);
      expect(after.body.status).toBe('APPROVED');
      expect(await prisma.creditNote.count({ where: { saleId: s.saleId } })).toBe(0);
      expect(await prisma.refund.count({ where: { saleId: s.saleId } })).toBe(0);
      expect(await unitStatus(s.unitId)).toBe('IN_SERVICE');
    });

    it('cancels the vehicle warranty on completion', async () => {
      const s = await makeDeliveredSale(`CW${stamp}`);
      const warranty = await http().post('/api/v1/warranties').set('Authorization', auth(ownerToken)).send({ unitId: s.unitId, customerId: s.customerId, periodMonths: 24 }).expect(201);
      const wId = warranty.body.warranty.id;
      const rid = await makeApprovedReturn(s.saleId);
      await http().post(`/api/v1/returns/${rid}/complete`).set('Authorization', auth(ownerToken))
        .send({ disposition: 'AVAILABLE', deductionAmount: 0, refundMethod: 'UPI' }).expect(201);
      const w = await http().get(`/api/v1/warranties/${wId}`).set('Authorization', auth(ownerToken)).expect(200);
      expect(w.body.warranty.status).toBe('CANCELLED');
      // Clean up the warranty rows (cascades from unit/customer in afterAll would also work).
      await prisma.$executeRaw`DELETE FROM "FreeService" WHERE "warrantyId" = ${wId}`;
      await prisma.$executeRaw`DELETE FROM "Warranty" WHERE id = ${wId}`;
    });

    it('respects the month-close lock', async () => {
      const s = await makeDeliveredSale(`CM${stamp}`);
      const rid = await makeApprovedReturn(s.saleId);
      const now = new Date();
      const closing = await http().post('/api/v1/finance/closings').set('Authorization', auth(ownerToken)).send({ year: now.getFullYear(), month: now.getMonth() + 1 }).expect(201);
      await http().post(`/api/v1/returns/${rid}/complete`).set('Authorization', auth(ownerToken))
        .send({ disposition: 'AVAILABLE', deductionAmount: 0, refundMethod: 'UPI' }).expect(400);
      await http().delete(`/api/v1/finance/closings/${closing.body.id}`).set('Authorization', auth(ownerToken)).expect(204);
      // Reopened → completes.
      await http().post(`/api/v1/returns/${rid}/complete`).set('Authorization', auth(ownerToken))
        .send({ disposition: 'AVAILABLE', deductionAmount: 0, refundMethod: 'UPI' }).expect(201);
    });
  });
});
