import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Sales domain (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let token: string;
  let modelId: string;
  let customerId: string;
  let unitId: string;
  let variantId: string;
  let bookingId: string;
  const stamp = Date.now().toString().slice(-8);
  const email = process.env.SEED_OWNER_EMAIL ?? 'owner@azadev.in';
  const password = process.env.SEED_OWNER_PASSWORD ?? 'Azad@12345';
  const auth = (): string => `Bearer ${token}`;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
    prisma = app.get(PrismaService);

    token = (await http().post('/api/v1/auth/login').send({ email, password }).expect(200)).body.accessToken;
    const models = await http().get('/api/v1/inventory/models').set('Authorization', auth()).expect(200);
    modelId = models.body[0].id;

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
  });

  afterAll(async () => {
    // Data is namespaced by a unique run stamp; a psql wipe after the suite keeps
    // the DB pristine. Avoid deleteMany here (soft-delete middleware + FK restricts).
    await app.close();
  });

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

  it('generates the invoice (booking → Converted) then delivers (unit → Delivered)', async () => {
    const invoiced = await http().post(`/api/v1/bookings/${bookingId}/invoice`).set('Authorization', auth()).send({}).expect(201);
    expect(invoiced.body.status).toBe('CONVERTED');
    expect(invoiced.body.sale.invoiceNumber).toBeTruthy();

    await http().post(`/api/v1/bookings/${bookingId}/deliver`).set('Authorization', auth()).send({}).expect(201);
    const unit = await http().get(`/api/v1/inventory/units/${unitId}`).set('Authorization', auth()).expect(200);
    expect(unit.body.status).toBe('DELIVERED');
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
});
