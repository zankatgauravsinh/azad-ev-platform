import { INestApplication, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { TaxEngineService } from '../src/modules/tax/tax-engine.service';
import { SaleTaxService } from '../src/modules/tax/sale-tax.service';
import { readPdfText, type PdfText } from './support/pdf-text';

function binaryParser(res: request.Response, callback: (err: Error | null, body: unknown) => void): void {
  const stream = res as unknown as NodeJS.ReadableStream;
  const chunks: Buffer[] = [];
  stream.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
  stream.on('end', () => callback(null, Buffer.concat(chunks)));
}

/**
 * Stage D3 — the GST tax invoice through the real endpoint, GET /bookings/:id/invoice/pdf. The PDFs
 * are read back as text and checked for the figures a reader sees.
 *
 * Everything runs in THROWAWAY companies created here and hard-deleted afterwards; the seeded company
 * is never read or changed and GST is never enabled for it. Classification codes and rates below are
 * PLACEHOLDERS for testing — not real HSN/SAC values, approved GST rates, or CA-confirmed treatments.
 */
describe('GST invoice PDF (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let engine: TaxEngineService;
  let saleTax: SaleTaxService;
  const stamp = Date.now().toString().slice(-8);
  const http = () => request(app.getHttpServer());
  let serial = 0;

  interface Co { id: string; token: string; modelId: string; customers: Record<string, string> }
  const G = {} as Co; // GST enabled, fully configured (company state 24)
  const N = {} as Co; // GST disabled — the legacy invoice
  const T = {} as Co; // another GST-enabled tenant
  const cls: Record<string, string> = {};
  const acc: Record<string, string> = {};

  const auth = (token: string): string => `Bearer ${token}`;
  const day = (s: string): Date => new Date(`${s}T00:00:00.000Z`);

  const setupCompany = async (co: Co, label: string, gst: boolean): Promise<void> => {
    const company = await prisma.company.create({ data: { name: `GstInv ${label} ${stamp}`, slug: `gstinv-${label}-${stamp}` } });
    co.id = company.id;
    await prisma.branch.create({ data: { companyId: co.id, name: 'HQ', isPrimary: true } });
    const email = `gstinv.${label}.${stamp}@e2e.test`;
    await prisma.user.create({ data: { companyId: co.id, name: `Owner ${label}`, email, role: 'OWNER', passwordHash: await bcrypt.hash('Test@12345', 12) } });
    // Booking codes and invoice numbers are unique across ALL companies, so each company gets its own prefixes.
    await prisma.companySetting.create({
      data: {
        companyId: co.id, businessName: `Showroom ${label} ${stamp}`, legalName: `Legal ${label} ${stamp}`, address: `${label} Street`, city: 'Una', state: 'Gujarat',
        gstEnabled: gst, gstNumber: gst ? `TEST-GSTIN-${label}` : null, gstStateCode: gst ? '24' : null,
        bookingPrefix: `I${label}${stamp}-BK`, invoicePrefix: `I${label}${stamp}-INV`, receiptPrefix: `I${label}${stamp}-RC`,
      },
    });
    await prisma.invoiceSetting.create({ data: { companyId: co.id } });
    co.token = (await http().post('/api/v1/auth/login').send({ email, password: 'Test@12345' }).expect(200)).body.accessToken;
    co.modelId = (await prisma.scooterModel.create({ data: { companyId: co.id, name: `Inv Model ${label} ${stamp}`, brand: 'TESTBRAND' } })).id;
    co.customers = {};
    for (const [key, stateCode] of [['intra', '24'], ['inter', '27']] as const) {
      const res = await http().post('/api/v1/customers').set('Authorization', auth(co.token)).send({ name: `Customer ${key} ${label}`, phone: `6${stamp}${serial++}`, address: `${key} house`, city: 'Una' }).expect(201);
      await prisma.customer.update({ where: { id: res.body.id }, data: { gstStateCode: stateCode } });
      co.customers[key] = res.body.id;
    }
  };

  const makeClass = async (co: Co, name: string, over: Partial<Prisma.TaxClassificationUncheckedCreateInput> = {}, ratePct?: string): Promise<string> => {
    const c = await prisma.taxClassification.create({ data: { companyId: co.id, name: `${name} ${stamp}`, codeType: 'HSN', code: `TEST-${name.toUpperCase().replace(/\s+/g, '-')}`, treatment: 'TAXABLE', ...over } });
    if (ratePct) await prisma.taxRate.create({ data: { companyId: co.id, classificationId: c.id, ratePercent: new Prisma.Decimal(ratePct), effectiveFrom: day('2020-01-01'), effectiveTo: null } });
    return c.id;
  };

  interface Invoiced { bookingId: string; saleId: string; invoiceNumber: string; invoicedAt: Date; vin: string }
  const invoiced = async (co: Co, body: Record<string, unknown>, customer = 'intra'): Promise<Invoiced> => {
    const n = serial++;
    const vin = `INV${stamp}${n}`;
    const unit = await http().post('/api/v1/inventory/units').set('Authorization', auth(co.token)).send({ modelId: co.modelId, variant: `V-${stamp}`, colour: `C${n}`, vin, motorNumber: `INM${stamp}${n}`, batteryNumber: `INB${stamp}${n}` }).expect(201);
    const booking = await http().post('/api/v1/bookings').set('Authorization', auth(co.token)).send({ customerId: co.customers[customer], unitId: unit.body.id, ...body }).expect(201);
    await http().post(`/api/v1/bookings/${booking.body.id}/invoice`).set('Authorization', auth(co.token)).expect(201);
    const sale = await prisma.sale.findFirstOrThrow({ where: { bookingId: booking.body.id } });
    return { bookingId: booking.body.id, saleId: sale.id, invoiceNumber: sale.invoiceNumber!, invoicedAt: sale.invoicedAt!, vin };
  };

  const pdf = async (token: string, bookingId: string, status = 200): Promise<{ text: PdfText; res: request.Response; error: Record<string, unknown> }> => {
    const res = await http().get(`/api/v1/bookings/${bookingId}/invoice/pdf`).set('Authorization', auth(token)).buffer().parse(binaryParser).expect(status);
    if (status !== 200) return { text: { pageCount: 0, items: [], strings: [], all: '', onPage: () => [] }, res, error: JSON.parse((res.body as Buffer).toString()) };
    expect(res.headers['content-type']).toContain('application/pdf');
    return { text: await readPdfText(res.body as Buffer), res, error: {} };
  };
  const inIndia = (d: Date): string => d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' });
  const snapshotCount = (co: Co) => prisma.taxSnapshot.count({ where: { companyId: co.id } });
  /** The tax-bearing text of an invoice: everything except the live identity lines. */
  const taxText = (text: PdfText): string[] => text.strings.filter((s) => !/^(Showroom|Legal|Customer|Renamed Customer|intra house|inter house|Una)/.test(s));

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
    prisma = app.get(PrismaService);
    engine = app.get(TaxEngineService);
    saleTax = app.get(SaleTaxService);

    await setupCompany(G, 'g', true);
    await setupCompany(N, 'n', false);
    await setupCompany(T, 't', true);

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

    const tClass = await makeClass(T, 'Other tenant', {}, '5.00');
    await prisma.scooterModel.update({ where: { id: T.modelId }, data: { taxClassificationId: tClass } });
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
        'DELETE FROM "AppRole" WHERE "companyId" = $1',
        'DELETE FROM "Branch" WHERE "companyId" = $1',
        'DELETE FROM "Company" WHERE id = $1',
      ]) {
        await prisma.$executeRawUnsafe(sql, id);
      }
    }
    await app.close();
  });

  // ───────────────────────── GST invoice ─────────────────────────
  describe('a sale invoiced under GST', () => {
    it('INTRA, every component: the tax invoice prints the stored snapshot; the total is the customer\'s total', async () => {
      const sale = await invoiced(G, {
        exShowroom: 1_050_000, discount: 50_000, exchangeValue: 20_000,
        accessories: [{ accessoryId: acc.a, qty: 2, unitPrice: 59_000 }, { accessoryId: acc.b, qty: 1, unitPrice: 128_000 }],
        extendedWarranty: 118_000, rto: 85_000, insurance: 42_000, registration: 15_000,
      });
      const { text, res } = await pdf(G.token, sale.bookingId);
      expect(res.headers['content-disposition']).toBe(`attachment; filename="${sale.invoiceNumber}.pdf"`);
      expect(text.strings).toEqual(expect.arrayContaining([
        'TAX INVOICE', `No: ${sale.invoiceNumber}`, `Date: ${inIndia(sale.invoicedAt)}`,
        'GSTIN: TEST-GSTIN-g', 'State code: 24', `Showroom g ${stamp}`, `Legal name: Legal g ${stamp}`,
        'Place of supply: State code 24', 'Supply type: Intra-state',
        `Customer intra g`, 'intra house', `VIN: ${sale.vin}`,
        'HSN: TEST-VEHICLE', '10,500.00', '9,523.81', '5.00%', '238.10', '10,000.00', '− 500.00',
        `Acc A ${stamp}`, 'HSN: TEST-ACCESSORY-A', '590.00', '1,180.00', '1,000.00', '18.00%', '90.00',
        `Acc B ${stamp}`, 'HSN: TEST-ACCESSORY-B', '1,280.00', '28.00%', '140.00',
        'Extended warranty', 'SAC: TEST-WARRANTY', 'RTO', 'Non-taxable', '850.00', 'Insurance', 'Exempt', '420.00', 'Registration', 'Nil rated', '150.00',
        '₹13,943.81', 'CGST', '₹558.10', 'SGST', 'Round-off', '-₹0.01', 'Total', '₹15,060.00', '− ₹200.00', 'Grand total', '₹14,860.00',
      ]));
      expect(text.all).toContain(`TESTBRAND Inv Model g ${stamp} V-${stamp} (C`); // the vehicle line description frozen in the snapshot
      expect(text.all).toContain('Discount — reduces vehicle taxable value');
      expect(text.all).toContain('Exchange adjustment (after-tax adjustment)');
      expect(text.all).toContain('Value before GST (taxable lines and lines without GST)');
      expect(text.all).not.toContain('IGST');
      expect(text.all).not.toContain('On-road Total'); // not the legacy layout
      expect((await prisma.sale.findFirstOrThrow({ where: { id: sale.saleId } })).total).toBe(1_486_000n); // ₹14,860.00 — the agreed total, GST inside it
    });

    it('the ₹10,000 example: taxable 9,523.81 + GST 476.19 = 10,000 — nothing added on top', async () => {
      const sale = await invoiced(G, { exShowroom: 1_000_000 });
      const { text } = await pdf(G.token, sale.bookingId);
      expect(text.strings).toEqual(expect.arrayContaining(['9,523.81', '5.00%', '238.10', 'Taxable value', '₹9,523.81', '₹238.10', '-₹0.01', 'Grand total', '₹10,000.00', '476.19']));
      expect(text.all).not.toContain('10,476');
      expect(text.all).not.toContain('10,500');
    });

    it('INTER: IGST only, place of supply from the snapshot', async () => {
      const sale = await invoiced(G, { exShowroom: 1_000_000 }, 'inter');
      const { text } = await pdf(G.token, sale.bookingId);
      expect(text.strings).toEqual(expect.arrayContaining(['Place of supply: State code 27', 'Supply type: Inter-state', 'IGST (₹)', '476.19', 'IGST', '₹476.19', '₹10,000.00']));
      expect(text.all).not.toContain('CGST');
      expect(text.all).not.toContain('SGST');
    });

    it('is repeatable and read-only: the same PDF text twice, no engine call, no new rows', async () => {
      const sale = await invoiced(G, { exShowroom: 1_000_000 });
      const calculate = jest.spyOn(engine, 'calculate');
      const prepare = jest.spyOn(saleTax, 'prepare');
      const before = await snapshotCount(G);
      const first = await pdf(G.token, sale.bookingId);
      const second = await pdf(G.token, sale.bookingId);
      expect(second.text.strings).toEqual(first.text.strings);
      expect(calculate).not.toHaveBeenCalled();
      expect(prepare).not.toHaveBeenCalled();
      expect(await snapshotCount(G)).toBe(before);
      calculate.mockRestore();
      prepare.mockRestore();
    });
  });

  // ───────────────────────── Legacy invoice ─────────────────────────
  describe('a sale with no GST snapshot keeps the existing invoice', () => {
    it('renders the legacy layout, touches no tax configuration, creates nothing; endpoint, filename and permission unchanged', async () => {
      const calculate = jest.spyOn(engine, 'calculate');
      const resolveRate = jest.spyOn(engine, 'resolveRate');
      const sale = await invoiced(N, { exShowroom: 1_000_000, discount: 30_000, rto: 85_000 });
      expect(await snapshotCount(N)).toBe(0);
      const { text, res } = await pdf(N.token, sale.bookingId);
      expect(res.headers['content-disposition']).toBe(`attachment; filename="${sale.invoiceNumber}.pdf"`);
      expect(text.strings).toEqual(expect.arrayContaining(['TAX INVOICE', `No: ${sale.invoiceNumber}`, 'Bill To', 'Ex-showroom', '₹10,000.00', 'Discount', '− ₹300.00', 'RTO', '₹850.00', 'On-road Total', '₹10,550.00']));
      expect(text.all).not.toContain('GSTIN');
      expect(text.all).not.toContain('Place of supply');
      expect(text.all).not.toContain('Grand total');
      expect(calculate).not.toHaveBeenCalled();
      expect(resolveRate).not.toHaveBeenCalled();
      expect(await snapshotCount(N)).toBe(0);
      calculate.mockRestore();
      resolveRate.mockRestore();

      // The same booking, GST switched on afterwards: still the legacy invoice; no snapshot is manufactured.
      await prisma.companySetting.update({ where: { companyId: N.id }, data: { gstEnabled: true, gstNumber: 'TEST-GSTIN-n', gstStateCode: '24' } });
      const later = (await pdf(N.token, sale.bookingId)).text;
      expect(later.strings).toEqual(expect.arrayContaining(['On-road Total', '₹10,550.00']));
      expect(later.all).not.toContain('Place of supply');
      expect(await snapshotCount(N)).toBe(0);
      await prisma.companySetting.update({ where: { companyId: N.id }, data: { gstEnabled: false, gstNumber: null, gstStateCode: null } });
    });

    it('a booking without an invoice is still a 400', async () => {
      const n = serial++;
      const unit = await http().post('/api/v1/inventory/units').set('Authorization', auth(N.token)).send({ modelId: N.modelId, variant: `V-${stamp}`, colour: `C${n}`, vin: `INV${stamp}${n}`, motorNumber: `INM${stamp}${n}`, batteryNumber: `INB${stamp}${n}` }).expect(201);
      const booking = await http().post('/api/v1/bookings').set('Authorization', auth(N.token)).send({ customerId: N.customers.intra, unitId: unit.body.id, exShowroom: 1_000_000 }).expect(201);
      await http().get(`/api/v1/bookings/${booking.body.id}/invoice/pdf`).set('Authorization', auth(N.token)).expect(400);
    });

    it('still needs bookings.view', async () => {
      const role = await prisma.appRole.create({ data: { companyId: N.id, name: `No bookings ${stamp}`, isSystem: false } });
      const dashboard = await prisma.permission.findUniqueOrThrow({ where: { key: 'dashboard.view' } });
      await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: dashboard.id } });
      const email = `gstinv.limited.${stamp}@e2e.test`;
      await prisma.user.create({ data: { companyId: N.id, name: 'Limited', email, role: 'SALES_EXECUTIVE', roleId: role.id, passwordHash: await bcrypt.hash('Test@12345', 12) } });
      const token = (await http().post('/api/v1/auth/login').send({ email, password: 'Test@12345' }).expect(200)).body.accessToken;
      const sale = await invoiced(N, { exShowroom: 1_000_000 });
      await http().get(`/api/v1/bookings/${sale.bookingId}/invoice/pdf`).set('Authorization', auth(token)).expect(403);
      await http().get(`/api/v1/bookings/${sale.bookingId}/invoice/pdf`).expect(401);
    });
  });

  // ───────────────────────── Tenant isolation ─────────────────────────
  describe('tenant isolation', () => {
    it("a company cannot download another company's invoice, and its own invoice carries only its own data", async () => {
      const gSale = await invoiced(G, { exShowroom: 1_000_000 });
      const tSale = await invoiced(T, { exShowroom: 500_000 });
      await pdf(T.token, gSale.bookingId, 404);
      await pdf(G.token, tSale.bookingId, 404);

      const g = (await pdf(G.token, gSale.bookingId)).text;
      const t = (await pdf(T.token, tSale.bookingId)).text;
      expect(g.strings).toContain('GSTIN: TEST-GSTIN-g');
      expect(t.strings).toContain('GSTIN: TEST-GSTIN-t');
      for (const leak of ['TEST-GSTIN-t', `Showroom t ${stamp}`, 'Customer intra t', tSale.vin, '₹5,000.00']) expect(g.all).not.toContain(leak);
      for (const leak of ['TEST-GSTIN-g', `Showroom g ${stamp}`, 'Customer intra g', gSale.vin, '₹10,000.00']) expect(t.all).not.toContain(leak);
    });
  });

  // ───────────────────────── Failure behaviour ─────────────────────────
  describe('a stored record that cannot be presented', () => {
    const corrupt = async (saleId: string, sql: string): Promise<void> => {
      // Raw SQL on a throwaway company's row: the application itself can never change a snapshot.
      await prisma.$executeRawUnsafe(sql, saleId);
    };

    it('corrupt snapshot → a safe 500, no raw details, a server-side log line; nothing is recalculated or written', async () => {
      const sale = await invoiced(G, { exShowroom: 1_000_000 });
      await corrupt(sale.saleId, 'UPDATE "TaxSnapshot" SET "documentTotal" = "documentTotal" + 1 WHERE "saleId" = $1');
      const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      const calculate = jest.spyOn(engine, 'calculate');
      const before = await snapshotCount(G);

      const { res, error: body } = await pdf(G.token, sale.bookingId, 500);
      expect(res.headers['content-type']).not.toContain('application/pdf');
      expect(body.message).toBe('The GST record stored for this invoice is not consistent, so the invoice cannot be produced. Nothing has been changed.');
      for (const detail of ['DOCUMENT_TOTAL', 'prisma', 'TaxSnapshot', 'documentTotal', 'SELECT', sale.saleId]) expect(JSON.stringify(body)).not.toContain(detail);
      expect(error).toHaveBeenCalledWith(expect.stringContaining(`GST invoice refused for sale ${sale.saleId}: DOCUMENT_TOTAL_NOT_RECONCILED`));
      expect(calculate).not.toHaveBeenCalled();
      expect(await snapshotCount(G)).toBe(before);
      error.mockRestore();
      calculate.mockRestore();
    });

    it('unsupported engine version → a safe failure, never a fallback to current rates', async () => {
      const sale = await invoiced(G, { exShowroom: 1_000_000 });
      await corrupt(sale.saleId, 'UPDATE "TaxSnapshot" SET "engineVersion" = \'99\' WHERE "saleId" = $1');
      const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      const calculate = jest.spyOn(engine, 'calculate');
      const resolveRate = jest.spyOn(engine, 'resolveRate');
      const { error: body } = await pdf(G.token, sale.bookingId, 500);
      expect(body.message).toBe('The GST record stored for this invoice is not consistent, so the invoice cannot be produced. Nothing has been changed.');
      expect(JSON.stringify(body)).not.toContain('UNSUPPORTED_ENGINE_VERSION');
      expect(error).toHaveBeenCalledWith(expect.stringContaining('UNSUPPORTED_ENGINE_VERSION'));
      expect(calculate).not.toHaveBeenCalled();
      expect(resolveRate).not.toHaveBeenCalled();
      error.mockRestore();
      calculate.mockRestore();
      resolveRate.mockRestore();
    });
  });

  // ───────────────────────── Historical immutability ─────────────────────────
  // Runs last: it rewrites company G's configuration on purpose.
  describe('after the sale, the current configuration has no effect', () => {
    let sale: Invoiced;
    let original: string[];

    beforeAll(async () => {
      sale = await invoiced(G, { exShowroom: 1_000_000, extendedWarranty: 118_000, rto: 85_000, accessories: [{ accessoryId: acc.a, qty: 1, unitPrice: 59_000 }] });
      original = (await pdf(G.token, sale.bookingId)).text.strings;
      expect(original).toEqual(expect.arrayContaining(['GSTIN: TEST-GSTIN-g', 'HSN: TEST-VEHICLE', '5.00%', '9,523.81', '238.10', 'HSN: TEST-ACCESSORY-A', '18.00%', 'SAC: TEST-WARRANTY', 'Non-taxable', '₹12,620.00']));
    });

    it('rates, classifications, mappings, product classifications and GST settings all change — the invoice does not', async () => {
      await prisma.taxRate.updateMany({ where: { companyId: G.id }, data: { ratePercent: new Prisma.Decimal('12.00') } });
      await prisma.taxClassification.update({ where: { id: cls.vehicle }, data: { name: `Renamed ${stamp}`, code: 'TEST-CHANGED', codeType: 'SAC', treatment: 'EXEMPT' } });
      await prisma.taxClassification.update({ where: { id: cls.rto }, data: { treatment: 'TAXABLE', code: 'TEST-NOW-TAXABLE' } });
      await prisma.taxComponentMapping.updateMany({ where: { companyId: G.id }, data: { classificationId: cls.other } });
      await prisma.scooterModel.update({ where: { id: G.modelId }, data: { taxClassificationId: cls.other } });
      await prisma.accessory.update({ where: { id: acc.a }, data: { taxClassificationId: null } });
      await prisma.customer.update({ where: { id: G.customers.intra }, data: { gstStateCode: '27' } });
      await prisma.companySetting.update({ where: { companyId: G.id }, data: { gstNumber: 'TEST-GSTIN-CHANGED', gstStateCode: '27', gstDiscountTreatment: 'AFTER_TAX_ADJUSTMENT', gstExchangeTreatment: 'REDUCES_VEHICLE_TAXABLE_VALUE' } });

      const again = (await pdf(G.token, sale.bookingId)).text;
      expect(again.strings).toEqual(original);
      expect(again.all).not.toContain('TEST-GSTIN-CHANGED');
      expect(again.all).not.toContain('TEST-CHANGED');
      expect(again.all).not.toContain('12.00%');
    });

    it('GST disabled for the company — the sale still has its snapshot and still gets the GST invoice', async () => {
      await prisma.companySetting.update({ where: { companyId: G.id }, data: { gstEnabled: false } });
      const again = (await pdf(G.token, sale.bookingId)).text;
      expect(again.strings).toEqual(original);
      expect(again.strings).toContain('GSTIN: TEST-GSTIN-g');
      expect(again.all).not.toContain('On-road Total');
      await prisma.companySetting.update({ where: { companyId: G.id }, data: { gstEnabled: true } });
    });

    it('identity is live: a renamed customer shows the new name while every tax figure stays the same', async () => {
      await prisma.customer.update({ where: { id: G.customers.intra }, data: { name: `Renamed Customer ${stamp}` } });
      const again = (await pdf(G.token, sale.bookingId)).text;
      expect(again.strings).toContain(`Renamed Customer ${stamp}`);
      expect(again.strings).not.toContain('Customer intra g');
      expect(taxText(again)).toEqual(taxText({ ...again, strings: original }));
      await prisma.customer.update({ where: { id: G.customers.intra }, data: { name: 'Customer intra g' } });
    });
  });

});
