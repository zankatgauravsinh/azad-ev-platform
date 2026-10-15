import { INestApplication } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createE2eApp, E2E_HOOK_TIMEOUT } from './support/e2e-app';
import { createTestCompany, purgeTestCompany, TestCompany } from './support/e2e-company';

/**
 * M4B.3 — owner-only correction of a DELIVERED / IN_SERVICE / RETURNED vehicle's VIN, motor and battery
 * number, with a reason. Only the unit changes; one audit entry explains it; bookings, sales, deliveries,
 * warranties, AMC plans, service jobs, returns and GST snapshots keep what they recorded.
 *
 * Company A has GST enabled with placeholder TEST values only (so its sales carry a tax snapshot);
 * company B is another tenant. Both are throwaway companies, hard-deleted afterwards.
 */
describe('Inventory identification correction (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let A: TestCompany;
  let B: TestCompany;
  let customerA = '';
  let customerB = '';
  const stamp = Date.now().toString().slice(-8);
  let serial = 0;
  const http = () => request(app.getHttpServer());

  interface Unit { id: string; vin: string; motorNumber: string; batteryNumber: string }
  type RoleName = 'OWNER' | 'MANAGER' | 'SALES_EXECUTIVE' | 'TECHNICIAN' | 'ACCOUNTANT';

  const newUnit = async (co: TestCompany): Promise<Unit> => {
    const n = serial++;
    const res = await http().post('/api/v1/inventory/units').set('Authorization', co.auth())
      .send({ modelId: co.modelId, variant: 'Std', colour: 'Teal', vin: `CRV${stamp}${n}`, motorNumber: `CRM${stamp}${n}`, batteryNumber: `CRB${stamp}${n}` }).expect(201);
    return { id: res.body.id, vin: res.body.vin, motorNumber: res.body.motorNumber, batteryNumber: res.body.batteryNumber };
  };
  const setStatus = (co: TestCompany, id: string, toStatus: string) =>
    http().patch(`/api/v1/inventory/units/${id}/status`).set('Authorization', co.auth()).send({ toStatus }).expect(200);
  /** Booking → paid in full → invoiced → delivered. */
  const deliver = async (co: TestCompany, customerId: string, unitId: string): Promise<{ bookingId: string; saleId: string }> => {
    const booking = await http().post('/api/v1/bookings').set('Authorization', co.auth()).send({ customerId, unitId, exShowroom: 1_100_000 }).expect(201);
    const id = booking.body.id as string;
    await http().post(`/api/v1/bookings/${id}/payments`).set('Authorization', co.auth()).send({ amount: Number(booking.body.paymentSummary.balance), mode: 'UPI' }).expect(201);
    await http().post(`/api/v1/bookings/${id}/invoice`).set('Authorization', co.auth()).expect(201);
    await http().post(`/api/v1/bookings/${id}/deliver`).set('Authorization', co.auth()).send({}).expect(201);
    const sale = await prisma.sale.findFirstOrThrow({ where: { bookingId: id } });
    return { bookingId: id, saleId: sale.id };
  };
  /** Return requested by the owner, inspected / approved / completed by the manager; SCRAP keeps it RETURNED. */
  const returnVehicle = async (co: TestCompany, saleId: string): Promise<void> => {
    const req = await http().post('/api/v1/returns').set('Authorization', co.auth()).send({ saleId, reason: 'correction test' }).expect(201);
    await http().post(`/api/v1/returns/${req.body.id}/inspect`).set('Authorization', co.auth('MANAGER')).send({ inspectionOk: true }).expect(201);
    await http().post(`/api/v1/returns/${req.body.id}/approve`).set('Authorization', co.auth('MANAGER')).send({}).expect(201);
    await http().post(`/api/v1/returns/${req.body.id}/complete`).set('Authorization', co.auth('MANAGER')).send({ disposition: 'SCRAP', deductionAmount: 0, refundMethod: 'UPI' }).expect(201);
  };

  const unitIn = async (status: string, co: TestCompany = A, customerId = customerA): Promise<Unit> => {
    const u = await newUnit(co);
    if (status === 'RESERVED' || status === 'IN_SERVICE') await setStatus(co, u.id, status);
    if (status === 'BOOKED') await http().post('/api/v1/bookings').set('Authorization', co.auth()).send({ customerId, unitId: u.id, exShowroom: 1_100_000 }).expect(201);
    if (status === 'DELIVERED' || status === 'RETURNED') {
      const { saleId } = await deliver(co, customerId, u.id);
      if (status === 'RETURNED') await returnVehicle(co, saleId);
    }
    expect((await row(u.id)).status).toBe(status);
    return u;
  };

  const correct = (id: string, body: Record<string, unknown>, role: RoleName = 'OWNER', co: TestCompany = A) =>
    http().patch(`/api/v1/inventory/units/${id}/identification-correction`).set('Authorization', co.auth(role)).send(body);
  const edit = (id: string, body: Record<string, unknown>) =>
    http().patch(`/api/v1/inventory/units/${id}`).set('Authorization', A.auth()).send(body);
  const row = (id: string) => prisma.inventoryUnit.findUniqueOrThrow({ where: { id } });
  const ids = async (id: string) => {
    const r = await row(id);
    return { vin: r.vin, motorNumber: r.motorNumber, batteryNumber: r.batteryNumber };
  };
  const audits = (unitId: string) =>
    prisma.activityLog.findMany({ where: { entityType: 'InventoryUnit', entityId: unitId, action: 'UPDATE' }, orderBy: { createdAt: 'asc' } });
  const reason = 'VIN mistyped at stock entry';

  beforeAll(async () => {
    app = await createE2eApp();
    prisma = app.get(PrismaService);
    A = await createTestCompany(app, 'Corr', { roles: ['MANAGER', 'SALES_EXECUTIVE', 'TECHNICIAN', 'ACCOUNTANT'] });
    B = await createTestCompany(app, 'CorrB');

    // GST for company A — placeholder TEST classification and rate only.
    const cls = await prisma.taxClassification.create({ data: { companyId: A.id, name: `Vehicle ${stamp}`, codeType: 'HSN', code: 'TEST-VEHICLE', treatment: 'TAXABLE' } });
    await prisma.taxRate.create({ data: { companyId: A.id, classificationId: cls.id, ratePercent: new Prisma.Decimal('5.00'), effectiveFrom: new Date('2020-01-01T00:00:00.000Z'), effectiveTo: null } });
    await prisma.scooterModel.update({ where: { id: A.modelId }, data: { taxClassificationId: cls.id } });
    await prisma.companySetting.update({ where: { companyId: A.id }, data: { gstEnabled: true, gstNumber: 'TEST-GSTIN-CORR', gstStateCode: '24' } });

    customerA = (await http().post('/api/v1/customers').set('Authorization', A.auth()).send({ name: `Corr A ${stamp}`, phone: `9${stamp}1` }).expect(201)).body.id;
    await prisma.customer.update({ where: { id: customerA }, data: { gstStateCode: '24' } });
    customerB = (await http().post('/api/v1/customers').set('Authorization', B.auth()).send({ name: `Corr B ${stamp}`, phone: `9${stamp}2` }).expect(201)).body.id;
  }, 60_000);

  afterAll(async () => {
    await purgeTestCompany(prisma, A?.id);
    await purgeTestCompany(prisma, B?.id);
    await app.close();
  }, E2E_HOOK_TIMEOUT);

  // ───────────────────────── Corrections (1–4, 16) ─────────────────────────
  it('1. OWNER corrects the VIN of a DELIVERED vehicle', async () => {
    const u = await unitIn('DELIVERED');
    const res = await correct(u.id, { vin: `FIXV${stamp}1`, reason }).expect(200);
    expect(res.body.vin).toBe(`FIXV${stamp}1`);
    expect(await ids(u.id)).toEqual({ vin: `FIXV${stamp}1`, motorNumber: u.motorNumber, batteryNumber: u.batteryNumber });
    expect((await row(u.id)).status).toBe('DELIVERED');
  });

  it('2. OWNER corrects the motor number of an IN_SERVICE vehicle', async () => {
    const u = await unitIn('IN_SERVICE');
    await correct(u.id, { motorNumber: `FIXM${stamp}2`, reason }).expect(200);
    expect(await ids(u.id)).toEqual({ vin: u.vin, motorNumber: `FIXM${stamp}2`, batteryNumber: u.batteryNumber });
  });

  it('3. OWNER corrects the battery number of a RETURNED vehicle', async () => {
    const u = await unitIn('RETURNED');
    await correct(u.id, { batteryNumber: `FIXB${stamp}3`, reason }).expect(200);
    expect(await ids(u.id)).toEqual({ vin: u.vin, motorNumber: u.motorNumber, batteryNumber: `FIXB${stamp}3` });
  });

  it('4. OWNER corrects all three identifiers in one request', async () => {
    const u = await unitIn('DELIVERED');
    const fixed = { vin: `FIXV${stamp}4`, motorNumber: `FIXM${stamp}4`, batteryNumber: `FIXB${stamp}4` };
    const res = await correct(u.id, { ...fixed, reason }).expect(200);
    expect(res.body).toMatchObject(fixed);
    expect(await ids(u.id)).toEqual(fixed);
  });

  it.each(['DELIVERED', 'IN_SERVICE', 'RETURNED'])('16. %s: each identifier can be corrected; the response has the ordinary unit shape', async (status) => {
    const u = await unitIn(status);
    const n = serial++;
    const res = await correct(u.id, { vin: `ALLV${stamp}${n}`, reason }).expect(200);
    await correct(u.id, { motorNumber: `ALLM${stamp}${n}`, reason }).expect(200);
    await correct(u.id, { batteryNumber: `ALLB${stamp}${n}`, reason }).expect(200);
    expect(await ids(u.id)).toEqual({ vin: `ALLV${stamp}${n}`, motorNumber: `ALLM${stamp}${n}`, batteryNumber: `ALLB${stamp}${n}` });
    // Same DTO as an ordinary edit (compared with an edit of a pre-delivery unit).
    const other = await unitIn('AVAILABLE');
    const ordinary = await edit(other.id, { location: 'Bay 2' }).expect(200);
    expect(Object.keys(res.body).sort()).toEqual(Object.keys(ordinary.body).sort());
    expect(res.body.variant).toMatchObject({ id: expect.any(String), model: expect.any(Object) });
  });

  // ───────────────────────── Authorization (5) ─────────────────────────
  describe('5. authorization', () => {
    it.each(['MANAGER', 'SALES_EXECUTIVE', 'TECHNICIAN', 'ACCOUNTANT'] as const)('%s is refused with a safe 403; nothing changes, nothing is audited', async (role) => {
      const u = await unitIn('DELIVERED');
      const res = await correct(u.id, { vin: `NOPE${stamp}${serial++}`, reason }, role).expect(403);
      expect(res.body.message).toBe('You do not have permission to perform this action');
      expect(await ids(u.id)).toEqual({ vin: u.vin, motorNumber: u.motorNumber, batteryNumber: u.batteryNumber });
      expect(await audits(u.id)).toHaveLength(0);
    });

    it('a non-owner learns nothing about whether the unit exists (403, not 404); anonymous is 401', async () => {
      await correct('00000000-0000-0000-0000-000000000000', { vin: 'X1234', reason }, 'MANAGER').expect(403);
      await http().patch('/api/v1/inventory/units/00000000-0000-0000-0000-000000000000/identification-correction').send({ vin: 'X1234', reason }).expect(401);
    });
  });

  // ───────────────────────── Validation (6–8) ─────────────────────────
  describe('6–8. validation — nothing changes, nothing is audited', () => {
    let u: Unit;
    beforeAll(async () => { u = await unitIn('DELIVERED'); }, E2E_HOOK_TIMEOUT);
    afterEach(async () => {
      expect(await ids(u.id)).toEqual({ vin: u.vin, motorNumber: u.motorNumber, batteryNumber: u.batteryNumber });
      expect(await audits(u.id)).toHaveLength(0);
    });

    /** The validation pipe answers 400 "Validation failed" with one { path, message } per problem. */
    const problems = async (body: Record<string, unknown>) => {
      const res = await correct(u.id, body).expect(400);
      expect(res.body.message).toBe('Validation failed');
      return res.body.details as { path: string; message: string }[];
    };

    it('6. a missing, blank or short (after trimming) reason is a 400', async () => {
      expect(await problems({ vin: `R${stamp}6` })).toEqual([{ path: 'reason', message: 'A reason is required' }]);
      expect(await problems({ vin: `R${stamp}6`, reason: '    ' })).toEqual([{ path: 'reason', message: 'Give a reason of at least 5 characters' }]);
      expect(await problems({ vin: `R${stamp}6`, reason: '  abcd  ' })).toEqual([{ path: 'reason', message: 'Give a reason of at least 5 characters' }]);
    });

    it('6b. no identifier at all is a 400', async () => {
      expect(await problems({ reason })).toEqual([{ path: 'vin', message: 'Give the VIN, motor, battery, controller or charger number to correct' }]);
    });

    it('7. the same values only are a 400', async () => {
      const res = await correct(u.id, { vin: u.vin, motorNumber: u.motorNumber, batteryNumber: u.batteryNumber, reason }).expect(400);
      expect(res.body.message).toBe('Nothing to correct: the identification given matches the vehicle.');
    });

    it('8. a case-only (or whitespace-only) difference is not a change', async () => {
      await correct(u.id, { vin: `  ${u.vin.toLowerCase()} `, motorNumber: u.motorNumber.toLowerCase(), reason }).expect(400);
    });

    it('request-supplied companyId / userId are ignored, never used', async () => {
      // Stripped by the schema — the result is still "same values only".
      await correct(u.id, { vin: u.vin, reason, companyId: B.id, userId: B.user().id }).expect(400);
    });
  });

  // ───────────────────────── Uniqueness, atomically (9–11) ─────────────────────────
  describe('9–11. uniqueness — refused atomically: no field changes, no audit', () => {
    let u: Unit;
    let taken: Unit;
    beforeAll(async () => {
      u = await unitIn('DELIVERED');
      taken = await newUnit(A);
    }, E2E_HOOK_TIMEOUT);
    afterEach(async () => {
      expect(await ids(u.id)).toEqual({ vin: u.vin, motorNumber: u.motorNumber, batteryNumber: u.batteryNumber });
      expect(await audits(u.id)).toHaveLength(0);
    });

    it("9. another unit's VIN → 409, and the battery change sent alongside is not applied", async () => {
      const res = await correct(u.id, { vin: taken.vin, batteryNumber: `FRESH${stamp}9`, reason }).expect(409);
      expect(res.body.message).toBe(`A scooter with VIN ${taken.vin} already exists`);
    });

    it("10. another unit's motor number → 409, and the VIN change sent alongside is not applied", async () => {
      await correct(u.id, { vin: `FRESH${stamp}10`, motorNumber: taken.motorNumber, reason }).expect(409);
    });

    it("11. another unit's battery number → 409, and the motor change sent alongside is not applied", async () => {
      await correct(u.id, { motorNumber: `FRESH${stamp}11`, batteryNumber: taken.batteryNumber, reason }).expect(409);
    });
  });

  // ───────────────────────── Audit (12–13) ─────────────────────────
  it('12–13. one request → exactly one audit entry, with the reason and exact from / to values', async () => {
    const u = await unitIn('IN_SERVICE');
    const before = await prisma.activityLog.count({ where: { companyId: A.id } });
    const to = { vin: `AUDV${stamp}`, motorNumber: u.motorNumber, batteryNumber: `AUDB${stamp}` }; // motor unchanged
    await correct(u.id, { ...to, reason: `   ${reason}   ` }).expect(200);
    expect(await prisma.activityLog.count({ where: { companyId: A.id } })).toBe(before + 1);
    const [entry, ...rest] = await audits(u.id);
    expect(rest).toHaveLength(0);
    expect(entry).toMatchObject({ companyId: A.id, actorId: A.user().id, action: 'UPDATE', entityType: 'InventoryUnit', entityId: u.id });
    expect(entry!.metadata).toEqual({
      identificationCorrection: {
        reason,
        changes: [{ field: 'vin', from: u.vin, to: to.vin }, { field: 'batteryNumber', from: u.batteryNumber, to: to.batteryNumber }],
      },
    });
    expect(entry!.summary).toBe(`Updated scooter ${u.vin}: vin ${u.vin} → ${to.vin}; batteryNumber ${u.batteryNumber} → ${to.batteryNumber} (identification correction)`);
  });

  // ───────────────────────── History is not rewritten (14–15) ─────────────────────────
  describe('14–15. historical records', () => {
    const history = async (unitId: string) => {
      const bookings = await prisma.booking.findMany({ where: { unitId }, orderBy: { id: 'asc' } });
      const sales = await prisma.sale.findMany({ where: { unitId }, orderBy: { id: 'asc' } });
      const saleIds = sales.map((s) => s.id);
      const warranties = await prisma.warranty.findMany({ where: { unitId }, orderBy: { id: 'asc' } });
      const amcPlans = await prisma.amcPlan.findMany({ where: { unitId }, orderBy: { id: 'asc' } });
      const serviceJobs = await prisma.serviceJob.findMany({ where: { unitId }, orderBy: { id: 'asc' } });
      const deliveries = await prisma.delivery.findMany({ where: { saleId: { in: saleIds } }, orderBy: { id: 'asc' } });
      const snapshots = await prisma.taxSnapshot.findMany({ where: { saleId: { in: saleIds } }, orderBy: { id: 'asc' } });
      return {
        bookings,
        sales,
        saleItems: await prisma.saleItem.findMany({ where: { saleId: { in: saleIds } }, orderBy: { id: 'asc' } }),
        payments: await prisma.payment.findMany({ where: { bookingId: { in: bookings.map((b) => b.id) } }, orderBy: { id: 'asc' } }),
        deliveries,
        checklists: await prisma.deliveryChecklist.findMany({ where: { deliveryId: { in: deliveries.map((d) => d.id) } }, orderBy: { id: 'asc' } }),
        warranties,
        freeServices: await prisma.freeService.findMany({ where: { warrantyId: { in: warranties.map((w) => w.id) } }, orderBy: { id: 'asc' } }),
        amcPlans,
        amcVisits: await prisma.amcVisit.findMany({ where: { amcPlanId: { in: amcPlans.map((p) => p.id) } }, orderBy: { id: 'asc' } }),
        serviceJobs,
        complaints: await prisma.serviceComplaint.findMany({ where: { serviceJobId: { in: serviceJobs.map((j) => j.id) } }, orderBy: { id: 'asc' } }),
        returns: await prisma.vehicleReturn.findMany({ where: { unitId }, orderBy: { id: 'asc' } }),
        creditNotes: await prisma.creditNote.findMany({ where: { saleId: { in: saleIds } }, orderBy: { id: 'asc' } }),
        refunds: await prisma.refund.findMany({ where: { saleId: { in: saleIds } }, orderBy: { id: 'asc' } }),
        snapshots,
        snapshotLines: await prisma.taxSnapshotLine.findMany({ where: { snapshotId: { in: snapshots.map((s) => s.id) } }, orderBy: { id: 'asc' } }),
        events: await prisma.inventoryEvent.findMany({ where: { unitId }, orderBy: { id: 'asc' } }),
      };
    };

    it('14–15. a delivered vehicle with warranty, AMC and a service job, then returned: nothing but the unit changes', async () => {
      const u = await newUnit(A);
      const { saleId } = await deliver(A, customerA, u.id);
      expect(await prisma.warranty.count({ where: { unitId: u.id } })).toBe(1); // issued on delivery
      const amc = await http().post('/api/v1/amc').set('Authorization', A.auth())
        .send({ unitId: u.id, customerId: customerA, planType: 'GOLD', months: 12, visitsIncluded: 3, price: 300000 }).expect(201);
      await http().post(`/api/v1/amc/${amc.body.id}/visits`).set('Authorization', A.auth()).send({ workDone: 'General service', amount: 0, coveredUnderAmc: true }).expect(201);
      await http().post('/api/v1/service/jobs').set('Authorization', A.auth())
        .send({ customerId: customerA, unitId: u.id, type: 'PAID', complaints: [{ description: 'Brake noise' }] }).expect(201);

      const before = await history(u.id);
      for (const key of ['bookings', 'sales', 'payments', 'deliveries', 'warranties', 'freeServices', 'amcPlans', 'amcVisits', 'serviceJobs', 'snapshots', 'snapshotLines'] as const) {
        expect(before[key].length).toBeGreaterThan(0);
      }
      const status = (await row(u.id)).status;
      const first = { vin: `HISV${stamp}`, motorNumber: `HISM${stamp}`, batteryNumber: `HISB${stamp}` };
      await correct(u.id, { ...first, reason }).expect(200);
      expect(await history(u.id)).toEqual(before);
      // The warranty keeps the numbers it recorded at issue; the unit has the corrected ones.
      expect(before.warranties[0]).toMatchObject({ motorNumber: u.motorNumber, batteryNumber: u.batteryNumber });
      expect(await ids(u.id)).toEqual(first);
      expect((await row(u.id)).status).toBe(status);

      // Returned afterwards: the return records, too, are untouched by a later correction.
      if (status !== 'DELIVERED') await setStatus(A, u.id, 'DELIVERED'); // a service job may have moved it
      await returnVehicle(A, saleId);
      const returned = await history(u.id);
      for (const key of ['returns', 'creditNotes', 'refunds'] as const) expect(returned[key].length).toBeGreaterThan(0);
      await correct(u.id, { vin: `HISV${stamp}R`, reason }).expect(200);
      expect(await history(u.id)).toEqual(returned);
    });
  });

  // ───────────────────────── Tenant isolation (17) ─────────────────────────
  describe('17. tenant isolation', () => {
    it("another company's owner gets 404 for this company's unit; nothing changes, nothing is audited", async () => {
      const u = await unitIn('DELIVERED');
      await correct(u.id, { vin: `TENV${stamp}`, reason }, 'OWNER', B).expect(404);
      expect(await ids(u.id)).toEqual({ vin: u.vin, motorNumber: u.motorNumber, batteryNumber: u.batteryNumber });
      expect(await audits(u.id)).toHaveLength(0);
    });

    it("each company corrects its own units only; a VIN already used in another company is still refused (409), atomically", async () => {
      const mine = await unitIn('DELIVERED');
      const theirs = await unitIn('DELIVERED', B, customerB);
      await correct(theirs.id, { motorNumber: `TENM${stamp}`, reason }, 'OWNER', B).expect(200);
      await correct(mine.id, { vin: theirs.vin, motorNumber: `TENX${stamp}`, reason }).expect(409);
      expect(await ids(mine.id)).toEqual({ vin: mine.vin, motorNumber: mine.motorNumber, batteryNumber: mine.batteryNumber });
      expect(await audits(mine.id)).toHaveLength(0);
      const [entry] = await audits(theirs.id);
      expect(entry!.companyId).toBe(B.id);
    });
  });

  // ───────────────────────── M4B.2 unchanged ─────────────────────────
  describe('the ordinary edit (M4B.2) is unchanged', () => {
    it.each(['AVAILABLE', 'RESERVED', 'BOOKED'])('%s (never committed): the ordinary edit changes identification; the correction endpoint refuses (409)', async (status) => {
      const u = await unitIn(status);
      const res = await correct(u.id, { vin: `ORDV${stamp}${serial++}`, reason }).expect(409);
      expect(res.body.message).toBe('Identification correction applies only to delivered, in-service or returned vehicles, or to vehicles with a sale, warranty or AMC history — edit this vehicle instead.');
      const vin = `ORDV${stamp}${serial++}`;
      await edit(u.id, { vin }).expect(200);
      expect((await row(u.id)).vin).toBe(vin);
    });

    it.each(['DELIVERED', 'IN_SERVICE', 'RETURNED'])('%s: the ordinary edit still refuses identification changes (409)', async (status) => {
      const u = await unitIn(status);
      const res = await edit(u.id, { vin: `ORDX${stamp}${serial++}` }).expect(409);
      expect(res.body.message).toBe('Vehicle identification cannot be changed after delivery.');
      expect(await ids(u.id)).toEqual({ vin: u.vin, motorNumber: u.motorNumber, batteryNumber: u.batteryNumber });
    });
  });
});
