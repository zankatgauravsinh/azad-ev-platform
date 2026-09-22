import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

function binaryParser(res: request.Response, callback: (err: Error | null, body: unknown) => void): void {
  const stream = res as unknown as NodeJS.ReadableStream;
  const chunks: Buffer[] = [];
  stream.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
  stream.on('end', () => callback(null, Buffer.concat(chunks)));
}
// 1x1 transparent PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

describe('Delivery (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ownerToken: string;
  let techToken: string;
  const email = process.env.SEED_OWNER_EMAIL ?? 'owner@azadev.in';
  const password = process.env.SEED_OWNER_PASSWORD ?? 'Azad@12345';
  const stamp = Date.now().toString().slice(-8);
  const http = () => request(app.getHttpServer());
  const auth = (t: string): string => `Bearer ${t}`;
  const login = async (e: string, p: string): Promise<string> =>
    (await http().post('/api/v1/auth/login').send({ email: e, password: p }).expect(200)).body.accessToken;

  let unitId = '';
  let customerId = '';
  let bookingId = '';
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
    prisma = app.get(PrismaService);

    const owner = await prisma.user.findUniqueOrThrow({ where: { email: email.toLowerCase() } });
    const tech = await prisma.user.create({ data: { companyId: owner.companyId, name: 'Dlv Tech', email: `dlv.tech.${stamp}@e2e.test`, role: 'TECHNICIAN', passwordHash: await bcrypt.hash('Test@12345', 12) } });
    createdUserIds.push(tech.id);
    ownerToken = await login(email, password);
    techToken = await login(tech.email, 'Test@12345');

    const models = await http().get('/api/v1/inventory/models').set('Authorization', auth(ownerToken)).expect(200);
    const unit = await http().post('/api/v1/inventory/units').set('Authorization', auth(ownerToken))
      .send({ modelId: models.body[0].id, variant: `DLV-${stamp}`, colour: 'Blue', vin: `DLVVIN${stamp}`, motorNumber: `DLVM${stamp}`, batteryNumber: `DLVB${stamp}` }).expect(201);
    unitId = unit.body.id;
    const customer = await http().post('/api/v1/customers').set('Authorization', auth(ownerToken)).send({ name: 'Delivery Customer', phone: `93${stamp}` }).expect(201);
    customerId = customer.body.id;

    // Booking → pay balance → invoice, so it's deliverable.
    const booking = await http().post('/api/v1/bookings').set('Authorization', auth(ownerToken))
      .send({ customerId, unitId, exShowroom: 10000000, rto: 500000, advanceAmount: 1000000 }).expect(201);
    bookingId = booking.body.id;
    const balance = Number(booking.body.paymentSummary.balance);
    await http().post(`/api/v1/bookings/${bookingId}/payments`).set('Authorization', auth(ownerToken)).send({ amount: balance, mode: 'UPI' }).expect(201);
    await http().post(`/api/v1/bookings/${bookingId}/invoice`).set('Authorization', auth(ownerToken)).send({}).expect(201);
  });

  afterAll(async () => {
    try {
      await prisma.$executeRaw`DELETE FROM "Delivery" WHERE "saleId" IN (SELECT id FROM "Sale" WHERE "bookingId" = ${bookingId})`;
      await prisma.$executeRaw`DELETE FROM "Payment" WHERE "bookingId" = ${bookingId}`;
      await prisma.$executeRaw`DELETE FROM "Sale" WHERE "bookingId" = ${bookingId}`;
      await prisma.$executeRaw`DELETE FROM "Booking" WHERE id = ${bookingId}`;
      await prisma.$executeRaw`DELETE FROM "InventoryUnit" WHERE id = ${unitId}`;
      await prisma.$executeRaw`DELETE FROM "Customer" WHERE id = ${customerId}`;
    } catch {
      /* best-effort */
    }
    if (createdUserIds.length) await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await app.close();
  });

  it('shows the booking in the pipeline as READY once invoiced + paid', async () => {
    const list = await http().get('/api/v1/deliveries?pageSize=100').set('Authorization', auth(ownerToken)).expect(200);
    const row = list.body.data.find((r: { bookingId: string }) => r.bookingId === bookingId);
    expect(row).toBeTruthy();
    expect(row.status).toBe('READY');
    expect(row.balance).toBe('0');
    expect(row.vin).toBe(`DLVVIN${stamp}`);
  });

  it('schedules the delivery (→ SCHEDULED)', async () => {
    const owner = await prisma.user.findUniqueOrThrow({ where: { email: email.toLowerCase() } });
    const res = await http().post(`/api/v1/deliveries/${bookingId}/schedule`).set('Authorization', auth(ownerToken))
      .send({ expectedDelivery: new Date(Date.now() + 86_400_000).toISOString(), deliveryExecutiveId: owner.id, pendingDocuments: 'Address proof' }).expect(201);
    expect(res.body.booking.status).toBe('SCHEDULED');
    expect(res.body.booking.deliveryExecutive).toBeTruthy();
    expect(res.body.delivery).toBeNull();
  });

  it('completes the delivery with a handover checklist (→ DELIVERED, unit Delivered)', async () => {
    const res = await http().post(`/api/v1/deliveries/${bookingId}/complete`).set('Authorization', auth(ownerToken))
      .send({ notes: `Handed over ${stamp}`, checklist: { keys: true, charged: true, helmet: true, invoice: true, insurance: true } }).expect(201);
    expect(res.body.booking.status).toBe('DELIVERED');
    expect(res.body.delivery).not.toBeNull();
    expect(res.body.delivery.checklist.keys).toBe(true);
    expect(res.body.delivery.checklist.insurance).toBe(true);
    expect(res.body.delivery.checklist.rcBook).toBe(false);
    expect(res.body.delivery.notes).toContain(stamp);

    const unit = await http().get(`/api/v1/inventory/units/${unitId}`).set('Authorization', auth(ownerToken)).expect(200);
    expect(unit.body.status).toBe('DELIVERED');
  });

  it('rejects a second completion (already delivered)', async () => {
    await http().post(`/api/v1/deliveries/${bookingId}/complete`).set('Authorization', auth(ownerToken)).send({}).expect(400);
  });

  it('updates the checklist after delivery', async () => {
    const res = await http().patch(`/api/v1/deliveries/${bookingId}/checklist`).set('Authorization', auth(ownerToken)).send({ rcBook: true, warrantyCard: true }).expect(200);
    expect(res.body.delivery.checklist.rcBook).toBe(true);
    expect(res.body.delivery.checklist.keys).toBe(true); // preserved
  });

  it('uploads a delivery photo and the customer signature', async () => {
    const withPhoto = await http().post(`/api/v1/deliveries/${bookingId}/photos`).set('Authorization', auth(ownerToken))
      .field('label', 'Handover').attach('file', PNG, { filename: 'photo.png', contentType: 'image/png' }).expect(201);
    expect(withPhoto.body.delivery.photos.length).toBe(1);
    await http().post(`/api/v1/deliveries/${bookingId}/photos`).set('Authorization', auth(ownerToken))
      .attach('file', PNG, { filename: 'x.txt', contentType: 'text/plain' }).expect(400); // wrong mime

    const withSig = await http().post(`/api/v1/deliveries/${bookingId}/signature`).set('Authorization', auth(ownerToken))
      .attach('file', PNG, { filename: 'sign.png', contentType: 'image/png' }).expect(201);
    expect(withSig.body.delivery.signatureUrl).toBeTruthy();
  });

  it('downloads the branded delivery note PDF', async () => {
    const res = await http().get(`/api/v1/deliveries/${bookingId}/note.pdf`).set('Authorization', auth(ownerToken)).buffer().parse(binaryParser).expect(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect((res.body as Buffer).length).toBeGreaterThan(1000);
  });

  it('reports delivery KPIs and exports the delivery report', async () => {
    const dash = await http().get('/api/v1/deliveries/dashboard').set('Authorization', auth(ownerToken)).expect(200);
    expect(dash.body).toHaveProperty('deliveredThisMonth');
    expect(dash.body.deliveredThisMonth).toBeGreaterThanOrEqual(1);
    const csv = await http().get('/api/v1/reports/deliveries/export?format=csv').set('Authorization', auth(ownerToken)).buffer().parse(binaryParser).expect(200);
    expect((csv.body as Buffer).toString()).toContain(`DLVVIN${stamp}`);
  });

  it('enforces permissions (technician forbidden, anonymous blocked)', async () => {
    await http().get('/api/v1/deliveries').set('Authorization', auth(techToken)).expect(403);
    await http().get('/api/v1/deliveries').expect(401);
  });
});
