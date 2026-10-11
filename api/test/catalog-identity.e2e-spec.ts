import { INestApplication } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createE2eApp, E2E_HOOK_TIMEOUT } from './support/e2e-app';
import { createTestCompany, purgeTestCompany, TestCompany } from './support/e2e-company';

/**
 * M4B.5 — catalogue identity protection. A variant's name / colour — and its model's brand / name — are
 * locked once any unit of it is BOOKED, DELIVERED, IN_SERVICE or RETURNED, or has a Sale (soft-deleted
 * included), Warranty (cancelled included) or AMC plan (cancelled included). Description, list price,
 * specifications, hex colour and active state stay editable. Quotations and service jobs alone do not lock.
 *
 * Company A has GST enabled with placeholder TEST values only (so its sales carry a tax snapshot);
 * company B is another tenant. Both are throwaway companies, hard-deleted afterwards.
 */
describe('Catalogue identity protection (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let A: TestCompany;
  let B: TestCompany;
  let customerA = '';
  let classificationId = '';
  const stamp = Date.now().toString().slice(-8);
  let serial = 0;
  const http = () => request(app.getHttpServer());

  const MODEL_LOCKED = 'Model brand/name cannot be changed: vehicles of this model are booked, delivered or have sale, warranty or AMC history. Add a new model instead.';
  const VARIANT_LOCKED = 'Variant name/colour cannot be changed: vehicles of this variant are booked, delivered or have sale, warranty or AMC history. Add a new variant instead.';

  interface Cat { modelId: string; variantId: string; modelName: string; variantName: string }

  /** A fresh model with one variant (A by default), GST-classified with the placeholder TEST class. */
  const catalogue = async (co: TestCompany = A, variantName = 'Pro'): Promise<Cat> => {
    const n = serial++;
    const modelName = `Cat ${stamp} ${n}`;
    const modelId = (await http().post('/api/v1/inventory/models').set('Authorization', co.auth()).send({ brand: 'TESTBRAND', name: modelName }).expect(201)).body.id;
    if (co === A) await prisma.scooterModel.update({ where: { id: modelId }, data: { taxClassificationId: classificationId } });
    const variantId = await addVariant(modelId, variantName, 'Red', co);
    return { modelId, variantId, modelName, variantName };
  };
  const addVariant = async (modelId: string, name: string, colour: string, co: TestCompany = A): Promise<string> =>
    (await http().post(`/api/v1/inventory/models/${modelId}/variants`).set('Authorization', co.auth()).send({ name, colour, exShowroomPrice: 1_100_000 }).expect(201)).body.id;
  const unit = async (variantId: string, co: TestCompany = A): Promise<string> => {
    const n = serial++;
    return (await http().post('/api/v1/inventory/units').set('Authorization', co.auth())
      .send({ variantId, vin: `CIV${stamp}${n}`, motorNumber: `CIM${stamp}${n}`, batteryNumber: `CIB${stamp}${n}` }).expect(201)).body.id;
  };
  const book = async (unitId: string) => {
    const res = await http().post('/api/v1/bookings').set('Authorization', A.auth()).send({ customerId: customerA, unitId, exShowroom: 1_100_000 }).expect(201);
    return { id: res.body.id as string, balance: Number(res.body.paymentSummary.balance) };
  };
  const deliver = async (unitId: string): Promise<string> => {
    const b = await book(unitId);
    await http().post(`/api/v1/bookings/${b.id}/payments`).set('Authorization', A.auth()).send({ amount: b.balance, mode: 'UPI' }).expect(201);
    await http().post(`/api/v1/bookings/${b.id}/invoice`).set('Authorization', A.auth()).expect(201);
    await http().post(`/api/v1/bookings/${b.id}/deliver`).set('Authorization', A.auth()).send({}).expect(201);
    return (await prisma.sale.findFirstOrThrow({ where: { bookingId: b.id } })).id;
  };
  /** Delivered, then returned and restocked AVAILABLE: only the Sale history is left to lock it. */
  const restocked = async (variantId: string): Promise<{ unitId: string; saleId: string }> => {
    const unitId = await unit(variantId);
    const saleId = await deliver(unitId);
    const req = await http().post('/api/v1/returns').set('Authorization', A.auth()).send({ saleId, reason: 'catalogue test' }).expect(201);
    await http().post(`/api/v1/returns/${req.body.id}/inspect`).set('Authorization', A.auth('MANAGER')).send({ inspectionOk: true }).expect(201);
    await http().post(`/api/v1/returns/${req.body.id}/approve`).set('Authorization', A.auth('MANAGER')).send({}).expect(201);
    await http().post(`/api/v1/returns/${req.body.id}/complete`).set('Authorization', A.auth('MANAGER')).send({ disposition: 'AVAILABLE', deductionAmount: 0, refundMethod: 'UPI' }).expect(201);
    expect((await prisma.inventoryUnit.findUniqueOrThrow({ where: { id: unitId } })).status).toBe('AVAILABLE');
    return { unitId, saleId };
  };
  const warranty = async (unitId: string): Promise<string> =>
    (await http().post('/api/v1/warranties').set('Authorization', A.auth()).send({ unitId, customerId: customerA, periodMonths: 12 }).expect(201)).body.warranty.id;
  const amc = async (unitId: string): Promise<string> =>
    (await http().post('/api/v1/amc').set('Authorization', A.auth()).send({ unitId, customerId: customerA, planType: 'GOLD', months: 12, visitsIncluded: 2, price: 100000 }).expect(201)).body.id;

  const patchModel = (id: string, body: Record<string, unknown>, co: TestCompany = A) => http().patch(`/api/v1/inventory/models/${id}`).set('Authorization', co.auth()).send(body);
  const patchVariant = (id: string, body: Record<string, unknown>, co: TestCompany = A) => http().patch(`/api/v1/inventory/variants/${id}`).set('Authorization', co.auth()).send(body);
  const getModel = async (id: string) => (await http().get(`/api/v1/inventory/models/${id}`).set('Authorization', A.auth()).expect(200)).body;
  const listedVariant = async (modelId: string, id: string) =>
    ((await http().get(`/api/v1/inventory/variants?modelId=${modelId}&status=all`).set('Authorization', A.auth()).expect(200)).body as { id: string; identityLocked: boolean }[]).find((v) => v.id === id)!;
  const listedModel = async (id: string) =>
    ((await http().get('/api/v1/inventory/models?status=all').set('Authorization', A.auth()).expect(200)).body as { id: string; identityLocked: boolean }[]).find((m) => m.id === id)!;
  const stored = async (c: Cat) => ({
    model: await prisma.scooterModel.findUniqueOrThrow({ where: { id: c.modelId }, select: { brand: true, name: true } }),
    variant: await prisma.scooterVariant.findUniqueOrThrow({ where: { id: c.variantId }, select: { name: true, colour: true } }),
  });
  const catalogueAudits = (c: Cat) => prisma.activityLog.count({ where: { entityId: { in: [c.modelId, c.variantId] }, action: 'UPDATE' } });

  /** Every identity change on a locked catalogue entry is refused; nothing changes; nothing is audited. */
  const expectLocked = async (c: Cat): Promise<void> => {
    const before = await stored(c);
    const audits = await catalogueAudits(c);
    expect((await patchVariant(c.variantId, { name: `${c.variantName} X`, exShowroomPrice: 1 }).expect(409)).body.message).toBe(VARIANT_LOCKED);
    expect((await patchVariant(c.variantId, { colour: 'Blue' }).expect(409)).body.message).toBe(VARIANT_LOCKED);
    expect((await patchModel(c.modelId, { name: `${c.modelName} X`, description: 'not applied' }).expect(409)).body.message).toBe(MODEL_LOCKED);
    expect((await patchModel(c.modelId, { brand: 'OTHERBRAND' }).expect(409)).body.message).toBe(MODEL_LOCKED);
    expect(await stored(c)).toEqual(before);
    expect(await catalogueAudits(c)).toBe(audits);
    expect((await getModel(c.modelId)).identityLocked).toBe(true);
    expect((await listedModel(c.modelId)).identityLocked).toBe(true);
    expect((await listedVariant(c.modelId, c.variantId)).identityLocked).toBe(true);
  };
  const expectUnlocked = async (c: Cat): Promise<void> => {
    expect((await listedVariant(c.modelId, c.variantId)).identityLocked).toBe(false);
    expect((await getModel(c.modelId)).identityLocked).toBe(false);
    const variant = await patchVariant(c.variantId, { name: `${c.variantName} Renamed`, colour: 'Blue' }).expect(200);
    expect(variant.body).toMatchObject({ name: `${c.variantName} Renamed`, colour: 'Blue', identityLocked: false });
    const model = await patchModel(c.modelId, { brand: 'NEWBRAND', name: `${c.modelName} Renamed` }).expect(200);
    expect(model.body).toMatchObject({ brand: 'NEWBRAND', name: `${c.modelName} Renamed`, identityLocked: false });
  };

  beforeAll(async () => {
    app = await createE2eApp();
    prisma = app.get(PrismaService);
    A = await createTestCompany(app, 'CatId', { roles: ['MANAGER'] });
    B = await createTestCompany(app, 'CatIdB');
    // GST for company A — placeholder TEST classification and rate only.
    classificationId = (await prisma.taxClassification.create({ data: { companyId: A.id, name: `Vehicle ${stamp}`, codeType: 'HSN', code: 'TEST-VEHICLE', treatment: 'TAXABLE' } })).id;
    await prisma.taxRate.create({ data: { companyId: A.id, classificationId, ratePercent: new Prisma.Decimal('5.00'), effectiveFrom: new Date('2020-01-01T00:00:00.000Z'), effectiveTo: null } });
    await prisma.companySetting.update({ where: { companyId: A.id }, data: { gstEnabled: true, gstNumber: 'TEST-GSTIN-CATID', gstStateCode: '24' } });
    customerA = (await http().post('/api/v1/customers').set('Authorization', A.auth()).send({ name: `CatId ${stamp}`, phone: `7${stamp}1` }).expect(201)).body.id;
    await prisma.customer.update({ where: { id: customerA }, data: { gstStateCode: '24' } });
  }, 60_000);

  afterAll(async () => {
    await purgeTestCompany(prisma, A?.id);
    await purgeTestCompany(prisma, B?.id);
    await app.close();
  }, E2E_HOOK_TIMEOUT);

  // ───────────────────────── Not locked ─────────────────────────
  it('an unused model / variant (AVAILABLE and RESERVED stock) stays fully editable', async () => {
    const c = await catalogue();
    await unit(c.variantId);
    const reserved = await unit(c.variantId);
    await http().patch(`/api/v1/inventory/units/${reserved}/status`).set('Authorization', A.auth()).send({ toStatus: 'RESERVED' }).expect(200);
    await expectUnlocked(c);
  });

  it('a quotation alone does not lock the identity', async () => {
    const c = await catalogue();
    await http().post('/api/v1/quotations').set('Authorization', A.auth()).send({ customerId: customerA, variantId: c.variantId, exShowroom: 1_100_000 }).expect(201);
    await expectUnlocked(c);
  });

  it('a service job alone does not lock the identity', async () => {
    const c = await catalogue();
    const u = await unit(c.variantId);
    await http().post('/api/v1/service/jobs').set('Authorization', A.auth()).send({ customerId: customerA, unitId: u, type: 'PAID', complaints: [{ description: 'PDI' }] }).expect(201);
    await expectUnlocked(c);
  });

  // ───────────────────────── Locked ─────────────────────────
  it('a BOOKED unit (no sale) locks its variant and model', async () => {
    const c = await catalogue();
    await book(await unit(c.variantId));
    await expectLocked(c);
  });

  it('Sale history locks — on a restocked AVAILABLE unit, and still when the Sale is soft-deleted', async () => {
    const c = await catalogue();
    const { saleId } = await restocked(c.variantId);
    await expectLocked(c);
    await prisma.$executeRaw`UPDATE "Sale" SET "deletedAt" = now() WHERE id = ${saleId}`;
    await expectLocked(c);
  });

  it('Warranty history locks, also once the warranty is cancelled', async () => {
    const c = await catalogue();
    const u = await unit(c.variantId);
    const w = await warranty(u);
    await expectLocked(c);
    await http().post(`/api/v1/warranties/${w}/cancel`).set('Authorization', A.auth()).send({}).expect(201);
    await expectLocked(c);
  });

  it('AMC history locks, also once the plan is cancelled', async () => {
    const c = await catalogue();
    const plan = await amc(await unit(c.variantId));
    await expectLocked(c);
    await prisma.amcPlan.update({ where: { id: plan }, data: { status: 'CANCELLED' } }); // no cancel endpoint; the record remains
    await expectLocked(c);
  });

  it('a model is locked when any of its variants is; its unused variants stay editable', async () => {
    const c = await catalogue();
    const used = await addVariant(c.modelId, 'Max', 'Black');
    await book(await unit(used));
    expect((await patchModel(c.modelId, { name: `${c.modelName} X` }).expect(409)).body.message).toBe(MODEL_LOCKED);
    expect((await listedVariant(c.modelId, used)).identityLocked).toBe(true);
    expect((await listedVariant(c.modelId, c.variantId)).identityLocked).toBe(false);
    await patchVariant(c.variantId, { name: 'Pro Renamed' }).expect(200);
    expect((await patchVariant(used, { colour: 'White' }).expect(409)).body.message).toBe(VARIANT_LOCKED);
  });

  it('case-only and inner-spacing differences are changes; a value equal to the stored one after trimming is not', async () => {
    const c = await catalogue(A, 'Pro X');
    await book(await unit(c.variantId));
    expect((await patchVariant(c.variantId, { name: 'pro x' }).expect(409)).body.message).toBe(VARIANT_LOCKED);
    expect((await patchVariant(c.variantId, { name: 'Pro  X' }).expect(409)).body.message).toBe(VARIANT_LOCKED);
    expect((await patchVariant(c.variantId, { colour: 'RED' }).expect(409)).body.message).toBe(VARIANT_LOCKED);
    expect((await patchModel(c.modelId, { brand: 'testbrand' }).expect(409)).body.message).toBe(MODEL_LOCKED);
    await patchVariant(c.variantId, { name: '  Pro X ', colour: 'Red' }).expect(200); // trimmed by the schema → the stored value
    await patchModel(c.modelId, { brand: 'TESTBRAND', name: c.modelName }).expect(200);
    expect(await stored(c)).toEqual({ model: { brand: 'TESTBRAND', name: c.modelName }, variant: { name: 'Pro X', colour: 'Red' } });
  });

  it('a locked variant keeps hex colour, list price and specifications editable; a locked model keeps description and active state', async () => {
    const c = await catalogue();
    await book(await unit(c.variantId));
    const v = await patchVariant(c.variantId, { hexColour: '#aa0000', exShowroomPrice: 1_250_000, batteryType: 'Li-ion', batteryCapacity: '3 kWh', rangeKm: 110, topSpeedKmph: 70, chargingTimeHrs: 4.5, motorPowerW: 2500, warrantyMonths: 30 }).expect(200);
    expect(v.body).toMatchObject({ hexColour: '#aa0000', exShowroomPrice: '1250000', rangeKm: 110, warrantyMonths: 30, chargingTimeHrs: '4.50', identityLocked: true });
    await http().patch(`/api/v1/inventory/variants/${c.variantId}/active`).set('Authorization', A.auth()).send({ isActive: false }).expect(200);
    await http().patch(`/api/v1/inventory/variants/${c.variantId}/active`).set('Authorization', A.auth()).send({ isActive: true }).expect(200);
    const m = await patchModel(c.modelId, { description: 'Updated description' }).expect(200);
    expect(m.body).toMatchObject({ description: 'Updated description', identityLocked: true });
    const off = await http().patch(`/api/v1/inventory/models/${c.modelId}/active`).set('Authorization', A.auth()).send({ isActive: false }).expect(200);
    expect(off.body).toMatchObject({ isActive: false, identityLocked: true });
    await http().patch(`/api/v1/inventory/models/${c.modelId}/active`).set('Authorization', A.auth()).send({ isActive: true }).expect(200);
  });

  it('a refused rename leaves every historical record and the GST snapshot untouched', async () => {
    const c = await catalogue();
    const u = await unit(c.variantId);
    const saleId = await deliver(u);
    await warranty(u);
    const history = async () => ({
      sale: await prisma.sale.findUniqueOrThrow({ where: { id: saleId } }),
      booking: await prisma.booking.findFirstOrThrow({ where: { unitId: u } }),
      delivery: await prisma.delivery.findFirstOrThrow({ where: { saleId } }),
      warranties: await prisma.warranty.findMany({ where: { unitId: u } }),
      snapshots: await prisma.taxSnapshot.findMany({ where: { saleId } }),
      lines: await prisma.taxSnapshotLine.findMany({ where: { snapshot: { saleId } }, orderBy: { id: 'asc' } }),
      unit: await prisma.inventoryUnit.findUniqueOrThrow({ where: { id: u } }),
    });
    const before = await history();
    expect(before.snapshots).toHaveLength(1);
    expect(before.lines.map((l) => l.description)).toContain(`TESTBRAND ${c.modelName} Pro (Red)`);
    await expectLocked(c);
    expect(await history()).toEqual(before);
  });

  // ───────────────────────── Tenant isolation ─────────────────────────
  it("another company can neither rename nor see this company's catalogue entries; its own follow its own vehicles", async () => {
    const c = await catalogue();
    await book(await unit(c.variantId));
    await patchModel(c.modelId, { name: 'Hijack' }, B).expect(404);
    await patchVariant(c.variantId, { colour: 'Hijack' }, B).expect(404);
    await http().get(`/api/v1/inventory/models/${c.modelId}`).set('Authorization', B.auth()).expect(404);
    expect((await stored(c)).variant.colour).toBe('Red');
    const theirs = await catalogue(B);
    await unit(theirs.variantId, B);
    await patchVariant(theirs.variantId, { name: 'Free', colour: 'Blue' }, B).expect(200); // B's stock is uncommitted
    await patchModel(theirs.modelId, { name: `${theirs.modelName} B` }, B).expect(200);
  });

  // ───────────────────────── Concurrency (lock protocol) ─────────────────────────
  describe('concurrency', () => {
    /** Runs `hold` in a transaction left open until `release()`; resolves `opened` once `hold` has run. */
    const holdOpen = (hold: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
      let opened!: () => void;
      let release!: () => void;
      const openedSignal = new Promise<void>((resolve) => { opened = resolve; });
      const gate = new Promise<void>((resolve) => { release = resolve; });
      const done = prisma.$transaction(async (tx) => { await hold(tx); opened(); await gate; }, { timeout: 20_000 });
      return { opened: openedSignal, release, done };
    };
    const settle = () => new Promise((resolve) => setTimeout(resolve, 300));
    const today = new Date();

    it('a variant rename racing a warranty being created on one of its units waits for it, then refuses', async () => {
      const c = await catalogue();
      const u = await unit(c.variantId);
      const held = holdOpen((tx) => tx.warranty.create({ data: { companyId: A.id, warrantyNumber: `RACE-W-${stamp}`, customerId: customerA, unitId: u, purchaseDate: today, startDate: today, endDate: today, periodMonths: 1 } }));
      await held.opened;
      const racing = patchVariant(c.variantId, { colour: 'Blue' }).then((r) => r);
      await settle();
      held.release();
      await held.done;
      const res = await racing;
      expect(res.status).toBe(409);
      expect(res.body.message).toBe(VARIANT_LOCKED);
      expect((await stored(c)).variant.colour).toBe('Red');
    });

    it('a variant rename racing a unit being created DELIVERED in it waits for the variant row, then refuses', async () => {
      const c = await catalogue();
      const n = serial++;
      const held = holdOpen((tx) => tx.inventoryUnit.create({ data: { companyId: A.id, variantId: c.variantId, vin: `RACEV${stamp}${n}`, motorNumber: `RACEM${stamp}${n}`, batteryNumber: `RACEB${stamp}${n}`, status: 'DELIVERED' } }));
      await held.opened;
      const racing = patchVariant(c.variantId, { name: 'Renamed' }).then((r) => r);
      await settle();
      held.release();
      await held.done;
      const res = await racing;
      expect(res.status).toBe(409);
      expect((await stored(c)).variant.name).toBe(c.variantName);
    });

    it('a model rename racing a booking (unit → BOOKED) of a unit of one of its variants waits for it, then refuses', async () => {
      const c = await catalogue();
      const u = await unit(c.variantId);
      const held = holdOpen((tx) => tx.inventoryUnit.update({ where: { id: u }, data: { status: 'BOOKED' } }));
      await held.opened;
      const racing = patchModel(c.modelId, { name: `${c.modelName} Renamed` }).then((r) => r);
      await settle();
      held.release();
      await held.done;
      const res = await racing;
      expect(res.status).toBe(409);
      expect(res.body.message).toBe(MODEL_LOCKED);
      expect((await stored(c)).model.name).toBe(c.modelName);
    });

    it('a model rename racing an AMC plan being created on a unit of one of its variants waits for it, then refuses', async () => {
      const c = await catalogue();
      const u = await unit(c.variantId);
      const held = holdOpen((tx) => tx.amcPlan.create({ data: { companyId: A.id, amcNumber: `RACE-A-${stamp}`, customerId: customerA, unitId: u, planType: 'GOLD', startDate: today, endDate: today, visitsIncluded: 1, price: 1n } }));
      await held.opened;
      const racing = patchModel(c.modelId, { brand: 'RACEBRAND' }).then((r) => r);
      await settle();
      held.release();
      await held.done;
      expect((await racing).status).toBe(409);
      expect((await stored(c)).model.brand).toBe('TESTBRAND');
    });

    it('mixed concurrent renames, unit creation / moves / edits, bookings, warranties and variant creation never deadlock or fail with 5xx', async () => {
      const statuses = new Map<number, number>();
      for (let round = 0; round < 6; round += 1) {
        const c = await catalogue();
        const units = [await unit(c.variantId), await unit(c.variantId), await unit(c.variantId), await unit(c.variantId)];
        const k = () => serial++;
        const ops = [
          () => patchVariant(c.variantId, { colour: `C${k()}` }),
          () => patchVariant(c.variantId, { name: `S${k()}` }),
          () => patchModel(c.modelId, { name: `${c.modelName} r${k()}` }),
          () => patchModel(c.modelId, { brand: `B${k()}` }),
          () => patchVariant(c.variantId, { exShowroomPrice: 2000 + k() }),
          () => { const x = k(); return http().post('/api/v1/inventory/units').set('Authorization', A.auth()).send({ variantId: c.variantId, vin: `MXV${stamp}${x}`, motorNumber: `MXM${stamp}${x}`, batteryNumber: `MXB${stamp}${x}` }); },
          () => { const x = k(); return http().post('/api/v1/inventory/units').set('Authorization', A.auth()).send({ modelId: c.modelId, variant: 'Legacy', colour: `L${x}`, vin: `MLV${stamp}${x}`, motorNumber: `MLM${stamp}${x}`, batteryNumber: `MLB${stamp}${x}` }); },
          () => http().patch(`/api/v1/inventory/units/${units[0]}`).set('Authorization', A.auth()).send({ variant: 'Moved', colour: `M${k()}` }),
          () => http().patch(`/api/v1/inventory/units/${units[1]}`).set('Authorization', A.auth()).send({ vin: `MEV${stamp}${k()}` }),
          () => http().post('/api/v1/bookings').set('Authorization', A.auth()).send({ customerId: customerA, unitId: units[2], exShowroom: 1_100_000 }),
          () => http().post('/api/v1/warranties').set('Authorization', A.auth()).send({ unitId: units[3], customerId: customerA, periodMonths: 12 }),
          () => http().post(`/api/v1/inventory/models/${c.modelId}/variants`).set('Authorization', A.auth()).send({ name: 'New', colour: `N${k()}`, exShowroomPrice: 1000 }),
        ];
        const results = await Promise.all(ops.sort(() => Math.random() - 0.5).map((op) => op()));
        for (const r of results) statuses.set(r.status, (statuses.get(r.status) ?? 0) + 1);
      }
      // Every operation either succeeds or is refused cleanly (409: locked, busy, or a uniqueness clash).
      expect([...statuses.keys()].filter((status) => ![200, 201, 409].includes(status))).toEqual([]);
    }, 60_000);

    it('a rename that wins the race is simply first: the warranty created after it still succeeds', async () => {
      const c = await catalogue();
      const u = await unit(c.variantId);
      await patchVariant(c.variantId, { colour: 'Blue' }).expect(200);
      await warranty(u);
      expect((await listedVariant(c.modelId, c.variantId)).identityLocked).toBe(true);
    });
  });
});
