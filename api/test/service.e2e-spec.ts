import { INestApplication } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createE2eApp, E2E_HOOK_TIMEOUT } from './support/e2e-app';
import { createTestCompany, purgeTestCompany, TEST_PASSWORD, TestCompany } from './support/e2e-company';

describe('Service & after-sales (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  // Runs in its own throwaway company (see support/e2e-company).
  let co: TestCompany;
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
  const http = () => request(app.getHttpServer());
  const auth = (t: string): string => `Bearer ${t}`;
  const login = async (mail: string, pass: string): Promise<string> =>
    (await http().post('/api/v1/auth/login').send({ email: mail, password: pass }).expect(200)).body.accessToken;
  const setStatus = (id: string, status: string): request.Test =>
    http().post(`/api/v1/service/jobs/${id}/status`).set('Authorization', auth(ownerToken)).send({ status });

  beforeAll(async () => {
    app = await createE2eApp();
    prisma = app.get(PrismaService);

    co = await createTestCompany(app, 'Svc', { roles: ['TECHNICIAN', 'SALES_EXECUTIVE'] });
    techId = co.user('TECHNICIAN').id;
    ownerToken = co.user().token;
    techToken = co.user('TECHNICIAN').token;
    salesToken = co.user('SALES_EXECUTIVE').token;

    const unit = await http().post('/api/v1/inventory/units').set('Authorization', auth(ownerToken))
      .send({ modelId: co.modelId, variant: `SVC-${stamp}`, colour: 'Black', vin: `SVC${stamp}`, motorNumber: `SM${stamp}`, batteryNumber: `SB${stamp}` }).expect(201);
    unitId = unit.body.id;
    const customer = await http().post('/api/v1/customers').set('Authorization', auth(ownerToken)).send({ name: 'Svc Customer', phone: `96${stamp}` }).expect(201);
    customerId = customer.body.id;
    // A dedicated part with known stock.
    const part = await http().post('/api/v1/service/spare-parts').set('Authorization', auth(ownerToken))
      .send({ name: 'Svc Test Part', sku: `SVCP-${stamp}`, quantity: 100, cost: 1000, sellingPrice: 1500, minStock: 5 }).expect(201);
    sparePartId = part.body.id;
    // The company's own labour catalogue entry (a new company starts with an empty catalogue).
    await http().post('/api/v1/service/labour-items').set('Authorization', auth(ownerToken))
      .send({ name: 'Svc Test Labour', defaultCost: 45000, durationMins: 30 }).expect(201);
  }, E2E_HOOK_TIMEOUT);

  afterAll(async () => {
    await purgeTestCompany(prisma, co?.id);
    await app.close();
  }, E2E_HOOK_TIMEOUT);

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
    const otherTech = await prisma.user.create({ data: { companyId: co.id, name: 'Other Tech', email: `other.tech.${stamp}@e2e.test`, role: 'TECHNICIAN', passwordHash: await bcrypt.hash(TEST_PASSWORD, 12) } });
    const otherToken = await login(otherTech.email, TEST_PASSWORD);
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

  it("a job card cannot be opened on another customer's vehicle", async () => {
    const unit = await http().post('/api/v1/inventory/units').set('Authorization', auth(ownerToken))
      .send({ modelId: co.modelId, variant: `SVC-${stamp}`, colour: 'Black', vin: `SVO${stamp}`, motorNumber: `SOM${stamp}`, batteryNumber: `SOB${stamp}` }).expect(201);
    const owner = (await http().post('/api/v1/customers').set('Authorization', auth(ownerToken)).send({ name: 'Svc Vehicle Owner', phone: `95${stamp}` }).expect(201)).body.id;
    const other = (await http().post('/api/v1/customers').set('Authorization', auth(ownerToken)).send({ name: 'Svc Someone Else', phone: `94${stamp}` }).expect(201)).body.id;
    const booking = (await http().post('/api/v1/bookings').set('Authorization', auth(ownerToken)).send({ customerId: owner, unitId: unit.body.id, exShowroom: 9000000 }).expect(201)).body;
    const job = (customer: string, extra: Record<string, unknown> = {}) => http().post('/api/v1/service/jobs').set('Authorization', auth(ownerToken))
      .send({ customerId: customer, unitId: unit.body.id, type: 'PAID', complaints: [{ description: 'Check-up' }], ...extra });
    const jobsOnUnit = () => prisma.serviceJob.count({ where: { unitId: unit.body.id } });

    const refused = await job(other).expect(400);
    expect(refused.body.message).toBe(`Vehicle SVO${stamp} belongs to another customer — choose one of this customer's vehicles`);
    expect(refused.body.message).not.toContain('Svc Vehicle Owner'); // the other customer is not disclosed
    // A booking or sale reference must match the customer and the vehicle.
    await job(other, { bookingId: booking.id }).expect(400);
    await job(owner, { bookingId: jobId }).expect(400);
    expect(await jobsOnUnit()).toBe(0);
    await job(owner, { bookingId: booking.id }).expect(201);

    // The job card form is offered only the customer's own vehicles.
    const vehicles = (customer: string) => http().get(`/api/v1/service/jobs/customer-vehicles?customerId=${customer}`).set('Authorization', auth(ownerToken)).expect(200);
    expect((await vehicles(owner)).body).toEqual([{ id: unit.body.id, vin: `SVO${stamp}`, model: expect.any(String), variant: `SVC-${stamp}`, colour: 'Black' }]);
    expect((await vehicles(other)).body).toEqual([]);
    await http().get('/api/v1/service/jobs/customer-vehicles?customerId=nope').set('Authorization', auth(ownerToken)).expect(400);
    await http().get(`/api/v1/service/jobs/customer-vehicles?customerId=${owner}`).set('Authorization', auth(salesToken)).expect(403);

    // Once the booking is cancelled the scooter is dealer stock again, and stock has no owner.
    await http().post(`/api/v1/bookings/${booking.id}/cancel`).set('Authorization', auth(ownerToken)).send({ reason: 'test' }).expect(201);
    expect((await vehicles(owner)).body).toEqual([]);
    await job(other).expect(201);
  });

  // ───────────────────────── Closed job cards (QA M1, M7) ─────────────────────────
  const newJob = async (extra: Record<string, unknown> = {}): Promise<string> =>
    (await http().post('/api/v1/service/jobs').set('Authorization', auth(ownerToken)).send({ customerId, unitId, type: 'PAID', complaints: [{ description: 'Check-up' }], ...extra }).expect(201)).body.id;
  const stock = async (): Promise<number> => (await http().get(`/api/v1/service/spare-parts/${sparePartId}`).set('Authorization', auth(ownerToken))).body.quantity;

  it('a cancelled job card is frozen: no parts, labour, bill, payment or edits — and stock is returned once', async () => {
    const id = await newJob();
    await setStatus(id, 'CHECKED_IN').expect(201);
    const part = (await http().post(`/api/v1/service/jobs/${id}/parts`).set('Authorization', auth(ownerToken)).send({ sparePartId, qty: 1 }).expect(201)).body.parts[0];
    const before = await stock();
    const cancelled = await http().post(`/api/v1/service/jobs/${id}/status`).set('Authorization', auth(ownerToken)).send({ status: 'CANCELLED', reason: 'Customer withdrew the vehicle' }).expect(201);
    expect(cancelled.body.notes).toContain('Cancelled: Customer withdrew the vehicle');
    expect(await stock()).toBe(before + 1);

    const refused = 'is cancelled and can no longer be changed';
    const o = (r: request.Test) => r.set('Authorization', auth(ownerToken));
    expect((await o(http().post(`/api/v1/service/jobs/${id}/parts`)).send({ sparePartId, qty: 1 }).expect(400)).body.message).toContain(refused);
    await o(http().delete(`/api/v1/service/jobs/${id}/parts/${part.id}`)).expect(400); // would return the part to stock a second time
    await o(http().post(`/api/v1/service/jobs/${id}/labour`)).send({ description: 'x', cost: 100 }).expect(400);
    await o(http().post(`/api/v1/service/jobs/${id}/bill`)).send({ discount: 0, taxPercentage: 0 }).expect(400);
    await o(http().post(`/api/v1/service/jobs/${id}/payments`)).send({ amount: 100, mode: 'CASH' }).expect(400);
    await o(http().patch(`/api/v1/service/jobs/${id}`)).send({ notes: 'edit' }).expect(400);
    await o(http().post(`/api/v1/service/jobs/${id}/complaints`)).send({ description: 'more' }).expect(400);
    expect(await stock()).toBe(before + 1);
  });

  it('a delivered job card is closed to work but still takes payment and feedback', async () => {
    // jobId was delivered above.
    const o = (r: request.Test) => r.set('Authorization', auth(ownerToken));
    expect((await o(http().post(`/api/v1/service/jobs/${jobId}/parts`)).send({ sparePartId, qty: 1 }).expect(400)).body.message).toContain('is delivered and closed');
    await o(http().post(`/api/v1/service/jobs/${jobId}/bill`)).send({ discount: 0, taxPercentage: 0 }).expect(400);
    await o(http().post(`/api/v1/service/jobs/${jobId}/feedback`)).send({ rating: 4 }).expect(201);
  });

  // ───────────────────────── Free services (QA M2) ─────────────────────────
  it('delivering a FREE_1 job card completes the warranty\'s first free service', async () => {
    // A sold, delivered scooter — delivery issues its warranty with three pending free services.
    const sold = await http().post('/api/v1/inventory/units').set('Authorization', auth(ownerToken))
      .send({ modelId: co.modelId, variant: `SVC-${stamp}`, colour: 'Black', vin: `SVF${stamp}`, motorNumber: `SFM${stamp}`, batteryNumber: `SFB${stamp}` }).expect(201);
    const booking = (await http().post('/api/v1/bookings').set('Authorization', auth(ownerToken)).send({ customerId, unitId: sold.body.id, exShowroom: 9000000 }).expect(201)).body;
    await http().post(`/api/v1/bookings/${booking.id}/invoice`).set('Authorization', auth(ownerToken)).expect(201);
    await http().post(`/api/v1/bookings/${booking.id}/deliver`).set('Authorization', auth(ownerToken)).send({}).expect(201);
    const free = () => prisma.freeService.findMany({ where: { warranty: { unitId: sold.body.id } }, orderBy: { serviceNumber: 'asc' } });
    expect((await free()).map((f) => f.status)).toEqual(['PENDING', 'PENDING', 'PENDING']);

    const job = (await http().post('/api/v1/service/jobs').set('Authorization', auth(ownerToken))
      .send({ customerId, unitId: sold.body.id, type: 'FREE_1', technicianId: techId, complaints: [{ description: 'First free service' }] }).expect(201)).body;
    for (const status of ['CHECKED_IN', 'DIAGNOSIS', 'REPAIRING', 'QUALITY_CHECK', 'READY']) await setStatus(job.id, status).expect(201);
    expect((await free())[0]?.status).toBe('PENDING'); // not until the vehicle is handed back
    await setStatus(job.id, 'DELIVERED').expect(201);
    const [first, second] = await free();
    expect(first).toMatchObject({ status: 'COMPLETED', technicianId: techId, remarks: `Job card ${job.code}` });
    expect(first?.completedDate).toBeTruthy();
    expect(second?.status).toBe('PENDING');
  });

  // ───────────────────────── Technician workload (QA M8) ─────────────────────────
  it("the dashboard's technician workload includes anyone holding open jobs, whatever their role", async () => {
    const owner = co.user();
    const id = await newJob({ technicianId: owner.id });
    const dash = await http().get('/api/v1/dashboard/summary').set('Authorization', auth(ownerToken)).expect(200);
    const row = dash.body.service.technicianWorkload.find((t: { technicianId: string }) => t.technicianId === owner.id);
    expect(row?.openJobs).toBeGreaterThanOrEqual(1);
    expect(dash.body.service.technicianWorkload.some((t: { technicianId: string }) => t.technicianId === techId)).toBe(true);
    await http().post(`/api/v1/service/jobs/${id}/status`).set('Authorization', auth(ownerToken)).send({ status: 'CANCELLED', reason: 'test' }).expect(201);
  });

  // QA (Low): the dashboard's Service Due list was always empty.
  it("lists booked job cards due today on the dashboard's Service Due reminders", async () => {
    const id = await newJob({ scheduledDate: new Date().toISOString() });
    const later = await newJob({ scheduledDate: new Date(Date.now() + 5 * 86_400_000).toISOString() });
    const due = async () => (await http().get('/api/v1/dashboard/summary').set('Authorization', auth(ownerToken)).expect(200)).body.reminders.serviceDue as { id: string; href: string }[];
    const list = await due();
    expect(list.find((r) => r.id === id)?.href).toBe(`/service/${id}`);
    expect(list.some((r) => r.id === later)).toBe(false);
    await setStatus(id, 'CHECKED_IN').expect(201); // once the vehicle is in, it is no longer "due"
    expect((await due()).some((r) => r.id === id)).toBe(false);
    for (const j of [id, later]) await http().post(`/api/v1/service/jobs/${j}/status`).set('Authorization', auth(ownerToken)).send({ status: 'CANCELLED', reason: 'test' }).expect(201);
  });
});
