import { INestApplication } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createE2eApp, E2E_HOOK_TIMEOUT } from './support/e2e-app';
import { readPdfText } from './support/pdf-text';

function binaryParser(res: request.Response, cb: (err: Error | null, body: unknown) => void): void {
  const chunks: Buffer[] = [];
  (res as unknown as NodeJS.ReadableStream).on('data', (c: Buffer) => chunks.push(Buffer.from(c)));
  (res as unknown as NodeJS.ReadableStream).on('end', () => cb(null, Buffer.concat(chunks)));
}

/**
 * M4B — a unit's catalogue identity (model / variant / colour) can be corrected only while AVAILABLE or
 * RESERVED. From BOOKED on, by curated id or by legacy text, a real change is a 409 and nothing is written;
 * naming the current variant is never a change. Downstream records keep reading the original identity.
 *
 * Everything runs in THROWAWAY companies created here and hard-deleted afterwards.
 */
describe('Inventory identity guard (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const stamp = Date.now().toString().slice(-8);
  const http = () => request(app.getHttpServer());
  const auth = (t: string): string => `Bearer ${t}`;
  let serial = 0;

  interface Co { id: string; owner: string; approver: string; modelId: string; otherModelId: string; teal: string; red: string; customerId: string }
  const A = {} as Co;
  const B = {} as Co;

  const setupCompany = async (co: Co, label: string): Promise<void> => {
    co.id = (await prisma.company.create({ data: { name: `Identity ${label} ${stamp}`, slug: `identity-${label}-${stamp}` } })).id;
    await prisma.branch.create({ data: { companyId: co.id, name: 'HQ', isPrimary: true } });
    const hash = await bcrypt.hash('Test@12345', 12);
    for (const who of ['owner', 'approver'] as const) {
      const email = `identity.${who}.${label}.${stamp}@e2e.test`;
      await prisma.user.create({ data: { companyId: co.id, name: `${who} ${label}`, email, role: 'OWNER', passwordHash: hash } });
      co[who] = (await http().post('/api/v1/auth/login').send({ email, password: 'Test@12345' }).expect(200)).body.accessToken;
    }
    await prisma.companySetting.create({ data: { companyId: co.id, bookingPrefix: `I${label}${stamp}-BK`, invoicePrefix: `I${label}${stamp}-INV`, receiptPrefix: `I${label}${stamp}-RC`, returnPrefix: `I${label}${stamp}-RET`, creditNotePrefix: `I${label}${stamp}-CN`, refundPrefix: `I${label}${stamp}-RF`, warrantyPrefix: `I${label}${stamp}-WR`, amcPrefix: `I${label}${stamp}-AMC`, jobCardPrefix: `I${label}${stamp}-JC` } });
    await prisma.invoiceSetting.create({ data: { companyId: co.id } });
    const post = (url: string, body: object) => http().post(url).set('Authorization', auth(co.owner)).send(body);
    co.modelId = (await post('/api/v1/inventory/models', { brand: 'TESTBRAND', name: `Alpha ${label} ${stamp}` }).expect(201)).body.id;
    co.otherModelId = (await post('/api/v1/inventory/models', { brand: 'TESTBRAND', name: `Beta ${label} ${stamp}` }).expect(201)).body.id;
    co.teal = (await post(`/api/v1/inventory/models/${co.modelId}/variants`, { name: 'Pro', colour: 'Teal', exShowroomPrice: 12_500_000 }).expect(201)).body.id;
    co.red = (await post(`/api/v1/inventory/models/${co.modelId}/variants`, { name: 'Pro', colour: 'Red', exShowroomPrice: 12_500_000 }).expect(201)).body.id;
    await post(`/api/v1/inventory/models/${co.otherModelId}/variants`, { name: 'Pro', colour: 'Teal', exShowroomPrice: 1 }).expect(201);
    co.customerId = (await post('/api/v1/customers', { name: `Cust ${label}`, phone: `6${stamp}${serial++}` }).expect(201)).body.id;
  };

  const newUnit = async (co: Co): Promise<{ id: string; vin: string }> => {
    const n = serial++;
    const res = await http().post('/api/v1/inventory/units').set('Authorization', auth(co.owner)).send({ variantId: co.teal, vin: `IDV${stamp}${n}`, motorNumber: `IDM${stamp}${n}`, batteryNumber: `IDB${stamp}${n}`, sellingPrice: 11_000_000 }).expect(201);
    return { id: res.body.id, vin: res.body.vin };
  };
  const setStatus = (co: Co, id: string, toStatus: string) => http().patch(`/api/v1/inventory/units/${id}/status`).set('Authorization', auth(co.owner)).send({ toStatus }).expect(200);
  const patch = (co: Co, id: string, body: Record<string, unknown>) => http().patch(`/api/v1/inventory/units/${id}`).set('Authorization', auth(co.owner)).send(body);
  const row = (id: string) => prisma.inventoryUnit.findUniqueOrThrow({ where: { id } });

  /** Books (and optionally invoices + delivers) a unit; returns the booking id. */
  const book = async (co: Co, unitId: string, deliver: boolean): Promise<string> => {
    const booking = await http().post('/api/v1/bookings').set('Authorization', auth(co.owner)).send({ customerId: co.customerId, unitId, exShowroom: 1_100_000 }).expect(201);
    if (deliver) {
      await http().post(`/api/v1/bookings/${booking.body.id}/payments`).set('Authorization', auth(co.owner)).send({ amount: 1_100_000, mode: 'UPI' }).expect(201);
      await http().post(`/api/v1/bookings/${booking.body.id}/invoice`).set('Authorization', auth(co.owner)).expect(201);
      await http().post(`/api/v1/bookings/${booking.body.id}/deliver`).set('Authorization', auth(co.owner)).send({}).expect(201);
    }
    return booking.body.id;
  };
  /** Request → inspect → approve → complete (SCRAP keeps the unit RETURNED). */
  const returnUnit = async (co: Co, bookingId: string): Promise<string> => {
    const booking = await http().get(`/api/v1/bookings/${bookingId}`).set('Authorization', auth(co.owner)).expect(200);
    const req = await http().post('/api/v1/returns').set('Authorization', auth(co.owner)).send({ saleId: booking.body.sale.id, reason: 'identity test' }).expect(201);
    await http().post(`/api/v1/returns/${req.body.id}/inspect`).set('Authorization', auth(co.approver)).send({ inspectionOk: true }).expect(201);
    await http().post(`/api/v1/returns/${req.body.id}/approve`).set('Authorization', auth(co.approver)).send({}).expect(201);
    await http().post(`/api/v1/returns/${req.body.id}/complete`).set('Authorization', auth(co.approver)).send({ disposition: 'SCRAP', deductionAmount: 0, refundMethod: 'UPI' }).expect(201);
    return req.body.id;
  };

  const BLOCKED = 'Vehicle model/variant cannot be changed after booking or delivery.';
  const legacyChange = { variant: 'Pro', colour: 'Red' }; // same model, other colour → the Red variant
  const legacyNew = (co: Co) => ({ modelId: co.otherModelId, variant: 'Pro', colour: 'Lime' }); // would be created by the legacy resolver
  const legacySame = { variant: 'Pro', colour: 'Teal' };

  beforeAll(async () => {
    app = await createE2eApp();
    prisma = app.get(PrismaService);
    await setupCompany(A, 'a');
    await setupCompany(B, 'b');
  }, 120000);

  afterAll(async () => {
    for (const id of [A.id, B.id].filter(Boolean)) {
      for (const sql of [
        'DELETE FROM "Refund" WHERE "companyId" = $1', 'DELETE FROM "CreditNote" WHERE "companyId" = $1', 'DELETE FROM "VehicleReturn" WHERE "companyId" = $1',
        'DELETE FROM "AmcVisit" v USING "AmcPlan" p WHERE v."amcPlanId" = p.id AND p."companyId" = $1', 'DELETE FROM "AmcPlan" WHERE "companyId" = $1',
        'DELETE FROM "FreeService" WHERE "companyId" = $1', 'DELETE FROM "WarrantyClaim" WHERE "companyId" = $1', 'DELETE FROM "Warranty" WHERE "companyId" = $1',
        'DELETE FROM "ServiceJob" WHERE "companyId" = $1',
        'DELETE FROM "Payment" WHERE "companyId" = $1', 'DELETE FROM "Sale" WHERE "companyId" = $1', 'DELETE FROM "Booking" WHERE "companyId" = $1',
        'DELETE FROM "CustomerTimelineEntry" WHERE "companyId" = $1', 'DELETE FROM "Notification" WHERE "companyId" = $1', 'DELETE FROM "ActivityLog" WHERE "companyId" = $1',
        'DELETE FROM "Customer" WHERE "companyId" = $1',
        'DELETE FROM "InventoryEvent" WHERE "companyId" = $1', 'DELETE FROM "InventoryUnit" WHERE "companyId" = $1',
        'DELETE FROM "ScooterVariant" WHERE "companyId" = $1', 'DELETE FROM "ScooterModel" WHERE "companyId" = $1',
        'DELETE FROM "InvoiceSetting" WHERE "companyId" = $1', 'DELETE FROM "CompanySetting" WHERE "companyId" = $1',
        'DELETE FROM "User" WHERE "companyId" = $1', 'DELETE FROM "Branch" WHERE "companyId" = $1', 'DELETE FROM "Company" WHERE id = $1',
      ]) await prisma.$executeRawUnsafe(sql, id);
    }
    await app.close();
  }, E2E_HOOK_TIMEOUT);

  // ───────────────────────── Allowed before commitment ─────────────────────────
  describe.each(['AVAILABLE', 'RESERVED'])('%s', (status) => {
    it('curated change succeeds and is audited old → new; legacy change succeeds', async () => {
      const u = await newUnit(A);
      if (status === 'RESERVED') await setStatus(A, u.id, 'RESERVED');
      const res = await patch(A, u.id, { variantId: A.red, location: 'Bay 1' }).expect(200);
      expect(res.body.variant).toMatchObject({ id: A.red, colour: 'Red' });
      expect(res.body.location).toBe('Bay 1');
      const log = await prisma.activityLog.findFirst({ where: { companyId: A.id, entityType: 'InventoryUnit', entityId: u.id, action: 'UPDATE' }, orderBy: { createdAt: 'desc' } });
      expect(log?.summary).toBe(`Updated scooter ${u.vin}: variant TESTBRAND Alpha a ${stamp} Pro (Teal) → TESTBRAND Alpha a ${stamp} Pro (Red)`);
      expect(log?.metadata).toMatchObject({ variantChange: { from: { variantId: A.teal, colour: 'Teal' }, to: { variantId: A.red, colour: 'Red' } } });
      // Legacy text back to Teal.
      const back = await patch(A, u.id, legacySame).expect(200);
      expect(back.body.variant.id).toBe(A.teal);
      expect((await row(u.id)).status).toBe(status);
    });
  });

  // ───────────────────────── Refused after commitment ─────────────────────────
  const committed: [string, (co: Co) => Promise<string>][] = [
    ['BOOKED', async (co) => { const u = await newUnit(co); await book(co, u.id, false); return u.id; }],
    ['DELIVERED', async (co) => { const u = await newUnit(co); await book(co, u.id, true); return u.id; }],
    ['IN_SERVICE', async (co) => { const u = await newUnit(co); await setStatus(co, u.id, 'IN_SERVICE'); return u.id; }],
    ['RETURNED', async (co) => { const u = await newUnit(co); const b = await book(co, u.id, true); await returnUnit(co, b); return u.id; }],
  ];

  describe.each(committed)('%s', (status, prepare) => {
    let unitId = '';
    beforeAll(async () => { unitId = await prepare(A); expect((await row(unitId)).status).toBe(status); }, E2E_HOOK_TIMEOUT);

    it('curated change → 409 and NOTHING is written (atomic)', async () => {
      const before = await row(unitId);
      // Only the catalogue identity changes here (the identification numbers have their own rule, tested below).
      const res = await patch(A, unitId, { variantId: A.red, sellingPrice: 1, notes: 'tampered', location: 'nowhere', supplier: 'x' }).expect(409);
      expect(res.body.message).toBe(BLOCKED);
      expect(await row(unitId)).toEqual(before);
    });

    it('legacy change → 409 whether the text names an existing variant or a brand-new one; no variant is created', async () => {
      const before = await row(unitId);
      const variantsBefore = await prisma.scooterVariant.count({ where: { companyId: A.id } });
      expect((await patch(A, unitId, { ...legacyChange, notes: 'tampered' }).expect(409)).body.message).toBe(BLOCKED);
      expect((await patch(A, unitId, legacyNew(A)).expect(409)).body.message).toBe(BLOCKED);
      expect(await row(unitId)).toEqual(before);
      expect(await prisma.scooterVariant.count({ where: { companyId: A.id } })).toBe(variantsBefore); // the legacy resolver's new variant rolled back
      expect(await prisma.activityLog.count({ where: { companyId: A.id, entityId: unitId, summary: { contains: 'variant' } } })).toBe(0);
    });

    it('naming the current variant is not a change: curated and legacy both succeed, other fields update, no variant-change audit', async () => {
      const res = await patch(A, unitId, { variantId: A.teal, location: 'Bay 7' }).expect(200);
      expect(res.body).toMatchObject({ location: 'Bay 7', variant: { id: A.teal } });
      const legacy = await patch(A, unitId, { modelId: A.modelId, ...legacySame, notes: 'checked' }).expect(200);
      expect(legacy.body).toMatchObject({ notes: 'checked', variant: { id: A.teal } });
      expect(await prisma.activityLog.count({ where: { companyId: A.id, entityId: unitId, summary: { contains: 'variant' } } })).toBe(0);
      expect((await row(unitId)).status).toBe(status);
    });

    it("another company's variantId is still a 404 (not a 409) and reveals nothing", async () => {
      await patch(A, unitId, { variantId: B.red }).expect(404);
      await patch(B, unitId, { variantId: B.red }).expect(404);
    });
  });

  // ───────────────────────── Vehicle identification (VIN / motor / battery) — M4B.2 ─────────────────────────
  const LOCKED = 'Vehicle identification cannot be changed after delivery.';
  const fresh = () => { const n = serial++; return { vin: `NEWV${stamp}${n}`, motorNumber: `NEWM${stamp}${n}`, batteryNumber: `NEWB${stamp}${n}` }; };
  const logs = (unitId: string) => prisma.activityLog.findMany({ where: { companyId: A.id, entityType: 'InventoryUnit', entityId: unitId, action: 'UPDATE' }, orderBy: { createdAt: 'asc' } });

  describe.each([
    ['AVAILABLE', async (co: Co) => (await newUnit(co)).id],
    ['RESERVED', async (co: Co) => { const u = await newUnit(co); await setStatus(co, u.id, 'RESERVED'); return u.id; }],
    ['BOOKED', async (co: Co) => { const u = await newUnit(co); await book(co, u.id, false); return u.id; }],
  ])('identification while %s', (status, prepare) => {
    it('1–5. VIN, motor and battery change one at a time and together; each change is audited with field / from / to; 23–24', async () => {
      const id = await prepare(A);
      const before = await row(id);
      const one = fresh();
      const r1 = await patch(A, id, { vin: one.vin }).expect(200);
      expect(r1.body.vin).toBe(one.vin);
      const r2 = await patch(A, id, { motorNumber: one.motorNumber }).expect(200);
      expect(r2.body.motorNumber).toBe(one.motorNumber);
      const r3 = await patch(A, id, { batteryNumber: one.batteryNumber }).expect(200);
      expect(r3.body.batteryNumber).toBe(one.batteryNumber);
      const all = fresh();
      const r4 = await patch(A, id, { ...all, notes: 'rechecked' }).expect(200);
      expect(r4.body).toMatchObject({ ...all, notes: 'rechecked' });
      expect((await row(id)).status).toBe(status);
      const entries = await logs(id);
      expect(entries.map((e) => e.metadata)).toEqual([
        { identificationChanges: [{ field: 'vin', from: before.vin, to: one.vin }] },
        { identificationChanges: [{ field: 'motorNumber', from: before.motorNumber, to: one.motorNumber }] },
        { identificationChanges: [{ field: 'batteryNumber', from: before.batteryNumber, to: one.batteryNumber }] },
        { identificationChanges: [{ field: 'vin', from: one.vin, to: all.vin }, { field: 'motorNumber', from: one.motorNumber, to: all.motorNumber }, { field: 'batteryNumber', from: one.batteryNumber, to: all.batteryNumber }] },
      ]);
      expect(entries[0]!.summary).toBe(`Updated scooter ${before.vin}: vin ${before.vin} → ${one.vin}`);
    });

    it('a VIN already in use is still refused (pre-check), lower-case input is normalised, and the same value is not a change', async () => {
      const id = await prepare(A);
      const other = await newUnit(A);
      await patch(A, id, { vin: other.vin }).expect(409);
      const current = await row(id);
      await patch(A, id, { vin: current.vin.toLowerCase(), motorNumber: current.motorNumber.toLowerCase(), batteryNumber: current.batteryNumber.toLowerCase() }).expect(200);
      expect(await row(id)).toMatchObject({ vin: current.vin, motorNumber: current.motorNumber, batteryNumber: current.batteryNumber });
      const last = (await logs(id)).at(-1);
      expect(last?.summary).toBe(`Updated scooter ${current.vin}`);
      expect(last?.metadata).toBeNull();
    });
  });

  describe.each([
    ['DELIVERED', async (co: Co) => { const u = await newUnit(co); await book(co, u.id, true); return u.id; }],
    ['IN_SERVICE', async (co: Co) => { const u = await newUnit(co); await setStatus(co, u.id, 'IN_SERVICE'); return u.id; }],
    ['RETURNED', async (co: Co) => { const u = await newUnit(co); const b = await book(co, u.id, true); await returnUnit(co, b); return u.id; }],
  ])('identification while %s', (status, prepare) => {
    let id = '';
    beforeAll(async () => { id = await prepare(A); expect((await row(id)).status).toBe(status); }, E2E_HOOK_TIMEOUT);

    it('6–14. VIN, motor and battery are each locked → 409, nothing written, no audit', async () => {
      const before = await row(id);
      const n = await logs(id);
      const f = fresh();
      for (const change of [{ vin: f.vin }, { motorNumber: f.motorNumber }, { batteryNumber: f.batteryNumber }]) {
        expect((await patch(A, id, change).expect(409)).body.message).toBe(LOCKED);
      }
      expect(await row(id)).toEqual(before);
      expect((await logs(id)).length).toBe(n.length);
    });

    it('15–17 + 28. every combination, with ordinary fields alongside, is refused atomically', async () => {
      const before = await row(id);
      const f = fresh();
      const combos = [
        { vin: f.vin, motorNumber: f.motorNumber }, { vin: f.vin, batteryNumber: f.batteryNumber }, { motorNumber: f.motorNumber, batteryNumber: f.batteryNumber },
        { vin: f.vin, motorNumber: f.motorNumber, batteryNumber: f.batteryNumber },
      ];
      for (const change of combos) {
        expect((await patch(A, id, { ...change, sellingPrice: 1, notes: 'tampered', location: 'nowhere', supplier: 'x' }).expect(409)).body.message).toBe(LOCKED);
      }
      expect(await row(id)).toEqual(before); // sellingPrice / notes / location / supplier untouched too
    });

    it('18–22. the same identifiers (any case) are not a change; ordinary fields still update; no identificationChanges', async () => {
      const current = await row(id);
      const res = await patch(A, id, { vin: current.vin.toLowerCase(), motorNumber: current.motorNumber, batteryNumber: current.batteryNumber.toLowerCase(), location: 'Customer' }).expect(200);
      expect(res.body).toMatchObject({ vin: current.vin, motorNumber: current.motorNumber, batteryNumber: current.batteryNumber, location: 'Customer' });
      const last = (await logs(id)).at(-1);
      expect(last?.summary).toBe(`Updated scooter ${current.vin}`);
      expect(last?.metadata).toBeNull();
    });

    it('an ordinary edit still works and the catalogue identity rule still applies alongside', async () => {
      await patch(A, id, { notes: 'inspected' }).expect(200);
      expect((await patch(A, id, { variantId: A.red }).expect(409)).body.message).toBe(BLOCKED);
    });
  });

  it('25. an allowed request changing variant AND VIN produces one UPDATE entry carrying both metadata sections', async () => {
    const u = await newUnit(A);
    const f = fresh();
    await patch(A, u.id, { variantId: A.red, vin: f.vin }).expect(200);
    const last = (await logs(u.id)).at(-1)!;
    expect(last.metadata).toEqual({
      variantChange: { from: expect.objectContaining({ variantId: A.teal }), to: expect.objectContaining({ variantId: A.red }) },
      identificationChanges: [{ field: 'vin', from: u.vin, to: f.vin }],
    });
    expect(last.summary).toContain('variant');
    expect(last.summary).toContain(`vin ${u.vin} → ${f.vin}`);
    expect(await logs(u.id)).toHaveLength(1);
  });

  it("a DELIVERED unit's warranty certificate and delivery note keep their numbers after a refused change", async () => {
    const u = await newUnit(A);
    const bookingId = await book(A, u.id, true);
    const warranty = (await http().post('/api/v1/warranties').set('Authorization', auth(A.owner)).send({ unitId: u.id, customerId: A.customerId, periodMonths: 12 }).expect(201)).body.warranty;
    const pdf = async (url: string) => readPdfText((await http().get(url).set('Authorization', auth(A.owner)).buffer().parse(binaryParser).expect(200)).body as Buffer);
    const certBefore = (await pdf(`/api/v1/warranties/${warranty.id}/certificate.pdf`)).strings;
    const noteBefore = (await pdf(`/api/v1/deliveries/${bookingId}/note.pdf`)).strings;
    const f = fresh();
    expect((await patch(A, u.id, { vin: f.vin, motorNumber: f.motorNumber, batteryNumber: f.batteryNumber }).expect(409)).body.message).toBe(LOCKED);
    expect((await pdf(`/api/v1/warranties/${warranty.id}/certificate.pdf`)).strings).toEqual(certBefore);
    expect((await pdf(`/api/v1/deliveries/${bookingId}/note.pdf`)).strings).toEqual(noteBefore);
    expect(certBefore).toEqual(expect.arrayContaining([u.vin]));
  });

  // ───────────────────────── Downstream records keep the original identity ─────────────────────────
  describe('historical safety', () => {
    it('a delivered unit with booking, invoice, delivery, service, warranty, AMC and return records cannot be re-pointed, and every record keeps reading Pro / Teal', async () => {
      const u = await newUnit(A);
      const bookingId = await book(A, u.id, true);
      const post = (url: string, body: object) => http().post(url).set('Authorization', auth(A.owner)).send(body);
      const warranty = (await post('/api/v1/warranties', { unitId: u.id, customerId: A.customerId, periodMonths: 24 }).expect(201)).body.warranty;
      const amc = (await post('/api/v1/amc', { unitId: u.id, customerId: A.customerId, planType: 'GOLD', months: 12, visitsIncluded: 3, price: 300000 }).expect(201)).body;
      const job = (await post('/api/v1/service/jobs', { customerId: A.customerId, unitId: u.id, type: 'PAID', complaints: [{ description: 'Noise', priority: 'LOW' }] }).expect(201)).body;
      const get = (url: string) => http().get(url).set('Authorization', auth(A.owner)).expect(200);
      const pdf = async (url: string) => readPdfText((await http().get(url).set('Authorization', auth(A.owner)).buffer().parse(binaryParser).expect(200)).body as Buffer);

      const bookingBefore = (await get(`/api/v1/bookings/${bookingId}`)).body;
      const invoiceBefore = (await pdf(`/api/v1/bookings/${bookingId}/invoice/pdf`)).strings;
      const noteBefore = (await pdf(`/api/v1/deliveries/${bookingId}/note.pdf`)).strings;
      const deliveryBefore = (await get(`/api/v1/deliveries/${bookingId}`)).body;
      expect(invoiceBefore).toEqual(expect.arrayContaining([`Alpha a ${stamp} Pro`, 'Colour: Teal']));

      for (const attempt of [{ variantId: A.red }, legacyChange, { modelId: A.otherModelId, variant: 'Pro', colour: 'Teal' }, legacyNew(A)]) {
        expect((await patch(A, u.id, attempt).expect(409)).body.message).toBe(BLOCKED);
      }

      expect((await row(u.id)).variantId).toBe(A.teal);
      expect((await get(`/api/v1/bookings/${bookingId}`)).body.unit).toEqual(bookingBefore.unit);
      expect((await get(`/api/v1/deliveries/${bookingId}`)).body.booking).toMatchObject({ model: deliveryBefore.booking.model, variant: deliveryBefore.booking.variant, vin: u.vin });
      expect((await pdf(`/api/v1/deliveries/${bookingId}/note.pdf`)).strings).toEqual(noteBefore);
      expect((await pdf(`/api/v1/bookings/${bookingId}/invoice/pdf`)).strings).toEqual(invoiceBefore);
      expect((await get(`/api/v1/service/jobs/${job.id}`)).body.unit).toMatchObject({ model: `Alpha a ${stamp}`, variant: 'Pro', colour: 'Teal', vin: u.vin });
      expect((await get(`/api/v1/warranties/${warranty.id}`)).body.warranty).toMatchObject({ model: `Alpha a ${stamp}`, variant: 'Pro', vin: u.vin });
      expect((await get(`/api/v1/amc/${amc.id}`)).body).toMatchObject({ model: `Alpha a ${stamp}` });

      // The return path: a returned vehicle is locked too, and its return record still points at the same unit identity.
      const u2 = await newUnit(A);
      const b2 = await book(A, u2.id, true);
      const returnId = await returnUnit(A, b2);
      expect((await row(u2.id)).status).toBe('RETURNED');
      expect((await patch(A, u2.id, { variantId: A.red }).expect(409)).body.message).toBe(BLOCKED);
      const ret = (await get(`/api/v1/returns/${returnId}`)).body;
      expect(ret.vin).toBe(u2.vin);
      expect((await get(`/api/v1/inventory/units/${u2.id}`)).body.variant).toMatchObject({ id: A.teal, colour: 'Teal' });
    });
  });
});
