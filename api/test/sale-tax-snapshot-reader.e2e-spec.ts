import { INestApplication, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantContext } from '../src/tenant/tenant-context.service';
import type { SaleTaxDocument } from '../src/modules/tax/sale-tax-document';
import { SaleTaxSnapshotReader } from '../src/modules/tax/sale-tax-snapshot.reader';
import { TaxEngineService } from '../src/modules/tax/tax-engine.service';
import { calendarDateInTimeZone } from '../src/modules/tax/tax-point';

/**
 * Stage D1 — the GST snapshot read model against the real database. Sales are invoiced through the
 * real HTTP endpoint (so the snapshots are genuine Stage C output); the reader has no HTTP endpoint and
 * is exercised directly inside a tenant context, exactly as a document service will call it.
 *
 * Everything runs in THROWAWAY companies created here and hard-deleted afterwards; the seeded company
 * is never read or changed and GST is never enabled for it. Classification codes and rates below are
 * PLACEHOLDERS for testing — not real HSN/SAC values, approved GST rates, or CA-confirmed treatments.
 */
describe('Sale GST snapshot reader (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenant: TenantContext;
  let reader: SaleTaxSnapshotReader;
  let engine: TaxEngineService;
  const stamp = Date.now().toString().slice(-8);
  const http = () => request(app.getHttpServer());
  let serial = 0;

  interface Co { id: string; token: string; modelId: string; customers: Record<string, string> }
  const G = {} as Co; // GST enabled, fully configured (company state 24)
  const N = {} as Co; // GST disabled
  const T = {} as Co; // another GST-enabled tenant
  const cls: Record<string, string> = {};
  const acc: Record<string, string> = {};

  const auth = (co: Co): string => `Bearer ${co.token}`;
  const day = (s: string): Date => new Date(`${s}T00:00:00.000Z`);
  const read = (co: Co, saleId: string): Promise<SaleTaxDocument | null> => tenant.runWith(co.id, () => reader.forSale(saleId));

  const setupCompany = async (co: Co, label: string, gst: boolean): Promise<void> => {
    const company = await prisma.company.create({ data: { name: `TaxRead ${label} ${stamp}`, slug: `taxread-${label}-${stamp}` } });
    co.id = company.id;
    await prisma.branch.create({ data: { companyId: co.id, name: 'HQ', isPrimary: true } });
    const email = `taxread.${label}.${stamp}@e2e.test`;
    await prisma.user.create({ data: { companyId: co.id, name: `Owner ${label}`, email, role: 'OWNER', passwordHash: await bcrypt.hash('Test@12345', 12) } });
    // Booking codes and invoice numbers are unique across ALL companies, so each company gets its own prefixes.
    await prisma.companySetting.create({
      data: { companyId: co.id, gstEnabled: gst, gstNumber: gst ? `TEST-GSTIN-${label}` : null, gstStateCode: gst ? '24' : null, bookingPrefix: `R${label}${stamp}-BK`, invoicePrefix: `R${label}${stamp}-INV`, receiptPrefix: `R${label}${stamp}-RC` },
    });
    await prisma.invoiceSetting.create({ data: { companyId: co.id } });
    co.token = (await http().post('/api/v1/auth/login').send({ email, password: 'Test@12345' }).expect(200)).body.accessToken;
    co.modelId = (await prisma.scooterModel.create({ data: { companyId: co.id, name: `Read Model ${label} ${stamp}`, brand: 'TESTBRAND' } })).id;
    co.customers = {};
    for (const [key, stateCode] of [['intra', '24'], ['inter', '27']] as const) {
      const res = await http().post('/api/v1/customers').set('Authorization', auth(co)).send({ name: `Cust ${key} ${label}`, phone: `8${stamp}${serial++}` }).expect(201);
      await prisma.customer.update({ where: { id: res.body.id }, data: { gstStateCode: stateCode } });
      co.customers[key] = res.body.id;
    }
  };

  const makeClass = async (co: Co, name: string, over: Partial<Prisma.TaxClassificationUncheckedCreateInput> = {}, ratePct?: string): Promise<string> => {
    const c = await prisma.taxClassification.create({ data: { companyId: co.id, name: `${name} ${stamp}`, codeType: 'HSN', code: `TEST-${name.toUpperCase().replace(/\s+/g, '-')}`, treatment: 'TAXABLE', ...over } });
    if (ratePct) await prisma.taxRate.create({ data: { companyId: co.id, classificationId: c.id, ratePercent: new Prisma.Decimal(ratePct), effectiveFrom: day('2020-01-01'), effectiveTo: null } });
    return c.id;
  };

  /** Creates a booking, invoices it through the API and returns the resulting sale id. */
  const invoicedSale = async (co: Co, body: Record<string, unknown>, customer = 'intra'): Promise<string> => {
    const n = serial++;
    const unit = await http()
      .post('/api/v1/inventory/units')
      .set('Authorization', auth(co))
      .send({ modelId: co.modelId, variant: `V-${stamp}`, colour: `C${n}`, vin: `RDV${stamp}${n}`, motorNumber: `RDM${stamp}${n}`, batteryNumber: `RDB${stamp}${n}` })
      .expect(201);
    const booking = await http().post('/api/v1/bookings').set('Authorization', auth(co)).send({ customerId: co.customers[customer], unitId: unit.body.id, ...body }).expect(201);
    await http().post(`/api/v1/bookings/${booking.body.id}/invoice`).set('Authorization', auth(co)).expect(201);
    return (await prisma.sale.findFirstOrThrow({ where: { bookingId: booking.body.id } })).id;
  };

  // Raw rows, read without the application's mapping — the independent truth the reader is compared to.
  type Row = Record<string, unknown>;
  const rawSnapshot = async (saleId: string): Promise<Row> => (await prisma.$queryRawUnsafe<Row[]>('SELECT * FROM "TaxSnapshot" WHERE "saleId" = $1', saleId))[0]!;
  const rawLines = (snapshotId: string): Promise<Row[]> => prisma.$queryRawUnsafe<Row[]>('SELECT * FROM "TaxSnapshotLine" WHERE "snapshotId" = $1 ORDER BY position', snapshotId);
  const snapshotCounts = async (): Promise<{ snapshots: number; lines: number }> => {
    const where = { companyId: { in: [G.id, N.id, T.id] } };
    return { snapshots: await prisma.taxSnapshot.count({ where }), lines: await prisma.taxSnapshotLine.count({ where }) };
  };

  let fullSaleId = ''; // INTRA, every component, pre-tax discount + after-tax exchange
  let interSaleId = '';
  let tSaleId = '';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
    prisma = app.get(PrismaService);
    tenant = app.get(TenantContext);
    reader = app.get(SaleTaxSnapshotReader);
    engine = app.get(TaxEngineService);

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
    cls.other = await makeClass(G, 'Other', {}, '12.00');
    await prisma.scooterModel.update({ where: { id: G.modelId }, data: { taxClassificationId: cls.vehicle } });
    for (const [componentType, classificationId] of [['EXTENDED_WARRANTY', cls.warranty], ['RTO', cls.rto], ['INSURANCE', cls.insurance], ['REGISTRATION', cls.registration]] as const) {
      await prisma.taxComponentMapping.create({ data: { companyId: G.id, componentType, classificationId: classificationId! } });
    }
    acc.a = (await prisma.accessory.create({ data: { companyId: G.id, name: `Acc A ${stamp}`, sellPrice: 59_000n, taxClassificationId: cls.accA } })).id;
    acc.b = (await prisma.accessory.create({ data: { companyId: G.id, name: `Acc B ${stamp}`, sellPrice: 128_000n, taxClassificationId: cls.accB } })).id;
    await prisma.companySetting.update({ where: { companyId: G.id }, data: { gstDiscountTreatment: 'REDUCES_VEHICLE_TAXABLE_VALUE', gstExchangeTreatment: 'AFTER_TAX_ADJUSTMENT' } });

    // Company T — its own classification, so it can issue its own GST sale.
    const tClass = await makeClass(T, 'Other tenant', {}, '5.00');
    await prisma.scooterModel.update({ where: { id: T.modelId }, data: { taxClassificationId: tClass } });

    fullSaleId = await invoicedSale(G, {
      exShowroom: 1_050_000, discount: 50_000, exchangeValue: 20_000,
      accessories: [{ accessoryId: acc.a, qty: 2, unitPrice: 59_000 }, { accessoryId: acc.b, qty: 1, unitPrice: 128_000 }],
      extendedWarranty: 118_000, rto: 85_000, insurance: 42_000, registration: 15_000,
    });
    interSaleId = await invoicedSale(G, { exShowroom: 1_000_000 }, 'inter');
    tSaleId = await invoicedSale(T, { exShowroom: 500_000 });
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

  // ───────────────────────── A sale with a snapshot ─────────────────────────
  describe('GST sale', () => {
    it('INTRA: returns the frozen header with the sale identity', async () => {
      const sale = await prisma.sale.findFirstOrThrow({ where: { id: fullSaleId } });
      const doc = (await read(G, fullSaleId))!;
      expect(doc).toMatchObject({
        saleId: fullSaleId, bookingId: sale.bookingId, invoiceNumber: sale.invoiceNumber, invoicedAt: sale.invoicedAt,
        engineVersion: '1', supplyType: 'INTRA', supplierGstin: 'TEST-GSTIN-g', supplierStateCode: '24', placeOfSupplyStateCode: '24',
        discount: { amount: 50_000n, treatment: 'REDUCES_VEHICLE_TAXABLE_VALUE' },
        exchange: { amount: 20_000n, treatment: 'AFTER_TAX_ADJUSTMENT' },
        totals: { totalGross: 1_506_000n, totalTaxable: 1_394_381n, totalCGST: 55_810n, totalSGST: 55_810n, totalIGST: 0n, totalTax: 111_619n, totalRoundOff: -1n },
        documentTotal: 1_486_000n,
      });
      expect(doc.invoiceNumber).toMatch(/-INV0001$/);
      expect(doc.documentTotal).toBe(sale.total); // the customer's on-road total, untouched
      expect(doc.taxPoint).toBe(calendarDateInTimeZone(sale.invoicedAt!, 'Asia/Kolkata'));
    });

    it('returns every line in position order, taxable and not', async () => {
      const doc = (await read(G, fullSaleId))!;
      expect(doc.lines.map((l) => [l.position, l.lineKey.split(':')[0], l.componentType, l.treatment, l.ratePercent, l.quantity, l.unitAmount, l.grossAmount, l.taxableAmount, l.cgst, l.sgst, l.igst, l.taxTotal, l.roundOff])).toEqual([
        [1, 'vehicle', 'VEHICLE', 'TAXABLE', '5.00', 1, 1_050_000n, 1_000_000n, 952_381n, 23_810n, 23_810n, 0n, 47_619n, -1n],
        [2, 'accessory', 'ACCESSORY', 'TAXABLE', '18.00', 2, 59_000n, 118_000n, 100_000n, 9_000n, 9_000n, 0n, 18_000n, 0n],
        [3, 'accessory', 'ACCESSORY', 'TAXABLE', '28.00', 1, 128_000n, 128_000n, 100_000n, 14_000n, 14_000n, 0n, 28_000n, 0n],
        [4, 'extended-warranty', 'EXTENDED_WARRANTY', 'TAXABLE', '18.00', 1, 118_000n, 118_000n, 100_000n, 9_000n, 9_000n, 0n, 18_000n, 0n],
        [5, 'rto', 'RTO', 'NON_TAXABLE', null, 1, 85_000n, 85_000n, 85_000n, 0n, 0n, 0n, 0n, 0n],
        [6, 'insurance', 'INSURANCE', 'EXEMPT', null, 1, 42_000n, 42_000n, 42_000n, 0n, 0n, 0n, 0n, 0n],
        [7, 'registration', 'REGISTRATION', 'NIL_RATED', null, 1, 15_000n, 15_000n, 15_000n, 0n, 0n, 0n, 0n, 0n],
      ]);
      expect(doc.lines[0]).toMatchObject({ classificationId: cls.vehicle, classificationName: `Vehicle ${stamp}`, codeType: 'HSN', code: 'TEST-VEHICLE', pricingMode: 'INCLUSIVE' });
      expect(doc.lines[1]).toMatchObject({ sourceId: acc.a, description: `Acc A ${stamp}`, classificationId: cls.accA, code: 'TEST-ACCESSORY-A' });
      expect(doc.lines[3]).toMatchObject({ codeType: 'SAC', code: 'TEST-WARRANTY', sourceId: null });
      expect(doc.lines[4]).toMatchObject({ classificationName: `Rto ${stamp}`, code: null });
    });

    it('matches the stored rows field for field — nothing is recalculated on the way out', async () => {
      const doc = (await read(G, fullSaleId))!;
      const snap = await rawSnapshot(fullSaleId);
      expect(doc.snapshotId).toBe(snap.id);
      expect(doc.recordedAt).toEqual(snap.createdAt);
      expect(doc.taxPoint).toBe((snap.asOf as Date).toISOString().slice(0, 10));
      expect({
        engineVersion: doc.engineVersion, supplyType: doc.supplyType, supplierGstin: doc.supplierGstin, supplierStateCode: doc.supplierStateCode, placeOfSupplyStateCode: doc.placeOfSupplyStateCode,
        discountTreatment: doc.discount.treatment, exchangeTreatment: doc.exchange.treatment, discountAmount: doc.discount.amount, exchangeAmount: doc.exchange.amount,
        ...doc.totals, documentTotal: doc.documentTotal,
      }).toEqual({
        engineVersion: snap.engineVersion, supplyType: snap.supplyType, supplierGstin: snap.supplierGstin, supplierStateCode: snap.supplierStateCode, placeOfSupplyStateCode: snap.placeOfSupplyStateCode,
        discountTreatment: snap.discountTreatment, exchangeTreatment: snap.exchangeTreatment, discountAmount: snap.discountAmount, exchangeAmount: snap.exchangeAmount,
        totalGross: snap.totalGross, totalTaxable: snap.totalTaxable, totalCGST: snap.totalCGST, totalSGST: snap.totalSGST, totalIGST: snap.totalIGST, totalTax: snap.totalTax, totalRoundOff: snap.totalRoundOff,
        documentTotal: snap.documentTotal,
      });

      const rows = await rawLines(snap.id as string);
      expect(doc.lines).toHaveLength(rows.length);
      const copied = ['position', 'lineKey', 'componentType', 'description', 'sourceId', 'quantity', 'unitAmount', 'classificationId', 'classificationName', 'codeType', 'code', 'treatment', 'pricingMode', 'grossAmount', 'taxableAmount', 'cgst', 'sgst', 'igst', 'taxTotal', 'roundOff'] as const;
      doc.lines.forEach((l, i) => {
        const row = rows[i]!;
        for (const field of copied) expect([field, l[field]]).toEqual([field, row[field]]);
        expect(l.ratePercent).toBe(row.ratePercent === null ? null : (row.ratePercent as Prisma.Decimal).toFixed(2));
      });
    });

    it('INTER: a sale to another state carries IGST only', async () => {
      const doc = (await read(G, interSaleId))!;
      expect(doc).toMatchObject({
        supplyType: 'INTER', supplierStateCode: '24', placeOfSupplyStateCode: '27',
        discount: { amount: 0n, treatment: null }, exchange: { amount: 0n, treatment: null },
        totals: { totalGross: 1_000_000n, totalTaxable: 952_381n, totalCGST: 0n, totalSGST: 0n, totalIGST: 47_619n, totalTax: 47_619n, totalRoundOff: 0n },
        documentTotal: 1_000_000n,
      });
      expect(doc.lines).toHaveLength(1);
      expect(doc.lines[0]).toMatchObject({ lineKey: 'vehicle', position: 1, ratePercent: '5.00', cgst: 0n, sgst: 0n, igst: 47_619n, taxTotal: 47_619n, roundOff: 0n });
    });

    it('is repeatable and read-only: no engine call, no rows written', async () => {
      const calculate = jest.spyOn(engine, 'calculate');
      const resolveRate = jest.spyOn(engine, 'resolveRate');
      const before = await snapshotCounts();
      const first = await read(G, fullSaleId);
      const second = await read(G, fullSaleId);
      expect(second).toEqual(first);
      expect(calculate).not.toHaveBeenCalled();
      expect(resolveRate).not.toHaveBeenCalled();
      expect(await snapshotCounts()).toEqual(before);
      calculate.mockRestore();
      resolveRate.mockRestore();
    });
  });

  // ───────────────────────── A sale without a snapshot ─────────────────────────
  describe('sale with no GST snapshot', () => {
    it('returns null and never calculates or creates one — even after GST is enabled later', async () => {
      const saleId = await invoicedSale(N, { exShowroom: 1_000_000, discount: 30_000, rto: 85_000 });
      const before = await snapshotCounts();
      const calculate = jest.spyOn(engine, 'calculate');
      await expect(read(N, saleId)).resolves.toBeNull();

      // The company switches GST on afterwards: the old sale still has no snapshot and gets none.
      await prisma.companySetting.update({ where: { companyId: N.id }, data: { gstEnabled: true, gstNumber: 'TEST-GSTIN-n', gstStateCode: '24' } });
      await expect(read(N, saleId)).resolves.toBeNull();
      expect(calculate).not.toHaveBeenCalled();
      expect(await snapshotCounts()).toEqual(before);
      expect(await prisma.taxSnapshot.count({ where: { companyId: N.id } })).toBe(0);
      calculate.mockRestore();
    });
  });

  // ───────────────────────── Tenant isolation ─────────────────────────
  describe('tenant isolation', () => {
    it('each company reads its own sale', async () => {
      expect((await read(T, tSaleId))!).toMatchObject({ saleId: tSaleId, supplierGstin: 'TEST-GSTIN-t', documentTotal: 500_000n });
      expect((await read(G, fullSaleId))!.supplierGstin).toBe('TEST-GSTIN-g');
    });

    it("a company cannot read another company's snapshot — it looks like a sale that does not exist", async () => {
      await expect(read(T, fullSaleId)).rejects.toBeInstanceOf(NotFoundException);
      await expect(read(G, tSaleId)).rejects.toBeInstanceOf(NotFoundException);
      await expect(read(N, fullSaleId)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('an unknown or malformed sale id is a plain not-found', async () => {
      await expect(read(G, randomUUID())).rejects.toBeInstanceOf(NotFoundException);
      await expect(read(G, 'not-a-sale-id')).rejects.toBeInstanceOf(NotFoundException);
      await expect(read(G, '')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuses to run outside a tenant context', async () => {
      await expect(reader.forSale(fullSaleId)).rejects.toThrow('No tenant in context');
    });
  });

  // ───────────────────────── Immutability against configuration ─────────────────────────
  // Runs last: it deliberately rewrites company G's whole GST configuration.
  describe('configuration changed after the sale', () => {
    it('does not change the read model', async () => {
      const before = (await read(G, fullSaleId))!;
      const interBefore = (await read(G, interSaleId))!;

      await prisma.taxRate.updateMany({ where: { companyId: G.id }, data: { ratePercent: new Prisma.Decimal('12.00') } });
      await prisma.taxClassification.update({ where: { id: cls.vehicle }, data: { name: `Renamed ${stamp}`, code: 'TEST-CHANGED', codeType: 'SAC', treatment: 'EXEMPT' } });
      await prisma.taxClassification.update({ where: { id: cls.rto }, data: { treatment: 'TAXABLE', code: 'TEST-NOW-TAXABLE' } });
      await prisma.taxComponentMapping.updateMany({ where: { companyId: G.id }, data: { classificationId: cls.other } });
      await prisma.scooterModel.update({ where: { id: G.modelId }, data: { taxClassificationId: cls.other } });
      await prisma.accessory.update({ where: { id: acc.a }, data: { name: `Acc A renamed ${stamp}`, taxClassificationId: null } });
      await prisma.taxClassification.delete({ where: { id: cls.accB } }).catch(() => undefined); // archive, where the FK allows it
      await prisma.customer.update({ where: { id: G.customers.intra }, data: { gstStateCode: '27', name: 'Moved Customer' } });
      await prisma.customer.update({ where: { id: G.customers.inter }, data: { gstStateCode: '24' } });
      await prisma.companySetting.update({
        where: { companyId: G.id },
        data: { gstNumber: 'TEST-GSTIN-CHANGED', gstStateCode: '27', gstDiscountTreatment: 'AFTER_TAX_ADJUSTMENT', gstExchangeTreatment: 'REDUCES_VEHICLE_TAXABLE_VALUE', timezone: 'UTC' },
      });

      expect(await read(G, fullSaleId)).toEqual(before);
      expect(await read(G, interSaleId)).toEqual(interBefore);

      // …and still unchanged with GST switched off altogether.
      await prisma.companySetting.update({ where: { companyId: G.id }, data: { gstEnabled: false } });
      expect(await read(G, fullSaleId)).toEqual(before);
    });

    it('a soft-deleted sale is not found', async () => {
      await prisma.$executeRawUnsafe('UPDATE "Sale" SET "deletedAt" = now() WHERE id = $1', tSaleId);
      await expect(read(T, tSaleId)).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
