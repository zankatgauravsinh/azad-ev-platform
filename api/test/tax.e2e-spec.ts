import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { seedRbac } from '../src/common/rbac/rbac-seed';

/**
 * Stage A — GST/Tax management (configuration only). Proves classification + effective-dated rate
 * CRUD, taxable-needs-code + overlap validation, RBAC (settings.view/manage) and tenant isolation.
 * No tax calculation and no Booking/Sale/invoice/Delivery behaviour is exercised.
 */
describe('Tax management (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const email = (process.env.SEED_OWNER_EMAIL ?? 'owner@azadev.in').toLowerCase();
  const password = process.env.SEED_OWNER_PASSWORD ?? 'Azad@12345';
  const stamp = Date.now().toString().slice(-8);
  const http = () => request(app.getHttpServer());
  const auth = (t: string): string => `Bearer ${t}`;
  const login = async (mail: string, pass: string): Promise<string> =>
    (await http().post('/api/v1/auth/login').send({ email: mail, password: pass }).expect(200)).body.accessToken;

  let ownerToken = '';
  let salesToken = '';
  let companyAId = '';
  let companyBId = '';
  let bClassificationId = '';
  const createdUserIds: string[] = [];
  const createdClassIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
    prisma = app.get(PrismaService);

    await seedRbac(prisma);
    const owner = await prisma.user.findUniqueOrThrow({ where: { email } });
    companyAId = owner.companyId;
    ownerToken = await login(email, password);

    // A SALES_EXECUTIVE lacks settings.manage — used to prove write authorization.
    const hash = await bcrypt.hash('Test@12345', 12);
    const sales = await prisma.user.create({
      data: { companyId: companyAId, name: 'Tax Sales', email: `tax.sales.${stamp}@e2e.test`, role: 'SALES_EXECUTIVE', passwordHash: hash, isActive: true },
    });
    createdUserIds.push(sales.id);
    salesToken = await login(sales.email, 'Test@12345');

    // Second company + a classification, for tenant isolation (companyId set explicitly: no request context here).
    const companyB = await prisma.company.create({ data: { name: `Tax B ${stamp}`, slug: `tax-b-${stamp}` } });
    companyBId = companyB.id;
    const bClass = await prisma.taxClassification.create({ data: { companyId: companyB.id, name: `B Vehicle ${stamp}`, codeType: 'HSN', code: '8703', treatment: 'TAXABLE' } });
    bClassificationId = bClass.id;
  }, 30000);

  afterAll(async () => {
    // TaxClassification is a soft-delete model (deleteMany only archives), so remove this suite's own
    // rows with raw SQL — rates go with them via ON DELETE CASCADE. Nothing else is touched.
    if (createdClassIds.length > 0) await prisma.$executeRaw(Prisma.sql`DELETE FROM "TaxClassification" WHERE id IN (${Prisma.join(createdClassIds)})`);
    await prisma.$executeRaw(Prisma.sql`DELETE FROM "TaxClassification" WHERE "companyId" = ${companyBId}`);
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await prisma.company.deleteMany({ where: { id: companyBId } });
    await app.close();
  });

  let classId = '';
  it('OWNER creates a taxable classification', async () => {
    const res = await http()
      .post('/api/v1/tax/classifications')
      .set('Authorization', auth(ownerToken))
      .send({ name: `EV Scooter ${stamp}`, codeType: 'HSN', code: '8711', treatment: 'TAXABLE', description: 'Electric two-wheeler' })
      .expect(201);
    classId = res.body.id;
    createdClassIds.push(classId);
    expect(res.body.code).toBe('8711');
    expect(res.body.treatment).toBe('TAXABLE');
    expect(res.body.rates).toEqual([]);
  });

  it('rejects a TAXABLE classification with no HSN/SAC code (400)', async () => {
    await http()
      .post('/api/v1/tax/classifications')
      .set('Authorization', auth(ownerToken))
      .send({ name: `NoCode ${stamp}`, codeType: 'HSN', treatment: 'TAXABLE' })
      .expect(400);
  });

  it('rejects a duplicate classification name (409)', async () => {
    await http()
      .post('/api/v1/tax/classifications')
      .set('Authorization', auth(ownerToken))
      .send({ name: `EV Scooter ${stamp}`, codeType: 'HSN', code: '8711', treatment: 'TAXABLE' })
      .expect(409);
  });

  it('adds an effective-dated rate, then blocks an overlapping active rate (409)', async () => {
    const r1 = await http()
      .post(`/api/v1/tax/classifications/${classId}/rates`)
      .set('Authorization', auth(ownerToken))
      .send({ ratePercent: 5, effectiveFrom: '2026-01-01', effectiveTo: '2026-06-30' })
      .expect(201);
    expect(r1.body.ratePercent).toBe('5.00');

    // Overlaps [2026-01-01, 2026-06-30)
    await http()
      .post(`/api/v1/tax/classifications/${classId}/rates`)
      .set('Authorization', auth(ownerToken))
      .send({ ratePercent: 12, effectiveFrom: '2026-06-01', effectiveTo: '2026-12-31' })
      .expect(409);

    // A non-overlapping later period is accepted.
    await http()
      .post(`/api/v1/tax/classifications/${classId}/rates`)
      .set('Authorization', auth(ownerToken))
      .send({ ratePercent: 12, effectiveFrom: '2026-07-01' })
      .expect(201);
  });

  // Calendar-date semantics: effectiveFrom and effectiveTo are both inclusive.
  it('treats the boundary day as inclusive: a rate starting on another’s last day overlaps (409)', async () => {
    // Existing: 5% 2026-01-01 → 2026-06-30 and 12% 2026-07-01 → open (adjacent, accepted above).
    await http()
      .post(`/api/v1/tax/classifications/${classId}/rates`)
      .set('Authorization', auth(ownerToken))
      .send({ ratePercent: 18, effectiveFrom: '2025-06-01', effectiveTo: '2026-01-01' }) // ends ON 1 Jan
      .expect(409);
    // Ending the day before is adjacent and fine.
    const ok = await http()
      .post(`/api/v1/tax/classifications/${classId}/rates`)
      .set('Authorization', auth(ownerToken))
      .send({ ratePercent: 18, effectiveFrom: '2025-06-01', effectiveTo: '2025-12-31' })
      .expect(201);
    expect(ok.body.effectiveFrom).toBe('2025-06-01T00:00:00.000Z');
    expect(ok.body.effectiveTo).toBe('2025-12-31T00:00:00.000Z');
    await http().delete(`/api/v1/tax/rates/${ok.body.id}`).set('Authorization', auth(ownerToken)).expect(200);
  });

  it('accepts a single-day rate (effectiveFrom === effectiveTo) and ignores time-of-day', async () => {
    const res = await http()
      .post(`/api/v1/tax/classifications/${classId}/rates`)
      .set('Authorization', auth(ownerToken))
      .send({ ratePercent: 3, effectiveFrom: '2025-01-15T10:30:00.000Z', effectiveTo: '2025-01-15T22:00:00.000Z' })
      .expect(201);
    expect(res.body.effectiveFrom).toBe('2025-01-15T00:00:00.000Z');
    expect(res.body.effectiveTo).toBe('2025-01-15T00:00:00.000Z');
    await http().delete(`/api/v1/tax/rates/${res.body.id}`).set('Authorization', auth(ownerToken)).expect(200);
  });

  it('rejects a rate whose effectiveTo precedes effectiveFrom (400)', async () => {
    await http()
      .post(`/api/v1/tax/classifications/${classId}/rates`)
      .set('Authorization', auth(ownerToken))
      .send({ ratePercent: 5, effectiveFrom: '2027-05-01', effectiveTo: '2027-01-01' })
      .expect(400);
  });

  it('lists classifications with their rates', async () => {
    const res = await http().get('/api/v1/tax/classifications').set('Authorization', auth(ownerToken)).expect(200);
    const mine = res.body.find((c: { id: string }) => c.id === classId);
    expect(mine).toBeTruthy();
    expect(mine.rates.length).toBe(2); // the 5% (closed) + 12% (open)
  });

  it('soft-deletes (archives) a classification — it disappears from the default list', async () => {
    const created = await http()
      .post('/api/v1/tax/classifications')
      .set('Authorization', auth(ownerToken))
      .send({ name: `Temp ${stamp}`, codeType: 'SAC', code: '9987', treatment: 'TAXABLE' })
      .expect(201);
    createdClassIds.push(created.body.id);
    await http().delete(`/api/v1/tax/classifications/${created.body.id}`).set('Authorization', auth(ownerToken)).expect(200);
    const list = await http().get('/api/v1/tax/classifications').set('Authorization', auth(ownerToken)).expect(200);
    expect(list.body.some((c: { id: string }) => c.id === created.body.id)).toBe(false);
    // And a direct fetch 404s (soft-deleted rows are filtered).
    await http().get(`/api/v1/tax/classifications/${created.body.id}`).set('Authorization', auth(ownerToken)).expect(404);
  });

  it('enforces RBAC: a role without settings.manage cannot write', async () => {
    await http()
      .post('/api/v1/tax/classifications')
      .set('Authorization', auth(salesToken))
      .send({ name: `Sales ${stamp}`, codeType: 'HSN', code: '8711', treatment: 'TAXABLE' })
      .expect(403);
  });

  it('enforces tenant isolation: another company’s classification is invisible (404)', async () => {
    await http().get(`/api/v1/tax/classifications/${bClassificationId}`).set('Authorization', auth(ownerToken)).expect(404);
    await http()
      .post(`/api/v1/tax/classifications/${bClassificationId}/rates`)
      .set('Authorization', auth(ownerToken))
      .send({ ratePercent: 5, effectiveFrom: '2026-01-01' })
      .expect(404);
  });
});
