import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createE2eApp, E2E_HOOK_TIMEOUT } from './support/e2e-app';
import { createTestCompany, purgeTestCompany, TestCompany } from './support/e2e-company';

/** Collect a binary response body into a Buffer (supertest doesn't do this by default). */
function binaryParser(res: request.Response, callback: (err: Error | null, body: unknown) => void): void {
  const stream = res as unknown as NodeJS.ReadableStream;
  const chunks: Buffer[] = [];
  stream.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
  stream.on('end', () => callback(null, Buffer.concat(chunks)));
}

describe('Reports (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  // The suite runs in its own throwaway company: report figures are cross-checked against this
  // company's rows only (other companies, including other suites' throwaway ones, may exist).
  let co: TestCompany;
  let ownerToken: string;
  let salesToken: string;
  const stamp = Date.now().toString().slice(-8);
  const http = () => request(app.getHttpServer());
  const auth = (t: string): string => `Bearer ${t}`;

  beforeAll(async () => {
    app = await createE2eApp();
    prisma = app.get(PrismaService);
    co = await createTestCompany(app, 'Rep', { roles: ['SALES_EXECUTIVE'] });
    ownerToken = co.user().token;
    salesToken = co.user('SALES_EXECUTIVE').token;

    // Known data: two units; one sold, paid in full and delivered today, the other in stock.
    const unit = (n: number) => http().post('/api/v1/inventory/units').set('Authorization', auth(ownerToken))
      .send({ modelId: co.modelId, variant: `Rep-${stamp}`, colour: `C${n}`, vin: `REPV${stamp}${n}`, motorNumber: `REPM${stamp}${n}`, batteryNumber: `REPB${stamp}${n}` }).expect(201);
    const sold = await unit(1);
    await unit(2);
    const customer = await http().post('/api/v1/customers').set('Authorization', auth(ownerToken)).send({ name: `Rep ${stamp}`, phone: `95${stamp}` }).expect(201);
    const booking = await http().post('/api/v1/bookings').set('Authorization', auth(ownerToken))
      .send({ customerId: customer.body.id, unitId: sold.body.id, exShowroom: 10000000, advanceAmount: 1000000 }).expect(201);
    await http().post(`/api/v1/bookings/${booking.body.id}/payments`).set('Authorization', auth(ownerToken)).send({ amount: Number(booking.body.paymentSummary.balance), mode: 'UPI' }).expect(201);
    await http().post(`/api/v1/bookings/${booking.body.id}/invoice`).set('Authorization', auth(ownerToken)).send({}).expect(201);
    await http().post(`/api/v1/bookings/${booking.body.id}/deliver`).set('Authorization', auth(ownerToken)).send({}).expect(201);
  }, E2E_HOOK_TIMEOUT);

  afterAll(async () => {
    await purgeTestCompany(prisma, co?.id);
    await app.close();
  }, E2E_HOOK_TIMEOUT);

  it('overview returns the 7 dealership KPIs + charts', async () => {
    const res = await http().get('/api/v1/reports/overview').set('Authorization', auth(ownerToken)).expect(200);
    expect(res.body.kpis).toHaveLength(7);
    expect(res.body.monthlyRevenue).toHaveLength(6);
    expect(Array.isArray(res.body.paymentMix)).toBe(true);
    expect(res.body.range.from).toBeTruthy();
  });

  it('sales report cross-checks against the database', async () => {
    const res = await http().get('/api/v1/reports/sales').set('Authorization', auth(ownerToken)).expect(200);
    expect(res.body.kpis).toHaveLength(5);
    expect(res.body.monthlySales).toHaveLength(6);
    // Delivered KPI equals bookings with an actualDelivery in the last 30 days.
    const from = new Date(Date.now() - 30 * 86_400_000);
    const delivered = await prisma.booking.count({ where: { companyId: co.id, actualDelivery: { gte: from } } });
    expect(delivered).toBe(1);
    const deliveredKpi = res.body.kpis.find((k: { label: string }) => k.label === 'Delivered');
    expect(Number(deliveredKpi.value)).toBe(delivered);
  });

  it('inventory report total matches the unit count', async () => {
    const res = await http().get('/api/v1/reports/inventory').set('Authorization', auth(ownerToken)).expect(200);
    const total = await prisma.inventoryUnit.count({ where: { companyId: co.id } });
    expect(total).toBe(2);
    const totalKpi = res.body.kpis.find((k: { label: string }) => k.label === 'Total units');
    expect(Number(totalKpi.value)).toBe(total);
    expect(Array.isArray(res.body.byModel)).toBe(true);
  });

  it('customers + payments reports return well-formed payloads', async () => {
    const customers = await http().get('/api/v1/reports/customers').set('Authorization', auth(ownerToken)).expect(200);
    expect(customers.body.kpis).toHaveLength(4);
    expect(customers.body.growth).toHaveLength(6);
    const payments = await http().get('/api/v1/reports/payments').set('Authorization', auth(ownerToken)).expect(200);
    expect(payments.body.kpis).toHaveLength(6);
    expect(payments.body.daily).toHaveLength(14);
    expect(Array.isArray(payments.body.byMode)).toBe(true);
  });

  it('honours a custom date range', async () => {
    const from = '2020-01-01T00:00:00.000Z';
    const to = '2020-01-02T00:00:00.000Z';
    const res = await http().get(`/api/v1/reports/sales?from=${from}&to=${to}`).set('Authorization', auth(ownerToken)).expect(200);
    // No bookings existed in 2020 → empty rows.
    expect(res.body.rows).toEqual([]);
  });

  it('exports pdf, excel and csv with correct content types', async () => {
    const pdf = await http().get('/api/v1/reports/payments/export?format=pdf').set('Authorization', auth(ownerToken)).buffer().parse(binaryParser).expect(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect(pdf.headers['content-disposition']).toContain('payments-report');
    expect(pdf.body.subarray(0, 5).toString()).toBe('%PDF-');

    const xlsx = await http().get('/api/v1/reports/inventory/export?format=excel').set('Authorization', auth(ownerToken)).buffer().parse(binaryParser).expect(200);
    expect(xlsx.headers['content-type']).toContain('spreadsheetml');
    expect(xlsx.body.subarray(0, 2).toString()).toBe('PK'); // xlsx is a zip

    const csv = await http().get('/api/v1/reports/sales/export?format=csv').set('Authorization', auth(ownerToken)).buffer().parse(binaryParser).expect(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.body.toString('utf8')).toContain('Booking');
  });

  it('rejects an unknown report type / format (400)', async () => {
    await http().get('/api/v1/reports/bogus/export?format=pdf').set('Authorization', auth(ownerToken)).expect(400);
    await http().get('/api/v1/reports/sales/export?format=bogus').set('Authorization', auth(ownerToken)).expect(400);
  });

  it('denies non-manager roles (Sales Executive 403) and anonymous (401)', async () => {
    await http().get('/api/v1/reports/overview').set('Authorization', auth(salesToken)).expect(403);
    await http().get('/api/v1/reports/overview').expect(401);
  });
});
