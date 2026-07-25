import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Proves company (tenant) isolation for future single-tenant → multi-tenant
 * readiness: two companies never see each other's data, even though only AZAD EV
 * is used today. Company B is created directly (system context, no request scope).
 */
describe('Tenant isolation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tokenA: string;
  let tokenB: string;
  let companyBId: string;
  const stamp = Date.now().toString().slice(-8);
  const emailA = process.env.SEED_OWNER_EMAIL ?? 'owner@azadev.in';
  const passwordA = process.env.SEED_OWNER_PASSWORD ?? 'Azad@12345';
  const emailB = `owner.b.${stamp}@tenant-b.test`;
  const http = () => request(app.getHttpServer());
  const bearer = (t: string): string => `Bearer ${t}`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
    prisma = app.get(PrismaService);

    // Company B (a second tenant) — created in system context.
    const companyB = await prisma.company.create({ data: { name: 'Rival Motors', slug: `rival-${stamp}` } });
    companyBId = companyB.id;
    await prisma.branch.create({ data: { companyId: companyBId, name: 'HQ', isPrimary: true } });
    await prisma.user.create({
      data: { companyId: companyBId, name: 'Owner B', email: emailB, role: 'OWNER', passwordHash: await bcrypt.hash('Test@12345', 12) },
    });

    tokenA = (await http().post('/api/v1/auth/login').send({ email: emailA, password: passwordA }).expect(200)).body.accessToken;
    tokenB = (await http().post('/api/v1/auth/login').send({ email: emailB, password: 'Test@12345' }).expect(200)).body.accessToken;
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe('DELETE FROM "CustomerTimelineEntry" WHERE "companyId" = $1', companyBId);
    await prisma.$executeRawUnsafe('DELETE FROM "Customer" WHERE "companyId" = $1', companyBId);
    await prisma.$executeRawUnsafe('DELETE FROM "InventoryEvent" e USING "InventoryUnit" u WHERE e."unitId" = u.id AND u."companyId" = $1', companyBId);
    await prisma.$executeRawUnsafe('DELETE FROM "InventoryUnit" WHERE "companyId" = $1', companyBId);
    await prisma.$executeRawUnsafe('DELETE FROM "ScooterVariant" WHERE "companyId" = $1', companyBId);
    await prisma.$executeRawUnsafe('DELETE FROM "ScooterModel" WHERE "companyId" = $1', companyBId);
    await prisma.$executeRawUnsafe('DELETE FROM "User" WHERE "companyId" = $1', companyBId);
    await prisma.$executeRawUnsafe('DELETE FROM "Branch" WHERE "companyId" = $1', companyBId);
    await prisma.$executeRawUnsafe('DELETE FROM "Company" WHERE id = $1', companyBId);
    await app.close();
  });

  it('scopes the JWT to the correct company', async () => {
    const meA = await http().get('/api/v1/auth/me').set('Authorization', bearer(tokenA)).expect(200);
    const meB = await http().get('/api/v1/auth/me').set('Authorization', bearer(tokenB)).expect(200);
    expect(meA.body.companyId).not.toBe(meB.body.companyId);
    expect(meB.body.companyId).toBe(companyBId);
  });

  it('isolates customers between companies', async () => {
    const a = await http().post('/api/v1/customers').set('Authorization', bearer(tokenA)).send({ name: 'A Customer', phone: `70${stamp}` }).expect(201);
    const b = await http().post('/api/v1/customers').set('Authorization', bearer(tokenB)).send({ name: 'B Customer', phone: `80${stamp}` }).expect(201);

    // A's list contains A's customer and never B's.
    const listA = await http().get(`/api/v1/customers?q=${stamp}`).set('Authorization', bearer(tokenA)).expect(200);
    const idsA = listA.body.data.map((c: { id: string }) => c.id);
    expect(idsA).toContain(a.body.id);
    expect(idsA).not.toContain(b.body.id);

    // B's list contains B's customer and never A's.
    const listB = await http().get(`/api/v1/customers?q=${stamp}`).set('Authorization', bearer(tokenB)).expect(200);
    const idsB = listB.body.data.map((c: { id: string }) => c.id);
    expect(idsB).toContain(b.body.id);
    expect(idsB).not.toContain(a.body.id);

    // A cannot fetch B's customer by id.
    await http().get(`/api/v1/customers/${b.body.id}`).set('Authorization', bearer(tokenA)).expect(404);
    // B cannot fetch A's customer by id.
    await http().get(`/api/v1/customers/${a.body.id}`).set('Authorization', bearer(tokenB)).expect(404);
  });

  it('isolates inventory models (seeded models belong to company A only)', async () => {
    const modelsA = await http().get('/api/v1/inventory/models').set('Authorization', bearer(tokenA)).expect(200);
    const modelsB = await http().get('/api/v1/inventory/models').set('Authorization', bearer(tokenB)).expect(200);
    expect(modelsA.body.length).toBeGreaterThanOrEqual(3);
    expect(modelsB.body.length).toBe(0); // company B has no models
  });

  it('isolates global search across tenants', async () => {
    // B searches for A's customer phone — must find nothing.
    const searchB = await http().get(`/api/v1/search?q=70${stamp}`).set('Authorization', bearer(tokenB)).expect(200);
    expect(searchB.body.customers).toHaveLength(0);
    // A finds its own.
    const searchA = await http().get(`/api/v1/search?q=70${stamp}`).set('Authorization', bearer(tokenA)).expect(200);
    expect(searchA.body.customers.length).toBeGreaterThanOrEqual(1);
  });

  it('isolates dashboard metrics between companies', async () => {
    const dashB = await http().get('/api/v1/dashboard/summary').set('Authorization', bearer(tokenB)).expect(200);
    // Company B has exactly one customer (created above) and no sales/inventory.
    expect(dashB.body.businessOverview.activeCustomers).toBe(1);
    expect(dashB.body.businessOverview.availableInventory).toBe(0);
    expect(dashB.body.businessOverview.deliveredVehicles).toBe(0);
  });

  it('persists the correct companyId on created records', async () => {
    const customer = await prisma.$queryRawUnsafe<{ companyId: string }[]>(
      'SELECT "companyId" FROM "Customer" WHERE phone = $1',
      `80${stamp}`,
    );
    expect(customer[0]?.companyId).toBe(companyBId);
  });
});
