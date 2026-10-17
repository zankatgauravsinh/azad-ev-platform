import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createE2eApp, E2E_HOOK_TIMEOUT } from './support/e2e-app';
import { createTestCompany, purgeTestCompany, TestCompany } from './support/e2e-company';
import { readPdfText } from './support/pdf-text';

function binaryParser(res: request.Response, callback: (err: Error | null, body: unknown) => void): void {
  const stream = res as unknown as NodeJS.ReadableStream;
  const chunks: Buffer[] = [];
  stream.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
  stream.on('end', () => callback(null, Buffer.concat(chunks)));
}

/**
 * RTO invoices: generated from a booking with the dealer's figures (GST added on top), one per booking,
 * Owner + Manager generate, only the Owner revises. Runs in its own throwaway company.
 */
describe('RTO invoices (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let co: TestCompany;
  const stamp = Date.now().toString().slice(-8);
  const http = () => request(app.getHttpServer());
  let serial = 0;

  let customerId: string;
  let otherCustomerId: string;

  const as = (role?: 'MANAGER' | 'SALES_EXECUTIVE' | 'ACCOUNTANT') => `Bearer ${co.user(role).token}`;
  const booking = async (customer = customerId): Promise<{ id: string; code: string; unitId: string }> => {
    const n = serial++;
    const unit = await http().post('/api/v1/inventory/units').set('Authorization', as())
      .send({ modelId: co.modelId, variant: `RTO-${stamp}`, colour: 'Teal', vin: `RTOV${stamp}${n}`, motorNumber: `RTOM${stamp}${n}`, batteryNumber: `RTOB${stamp}${n}`, sellingPrice: 11_800_000 }).expect(201);
    const b = await http().post('/api/v1/bookings').set('Authorization', as()).send({ customerId: customer, unitId: unit.body.id, exShowroom: 11_000_000 }).expect(201);
    return { id: b.body.id, code: b.body.code, unitId: unit.body.id };
  };
  const generate = (token: string, body: Record<string, unknown>) => http().post('/api/v1/rto-invoices').set('Authorization', token).send(body);

  beforeAll(async () => {
    app = await createE2eApp();
    prisma = app.get(PrismaService);
    co = await createTestCompany(app, 'Rto', { roles: ['MANAGER', 'SALES_EXECUTIVE', 'ACCOUNTANT'] });
    await prisma.companySetting.updateMany({ where: { companyId: co.id }, data: { gstStateCode: '24', gstNumber: '24AAJCT0051E1ZT', taxPercentage: 5 } });
    customerId = (await http().post('/api/v1/customers').set('Authorization', as()).send({ name: 'Rto Customer', phone: `91${stamp}`, gstStateCode: '24', city: 'Una' }).expect(201)).body.id;
    otherCustomerId = (await http().post('/api/v1/customers').set('Authorization', as()).send({ name: 'Rto Other', phone: `92${stamp}`, gstStateCode: '27' }).expect(201)).body.id;
  }, E2E_HOOK_TIMEOUT);

  afterAll(async () => {
    await purgeTestCompany(prisma, co?.id);
    await app.close();
  }, E2E_HOOK_TIMEOUT);

  it("the form starts from the scooter's list price, the company GST rate and the customer's state", async () => {
    const b = await booking();
    const d = await http().get(`/api/v1/rto-invoices/defaults?bookingId=${b.id}`).set('Authorization', as()).expect(200);
    expect(d.body).toMatchObject({ listPrice: '11800000', gstRate: 5, supplyType: 'INTRA', existing: null });
    const other = await booking(otherCustomerId);
    expect((await http().get(`/api/v1/rto-invoices/defaults?bookingId=${other.id}`).set('Authorization', as()).expect(200)).body.supplyType).toBe('INTER');
  });

  it('generates with GST on top, shows on the booking, and allows only one per booking', async () => {
    const b = await booking();
    const res = await generate(as('MANAGER'), { customerId, bookingId: b.id, listPrice: 10_000_000, gstRate: 5, supplyType: 'INTRA' }).expect(201);
    expect(res.body).toMatchObject({
      invoiceNumber: expect.stringMatching(/^RTO.*0001$/),
      booking: { id: b.id, code: b.code },
      customer: { id: customerId },
      sellingPrice: '10000000', gstRate: 5, supplyType: 'INTRA',
      cgst: '250000', sgst: '250000', igst: '0', gstAmount: '500000', total: '10500000',
      revision: 1,
    });
    expect(res.body.createdBy).toBeTruthy();

    // The booking page carries it.
    const bk = await http().get(`/api/v1/bookings/${b.id}`).set('Authorization', as()).expect(200);
    expect(bk.body.rtoInvoice).toMatchObject({ id: res.body.id, invoiceNumber: res.body.invoiceNumber, total: '10500000' });

    // One per booking.
    const again = await generate(as(), { customerId, bookingId: b.id, listPrice: 1, gstRate: 5, supplyType: 'INTRA' }).expect(409);
    expect(again.body.message).toContain(`already has RTO invoice ${res.body.invoiceNumber}`);
    expect((await http().get(`/api/v1/rto-invoices/defaults?bookingId=${b.id}`).set('Authorization', as()).expect(200)).body.existing).toEqual({ id: res.body.id, invoiceNumber: res.body.invoiceNumber });

    // Listed and searchable by VIN, booking and customer.
    for (const q of [`RTOV${stamp}`, b.code, 'Rto Customer']) {
      const list = await http().get(`/api/v1/rto-invoices?q=${encodeURIComponent(q)}`).set('Authorization', as('ACCOUNTANT')).expect(200);
      expect(list.body.data.some((r: { id: string }) => r.id === res.body.id)).toBe(true);
    }
  });

  it('IGST for a customer in another state; the PDF prints the figures', async () => {
    const b = await booking(otherCustomerId);
    const res = await generate(as(), { customerId: otherCustomerId, bookingId: b.id, listPrice: 9_000_000, gstRate: 5, supplyType: 'INTER' }).expect(201);
    expect(res.body).toMatchObject({ cgst: '0', sgst: '0', igst: '450000', total: '9450000' });
    const pdf = await http().get(`/api/v1/rto-invoices/${res.body.id}/pdf`).set('Authorization', as('ACCOUNTANT')).buffer().parse(binaryParser).expect(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    const text = (await readPdfText(pdf.body as Buffer)).strings.join(' ');
    expect(text).not.toContain('RTO INVOICE');
    for (const s of ['TAX INVOICE', res.body.invoiceNumber, `RTOV${stamp}`, '₹94,500.00', 'IGST @ 5%', 'HPA With', 'SELF', 'Chassis No.', 'Key No.', 'NINETY-FOUR THOUSAND FIVE HUNDRED ONLY', 'Customer Signature', 'Authorised Signatory']) expect(text).toContain(s);
  });

  it('list price − discount is the taxable value; the PDF prints the customer identity, HPA, key number and the discount note', async () => {
    await http().patch(`/api/v1/customers/${customerId}`).set('Authorization', as())
      .send({ tehsil: 'Kodinar', district: 'Gir Somnath', aadhaarNumber: '2341 2341 2346', panNumber: 'abcde1234f' }).expect(200);
    const b = await booking();
    await http().post(`/api/v1/bookings/${b.id}/finance`).set('Authorization', as()).send({ financeCompany: 'Bajaj Finance', loanAmount: 5_000_000, status: 'APPROVED' }).expect(201);
    await http().patch(`/api/v1/inventory/units/${b.unitId}`).set('Authorization', as()).send({ keyNumber: 'pb51' }).expect(200);

    const res = await generate(as(), { customerId, bookingId: b.id, listPrice: 13_900_000, discount: 400_000, gstRate: 5, supplyType: 'INTRA' }).expect(201);
    expect(res.body).toMatchObject({ listPrice: '13900000', discount: '400000', sellingPrice: '13500000', cgst: '337500', sgst: '337500', total: '14175000' });
    await generate(as(), { customerId, bookingId: (await booking()).id, listPrice: 1000, discount: 1000, gstRate: 5, supplyType: 'INTRA' }).expect(400);

    const pdf = await http().get(`/api/v1/rto-invoices/${res.body.id}/pdf`).set('Authorization', as()).buffer().parse(binaryParser).expect(200);
    const text = (await readPdfText(pdf.body as Buffer)).strings.join(' ');
    for (const s of ['Kodinar', 'Gir Somnath', '2341 2341 2346', 'ABCDE1234F', 'BAJAJ FINANCE', 'PB51', 'PAN: AAJCT', '₹1,41,750.00', 'ONE LAKH FORTY-ONE THOUSAND SEVEN HUNDRED FIFTY ONLY',
      'List price ₹1,39,000.00 − Discount ₹4,000.00 = Basic price ₹1,35,000.00']) expect(text).toContain(s);
  });

  it("policy number and delivery date start from the booking; only the owner may change the delivery date", async () => {
    const b = await booking();
    await http().patch(`/api/v1/bookings/${b.id}`).set('Authorization', as()).send({ expectedDelivery: '2026-11-20' }).expect(200);
    await http().post(`/api/v1/bookings/${b.id}/insurance`).set('Authorization', as()).send({ provider: 'Acko', policyNumber: 'POL-777', premium: 150000 }).expect(201);
    const d = (await http().get(`/api/v1/rto-invoices/defaults?bookingId=${b.id}`).set('Authorization', as('MANAGER')).expect(200)).body;
    expect(d).toMatchObject({ policyNumber: 'POL-777', deliveryDate: '2026-11-20', deliveryDateSource: 'EXPECTED' });

    const body = { customerId, bookingId: b.id, listPrice: 100, gstRate: 5, supplyType: 'INTRA' };
    // A manager cannot set another date…
    const refused = await generate(as('MANAGER'), { ...body, deliveryDate: '2026-11-25' }).expect(403);
    expect(refused.body.message).toBe("Only the owner can change the delivery date — leave it as the booking's");
    await generate(as('MANAGER'), { ...body, deliveryDate: null }).expect(403);
    // …but may type the policy number, and gets the booking's date.
    const byManager = (await generate(as('MANAGER'), { ...body, policyNumber: 'POL-778' }).expect(201)).body;
    expect(byManager).toMatchObject({ policyNumber: 'POL-778', deliveryDate: '2026-11-20' });

    // The owner may set a different date — on generation and when revising.
    const other = await booking();
    const byOwner = (await generate(as(), { ...body, bookingId: other.id, deliveryDate: '2026-10-01' }).expect(201)).body;
    expect(byOwner).toMatchObject({ deliveryDate: '2026-10-01', policyNumber: null });
    const revised = (await http().patch(`/api/v1/rto-invoices/${byManager.id}`).set('Authorization', as())
      .send({ listPrice: 100, gstRate: 5, supplyType: 'INTRA', deliveryDate: '2026-11-22' }).expect(200)).body;
    expect(revised).toMatchObject({ deliveryDate: '2026-11-22', policyNumber: 'POL-778', revision: 2 }); // not sent → kept
    await generate(as(), { ...body, bookingId: (await booking()).id, deliveryDate: '2026-02-30' }).expect(400);

    const pdf = await http().get(`/api/v1/rto-invoices/${byManager.id}/pdf`).set('Authorization', as()).buffer().parse(binaryParser).expect(200);
    const text = (await readPdfText(pdf.body as Buffer)).strings.join(' ');
    for (const t of ['Policy No.', 'POL-778', '22/11/2026', 'TAX INVOICE']) expect(text).toContain(t);
    expect(text).not.toMatch(/Rev\.|RTO INVOICE/); // revision 2 is shown in the app only
  });

  it("a delivered booking's delivery date is the handover's calendar date", async () => {
    const b = await booking();
    await http().post(`/api/v1/bookings/${b.id}/invoice`).set('Authorization', as()).expect(201);
    await prisma.$executeRaw`UPDATE "Booking" SET "createdAt" = ${new Date(Date.now() - 20 * 86_400_000)}::timestamptz AT TIME ZONE 'UTC' WHERE id = ${b.id}`;
    const day = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);
    await http().post(`/api/v1/bookings/${b.id}/deliver`).set('Authorization', as()).send({ actualDelivery: day }).expect(201);
    const d = (await http().get(`/api/v1/rto-invoices/defaults?bookingId=${b.id}`).set('Authorization', as()).expect(200)).body;
    expect(d).toMatchObject({ deliveryDate: day, deliveryDateSource: 'DELIVERED' });
  });

  it('HSN code: defaults to the model\'s, can be chosen from GST Management or left out; the PDF has no booking / sale numbers', async () => {
    const mk = (name: string, codeType: 'HSN' | 'SAC', code: string, isActive = true) => prisma.taxClassification.create({ data: { companyId: co.id, name: `${name} ${stamp}`, codeType, code, isActive } });
    const scooter = await mk('Electric scooter', 'HSN', '87116020');
    const parts = await mk('Parts', 'HSN', '87141090');
    const service = await mk('Service', 'SAC', '998714');
    const retired = await mk('Retired', 'HSN', '87110000', false);
    await prisma.scooterModel.update({ where: { id: co.modelId }, data: { taxClassificationId: scooter.id } });

    const b = await booking();
    const d = (await http().get(`/api/v1/rto-invoices/defaults?bookingId=${b.id}`).set('Authorization', as('MANAGER')).expect(200)).body;
    expect(d.taxClassificationId).toBe(scooter.id);
    const ids = d.hsnOptions.map((o: { id: string }) => o.id);
    expect(ids).toEqual(expect.arrayContaining([scooter.id, parts.id]));
    expect(ids).not.toContain(service.id); // SAC codes are services
    expect(ids).not.toContain(retired.id);

    const body = { customerId, listPrice: 100, gstRate: 5, supplyType: 'INTRA' };
    expect((await generate(as(), { ...body, bookingId: b.id }).expect(201)).body.hsnCode).toBe('87116020'); // model default
    expect((await generate(as('MANAGER'), { ...body, bookingId: (await booking()).id, taxClassificationId: parts.id }).expect(201)).body.hsnCode).toBe('87141090');
    expect((await generate(as(), { ...body, bookingId: (await booking()).id, taxClassificationId: null }).expect(201)).body.hsnCode).toBeNull();
    for (const bad of [service.id, retired.id]) {
      expect((await generate(as(), { ...body, bookingId: (await booking()).id, taxClassificationId: bad }).expect(400)).body.message).toBe('Choose an active HSN code from GST Management');
    }

    // A revision keeps the code unless another is chosen.
    const r = (await generate(as(), { ...body, bookingId: (await booking()).id, taxClassificationId: parts.id }).expect(201)).body;
    const revise = (extra: Record<string, unknown>) => http().patch(`/api/v1/rto-invoices/${r.id}`).set('Authorization', as()).send({ listPrice: 100, gstRate: 5, supplyType: 'INTRA', ...extra }).expect(200);
    expect((await revise({})).body.hsnCode).toBe('87141090');
    expect((await revise({ taxClassificationId: scooter.id })).body.hsnCode).toBe('87116020');

    const pdf = await http().get(`/api/v1/rto-invoices/${r.id}/pdf`).set('Authorization', as()).buffer().parse(binaryParser).expect(200);
    const text = (await readPdfText(pdf.body as Buffer)).strings.join(' ');
    expect(text).toContain('87116020');
    for (const gone of ['Booking No.', 'Sale Invoice No.', 'Computer-generated']) expect(text).not.toContain(gone);
    await prisma.scooterModel.update({ where: { id: co.modelId }, data: { taxClassificationId: null } });
  });

  it('refuses a booking of another customer, a cancelled booking, and bad figures', async () => {
    const b = await booking();
    expect((await generate(as(), { customerId: otherCustomerId, bookingId: b.id, listPrice: 100, gstRate: 5, supplyType: 'INTRA' }).expect(400)).body.message).toBe(`Booking ${b.code} belongs to another customer`);
    await generate(as(), { customerId, bookingId: b.id, listPrice: 100, gstRate: 30, supplyType: 'INTRA' }).expect(400);
    await generate(as(), { customerId, bookingId: b.id, listPrice: 0, gstRate: 5, supplyType: 'INTRA' }).expect(400);
    await http().post(`/api/v1/bookings/${b.id}/cancel`).set('Authorization', as()).send({ reason: 'test' }).expect(201);
    expect((await generate(as(), { customerId, bookingId: b.id, listPrice: 100, gstRate: 5, supplyType: 'INTRA' }).expect(400)).body.message).toBe(`Booking ${b.code} is cancelled`);
    expect(await prisma.rtoInvoice.count({ where: { bookingId: b.id } })).toBe(0);
  });

  it('only the Owner revises: same number, new figures, revision + 1, logged', async () => {
    const b = await booking();
    const created = (await generate(as('MANAGER'), { customerId, bookingId: b.id, listPrice: 10_000_000, gstRate: 5, supplyType: 'INTRA' }).expect(201)).body;
    const revise = (token: string) => http().patch(`/api/v1/rto-invoices/${created.id}`).set('Authorization', token).send({ listPrice: 12_000_000, gstRate: 12, supplyType: 'INTRA' });
    await revise(as('MANAGER')).expect(403);
    await revise(as('ACCOUNTANT')).expect(403);
    const revised = (await revise(as()).expect(200)).body;
    expect(revised).toMatchObject({ id: created.id, invoiceNumber: created.invoiceNumber, sellingPrice: '12000000', gstRate: 12, gstAmount: '1440000', total: '13440000', revision: 2 });
    const log = await prisma.activityLog.findFirstOrThrow({ where: { entityType: 'RtoInvoice', entityId: created.id, action: 'UPDATE' } });
    expect(log.summary).toContain('= ₹1,05,000.00');
    expect(log.summary).toContain('= ₹1,34,400.00');
  });

  it('permissions: Sales Executive has no access; Accountant can only view; unauthenticated is refused', async () => {
    const b = await booking();
    await http().get('/api/v1/rto-invoices').set('Authorization', as('SALES_EXECUTIVE')).expect(403);
    await generate(as('SALES_EXECUTIVE'), { customerId, bookingId: b.id, listPrice: 100, gstRate: 5, supplyType: 'INTRA' }).expect(403);
    await generate(as('ACCOUNTANT'), { customerId, bookingId: b.id, listPrice: 100, gstRate: 5, supplyType: 'INTRA' }).expect(403);
    await http().get('/api/v1/rto-invoices').expect(401);
  });

  it("another company cannot see or revise this company's RTO invoice", async () => {
    const other = await createTestCompany(app, 'RtoB');
    try {
      const b = await booking();
      const mine = (await generate(as(), { customerId, bookingId: b.id, listPrice: 100, gstRate: 5, supplyType: 'INTRA' }).expect(201)).body;
      await http().get(`/api/v1/rto-invoices/${mine.id}`).set('Authorization', other.auth()).expect(404);
      await http().patch(`/api/v1/rto-invoices/${mine.id}`).set('Authorization', other.auth()).send({ listPrice: 1, gstRate: 5, supplyType: 'INTRA' }).expect(404);
      await generate(other.auth(), { customerId, bookingId: b.id, listPrice: 100, gstRate: 5, supplyType: 'INTRA' }).expect(404);
      expect((await http().get('/api/v1/rto-invoices').set('Authorization', other.auth()).expect(200)).body.data).toEqual([]);
    } finally {
      await purgeTestCompany(prisma, other.id);
    }
  });

  it('numbers new RTO invoices with the prefix set in Settings; existing numbers keep theirs', async () => {
    const before = (await generate(as(), { customerId, bookingId: (await booking()).id, listPrice: 100, gstRate: 5, supplyType: 'INTRA' }).expect(201)).body;
    await http().patch('/api/v1/settings/company').set('Authorization', as()).send({ rtoInvoicePrefix: 'RTI/' }).expect(200);
    const after = (await generate(as(), { customerId, bookingId: (await booking()).id, listPrice: 100, gstRate: 5, supplyType: 'INTRA' }).expect(201)).body;
    expect(after.invoiceNumber).toMatch(/^RTI\/\d{4}$/);
    expect((await http().get(`/api/v1/rto-invoices/${before.id}`).set('Authorization', as()).expect(200)).body.invoiceNumber).toBe(before.invoiceNumber);
  });
});
