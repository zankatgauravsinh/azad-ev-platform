import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { SaleTaxService } from '../src/modules/tax/sale-tax.service';
import { TaxEngineService } from '../src/modules/tax/tax-engine.service';
import { calendarDateInTimeZone } from '../src/modules/tax/tax-point';

/**
 * Stage C — GST snapshots on Booking → generateInvoice() → Sale, through the real HTTP endpoint.
 *
 * Everything runs in THROWAWAY companies created here and hard-deleted afterwards; the seeded company
 * is never read or changed and GST is never enabled for it. Classification codes and rates below are
 * PLACEHOLDERS for testing — not real HSN/SAC values, approved GST rates, or CA-confirmed treatments.
 */
describe('Sale GST snapshots (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let calculateSpy: jest.SpyInstance;
  const stamp = Date.now().toString().slice(-8);
  const http = () => request(app.getHttpServer());
  let serial = 0;

  interface Co { id: string; token: string; modelId: string; customers: Record<string, string> }
  const G = {} as Co; // GST enabled, fully configured (company state 24)
  const N = {} as Co; // GST disabled — today's behaviour
  const T = {} as Co; // another tenant with its own classification
  const cls: Record<string, string> = {};
  const acc: Record<string, string> = {};
  let tClassificationId = '';

  const auth = (co: Co): string => `Bearer ${co.token}`;
  const day = (s: string): Date => new Date(`${s}T00:00:00.000Z`);

  const setupCompany = async (co: Co, label: string, gst: boolean): Promise<void> => {
    const company = await prisma.company.create({ data: { name: `SaleTax ${label} ${stamp}`, slug: `saletax-${label}-${stamp}` } });
    co.id = company.id;
    await prisma.branch.create({ data: { companyId: co.id, name: 'HQ', isPrimary: true } });
    const email = `saletax.${label}.${stamp}@e2e.test`;
    await prisma.user.create({ data: { companyId: co.id, name: `Owner ${label}`, email, role: 'OWNER', passwordHash: await bcrypt.hash('Test@12345', 12) } });
    // Booking codes and invoice numbers are unique across ALL companies, so a new company's counter
    // (starting at 1) needs its own prefixes to avoid colliding with existing documents.
    await prisma.companySetting.create({
      data: { companyId: co.id, gstEnabled: gst, gstNumber: gst ? `TEST-GSTIN-${label}` : null, gstStateCode: gst ? '24' : null, bookingPrefix: `T${label}${stamp}-BK`, invoicePrefix: `T${label}${stamp}-INV`, receiptPrefix: `T${label}${stamp}-RC` },
    });
    await prisma.invoiceSetting.create({ data: { companyId: co.id } });
    co.token = (await http().post('/api/v1/auth/login').send({ email, password: 'Test@12345' }).expect(200)).body.accessToken;
    co.modelId = (await prisma.scooterModel.create({ data: { companyId: co.id, name: `GST Model ${label} ${stamp}`, brand: 'TESTBRAND' } })).id;
    co.customers = {};
    for (const [key, stateCode] of [['intra', '24'], ['inter', '27'], ['noState', null]] as const) {
      const res = await http().post('/api/v1/customers').set('Authorization', auth(co)).send({ name: `Cust ${key} ${label}`, phone: `9${stamp}${serial++}` }).expect(201);
      if (stateCode) await prisma.customer.update({ where: { id: res.body.id }, data: { gstStateCode: stateCode } });
      co.customers[key] = res.body.id;
    }
  };

  const makeClass = async (co: Co, name: string, over: Partial<Prisma.TaxClassificationUncheckedCreateInput> = {}, ratePct?: string): Promise<string> => {
    const c = await prisma.taxClassification.create({ data: { companyId: co.id, name: `${name} ${stamp}`, codeType: 'HSN', code: `TEST-${name.toUpperCase().replace(/\s+/g, '-')}`, treatment: 'TAXABLE', ...over } });
    if (ratePct) await prisma.taxRate.create({ data: { companyId: co.id, classificationId: c.id, ratePercent: new Prisma.Decimal(ratePct), effectiveFrom: day('2020-01-01'), effectiveTo: null } });
    return c.id;
  };

  interface BookingBody { id: string; total: string; status: string; accessories: { id: string }[] }
  const newBooking = async (co: Co, body: Record<string, unknown>, customer = 'intra'): Promise<BookingBody> => {
    const n = serial++;
    const unit = await http()
      .post('/api/v1/inventory/units')
      .set('Authorization', auth(co))
      .send({ modelId: co.modelId, variant: `V-${stamp}`, colour: `C${n}`, vin: `GSTV${stamp}${n}`, motorNumber: `GSTM${stamp}${n}`, batteryNumber: `GSTB${stamp}${n}` })
      .expect(201);
    return (await http().post('/api/v1/bookings').set('Authorization', auth(co)).send({ customerId: co.customers[customer], unitId: unit.body.id, ...body }).expect(201)).body;
  };
  const invoice = (co: Co, bookingId: string) => http().post(`/api/v1/bookings/${bookingId}/invoice`).set('Authorization', auth(co));
  const saleOf = (bookingId: string) => prisma.sale.findFirst({ where: { bookingId } });
  const snapshotOf = (saleId: string) => prisma.taxSnapshot.findFirst({ where: { saleId }, include: { lines: { orderBy: { position: 'asc' } } } });
  const counters = async (co: Co) => ({
    nextInvoice: (await prisma.invoiceSetting.findFirstOrThrow({ where: { companyId: co.id } })).nextInvoiceNumber,
    sales: await prisma.sale.count({ where: { companyId: co.id } }),
    snapshots: await prisma.taxSnapshot.count({ where: { companyId: co.id } }),
    lines: await prisma.taxSnapshotLine.count({ where: { companyId: co.id } }),
  });
  /** A failed GST invoice must leave NOTHING behind. */
  const expectRefused = async (co: Co, bookingId: string, code: string): Promise<void> => {
    const before = await counters(co);
    const res = await invoice(co, bookingId).expect(422);
    expect(res.body.details).toMatchObject({ code });
    expect(await counters(co)).toEqual(before); // no Sale, no snapshot, no lines, no invoice number used
    expect(await saleOf(bookingId)).toBeNull();
    expect((await prisma.booking.findFirstOrThrow({ where: { id: bookingId } })).status).toBe('CONFIRMED');
  };
  const sum = (rows: Record<string, unknown>[], field: string): bigint => rows.reduce((t, r) => t + (r[field] as bigint), 0n);
  const setting = (co: Co, data: Prisma.CompanySettingUncheckedUpdateInput) => prisma.companySetting.update({ where: { companyId: co.id }, data });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
    prisma = app.get(PrismaService);
    calculateSpy = jest.spyOn(app.get(TaxEngineService), 'calculate');

    await setupCompany(G, 'g', true);
    await setupCompany(N, 'n', false);
    await setupCompany(T, 't', true);

    // Company G — placeholder classifications with deliberately mixed treatments.
    cls.vehicle = await makeClass(G, 'Vehicle', {}, '5.00');
    cls.accA = await makeClass(G, 'Accessory A', {}, '18.00');
    cls.accB = await makeClass(G, 'Accessory B', {}, '28.00');
    cls.warranty = await makeClass(G, 'Warranty', { codeType: 'SAC' }, '18.00');
    cls.rto = await makeClass(G, 'Rto', { treatment: 'NON_TAXABLE', code: null });
    cls.insurance = await makeClass(G, 'Insurance', { treatment: 'EXEMPT', code: null });
    cls.registration = await makeClass(G, 'Registration', { treatment: 'NIL_RATED', code: null });
    cls.noRate = await makeClass(G, 'No rate');
    cls.noCode = await makeClass(G, 'No code', { code: null }, '5.00');
    await prisma.scooterModel.update({ where: { id: G.modelId }, data: { taxClassificationId: cls.vehicle } });
    for (const [componentType, classificationId] of [['EXTENDED_WARRANTY', cls.warranty], ['RTO', cls.rto], ['INSURANCE', cls.insurance], ['REGISTRATION', cls.registration]] as const) {
      await prisma.taxComponentMapping.create({ data: { companyId: G.id, componentType, classificationId: classificationId! } });
    }
    acc.a = (await prisma.accessory.create({ data: { companyId: G.id, name: `Acc A ${stamp}`, sellPrice: 59_000n, taxClassificationId: cls.accA } })).id;
    acc.b = (await prisma.accessory.create({ data: { companyId: G.id, name: `Acc B ${stamp}`, sellPrice: 128_000n, taxClassificationId: cls.accB } })).id;
    acc.unclassified = (await prisma.accessory.create({ data: { companyId: G.id, name: `Acc None ${stamp}`, sellPrice: 10_000n } })).id;
    // Company T — another tenant's classification (with a rate), used to prove isolation.
    tClassificationId = await makeClass(T, 'Other tenant', {}, '5.00');
  }, 60000);

  afterAll(async () => {
    // Hard-delete this suite's own rows (raw SQL: several models are soft-delete aware, and snapshots
    // are write-once through the client). Order follows the foreign keys.
    for (const id of [G.id, N.id, T.id].filter(Boolean)) {
      for (const sql of [
        'DELETE FROM "TaxSnapshot" WHERE "companyId" = $1',
        'DELETE FROM "Sale" WHERE "companyId" = $1',
        'DELETE FROM "Booking" WHERE "companyId" = $1',
        'DELETE FROM "CustomerTimelineEntry" WHERE "companyId" = $1',
        'DELETE FROM "Notification" WHERE "companyId" = $1',
        'DELETE FROM "ActivityLog" WHERE "companyId" = $1',
        'DELETE FROM "Customer" WHERE "companyId" = $1',
        'DELETE FROM "InventoryEvent" e USING "InventoryUnit" u WHERE e."unitId" = u.id AND u."companyId" = $1',
        'DELETE FROM "InventoryUnit" WHERE "companyId" = $1',
        'DELETE FROM "ScooterVariant" WHERE "companyId" = $1',
        'DELETE FROM "ScooterModel" WHERE "companyId" = $1',
        'DELETE FROM "Accessory" WHERE "companyId" = $1',
        'DELETE FROM "TaxComponentMapping" WHERE "companyId" = $1',
        'DELETE FROM "TaxClassification" WHERE "companyId" = $1',
        'DELETE FROM "InvoiceSetting" WHERE "companyId" = $1',
        'DELETE FROM "CompanySetting" WHERE "companyId" = $1',
        'DELETE FROM "User" WHERE "companyId" = $1',
        'DELETE FROM "Branch" WHERE "companyId" = $1',
        'DELETE FROM "Company" WHERE id = $1',
      ]) {
        await prisma.$executeRawUnsafe(sql, id);
      }
    }
    await app.close();
  });

  // ───────────────────────── GST disabled ─────────────────────────
  describe('GST disabled — invoice generation is exactly as before', () => {
    let nonGstBookingId = '';

    it('creates the Sale with no snapshot, no engine call, and no GST configuration required', async () => {
      calculateSpy.mockClear();
      // Discount, exchange and every scalar component, with NO classification / mapping / state code anywhere.
      const b = await newBooking(N, { exShowroom: 1_000_000, discount: 30_000, exchangeValue: 100_000, rto: 85_000, insurance: 42_000, registration: 15_000, extendedWarranty: 20_000 }, 'noState');
      expect(b.total).toBe('1032000');
      nonGstBookingId = b.id;
      const res = await invoice(N, b.id).expect(201);
      expect(res.body.status).toBe('CONVERTED');
      expect(res.body.total).toBe('1032000');

      const sale = (await saleOf(b.id))!;
      expect(sale.total).toBe(1_032_000n);
      expect(sale.taxAmount).toBe(0n);
      expect(sale.status).toBe('INVOICED');
      expect(await snapshotOf(sale.id)).toBeNull();
      expect(await prisma.taxSnapshot.count({ where: { companyId: N.id } })).toBe(0);
      expect(calculateSpy).not.toHaveBeenCalled();
    });

    it('historical: a sale invoiced before GST was enabled keeps no snapshot and still serves its invoice', async () => {
      await setting(N, { gstEnabled: true, gstNumber: 'TEST-GSTIN-n', gstStateCode: '24' });
      try {
        const sale = (await saleOf(nonGstBookingId))!;
        expect(await snapshotOf(sale.id)).toBeNull(); // never backfilled
        const got = await http().get(`/api/v1/bookings/${nonGstBookingId}`).set('Authorization', auth(N)).expect(200);
        expect(got.body.total).toBe('1032000');
        expect(got.body.paymentSummary).toMatchObject({ total: '1032000', paid: '0', balance: '1032000' });
        const pdf = await http().get(`/api/v1/bookings/${nonGstBookingId}/invoice/pdf`).set('Authorization', auth(N)).expect(200);
        expect(pdf.headers['content-type']).toContain('application/pdf');
      } finally {
        await setting(N, { gstEnabled: false, gstNumber: null, gstStateCode: null });
      }
    });
  });

  // ───────────────────────── GST enabled ─────────────────────────
  describe('GST enabled — immutable snapshot, unchanged commercial total', () => {
    it('vehicle only, INTRA: GST is extracted from the inclusive amount; the total does not move', async () => {
      const b = await newBooking(G, { exShowroom: 1_000_000 });
      expect(b.total).toBe('1000000');
      const res = await invoice(G, b.id).expect(201);
      expect(res.body.status).toBe('CONVERTED');
      expect(res.body.total).toBe('1000000');
      expect(res.body.paymentSummary).toMatchObject({ total: '1000000', paid: '0', balance: '1000000' });

      const sale = (await saleOf(b.id))!;
      expect(sale.total).toBe(1_000_000n);
      expect(sale.exShowroom).toBe(1_000_000n);
      expect(sale.taxAmount).toBe(0n); // legacy additive field is NOT repurposed (returns boundary)

      const snap = (await snapshotOf(sale.id))!;
      expect(snap).toMatchObject({
        companyId: G.id, engineVersion: '1', supplyType: 'INTRA', supplierGstin: 'TEST-GSTIN-g', supplierStateCode: '24', placeOfSupplyStateCode: '24',
        discountTreatment: null, exchangeTreatment: null, discountAmount: 0n, exchangeAmount: 0n,
        totalGross: 1_000_000n, totalTaxable: 952_381n, totalTax: 47_619n, totalCGST: 23_810n, totalSGST: 23_810n, totalIGST: 0n, totalRoundOff: -1n,
        documentTotal: 1_000_000n,
      });
      expect(snap.documentTotal).toBe(sale.total);
      expect(snap.asOf.toISOString().slice(0, 10)).toBe(calendarDateInTimeZone(sale.invoicedAt!, 'Asia/Kolkata'));
      expect(snap.lines).toHaveLength(1);
      expect(snap.lines[0]).toMatchObject({
        companyId: G.id, lineKey: 'vehicle', position: 1, componentType: 'VEHICLE', quantity: 1, unitAmount: 1_000_000n, sourceId: sale.unitId,
        classificationId: cls.vehicle, classificationName: `Vehicle ${stamp}`, codeType: 'HSN', code: 'TEST-VEHICLE', treatment: 'TAXABLE', pricingMode: 'INCLUSIVE',
        grossAmount: 1_000_000n, taxableAmount: 952_381n, taxTotal: 47_619n, cgst: 23_810n, sgst: 23_810n, igst: 0n, roundOff: -1n,
      });
      expect(snap.lines[0]!.ratePercent!.toFixed(2)).toBe('5.00');
    });

    it('INTER: a customer in another state is taxed as IGST', async () => {
      const b = await newBooking(G, { exShowroom: 1_000_000 }, 'inter');
      await invoice(G, b.id).expect(201);
      const snap = (await snapshotOf((await saleOf(b.id))!.id))!;
      expect(snap).toMatchObject({ supplyType: 'INTER', supplierStateCode: '24', placeOfSupplyStateCode: '27', totalIGST: 47_619n, totalCGST: 0n, totalSGST: 0n, totalRoundOff: 0n, totalTax: 47_619n, documentTotal: 1_000_000n });
    });

    it('accessories: one line per row at its own rate — never blended', async () => {
      const b = await newBooking(G, { exShowroom: 1_000_000, accessories: [{ accessoryId: acc.a, qty: 2, unitPrice: 59_000 }, { accessoryId: acc.b, qty: 1, unitPrice: 128_000 }] });
      expect(b.total).toBe('1246000');
      await invoice(G, b.id).expect(201);
      const sale = (await saleOf(b.id))!;
      expect(sale.total).toBe(1_246_000n);
      const snap = (await snapshotOf(sale.id))!;
      expect(snap.lines.map((l) => [l.position, l.componentType, l.quantity, l.unitAmount, l.ratePercent?.toFixed(2), l.grossAmount, l.taxableAmount, l.taxTotal])).toEqual([
        [1, 'VEHICLE', 1, 1_000_000n, '5.00', 1_000_000n, 952_381n, 47_619n],
        [2, 'ACCESSORY', 2, 59_000n, '18.00', 118_000n, 100_000n, 18_000n],
        [3, 'ACCESSORY', 1, 128_000n, '28.00', 128_000n, 100_000n, 28_000n],
      ]);
      expect(snap.lines[1]).toMatchObject({ sourceId: acc.a, description: `Acc A ${stamp}`, classificationId: cls.accA, code: 'TEST-ACCESSORY-A', cgst: 9_000n, sgst: 9_000n });
      expect(snap.lines[2]).toMatchObject({ sourceId: acc.b, classificationId: cls.accB, cgst: 14_000n, sgst: 14_000n });
      expect(snap).toMatchObject({ totalGross: 1_246_000n, totalTaxable: 1_152_381n, totalTax: 93_619n, totalCGST: 46_810n, totalSGST: 46_810n, totalRoundOff: -1n, documentTotal: 1_246_000n });
    });

    it('mixed treatments: warranty, RTO, insurance and registration follow their mapped classification', async () => {
      const b = await newBooking(G, { exShowroom: 1_000_000, extendedWarranty: 118_000, rto: 85_000, insurance: 42_000, registration: 15_000 });
      expect(b.total).toBe('1260000');
      await invoice(G, b.id).expect(201);
      const sale = (await saleOf(b.id))!;
      const snap = (await snapshotOf(sale.id))!;
      expect(snap.lines.map((l) => [l.lineKey, l.componentType, l.treatment, l.ratePercent?.toFixed(2) ?? null, l.grossAmount, l.taxableAmount, l.taxTotal])).toEqual([
        ['vehicle', 'VEHICLE', 'TAXABLE', '5.00', 1_000_000n, 952_381n, 47_619n],
        ['extended-warranty', 'EXTENDED_WARRANTY', 'TAXABLE', '18.00', 118_000n, 100_000n, 18_000n],
        ['rto', 'RTO', 'NON_TAXABLE', null, 85_000n, 85_000n, 0n],
        ['insurance', 'INSURANCE', 'EXEMPT', null, 42_000n, 42_000n, 0n],
        ['registration', 'REGISTRATION', 'NIL_RATED', null, 15_000n, 15_000n, 0n],
      ]);
      // Header totals are the sums of the line results.
      const lines = snap.lines as unknown as Record<string, unknown>[];
      expect(snap.totalGross).toBe(sum(lines, 'grossAmount'));
      expect(snap.totalTaxable).toBe(sum(lines, 'taxableAmount'));
      expect(snap.totalCGST).toBe(sum(lines, 'cgst'));
      expect(snap.totalSGST).toBe(sum(lines, 'sgst'));
      expect(snap.totalIGST).toBe(sum(lines, 'igst'));
      expect(snap.totalTax).toBe(sum(lines, 'taxTotal'));
      expect(snap.totalRoundOff).toBe(sum(lines, 'roundOff'));
      // The hard invariants.
      expect(snap.totalTaxable + snap.totalTax).toBe(snap.totalGross);
      expect(snap.totalCGST + snap.totalSGST + snap.totalIGST + snap.totalRoundOff).toBe(snap.totalTax);
      expect(snap.documentTotal).toBe(sale.total);
      expect(sale.total).toBe(BigInt(b.total));
      expect(snap).toMatchObject({ totalGross: 1_260_000n, totalTaxable: 1_194_381n, totalTax: 65_619n, totalCGST: 32_810n, totalSGST: 32_810n, totalRoundOff: -1n });
    });

    describe('discount / exchange follow the company’s recorded policy', () => {
      afterEach(() => setting(G, { gstDiscountTreatment: null, gstExchangeTreatment: null }));

      it('discount recorded as reducing the vehicle taxable value', async () => {
        await setting(G, { gstDiscountTreatment: 'REDUCES_VEHICLE_TAXABLE_VALUE' });
        const b = await newBooking(G, { exShowroom: 1_050_000, discount: 50_000 });
        expect(b.total).toBe('1000000');
        await invoice(G, b.id).expect(201);
        const sale = (await saleOf(b.id))!;
        const snap = (await snapshotOf(sale.id))!;
        expect(snap).toMatchObject({ discountTreatment: 'REDUCES_VEHICLE_TAXABLE_VALUE', discountAmount: 50_000n, exchangeTreatment: null, totalGross: 1_000_000n, totalTaxable: 952_381n, documentTotal: 1_000_000n });
        expect(snap.lines[0]).toMatchObject({ unitAmount: 1_050_000n, grossAmount: 1_000_000n });
        expect(sale).toMatchObject({ total: 1_000_000n, exShowroom: 1_050_000n, discount: 50_000n }); // commercial figures untouched
      });

      it('discount recorded as an after-tax adjustment', async () => {
        await setting(G, { gstDiscountTreatment: 'AFTER_TAX_ADJUSTMENT' });
        const b = await newBooking(G, { exShowroom: 1_000_000, discount: 50_000 });
        expect(b.total).toBe('950000');
        await invoice(G, b.id).expect(201);
        const sale = (await saleOf(b.id))!;
        const snap = (await snapshotOf(sale.id))!;
        expect(snap).toMatchObject({ discountTreatment: 'AFTER_TAX_ADJUSTMENT', discountAmount: 50_000n, totalGross: 1_000_000n, totalTaxable: 952_381n, totalTax: 47_619n, documentTotal: 950_000n });
        expect(snap.totalGross - snap.discountAmount).toBe(sale.total);
      });

      it('exchange under each recorded policy', async () => {
        await setting(G, { gstExchangeTreatment: 'AFTER_TAX_ADJUSTMENT' });
        const after = await newBooking(G, { exShowroom: 1_000_000, exchangeValue: 200_000 });
        await invoice(G, after.id).expect(201);
        const afterSale = (await saleOf(after.id))!;
        expect(await snapshotOf(afterSale.id)).toMatchObject({ exchangeTreatment: 'AFTER_TAX_ADJUSTMENT', exchangeAmount: 200_000n, totalGross: 1_000_000n, totalTaxable: 952_381n, documentTotal: 800_000n });
        expect(afterSale.total).toBe(800_000n);

        await setting(G, { gstExchangeTreatment: 'REDUCES_VEHICLE_TAXABLE_VALUE' });
        const reduces = await newBooking(G, { exShowroom: 1_000_000, exchangeValue: 200_000 });
        await invoice(G, reduces.id).expect(201);
        const reducesSale = (await saleOf(reduces.id))!;
        expect(await snapshotOf(reducesSale.id)).toMatchObject({ exchangeTreatment: 'REDUCES_VEHICLE_TAXABLE_VALUE', exchangeAmount: 200_000n, totalGross: 800_000n, totalTaxable: 761_905n, totalTax: 38_095n, documentTotal: 800_000n });
        expect(reducesSale.total).toBe(800_000n);
      });
    });
  });

  // ───────────────────────── Concurrency / atomicity ─────────────────────────
  describe('one Sale, one snapshot', () => {
    it('a second generateInvoice call is rejected (409) and nothing is duplicated', async () => {
      const b = await newBooking(G, { exShowroom: 500_000 });
      await invoice(G, b.id).expect(201);
      const before = await counters(G);
      await invoice(G, b.id).expect(409);
      expect(await counters(G)).toEqual(before);
      expect(await prisma.sale.count({ where: { bookingId: b.id } })).toBe(1);
      expect(await prisma.taxSnapshot.count({ where: { sale: { bookingId: b.id } } })).toBe(1);
    });

    it('two concurrent calls produce exactly one Sale and one snapshot', async () => {
      const b = await newBooking(G, { exShowroom: 500_000 });
      const results = await Promise.all([invoice(G, b.id), invoice(G, b.id)]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(await prisma.sale.count({ where: { bookingId: b.id } })).toBe(1);
      expect(await prisma.taxSnapshot.count({ where: { sale: { bookingId: b.id } } })).toBe(1);
      expect(await prisma.taxSnapshotLine.count({ where: { snapshot: { sale: { bookingId: b.id } } } })).toBe(1);
    });

    it('if the snapshot cannot be written, the whole invoice rolls back — no Sale, no number used', async () => {
      const b = await newBooking(G, { exShowroom: 500_000 });
      const before = await counters(G);
      const persistSpy = jest.spyOn(app.get(SaleTaxService), 'persist').mockRejectedValueOnce(new Error('simulated snapshot write failure'));
      await invoice(G, b.id).expect(500);
      persistSpy.mockRestore();
      expect(await counters(G)).toEqual(before);
      expect(await saleOf(b.id)).toBeNull();
      expect((await prisma.booking.findFirstOrThrow({ where: { id: b.id } })).status).toBe('CONFIRMED');
      // And the same booking invoices cleanly afterwards.
      await invoice(G, b.id).expect(201);
      expect(await prisma.taxSnapshot.count({ where: { sale: { bookingId: b.id } } })).toBe(1);
    });
  });

  // ───────────────────────── Missing configuration ─────────────────────────
  describe('missing configuration fails closed — no Sale, no snapshot, booking unchanged', () => {
    let plain: BookingBody; // vehicle + RTO; stays unconverted through every failure below

    beforeAll(async () => {
      plain = await newBooking(G, { exShowroom: 1_000_000, rto: 85_000 });
    });

    it('vehicle model has no classification', async () => {
      await prisma.scooterModel.update({ where: { id: G.modelId }, data: { taxClassificationId: null } });
      try {
        await expectRefused(G, plain.id, 'VEHICLE_CLASSIFICATION_MISSING');
      } finally {
        await prisma.scooterModel.update({ where: { id: G.modelId }, data: { taxClassificationId: cls.vehicle } });
      }
    });

    it('classification has no rate for the tax-point date', async () => {
      await prisma.scooterModel.update({ where: { id: G.modelId }, data: { taxClassificationId: cls.noRate } });
      try {
        await expectRefused(G, plain.id, 'NO_RATE_FOR_DATE');
      } finally {
        await prisma.scooterModel.update({ where: { id: G.modelId }, data: { taxClassificationId: cls.vehicle } });
      }
    });

    it('taxable classification has no HSN/SAC code', async () => {
      await prisma.scooterModel.update({ where: { id: G.modelId }, data: { taxClassificationId: cls.noCode } });
      try {
        await expectRefused(G, plain.id, 'TAXABLE_WITHOUT_CODE');
      } finally {
        await prisma.scooterModel.update({ where: { id: G.modelId }, data: { taxClassificationId: cls.vehicle } });
      }
    });

    it('component mapping is missing', async () => {
      await prisma.taxComponentMapping.deleteMany({ where: { companyId: G.id, componentType: 'RTO' } });
      try {
        await expectRefused(G, plain.id, 'COMPONENT_MAPPING_MISSING');
      } finally {
        await prisma.taxComponentMapping.create({ data: { companyId: G.id, componentType: 'RTO', classificationId: cls.rto! } });
      }
    });

    it('company GST state code is missing', async () => {
      await setting(G, { gstStateCode: null });
      try {
        await expectRefused(G, plain.id, 'SUPPLIER_STATE_CODE_MISSING');
      } finally {
        await setting(G, { gstStateCode: '24' });
      }
    });

    it('customer GST state code is missing — no inference from free-text state', async () => {
      const b = await newBooking(G, { exShowroom: 1_000_000 }, 'noState');
      await prisma.customer.update({ where: { id: G.customers.noState }, data: { state: 'Gujarat', city: 'Una', pin: '362560' } });
      await expectRefused(G, b.id, 'CUSTOMER_STATE_CODE_MISSING');
    });

    it('accessory has no classification — never silently zero-rated', async () => {
      const b = await newBooking(G, { exShowroom: 1_000_000, accessories: [{ accessoryId: acc.unclassified, qty: 1, unitPrice: 10_000 }] });
      await expectRefused(G, b.id, 'ACCESSORY_CLASSIFICATION_MISSING');
    });

    it('accessoriesTotal is positive but the accessory rows are gone — no line is invented', async () => {
      const b = await newBooking(G, { exShowroom: 1_000_000, accessories: [{ accessoryId: acc.a, qty: 1, unitPrice: 59_000 }] });
      await prisma.$executeRawUnsafe('DELETE FROM "BookingAccessory" WHERE "bookingId" = $1', b.id);
      await expectRefused(G, b.id, 'ACCESSORY_TOTAL_MISMATCH');
    });

    it('discount with no recorded policy', async () => {
      const b = await newBooking(G, { exShowroom: 1_000_000, discount: 10_000 });
      await expectRefused(G, b.id, 'DISCOUNT_POLICY_MISSING');
    });

    it('exchange with no recorded policy', async () => {
      const b = await newBooking(G, { exShowroom: 1_000_000, exchangeValue: 10_000 });
      await expectRefused(G, b.id, 'EXCHANGE_POLICY_MISSING');
    });

    it('the refused booking was left intact: once configuration is complete it invoices normally', async () => {
      const res = await invoice(G, plain.id).expect(201);
      expect(res.body.total).toBe(plain.total);
      const sale = (await saleOf(plain.id))!;
      expect(await snapshotOf(sale.id)).toMatchObject({ documentTotal: 1_085_000n, totalGross: 1_085_000n, totalTaxable: 1_037_381n, totalTax: 47_619n });
    });
  });

  // ───────────────────────── Tenant isolation ─────────────────────────
  describe('tenant isolation', () => {
    it('a model pointing at another company’s classification cannot be invoiced', async () => {
      const b = await newBooking(G, { exShowroom: 1_000_000 });
      await prisma.scooterModel.update({ where: { id: G.modelId }, data: { taxClassificationId: tClassificationId } });
      try {
        await expectRefused(G, b.id, 'CLASSIFICATION_NOT_FOUND');
      } finally {
        await prisma.scooterModel.update({ where: { id: G.modelId }, data: { taxClassificationId: cls.vehicle } });
      }
    });

    it('a component mapping pointing at another company’s classification cannot be used', async () => {
      const b = await newBooking(G, { exShowroom: 1_000_000, rto: 85_000 });
      await prisma.taxComponentMapping.updateMany({ where: { companyId: G.id, componentType: 'RTO' }, data: { classificationId: tClassificationId } });
      try {
        await expectRefused(G, b.id, 'CLASSIFICATION_NOT_FOUND');
      } finally {
        await prisma.taxComponentMapping.updateMany({ where: { companyId: G.id, componentType: 'RTO' }, data: { classificationId: cls.rto! } });
      }
    });

    it('another company’s mappings are never read: company T has none, so its own RTO line is refused', async () => {
      await prisma.scooterModel.update({ where: { id: T.modelId }, data: { taxClassificationId: tClassificationId } });
      const b = await newBooking(T, { exShowroom: 1_000_000, rto: 85_000 });
      await expectRefused(T, b.id, 'COMPONENT_MAPPING_MISSING'); // G's RTO mapping is invisible to T
      expect(await prisma.taxSnapshot.count({ where: { companyId: T.id } })).toBe(0);
    });
  });

  // ───────────────────────── Immutability (kept last: it rewrites company G's configuration) ─────────────────────────
  describe('immutability — the snapshot is historical truth', () => {
    it('later changes to classifications, rates, products, customer and company settings do not alter it', async () => {
      const b = await newBooking(G, { exShowroom: 1_000_000, extendedWarranty: 118_000, rto: 85_000, accessories: [{ accessoryId: acc.a, qty: 1, unitPrice: 59_000 }] });
      await invoice(G, b.id).expect(201);
      const sale = (await saleOf(b.id))!;
      const freeze = async (): Promise<string> => JSON.stringify(await snapshotOf(sale.id), (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
      const before = await freeze();

      // Rewrite every master the snapshot was derived from.
      await prisma.taxClassification.update({ where: { id: cls.vehicle }, data: { name: `Renamed ${stamp}`, code: 'CHANGED', treatment: 'EXEMPT', codeType: 'SAC' } });
      await prisma.taxRate.updateMany({ where: { classificationId: cls.vehicle }, data: { ratePercent: new Prisma.Decimal('28.00') } });
      await prisma.taxRate.updateMany({ where: { classificationId: cls.warranty }, data: { isActive: false } });
      await prisma.taxClassification.update({ where: { id: cls.rto }, data: { treatment: 'TAXABLE', code: 'NOW-TAXABLE' } });
      await prisma.scooterModel.update({ where: { id: G.modelId }, data: { taxClassificationId: cls.accB } });
      await prisma.accessory.update({ where: { id: acc.a }, data: { taxClassificationId: null, name: 'Renamed accessory' } });
      await prisma.taxComponentMapping.updateMany({ where: { companyId: G.id, componentType: 'EXTENDED_WARRANTY' }, data: { classificationId: cls.insurance! } });
      await prisma.customer.update({ where: { id: G.customers.intra }, data: { gstStateCode: '29' } });
      await setting(G, { gstStateCode: '07', gstNumber: 'TEST-GSTIN-CHANGED', gstDiscountTreatment: 'AFTER_TAX_ADJUSTMENT', gstExchangeTreatment: 'AFTER_TAX_ADJUSTMENT', timezone: 'UTC' });

      expect(await freeze()).toBe(before);
      const after = (await snapshotOf(sale.id))!;
      expect(after.lines[0]).toMatchObject({ classificationName: `Vehicle ${stamp}`, code: 'TEST-VEHICLE', treatment: 'TAXABLE', codeType: 'HSN' });
      expect(after.lines[0]!.ratePercent!.toFixed(2)).toBe('5.00');
      expect(after).toMatchObject({ supplierGstin: 'TEST-GSTIN-g', supplierStateCode: '24', placeOfSupplyStateCode: '24' });
      // The commercial record is equally untouched.
      expect((await saleOf(b.id))!.total).toBe(sale.total);
    });

    it('a snapshot cannot be updated or deleted through the application, and its Sale cannot be removed from under it', async () => {
      const snap = (await prisma.taxSnapshot.findFirstOrThrow({ where: { companyId: G.id } }));
      await expect(prisma.taxSnapshot.update({ where: { id: snap.id }, data: { totalTax: 0n } })).rejects.toThrow(/immutable/);
      await expect(prisma.taxSnapshot.delete({ where: { id: snap.id } })).rejects.toThrow(/immutable/);
      await expect(prisma.taxSnapshotLine.updateMany({ where: { snapshotId: snap.id }, data: { taxTotal: 0n } })).rejects.toThrow(/immutable/);
      await expect(prisma.taxSnapshotLine.deleteMany({ where: { snapshotId: snap.id } })).rejects.toThrow(/immutable/);
      // Database-level: the Sale → snapshot foreign key is RESTRICT.
      await expect(prisma.$executeRawUnsafe('DELETE FROM "Sale" WHERE id = $1', snap.saleId)).rejects.toThrow();
      expect(await prisma.taxSnapshot.count({ where: { id: snap.id } })).toBe(1);
    });
  });
});
