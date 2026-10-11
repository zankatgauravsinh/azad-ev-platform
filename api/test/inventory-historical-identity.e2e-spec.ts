import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createE2eApp, E2E_HOOK_TIMEOUT } from './support/e2e-app';
import { createTestCompany, purgeTestCompany, TestCompany } from './support/e2e-company';

/**
 * M4B.4 — a vehicle with committed history (a Sale, a Warranty or an AMC plan, cancelled ones included)
 * keeps its identity protected for good: the ordinary edit can no longer change its model / variant /
 * colour or its VIN / motor / battery number, whatever its current status (e.g. restocked AVAILABLE
 * after a return). The owner identification correction (M4B.3) is the only path for its identifiers;
 * its model / variant / colour cannot be changed at all.
 *
 * Runs in throwaway companies (see support/e2e-company), hard-deleted afterwards.
 */
describe('Historical vehicle identity protection (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let A: TestCompany;
  let B: TestCompany;
  let customerA = '';
  let customerB = '';
  const stamp = Date.now().toString().slice(-8);
  let serial = 0;
  const http = () => request(app.getHttpServer());

  const HISTORY_IDENTIFICATION = 'Vehicle identification cannot be changed once the vehicle has a sale, warranty or AMC history — use the owner identification correction.';
  const HISTORY_VARIANT = 'Vehicle model/variant cannot be changed once the vehicle has a sale, warranty or AMC history.';
  const AFTER_DELIVERY = 'Vehicle identification cannot be changed after delivery.';
  const VARIANT_AFTER_BOOKING = 'Vehicle model/variant cannot be changed after booking or delivery.';
  const NOT_ELIGIBLE = 'Identification correction applies only to delivered, in-service or returned vehicles, or to vehicles with a sale, warranty or AMC history — edit this vehicle instead.';
  const reason = 'Number mistyped at stock entry';

  interface Unit { id: string; vin: string; motorNumber: string; batteryNumber: string; variantId: string }

  const newUnit = async (co: TestCompany = A, colour = 'Teal'): Promise<Unit> => {
    const n = serial++;
    const res = await http().post('/api/v1/inventory/units').set('Authorization', co.auth())
      .send({ modelId: co.modelId, variant: 'Std', colour, vin: `HIV${stamp}${n}`, motorNumber: `HIM${stamp}${n}`, batteryNumber: `HIB${stamp}${n}` }).expect(201);
    return { id: res.body.id, vin: res.body.vin, motorNumber: res.body.motorNumber, batteryNumber: res.body.batteryNumber, variantId: res.body.variant.id };
  };
  const setStatus = (id: string, toStatus: string) =>
    http().patch(`/api/v1/inventory/units/${id}/status`).set('Authorization', A.auth()).send({ toStatus }).expect(200);
  const book = async (unitId: string): Promise<{ id: string; balance: number }> => {
    const res = await http().post('/api/v1/bookings').set('Authorization', A.auth()).send({ customerId: customerA, unitId, exShowroom: 1_100_000 }).expect(201);
    return { id: res.body.id, balance: Number(res.body.paymentSummary.balance) };
  };
  /** Paid and invoiced (creates the Sale) — the unit stays BOOKED. */
  const invoice = async (unitId: string): Promise<string> => {
    const b = await book(unitId);
    await http().post(`/api/v1/bookings/${b.id}/payments`).set('Authorization', A.auth()).send({ amount: b.balance, mode: 'UPI' }).expect(201);
    await http().post(`/api/v1/bookings/${b.id}/invoice`).set('Authorization', A.auth()).expect(201);
    return b.id;
  };
  const deliver = async (unitId: string): Promise<string> => {
    const bookingId = await invoice(unitId);
    await http().post(`/api/v1/bookings/${bookingId}/deliver`).set('Authorization', A.auth()).send({}).expect(201);
    return (await prisma.sale.findFirstOrThrow({ where: { bookingId } })).id;
  };
  /** Requested by the owner; inspected, approved and completed by the manager with the given disposition. */
  const returnVehicle = async (saleId: string, disposition: 'AVAILABLE' | 'IN_SERVICE' | 'SCRAP'): Promise<void> => {
    const req = await http().post('/api/v1/returns').set('Authorization', A.auth()).send({ saleId, reason: 'history test' }).expect(201);
    await http().post(`/api/v1/returns/${req.body.id}/inspect`).set('Authorization', A.auth('MANAGER')).send({ inspectionOk: true }).expect(201);
    await http().post(`/api/v1/returns/${req.body.id}/approve`).set('Authorization', A.auth('MANAGER')).send({}).expect(201);
    await http().post(`/api/v1/returns/${req.body.id}/complete`).set('Authorization', A.auth('MANAGER')).send({ disposition, deductionAmount: 0, refundMethod: 'UPI' }).expect(201);
  };
  const warranty = async (unitId: string): Promise<string> =>
    (await http().post('/api/v1/warranties').set('Authorization', A.auth()).send({ unitId, customerId: customerA, periodMonths: 24 }).expect(201)).body.warranty.id;
  const amc = async (unitId: string): Promise<string> =>
    (await http().post('/api/v1/amc').set('Authorization', A.auth()).send({ unitId, customerId: customerA, planType: 'GOLD', months: 12, visitsIncluded: 2, price: 100000 }).expect(201)).body.id;

  const edit = (id: string, body: Record<string, unknown>, co: TestCompany = A) =>
    http().patch(`/api/v1/inventory/units/${id}`).set('Authorization', co.auth()).send(body);
  const correct = (id: string, body: Record<string, unknown>, co: TestCompany = A) =>
    http().patch(`/api/v1/inventory/units/${id}/identification-correction`).set('Authorization', co.auth()).send(body);
  const row = (id: string) => prisma.inventoryUnit.findUniqueOrThrow({ where: { id } });
  const identity = async (id: string) => {
    const r = await row(id);
    return { vin: r.vin, motorNumber: r.motorNumber, batteryNumber: r.batteryNumber, variantId: r.variantId };
  };
  const original = (u: Unit) => ({ vin: u.vin, motorNumber: u.motorNumber, batteryNumber: u.batteryNumber, variantId: u.variantId });
  const updateAudits = (unitId: string) => prisma.activityLog.count({ where: { entityType: 'InventoryUnit', entityId: unitId, action: 'UPDATE' } });

  let redVariantId = '';

  beforeAll(async () => {
    app = await createE2eApp();
    prisma = app.get(PrismaService);
    A = await createTestCompany(app, 'Hist', { roles: ['MANAGER'] });
    B = await createTestCompany(app, 'HistB');
    customerA = (await http().post('/api/v1/customers').set('Authorization', A.auth()).send({ name: `Hist A ${stamp}`, phone: `8${stamp}1` }).expect(201)).body.id;
    customerB = (await http().post('/api/v1/customers').set('Authorization', B.auth()).send({ name: `Hist B ${stamp}`, phone: `8${stamp}2` }).expect(201)).body.id;
    redVariantId = (await newUnit(A, 'Red')).variantId; // a second variant of the same model
  }, 60_000);

  afterAll(async () => {
    await purgeTestCompany(prisma, A?.id);
    await purgeTestCompany(prisma, B?.id);
    await app.close();
  }, E2E_HOOK_TIMEOUT);

  // ───────────────────── Committed vehicles whose status is editable again ─────────────────────
  type Prepare = () => Promise<Unit>;
  const restocked: Prepare = async () => { const u = await newUnit(); await returnVehicle(await deliver(u.id), 'AVAILABLE'); return u; };
  const committedEditableStatus: [string, string, Prepare][] = [
    ['3. BOOKED with an invoice (Sale)', 'BOOKED', async () => { const u = await newUnit(); await invoice(u.id); return u; }],
    ['5. returned and restocked AVAILABLE', 'AVAILABLE', restocked],
    ['5b. returned, restocked, then RESERVED', 'RESERVED', async () => { const u = await restocked(); await setStatus(u.id, 'RESERVED'); return u; }],
    ['5c. returned, restocked, then booked again (no new invoice)', 'BOOKED', async () => { const u = await restocked(); await book(u.id); return u; }],
    ['8. AVAILABLE with a warranty', 'AVAILABLE', async () => { const u = await newUnit(); await warranty(u.id); return u; }],
    ['8b. AVAILABLE with a CANCELLED warranty', 'AVAILABLE', async () => {
      const u = await newUnit();
      await http().post(`/api/v1/warranties/${await warranty(u.id)}/cancel`).set('Authorization', A.auth()).send({}).expect(201);
      return u;
    }],
    ['9. AVAILABLE with an AMC plan', 'AVAILABLE', async () => { const u = await newUnit(); await amc(u.id); return u; }],
    ['9b. AVAILABLE with a CANCELLED AMC plan', 'AVAILABLE', async () => {
      const u = await newUnit();
      await prisma.amcPlan.update({ where: { id: await amc(u.id) }, data: { status: 'CANCELLED' } }); // no cancel endpoint; the record remains
      return u;
    }],
  ];

  describe.each(committedEditableStatus)('%s', (_label, status, prepare) => {
    let u: Unit;
    beforeAll(async () => {
      u = await prepare();
      expect((await row(u.id)).status).toBe(status);
    }, E2E_HOOK_TIMEOUT);

    it('11. the ordinary edit refuses VIN / motor / battery changes atomically: nothing else in the request is applied, nothing audited', async () => {
      const before = await row(u.id);
      const audits = await updateAudits(u.id);
      for (const change of [{ vin: `XV${stamp}${serial++}` }, { motorNumber: `XM${stamp}${serial++}` }, { batteryNumber: `XB${stamp}${serial++}` }]) {
        const res = await edit(u.id, { ...change, location: 'Moved', notes: 'should not apply', sellingPrice: 1 }).expect(409);
        expect(res.body.message).toBe(HISTORY_IDENTIFICATION);
      }
      const after = await row(u.id);
      expect(after).toMatchObject({ ...original(u), location: before.location, notes: before.notes, sellingPrice: before.sellingPrice });
      expect(await updateAudits(u.id)).toBe(audits);
    });

    it('the ordinary edit refuses a model / variant / colour change (curated and free text)', async () => {
      const expected = status === 'BOOKED' ? VARIANT_AFTER_BOOKING : HISTORY_VARIANT; // the M4B status rule still comes first
      expect((await edit(u.id, { variantId: redVariantId }).expect(409)).body.message).toBe(expected);
      expect((await edit(u.id, { variant: 'Std', colour: 'Red' }).expect(409)).body.message).toBe(expected);
      expect((await edit(u.id, { variant: 'Std', colour: `Lime${serial++}` }).expect(409)).body.message).toBe(expected);
      expect(await identity(u.id)).toEqual(original(u));
    });

    it('15. notes / location / supplier / price still update; sending the current identity is not a change', async () => {
      const res = await edit(u.id, { notes: 'kept', location: 'Bay 7', supplier: 'Acme', sellingPrice: 1_234_500, vin: u.vin, variantId: u.variantId }).expect(200);
      expect(res.body).toMatchObject({ notes: 'kept', location: 'Bay 7', supplier: 'Acme', sellingPrice: '1234500' });
      expect(await identity(u.id)).toEqual(original(u));
    });

    it('12 + 17. the owner correction works, with exactly one audit entry carrying the reason and exact from / to', async () => {
      const audits = await updateAudits(u.id);
      const to = { vin: `CV${stamp}${serial++}`, batteryNumber: `CB${stamp}${serial++}` };
      await correct(u.id, { ...to, reason }).expect(200);
      expect(await identity(u.id)).toEqual({ ...original(u), ...to });
      expect(await updateAudits(u.id)).toBe(audits + 1);
      const entry = await prisma.activityLog.findFirstOrThrow({ where: { entityType: 'InventoryUnit', entityId: u.id, action: 'UPDATE' }, orderBy: { createdAt: 'desc' } });
      expect(entry.metadata).toEqual({ identificationCorrection: { reason, changes: [{ field: 'vin', from: u.vin, to: to.vin }, { field: 'batteryNumber', from: u.batteryNumber, to: to.batteryNumber }] } });
      expect((await row(u.id)).status).toBe(status);
      Object.assign(u, to);
    });

    it('14. the owner correction cannot change model / variant / colour (400, nothing changes)', async () => {
      for (const extra of [{ variantId: redVariantId }, { colour: 'Red' }, { modelId: A.modelId }]) {
        const res = await correct(u.id, { vin: `NV${stamp}${serial++}`, reason, ...extra }).expect(400);
        expect(res.body.details).toEqual([{ path: Object.keys(extra)[0], message: 'Model, variant and colour cannot be changed by an identification correction' }]);
      }
      expect(await identity(u.id)).toEqual(original(u));
    });
  });

  // ───────────────────── Committed by status (M4B.2 / M4B.3 unchanged) ─────────────────────
  const lockedByStatus: [string, string, Prepare][] = [
    ['4. DELIVERED', 'DELIVERED', async () => { const u = await newUnit(); await deliver(u.id); return u; }],
    ['6. returned to IN_SERVICE', 'IN_SERVICE', async () => { const u = await newUnit(); await returnVehicle(await deliver(u.id), 'IN_SERVICE'); return u; }],
    ['7. returned as SCRAP (RETURNED)', 'RETURNED', async () => { const u = await newUnit(); await returnVehicle(await deliver(u.id), 'SCRAP'); return u; }],
  ];

  describe.each(lockedByStatus)('%s', (_label, status, prepare) => {
    let u: Unit;
    beforeAll(async () => { u = await prepare(); expect((await row(u.id)).status).toBe(status); }, E2E_HOOK_TIMEOUT);

    it('the ordinary edit keeps refusing identity changes with the status messages', async () => {
      expect((await edit(u.id, { vin: `SV${stamp}${serial++}` }).expect(409)).body.message).toBe(AFTER_DELIVERY);
      expect((await edit(u.id, { variantId: redVariantId }).expect(409)).body.message).toBe(VARIANT_AFTER_BOOKING);
      expect(await identity(u.id)).toEqual(original(u));
    });

    it('13. the owner correction keeps working', async () => {
      const to = { motorNumber: `SM${stamp}${serial++}` };
      await correct(u.id, { ...to, reason }).expect(200);
      expect(await identity(u.id)).toEqual({ ...original(u), ...to });
      expect((await row(u.id)).status).toBe(status); // SCRAP stays RETURNED; nothing re-stocks it
    });
  });

  // ───────────────────── Never committed (unchanged behaviour) ─────────────────────
  describe('never committed', () => {
    it.each(['AVAILABLE', 'RESERVED'])('1. %s: the ordinary edit changes identifiers and variant; the correction refuses (409)', async (status) => {
      const u = await newUnit();
      if (status === 'RESERVED') await setStatus(u.id, 'RESERVED');
      const to = { vin: `NV${stamp}${serial++}`, motorNumber: `NM${stamp}${serial++}`, batteryNumber: `NB${stamp}${serial++}` };
      await edit(u.id, to).expect(200);
      await edit(u.id, { variantId: redVariantId }).expect(200);
      expect(await identity(u.id)).toEqual({ ...to, variantId: redVariantId });
      expect((await correct(u.id, { vin: `NC${stamp}${serial++}`, reason }).expect(409)).body.message).toBe(NOT_ELIGIBLE);
    });

    it('2. BOOKED without an invoice: identifiers editable (M4B.2), variant locked (M4B), correction refused', async () => {
      const u = await newUnit();
      await book(u.id);
      const vin = `BV${stamp}${serial++}`;
      await edit(u.id, { vin }).expect(200);
      expect((await edit(u.id, { variantId: redVariantId }).expect(409)).body.message).toBe(VARIANT_AFTER_BOOKING);
      expect((await correct(u.id, { vin: `BC${stamp}${serial++}`, reason }).expect(409)).body.message).toBe(NOT_ELIGIBLE);
      expect(await identity(u.id)).toEqual({ ...original(u), vin });
    });

    it('10. a service job alone does not commit the vehicle: still AVAILABLE and editable', async () => {
      const u = await newUnit();
      await http().post('/api/v1/service/jobs').set('Authorization', A.auth()).send({ customerId: customerA, unitId: u.id, type: 'PAID', complaints: [{ description: 'PDI' }] }).expect(201);
      expect((await row(u.id)).status).toBe('AVAILABLE');
      const vin = `SJ${stamp}${serial++}`;
      await edit(u.id, { vin, variantId: redVariantId }).expect(200);
      expect(await identity(u.id)).toMatchObject({ vin, variantId: redVariantId });
      expect((await correct(u.id, { vin: `SC${stamp}${serial++}`, reason }).expect(409)).body.message).toBe(NOT_ELIGIBLE);
    });

    it('10b. a never-sold vehicle put IN_SERVICE keeps the M4B.2 status rule (ordinary edit 409, correction allowed)', async () => {
      const u = await newUnit();
      await setStatus(u.id, 'IN_SERVICE');
      expect((await edit(u.id, { vin: `IS${stamp}${serial++}` }).expect(409)).body.message).toBe(AFTER_DELIVERY);
      await correct(u.id, { vin: `IC${stamp}${serial++}`, reason }).expect(200);
    });
  });

  // ───────────────────── Tenant isolation (16) ─────────────────────
  describe('16. tenant isolation', () => {
    it("another company can neither edit nor correct this company's committed vehicle (404); its own vehicles follow their own history", async () => {
      const mine = await newUnit();
      await warranty(mine.id);
      await edit(mine.id, { notes: 'x' }, B).expect(404);
      await edit(mine.id, { vin: `TV${stamp}${serial++}` }, B).expect(404);
      await correct(mine.id, { vin: `TC${stamp}${serial++}`, reason }, B).expect(404);
      expect(await identity(mine.id)).toEqual(original(mine));

      const theirs = await newUnit(B);
      await edit(theirs.id, { vin: `TB${stamp}${serial++}` }, B).expect(200); // never committed in B
      await http().post('/api/v1/warranties').set('Authorization', B.auth()).send({ unitId: theirs.id, customerId: customerB, periodMonths: 12 }).expect(201);
      expect((await edit(theirs.id, { vin: `TB${stamp}${serial++}` }, B).expect(409)).body.message).toBe(HISTORY_IDENTIFICATION);
    });
  });

  // ───────────────────── Concurrency ─────────────────────
  it('an edit that races a warranty being created waits for it, then sees it and refuses (no lost protection)', async () => {
    const u = await newUnit();
    let inserted!: () => void;
    let release!: () => void;
    const insertedSignal = new Promise<void>((resolve) => { inserted = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    // A warranty insert held open in its own transaction: Postgres keeps a KEY SHARE lock on the unit.
    const pending = prisma.$transaction(async (tx) => {
      const today = new Date();
      await tx.warranty.create({
        data: { companyId: A.id, warrantyNumber: `RACE-${stamp}`, customerId: customerA, unitId: u.id, purchaseDate: today, startDate: today, endDate: today, periodMonths: 1 },
      });
      inserted();
      await gate;
    }, { timeout: 20_000 });
    await insertedSignal;

    const racing = edit(u.id, { vin: `RV${stamp}${serial++}` }).then((res) => res);
    await new Promise((resolve) => setTimeout(resolve, 300)); // the edit is now waiting on the unit's row lock
    release();
    await pending;
    const res = await racing;
    expect(res.status).toBe(409);
    expect(res.body.message).toBe(HISTORY_IDENTIFICATION);
    expect(await identity(u.id)).toEqual(original(u));
  });
});
