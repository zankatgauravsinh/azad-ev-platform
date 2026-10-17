import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createE2eApp, E2E_HOOK_TIMEOUT } from './support/e2e-app';
import { createTestCompany, purgeTestCompany, TestCompany } from './support/e2e-company';

describe('Sales domain (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  // Runs in its own throwaway company (see support/e2e-company).
  let co: TestCompany;
  let token: string;
  let modelId: string;
  let customerId: string;
  let unitId: string;
  let variantId: string;
  let bookingId: string;
  let invoiceNumber: string;
  const stamp = Date.now().toString().slice(-8);
  const auth = (): string => `Bearer ${token}`;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createE2eApp();
    prisma = app.get(PrismaService);

    co = await createTestCompany(app, 'Sales');
    token = co.user().token;
    modelId = co.modelId;

    const unit = await http()
      .post('/api/v1/inventory/units')
      .set('Authorization', auth())
      .send({ modelId, variant: `E2E-${stamp}`, colour: 'Blue', vin: `SALE${stamp}`, motorNumber: `M${stamp}`, batteryNumber: `B${stamp}`, sellingPrice: 11800000 })
      .expect(201);
    unitId = unit.body.id;
    variantId = unit.body.variant.id;

    const customer = await http()
      .post('/api/v1/customers')
      .set('Authorization', auth())
      .send({ name: 'E2E Sales', phone: `97${stamp}` })
      .expect(201);
    customerId = customer.body.id;
  }, E2E_HOOK_TIMEOUT);

  afterAll(async () => {
    await purgeTestCompany(prisma, co?.id);
    await app.close();
  }, E2E_HOOK_TIMEOUT);

  it('creates a quotation with a computed on-road total', async () => {
    const res = await http()
      .post('/api/v1/quotations')
      .set('Authorization', auth())
      .send({ customerId, variantId, exShowroom: 10500000, discount: 300000, rto: 850000, insurance: 420000, registration: 150000 })
      .expect(201);
    expect(res.body.total).toBe('11620000');
  });

  it('creates a booking that allocates the VIN (inventory sync Available → Booked)', async () => {
    const res = await http()
      .post('/api/v1/bookings')
      .set('Authorization', auth())
      .send({ customerId, unitId, exShowroom: 10500000, rto: 850000, advanceAmount: 1000000 })
      .expect(201);
    bookingId = res.body.id;
    expect(res.body.paymentSummary.status).toBe('PARTIAL');

    const unit = await http().get(`/api/v1/inventory/units/${unitId}`).set('Authorization', auth()).expect(200);
    expect(unit.body.status).toBe('BOOKED');
  });

  it('prevents double allocation of the same VIN (409)', async () => {
    await http()
      .post('/api/v1/bookings')
      .set('Authorization', auth())
      .send({ customerId, unitId, exShowroom: 10500000 })
      .expect(409);
  });

  it('records a payment and recomputes the balance to PAID', async () => {
    const booking = (await http().get(`/api/v1/bookings/${bookingId}`).set('Authorization', auth())).body;
    await http()
      .post(`/api/v1/bookings/${bookingId}/payments`)
      .set('Authorization', auth())
      .send({ amount: Number(booking.paymentSummary.balance), mode: 'UPI' })
      .expect(201);
    const after = (await http().get(`/api/v1/bookings/${bookingId}`).set('Authorization', auth())).body;
    expect(after.paymentSummary.status).toBe('PAID');
    expect(after.paymentSummary.balance).toBe('0');
  });

  it('captures finance (approved) and insurance', async () => {
    await http()
      .post(`/api/v1/bookings/${bookingId}/finance`)
      .set('Authorization', auth())
      .send({ financeCompany: 'Bajaj', loanAmount: 9000000, downPayment: 2620000, emiAmount: 450000, tenureMonths: 24, status: 'APPROVED' })
      .expect(201);
    await http()
      .post(`/api/v1/bookings/${bookingId}/insurance`)
      .set('Authorization', auth())
      .send({ provider: 'ICICI', premium: 420000, status: 'ACTIVE' })
      .expect(201);
  });

  it('blocks delivery before an invoice exists (400)', async () => {
    await http().post(`/api/v1/bookings/${bookingId}/deliver`).set('Authorization', auth()).send({}).expect(400);
  });

  it('blocks invoice PDF download before the invoice is generated (400)', async () => {
    await http().get(`/api/v1/bookings/${bookingId}/invoice/pdf`).set('Authorization', auth()).expect(400);
  });

  it('generates the invoice (booking → Converted) then delivers (unit → Delivered)', async () => {
    const invoiced = await http().post(`/api/v1/bookings/${bookingId}/invoice`).set('Authorization', auth()).send({}).expect(201);
    expect(invoiced.body.status).toBe('CONVERTED');
    expect(invoiced.body.sale.invoiceNumber).toBeTruthy();
    invoiceNumber = invoiced.body.sale.invoiceNumber;

    await http().post(`/api/v1/bookings/${bookingId}/deliver`).set('Authorization', auth()).send({}).expect(201);
    const unit = await http().get(`/api/v1/inventory/units/${unitId}`).set('Authorization', auth()).expect(200);
    expect(unit.body.status).toBe('DELIVERED');
  });

  it('generating the invoice a second time is rejected (409) — no duplicate, number immutable', async () => {
    await http().post(`/api/v1/bookings/${bookingId}/invoice`).set('Authorization', auth()).send({}).expect(409);
    const booking = await http().get(`/api/v1/bookings/${bookingId}`).set('Authorization', auth()).expect(200);
    expect(booking.body.sale.invoiceNumber).toBe(invoiceNumber);
    const sales = await prisma.sale.count({ where: { bookingId } });
    expect(sales).toBe(1);
  });

  it('downloads the invoice PDF (attachment headers, real PDF bytes)', async () => {
    const res = await http().get(`/api/v1/bookings/${bookingId}/invoice/pdf`).set('Authorization', auth()).buffer(true).expect(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(res.headers['content-disposition']).toContain(invoiceNumber.replace(/\//g, '-'));
    expect(res.body.length).toBeGreaterThan(500);
    expect(res.body.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('downloads the invoice PDF repeatedly without regenerating (same number, still one Sale)', async () => {
    for (let i = 0; i < 3; i += 1) {
      const res = await http().get(`/api/v1/bookings/${bookingId}/invoice/pdf`).set('Authorization', auth()).buffer(true).expect(200);
      expect(res.body.subarray(0, 5).toString()).toBe('%PDF-');
    }
    // A page refresh re-reads the booking: the invoice actions persist and the record is unchanged.
    const refreshed = await http().get(`/api/v1/bookings/${bookingId}`).set('Authorization', auth()).expect(200);
    expect(refreshed.body.sale.invoiceNumber).toBe(invoiceNumber);
    expect(await prisma.sale.count({ where: { bookingId } })).toBe(1);
  });

  it('generates the full customer timeline for the pipeline', async () => {
    const timeline = await http().get(`/api/v1/customers/${customerId}/timeline`).set('Authorization', auth()).expect(200);
    const types: string[] = timeline.body.map((e: { type: string }) => e.type);
    for (const t of ['QUOTATION', 'BOOKING', 'VEHICLE_ASSIGNED', 'ADVANCE_PAYMENT', 'FINANCE_APPROVED', 'INSURANCE_ADDED', 'INVOICE_GENERATED', 'DELIVERY']) {
      expect(types).toContain(t);
    }
  });

  it('cancelling a booking releases the reserved VIN back to Available', async () => {
    const unit = await http()
      .post('/api/v1/inventory/units')
      .set('Authorization', auth())
      .send({ modelId, variant: `E2E-${stamp}`, colour: 'Grey', vin: `CANCEL${stamp}`, motorNumber: `CM${stamp}`, batteryNumber: `CB${stamp}` })
      .expect(201);
    const booking = await http()
      .post('/api/v1/bookings')
      .set('Authorization', auth())
      .send({ customerId, unitId: unit.body.id, exShowroom: 9500000 })
      .expect(201);
    expect((await http().get(`/api/v1/inventory/units/${unit.body.id}`).set('Authorization', auth())).body.status).toBe('BOOKED');

    await http().post(`/api/v1/bookings/${booking.body.id}/cancel`).set('Authorization', auth()).send({ reason: 'test' }).expect(201);
    expect((await http().get(`/api/v1/inventory/units/${unit.body.id}`).set('Authorization', auth())).body.status).toBe('AVAILABLE');
  });

  it('editing a booking cannot change its commercial terms (pricing frozen after creation)', async () => {
    const unit = await http()
      .post('/api/v1/inventory/units')
      .set('Authorization', auth())
      .send({ modelId, variant: `E2E-edit-${stamp}`, colour: 'Green', vin: `EDITC${stamp}`, motorNumber: `EDM${stamp}`, batteryNumber: `EDB${stamp}` })
      .expect(201);
    const created = await http()
      .post('/api/v1/bookings')
      .set('Authorization', auth())
      .send({ customerId, unitId: unit.body.id, exShowroom: 9500000, rto: 500000 })
      .expect(201);
    const originalEx = created.body.exShowroom;
    const originalTotal = created.body.total;

    // Attempt to mutate pricing/accessories/advance alongside the allowed fields.
    const edited = await http()
      .patch(`/api/v1/bookings/${created.body.id}`)
      .set('Authorization', auth())
      .send({ exShowroom: 1, discount: 9000000, extendedWarranty: 5000000, accessories: [], advanceAmount: 12345, notes: 'edited note', expectedDelivery: '2026-03-01' })
      .expect(200);

    // Commercial terms unchanged; only the non-financial fields were applied.
    expect(edited.body.exShowroom).toBe(originalEx);
    expect(edited.body.total).toBe(originalTotal);
    expect(edited.body.paymentSummary.total).toBe(originalTotal);
    expect(edited.body.notes).toBe('edited note');
  });

  it('cancelling a PAID booking preserves the payment history (advance retained, not refunded)', async () => {
    const unit = await http()
      .post('/api/v1/inventory/units')
      .set('Authorization', auth())
      .send({ modelId, variant: `E2E-paid-${stamp}`, colour: 'Blue', vin: `PAIDC${stamp}`, motorNumber: `PCM${stamp}`, batteryNumber: `PCB${stamp}` })
      .expect(201);
    const booking = await http()
      .post('/api/v1/bookings')
      .set('Authorization', auth())
      .send({ customerId, unitId: unit.body.id, exShowroom: 10000000, advanceAmount: 1000000 })
      .expect(201);
    // The advance was recorded as a booking payment.
    const before = await http().get(`/api/v1/bookings/${booking.body.id}/payments`).set('Authorization', auth()).expect(200);
    expect(before.body.length).toBe(1);

    await http().post(`/api/v1/bookings/${booking.body.id}/cancel`).set('Authorization', auth()).send({ reason: 'customer backed out' }).expect(201);

    const b = await http().get(`/api/v1/bookings/${booking.body.id}`).set('Authorization', auth()).expect(200);
    expect(b.body.status).toBe('CANCELLED');
    // Payment history is intact and the advance is retained (no refund invented on cancellation).
    expect(b.body.payments.length).toBe(1);
    expect(b.body.paymentSummary.paid).toBe('1000000');
    expect((await http().get(`/api/v1/inventory/units/${unit.body.id}`).set('Authorization', auth())).body.status).toBe('AVAILABLE');
  });

  it('a converted (invoiced) booking cannot be cancelled and keeps its vehicle allocated', async () => {
    const unit = await http()
      .post('/api/v1/inventory/units')
      .set('Authorization', auth())
      .send({ modelId, variant: `E2E-conv-${stamp}`, colour: 'Black', vin: `CONVC${stamp}`, motorNumber: `CVM${stamp}`, batteryNumber: `CVB${stamp}` })
      .expect(201);
    const booking = await http()
      .post('/api/v1/bookings')
      .set('Authorization', auth())
      .send({ customerId, unitId: unit.body.id, exShowroom: 10000000 })
      .expect(201);
    await http().post(`/api/v1/bookings/${booking.body.id}/invoice`).set('Authorization', auth()).expect(201);
    expect((await http().get(`/api/v1/bookings/${booking.body.id}`).set('Authorization', auth())).body.status).toBe('CONVERTED');

    await http().post(`/api/v1/bookings/${booking.body.id}/cancel`).set('Authorization', auth()).send({ reason: 'too late' }).expect(409);
    // Still converted, vehicle still allocated — post-sale undo goes through Vehicle Returns, not cancel.
    expect((await http().get(`/api/v1/bookings/${booking.body.id}`).set('Authorization', auth())).body.status).toBe('CONVERTED');
    expect((await http().get(`/api/v1/inventory/units/${unit.body.id}`).set('Authorization', auth())).body.status).toBe('BOOKED');
  });

  it('a quotation converts only with a scooter of the quoted variant', async () => {
    const quote = (await http().post('/api/v1/quotations').set('Authorization', auth()).send({ customerId, variantId, exShowroom: 10000000 }).expect(201)).body;
    const unitOf = async (colour: string, tag: string) => (await http().post('/api/v1/inventory/units').set('Authorization', auth())
      .send({ modelId, variant: `E2E-${stamp}`, colour, vin: `${tag}${stamp}`, motorNumber: `${tag}M${stamp}`, batteryNumber: `${tag}B${stamp}` }).expect(201)).body;
    const wrong = await unitOf('Red', 'QVW');
    expect(wrong.variant.id).not.toBe(variantId);
    const convert = (unit: string, advanceAmount = 0) => http().post(`/api/v1/quotations/${quote.id}/convert`).set('Authorization', auth()).send({ unitId: unit, advanceAmount });

    const refused = await convert(wrong.id).expect(400);
    expect(refused.body.message).toContain(`Scooter QVW${stamp} is a`);
    expect(refused.body.message).toContain('allocate a scooter of the quoted variant');
    expect((await http().get(`/api/v1/inventory/units/${wrong.id}`).set('Authorization', auth())).body.status).toBe('AVAILABLE');
    expect(await prisma.booking.count({ where: { quotationId: quote.id } })).toBe(0);

    const right = await unitOf('Blue', 'QVR');
    expect(right.variant.id).toBe(variantId);
    expect((await convert(right.id, Number(quote.total) + 1).expect(400)).body.message).toBe('The advance cannot exceed the on-road total');
    await convert(right.id, 500000).expect(201);
  });

  it('never accepts more than is owed: advance and payments are capped at the balance', async () => {
    const unit = await http().post('/api/v1/inventory/units').set('Authorization', auth())
      .send({ modelId, variant: `E2E-pay-${stamp}`, colour: 'White', vin: `OVERP${stamp}`, motorNumber: `OPM${stamp}`, batteryNumber: `OPB${stamp}` }).expect(201);
    const create = (advanceAmount: number) => http().post('/api/v1/bookings').set('Authorization', auth()).send({ customerId, unitId: unit.body.id, exShowroom: 1000000, rto: 50000, advanceAmount });
    expect((await create(1050001).expect(400)).body.message).toBe('The advance cannot exceed the on-road total');
    expect((await http().get(`/api/v1/inventory/units/${unit.body.id}`).set('Authorization', auth())).body.status).toBe('AVAILABLE');
    const booking = (await create(50000).expect(201)).body; // balance ₹10,000.00
    const pay = (amount: number) => http().post(`/api/v1/bookings/${booking.id}/payments`).set('Authorization', auth()).send({ amount, mode: 'CASH' });

    expect((await pay(1000001).expect(400)).body.message).toBe('The payment exceeds the balance due of ₹10,000.00');
    // Two payments of the full balance at the same moment: exactly one is recorded.
    const results = await Promise.all([pay(1000000), pay(1000000)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 400]);
    const after = (await http().get(`/api/v1/bookings/${booking.id}`).set('Authorization', auth()).expect(200)).body;
    expect(after.paymentSummary).toMatchObject({ paid: '1050000', balance: '0', status: 'PAID' });
    expect((await pay(100).expect(400)).body.message).toBe('This booking is already fully paid');
  });

  // ───────────────────────── QA M3: which quotations convert ─────────────────────────
  it('only a live quotation converts; cancelling its booking reopens it for a new conversion', async () => {
    const unitOf = async (tag: string) => (await http().post('/api/v1/inventory/units').set('Authorization', auth())
      .send({ modelId, variant: `E2E-${stamp}`, colour: 'Blue', vin: `${tag}${stamp}`, motorNumber: `${tag}M${stamp}`, batteryNumber: `${tag}B${stamp}` }).expect(201)).body;
    const quote = async (extra: Record<string, unknown> = {}) => (await http().post('/api/v1/quotations').set('Authorization', auth()).send({ customerId, variantId, exShowroom: 10000000, ...extra }).expect(201)).body;
    const convert = (id: string, unit: string) => http().post(`/api/v1/quotations/${id}/convert`).set('Authorization', auth()).send({ unitId: unit, advanceAmount: 0 });
    const setQuoteStatus = (id: string, status: string) => http().patch(`/api/v1/quotations/${id}/status`).set('Authorization', auth()).send({ status });
    const u1 = await unitOf('QL1');

    const expired = await quote();
    await setQuoteStatus(expired.id, 'EXPIRED').expect(200);
    expect((await convert(expired.id, u1.id).expect(400)).body.message).toBe('This quotation has expired — duplicate it to quote again');
    const cancelled = await quote();
    await setQuoteStatus(cancelled.id, 'CANCELLED').expect(200);
    expect((await convert(cancelled.id, u1.id).expect(400)).body.message).toBe('This quotation is cancelled — duplicate it to quote again');
    const lapsed = await quote({ validUntil: '2020-01-31' });
    expect((await convert(lapsed.id, u1.id).expect(400)).body.message).toBe('This quotation expired on 31/01/2020 — duplicate it to quote again');
    expect((await http().get(`/api/v1/inventory/units/${u1.id}`).set('Authorization', auth())).body.status).toBe('AVAILABLE');

    const live = await quote({ validUntil: '2099-12-31' });
    const first = (await convert(live.id, u1.id).expect(201)).body;
    expect((await http().get(`/api/v1/quotations/${live.id}`).set('Authorization', auth())).body.status).toBe('ACCEPTED');
    expect((await convert(live.id, u1.id).expect(400)).body.message).toBe('This quotation is already converted to a booking');

    await http().post(`/api/v1/bookings/${first.id}/cancel`).set('Authorization', auth()).send({ reason: 'changed mind' }).expect(201);
    const reopened = (await http().get(`/api/v1/quotations/${live.id}`).set('Authorization', auth())).body;
    expect(reopened.status).toBe('SENT');
    const u2 = await unitOf('QL2');
    const second = (await convert(live.id, u2.id).expect(201)).body;
    expect(second.quotationId).toBe(live.id);
    expect((await http().get(`/api/v1/quotations/${live.id}`).set('Authorization', auth())).body.booking.id).toBe(second.id);
    // The cancelled booking keeps its own terms; only the link moved.
    expect((await http().get(`/api/v1/bookings/${first.id}`).set('Authorization', auth())).body).toMatchObject({ status: 'CANCELLED', total: first.total, quotationId: null });
  });

  // ───────────────────────── QA M5, M10, M9 ─────────────────────────
  it('insurance dates, back-dated payments and the warranty issued on delivery', async () => {
    const unit = await http().post('/api/v1/inventory/units').set('Authorization', auth())
      .send({ modelId, variant: `E2E-${stamp}`, colour: 'Blue', vin: `QMX${stamp}`, motorNumber: `QMXM${stamp}`, batteryNumber: `QMXB${stamp}` }).expect(201);
    const booking = (await http().post('/api/v1/bookings').set('Authorization', auth()).send({ customerId, unitId: unit.body.id, exShowroom: 1000000 }).expect(201)).body;

    // M5: a policy cannot end before (or on) the day it starts.
    const insure = (startDate: string, endDate: string) => http().post(`/api/v1/bookings/${booking.id}/insurance`).set('Authorization', auth()).send({ provider: 'Acko', premium: 150000, startDate, endDate });
    const reversed = await insure('2026-10-10', '2026-01-01').expect(400);
    expect(JSON.stringify(reversed.body)).toContain('The policy end date must be after its start date');
    await insure('2026-10-10', '2026-10-10').expect(400);
    await insure('2026-10-10', '2027-10-09').expect(201);

    // M10: a payment may be back-dated, not future-dated.
    const pay = (paidAt: string) => http().post(`/api/v1/bookings/${booking.id}/payments`).set('Authorization', auth()).send({ amount: 100000, mode: 'UPI', paidAt });
    const tomorrow = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    expect((await pay(tomorrow).expect(400)).body.message).toBe('The payment date cannot be in the future');
    const lastWeek = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
    const paid = (await pay(lastWeek).expect(201)).body;
    expect(paid.paidAt.slice(0, 10)).toBe(lastWeek);

    // M9: delivering issues the warranty, starting on the delivery date, with its free services.
    await http().post(`/api/v1/bookings/${booking.id}/invoice`).set('Authorization', auth()).expect(201);
    const day = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    await prisma.$executeRaw`UPDATE "Booking" SET "createdAt" = ${new Date(Date.now() - 10 * 86_400_000)}::timestamptz AT TIME ZONE 'UTC' WHERE id = ${booking.id}`;
    await http().post(`/api/v1/bookings/${booking.id}/deliver`).set('Authorization', auth()).send({ actualDelivery: day }).expect(201);
    const warranties = await prisma.warranty.findMany({ where: { unitId: unit.body.id }, include: { freeServices: true } });
    expect(warranties).toHaveLength(1);
    const delivered = (await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).actualDelivery!;
    expect(warranties[0]).toMatchObject({ customerId, bookingId: booking.id, status: 'ACTIVE', startDate: delivered, purchaseDate: delivered });
    expect(warranties[0]!.freeServices).toHaveLength(3);
  });
});
