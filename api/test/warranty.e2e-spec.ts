import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { seedRbac } from '../src/common/rbac/rbac-seed';

/** Collect a binary response body into a Buffer. */
function binaryParser(res: request.Response, callback: (err: Error | null, body: unknown) => void): void {
  const stream = res as unknown as NodeJS.ReadableStream;
  const chunks: Buffer[] = [];
  stream.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
  stream.on('end', () => callback(null, Buffer.concat(chunks)));
}

describe('Warranty & AMC (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ownerToken: string;
  let salesToken: string;
  const email = process.env.SEED_OWNER_EMAIL ?? 'owner@azadev.in';
  const password = process.env.SEED_OWNER_PASSWORD ?? 'Azad@12345';
  const stamp = Date.now().toString().slice(-8);
  const http = () => request(app.getHttpServer());
  const auth = (t: string): string => `Bearer ${t}`;
  const login = async (e: string, p: string): Promise<string> =>
    (await http().post('/api/v1/auth/login').send({ email: e, password: p }).expect(200)).body.accessToken;

  let unitId = '';
  let customerId = '';
  let warrantyId = '';
  let warrantyNumber = '';
  let claimId = '';
  let amcId = '';
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
    prisma = app.get(PrismaService);

    const owner = await prisma.user.findUniqueOrThrow({ where: { email: email.toLowerCase() } });
    const hash = await bcrypt.hash('Test@12345', 12);
    const sales = await prisma.user.create({ data: { companyId: owner.companyId, name: 'Wty Sales', email: `wty.sales.${stamp}@e2e.test`, role: 'SALES_EXECUTIVE', passwordHash: hash } });
    createdUserIds.push(sales.id);

    // Backfill roleId so permission-migrated warranty/amc/claims endpoints resolve as in production.
    await seedRbac(prisma);
    ownerToken = await login(email, password);
    salesToken = await login(sales.email, 'Test@12345');

    const models = await http().get('/api/v1/inventory/models').set('Authorization', auth(ownerToken)).expect(200);
    const unit = await http().post('/api/v1/inventory/units').set('Authorization', auth(ownerToken))
      .send({ modelId: models.body[0].id, variant: `WTY-${stamp}`, colour: 'Teal', vin: `WTYVIN${stamp}`, motorNumber: `WTYMOT${stamp}`, batteryNumber: `WTYBAT${stamp}` }).expect(201);
    unitId = unit.body.id;
    const customer = await http().post('/api/v1/customers').set('Authorization', auth(ownerToken)).send({ name: 'Warranty Customer', phone: `97${stamp}` }).expect(201);
    customerId = customer.body.id;
  });

  afterAll(async () => {
    await prisma.notification.deleteMany({ where: { entityType: { in: ['Warranty', 'AmcPlan', 'WarrantyClaim', 'FreeService'] } } });
    if (unitId) {
      await prisma.warranty.deleteMany({ where: { unitId } });
      await prisma.amcPlan.deleteMany({ where: { unitId } });
      await prisma.inventoryUnit.delete({ where: { id: unitId } }).catch(() => undefined);
    }
    if (customerId) await prisma.customer.delete({ where: { id: customerId } }).catch(() => undefined);
    if (createdUserIds.length) await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await app.close();
  });

  it('creates a warranty with default coverage and three free services', async () => {
    const res = await http().post('/api/v1/warranties').set('Authorization', auth(ownerToken))
      .send({ unitId, customerId, periodMonths: 36 }).expect(201);
    warrantyId = res.body.warranty.id;
    warrantyNumber = res.body.warranty.warrantyNumber;
    expect(res.body.warranty.status).toBe('ACTIVE');
    expect(res.body.warranty.vin).toBe(`WTYVIN${stamp}`);
    expect(res.body.coverage.length).toBeGreaterThanOrEqual(10);
    expect(res.body.coverage.some((c: { item: string; covered: boolean }) => c.item === 'MOTOR' && c.covered)).toBe(true);
    expect(res.body.freeServices.length).toBe(3);
    expect(res.body.timeline.length).toBeGreaterThan(0);
  });

  it('rejects a second warranty for the same vehicle', async () => {
    await http().post('/api/v1/warranties').set('Authorization', auth(ownerToken)).send({ unitId, customerId }).expect(409);
  });

  it('lists and fetches the warranty', async () => {
    const list = await http().get('/api/v1/warranties?pageSize=50').set('Authorization', auth(ownerToken)).expect(200);
    expect(list.body.data.some((w: { id: string }) => w.id === warrantyId)).toBe(true);
    const detail = await http().get(`/api/v1/warranties/${warrantyId}`).set('Authorization', auth(ownerToken)).expect(200);
    expect(detail.body.warranty.warrantyNumber).toBe(warrantyNumber);
  });

  it('completes a free service', async () => {
    const detail = await http().get(`/api/v1/warranties/${warrantyId}`).set('Authorization', auth(ownerToken)).expect(200);
    const first = detail.body.freeServices[0];
    const done = await http().patch(`/api/v1/warranties/free-service/${first.id}`).set('Authorization', auth(ownerToken))
      .send({ status: 'COMPLETED' }).expect(200);
    expect(done.body.status).toBe('COMPLETED');
    expect(done.body.completedDate).not.toBeNull();
  });

  it('raises a claim, then approves and completes it (warranty → CLAIMED)', async () => {
    const created = await http().post('/api/v1/warranty-claims').set('Authorization', auth(ownerToken))
      .send({ warrantyId, complaint: 'Battery not charging', claimCost: 500000, manufacturerClaimAmount: 400000 }).expect(201);
    claimId = created.body.id;
    expect(created.body.status).toBe('PENDING');
    expect(created.body.dealerCost).toBe('100000'); // 500000 - 400000 paise

    const approved = await http().patch(`/api/v1/warranty-claims/${claimId}/status`).set('Authorization', auth(ownerToken))
      .send({ status: 'APPROVED' }).expect(200);
    expect(approved.body.status).toBe('APPROVED');

    await http().patch(`/api/v1/warranty-claims/${claimId}/status`).set('Authorization', auth(ownerToken))
      .send({ status: 'COMPLETED' }).expect(200);
    const detail = await http().get(`/api/v1/warranties/${warrantyId}`).set('Authorization', auth(ownerToken)).expect(200);
    expect(detail.body.warranty.status).toBe('CLAIMED');
    expect(detail.body.claims.length).toBe(1);
  });

  it('lists claims filtered by status', async () => {
    const res = await http().get('/api/v1/warranty-claims?status=COMPLETED&pageSize=50').set('Authorization', auth(ownerToken)).expect(200);
    expect(res.body.data.some((c: { id: string }) => c.id === claimId)).toBe(true);
  });

  it('creates an AMC plan and records a visit (decrements remaining)', async () => {
    const created = await http().post('/api/v1/amc').set('Authorization', auth(ownerToken))
      .send({ unitId, customerId, planType: 'GOLD', months: 12, visitsIncluded: 3, price: 300000 }).expect(201);
    amcId = created.body.id;
    expect(created.body.visitsRemaining).toBe(3);
    amcId = created.body.id;

    const visit = await http().post(`/api/v1/amc/${amcId}/visits`).set('Authorization', auth(ownerToken))
      .send({ workDone: 'General service', amount: 0, coveredUnderAmc: true }).expect(201);
    expect(visit.body.visitNumber).toBe(1);

    const detail = await http().get(`/api/v1/amc/${amcId}`).set('Authorization', auth(ownerToken)).expect(200);
    expect(detail.body.visitsUsed).toBe(1);
    expect(detail.body.visitsRemaining).toBe(2);
    expect(detail.body.visits.length).toBe(1);
  });

  it('reports warranty + AMC KPIs on the dashboard', async () => {
    const res = await http().get('/api/v1/warranties/dashboard').set('Authorization', auth(ownerToken)).expect(200);
    expect(res.body.warranty).toHaveProperty('active');
    expect(res.body.amc).toHaveProperty('revenue');
    expect(Number(res.body.amc.revenue)).toBeGreaterThanOrEqual(300000);
  });

  it('downloads the warranty certificate and AMC agreement PDFs', async () => {
    const cert = await http().get(`/api/v1/warranties/${warrantyId}/certificate.pdf`).set('Authorization', auth(ownerToken)).buffer().parse(binaryParser).expect(200);
    expect(cert.headers['content-type']).toContain('application/pdf');
    expect((cert.body as Buffer).length).toBeGreaterThan(1000);
    const agr = await http().get(`/api/v1/amc/${amcId}/agreement.pdf`).set('Authorization', auth(ownerToken)).buffer().parse(binaryParser).expect(200);
    expect(agr.headers['content-type']).toContain('application/pdf');
    expect((agr.body as Buffer).length).toBeGreaterThan(1000);
  });

  it('exports warranty + AMC reports as CSV', async () => {
    const w = await http().get('/api/v1/reports/warranty/export?format=csv').set('Authorization', auth(ownerToken)).buffer().parse(binaryParser).expect(200);
    expect(w.headers['content-type']).toContain('text/csv');
    expect((w.body as Buffer).toString()).toContain(warrantyNumber);
    const a = await http().get('/api/v1/reports/amc/export?format=csv').set('Authorization', auth(ownerToken)).buffer().parse(binaryParser).expect(200);
    expect((a.body as Buffer).toString('utf8').length).toBeGreaterThan(0);
  });

  it('surfaces the warranty in global search', async () => {
    const res = await http().get(`/api/v1/search?q=${warrantyNumber}`).set('Authorization', auth(ownerToken)).expect(200);
    expect(res.body.warranties.some((w: { id: string }) => w.id === warrantyId)).toBe(true);
  });

  it('enforces permissions (sales read-only, anonymous blocked)', async () => {
    await http().get('/api/v1/warranties').set('Authorization', auth(salesToken)).expect(200); // read OK
    await http().post('/api/v1/warranties').set('Authorization', auth(salesToken)).send({ unitId, customerId }).expect(403); // write forbidden
    await http().post('/api/v1/warranty-claims').set('Authorization', auth(salesToken)).send({ warrantyId, complaint: 'x' }).expect(403);
    await http().get('/api/v1/warranties').expect(401);
  });
});
