import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { seedRbac } from '../src/common/rbac/rbac-seed';

describe('Service & after-sales (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ownerToken: string;
  let techToken: string;
  let salesToken: string;
  let techId: string;
  let customerId: string;
  let unitId: string;
  let jobId: string;
  let sparePartId: string;
  let jobCode: string;
  const stamp = Date.now().toString().slice(-8);
  const email = process.env.SEED_OWNER_EMAIL ?? 'owner@azadev.in';
  const password = process.env.SEED_OWNER_PASSWORD ?? 'Azad@12345';
  const createdUserIds: string[] = [];
  const http = () => request(app.getHttpServer());
  const auth = (t: string): string => `Bearer ${t}`;
  const login = async (mail: string, pass: string): Promise<string> =>
    (await http().post('/api/v1/auth/login').send({ email: mail, password: pass }).expect(200)).body.accessToken;
  const setStatus = (id: string, status: string): request.Test =>
    http().post(`/api/v1/service/jobs/${id}/status`).set('Authorization', auth(ownerToken)).send({ status });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
    prisma = app.get(PrismaService);

    const owner = await prisma.user.findUniqueOrThrow({ where: { email: email.toLowerCase() } });
    const hash = await bcrypt.hash('Test@12345', 12);
    for (const role of ['TECHNICIAN', 'SALES_EXECUTIVE'] as const) {
      const u = await prisma.user.create({ data: { companyId: owner.companyId, name: `Svc ${role}`, email: `svc.${role.toLowerCase()}.${stamp}@e2e.test`, role, passwordHash: hash } });
      createdUserIds.push(u.id);
    }
    // Backfill roleId so permission-migrated service-jobs endpoints resolve as in production.
    await seedRbac(prisma);
    const [tech, sales] = await prisma.user.findMany({ where: { id: { in: createdUserIds } }, orderBy: { role: 'asc' } });
    techId = sales!.role === 'TECHNICIAN' ? sales!.id : tech!.id;
    const techUser = [tech, sales].find((u) => u!.role === 'TECHNICIAN')!;
    const salesUser = [tech, sales].find((u) => u!.role === 'SALES_EXECUTIVE')!;
    techId = techUser.id;
    ownerToken = await login(email, password);
    techToken = await login(techUser.email, 'Test@12345');
    salesToken = await login(salesUser.email, 'Test@12345');

    const models = await http().get('/api/v1/inventory/models').set('Authorization', auth(ownerToken)).expect(200);
    const unit = await http().post('/api/v1/inventory/units').set('Authorization', auth(ownerToken))
      .send({ modelId: models.body[0].id, variant: `SVC-${stamp}`, colour: 'Black', vin: `SVC${stamp}`, motorNumber: `SM${stamp}`, batteryNumber: `SB${stamp}` }).expect(201);
    unitId = unit.body.id;
    const customer = await http().post('/api/v1/customers').set('Authorization', auth(ownerToken)).send({ name: 'Svc Customer', phone: `96${stamp}` }).expect(201);
    customerId = customer.body.id;
    // Use a dedicated part (not shared seed stock) so repeated runs stay idempotent.
    const part = await http().post('/api/v1/service/spare-parts').set('Authorization', auth(ownerToken))
      .send({ name: 'Svc Test Part', sku: `SVCP-${stamp}`, quantity: 100, cost: 1000, sellingPrice: 1500, minStock: 5 }).expect(201);
    sparePartId = part.body.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await app.close();
  });

  it('rejects unauthenticated access', async () => {
    await http().get('/api/v1/service/jobs').expect(401);
  });

  it('Sales Executive is read-only (cannot create a job card)', async () => {
    await http().post('/api/v1/service/jobs').set('Authorization', auth(salesToken))
      .send({ customerId, unitId, type: 'PAID', complaints: [{ description: 'x' }] }).expect(403);
    await http().get('/api/v1/service/jobs').set('Authorization', auth(salesToken)).expect(200);
  });

  it('creates a job card with a JC-prefixed code and multiple complaints', async () => {
    const res = await http().post('/api/v1/service/jobs').set('Authorization', auth(ownerToken)).send({
      customerId, unitId, type: 'PAID', priority: 'HIGH', technicianId: techId, odometerKm: 1200,
      complaints: [{ description: 'Brake noise', priority: 'HIGH' }, { description: 'Headlight flicker', priority: 'MEDIUM' }],
    }).expect(201);
    jobId = res.body.id;
    jobCode = res.body.code;
    expect(res.body.code).toMatch(/^JC/);
    expect(res.body.status).toBe('BOOKED');
    expect(res.body.complaints).toHaveLength(2);
    expect(res.body.warrantyStatus.vehicle).toBeDefined();
  });

  it('advances the workshop status flow and blocks illegal jumps', async () => {
    await setStatus(jobId, 'DELIVERED').expect(400); // cannot skip
    await setStatus(jobId, 'CHECKED_IN').expect(201);
    await setStatus(jobId, 'DIAGNOSIS').expect(201);
    await setStatus(jobId, 'REPAIRING').expect(201);
  });

  it('records the inspection checklist', async () => {
    const res = await http().post(`/api/v1/service/jobs/${jobId}/inspection`).set('Authorization', auth(techToken)).send({
      items: [{ item: 'Brakes', result: 'NEEDS_ATTENTION', notes: 'worn' }, { item: 'Battery', result: 'GOOD' }],
    }).expect(201);
    expect(res.body.inspection).toHaveLength(2);
  });

  it('adds a spare part and decrements catalogue stock', async () => {
    const before = (await http().get(`/api/v1/service/spare-parts/${sparePartId}`).set('Authorization', auth(ownerToken))).body.quantity;
    const res = await http().post(`/api/v1/service/jobs/${jobId}/parts`).set('Authorization', auth(techToken)).send({ sparePartId, qty: 2 }).expect(201);
    expect(res.body.parts).toHaveLength(1);
    const after = (await http().get(`/api/v1/service/spare-parts/${sparePartId}`).set('Authorization', auth(ownerToken))).body.quantity;
    expect(after).toBe(before - 2);
  });

  it('adds labour from the catalogue and recomputes totals', async () => {
    const labour = (await http().get('/api/v1/service/labour-items').set('Authorization', auth(ownerToken))).body;
    const res = await http().post(`/api/v1/service/jobs/${jobId}/labour`).set('Authorization', auth(techToken)).send({ labourItemId: labour[0].id }).expect(201);
    expect(Number(res.body.bill.labourTotal)).toBeGreaterThan(0);
    expect(Number(res.body.bill.partsTotal)).toBeGreaterThan(0);
  });

  it('generates the bill (discount + GST) and takes payment to PAID', async () => {
    const billed = await http().post(`/api/v1/service/jobs/${jobId}/bill`).set('Authorization', auth(ownerToken)).send({ discount: 5000, taxPercentage: 18 }).expect(201);
    const parts = Number(billed.body.bill.partsTotal);
    const labour = Number(billed.body.bill.labourTotal);
    const expectedTax = Math.round((parts + labour - 5000) * 0.18);
    expect(Number(billed.body.bill.taxAmount)).toBe(expectedTax);
    expect(Number(billed.body.bill.total)).toBe(parts + labour - 5000 + expectedTax);

    const total = Number(billed.body.bill.total);
    const paid = await http().post(`/api/v1/service/jobs/${jobId}/payments`).set('Authorization', auth(ownerToken)).send({ amount: total, mode: 'CASH' }).expect(201);
    expect(paid.body.bill.status).toBe('PAID');
  });

  it('completes QC → READY → DELIVERED and stamps delivery', async () => {
    await setStatus(jobId, 'QUALITY_CHECK').expect(201);
    await setStatus(jobId, 'READY').expect(201);
    const delivered = await setStatus(jobId, 'DELIVERED').expect(201);
    expect(delivered.body.status).toBe('DELIVERED');
    expect(delivered.body.actualDelivery).toBeTruthy();
  });

  it('captures customer feedback', async () => {
    const res = await http().post(`/api/v1/service/jobs/${jobId}/feedback`).set('Authorization', auth(ownerToken)).send({ rating: 5, note: 'Great' }).expect(201);
    expect(res.body.feedbackRating).toBe(5);
  });

  it('downloads service PDFs (job-card + bill) as real PDF bytes, repeatably', async () => {
    for (const doc of ['job-card', 'bill', 'inspection']) {
      const res = await http().get(`/api/v1/service/jobs/${jobId}/pdf/${doc}`).set('Authorization', auth(ownerToken)).buffer(true).expect(200);
      expect(res.headers['content-type']).toContain('application/pdf');
      expect(res.body.subarray(0, 5).toString()).toBe('%PDF-');
    }
    await http().get(`/api/v1/service/jobs/${jobId}/pdf/nonsense`).set('Authorization', auth(ownerToken)).expect(400);
  });

  it('appends the full service timeline to the customer profile', async () => {
    const timeline = await http().get(`/api/v1/customers/${customerId}/timeline`).set('Authorization', auth(ownerToken)).expect(200);
    const types: string[] = timeline.body.map((e: { type: string }) => e.type);
    for (const t of ['JOB_CARD_CREATED', 'VEHICLE_CHECKED_IN', 'REPAIR_STARTED', 'PARTS_ADDED', 'SERVICE_DELIVERED', 'FEEDBACK_RECEIVED']) {
      expect(types).toContain(t);
    }
  });

  it('technician only sees their own jobs', async () => {
    const otherTech = await prisma.user.create({ data: { companyId: (await prisma.user.findUniqueOrThrow({ where: { email: email.toLowerCase() } })).companyId, name: 'Other Tech', email: `other.tech.${stamp}@e2e.test`, role: 'TECHNICIAN', passwordHash: await bcrypt.hash('Test@12345', 12) } });
    createdUserIds.push(otherTech.id);
    const otherToken = await login(otherTech.email, 'Test@12345');
    await http().get(`/api/v1/service/jobs/${jobId}`).set('Authorization', auth(otherToken)).expect(403);
    const mine = await http().get('/api/v1/service/jobs').set('Authorization', auth(techToken)).expect(200);
    expect(mine.body.data.every((j: { technician: { id: string } | null }) => j.technician?.id === techId)).toBe(true);
  });

  it('finds the job via global search (code, complaint, technician)', async () => {
    const byCode = await http().get(`/api/v1/search?q=${jobCode}`).set('Authorization', auth(ownerToken)).expect(200);
    expect(byCode.body.serviceJobs.some((j: { id: string }) => j.id === jobId)).toBe(true);
  });

  it('surfaces service widgets on the dashboard', async () => {
    const dash = await http().get('/api/v1/dashboard/summary').set('Authorization', auth(ownerToken)).expect(200);
    expect(dash.body.service).toBeDefined();
    expect(Array.isArray(dash.body.service.technicianWorkload)).toBe(true);
    expect(dash.body.service).toHaveProperty('lowPartsStock');
  });

  it('returns service reports (Owner/Manager only)', async () => {
    const reports = await http().get('/api/v1/service/reports').set('Authorization', auth(ownerToken)).expect(200);
    expect(reports.body.revenue).toBeDefined();
    expect(Array.isArray(reports.body.technicians)).toBe(true);
    await http().get('/api/v1/service/reports').set('Authorization', auth(techToken)).expect(403);
  });

  it('manages the spare-parts catalogue with stock guards', async () => {
    const created = await http().post('/api/v1/service/spare-parts').set('Authorization', auth(ownerToken))
      .send({ name: 'Test Part', sku: `TP-${stamp}`, quantity: 3, cost: 1000, sellingPrice: 1500, minStock: 5 }).expect(201);
    expect(created.body.lowStock).toBe(true);
    await http().post(`/api/v1/service/spare-parts/${created.body.id}/adjust`).set('Authorization', auth(ownerToken)).send({ delta: -10 }).expect(400);
    await http().delete(`/api/v1/service/spare-parts/${created.body.id}`).set('Authorization', auth(ownerToken)).expect(204);
  });
});
