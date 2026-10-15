import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createE2eApp, E2E_HOOK_TIMEOUT } from './support/e2e-app';
import { createTestCompany, purgeTestCompany, TestCompany } from './support/e2e-company';

/**
 * Proves company (tenant) isolation for future single-tenant → multi-tenant
 * readiness: two companies never see each other's data. Both are throwaway companies
 * (never the seeded dev company), each with its own owner and one scooter model.
 */
describe('Tenant isolation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let A: TestCompany;
  let B: TestCompany;
  let tokenA: string;
  let tokenB: string;
  let companyBId: string;
  const stamp = Date.now().toString().slice(-8);
  const http = () => request(app.getHttpServer());
  const bearer = (t: string): string => `Bearer ${t}`;

  beforeAll(async () => {
    app = await createE2eApp();
    prisma = app.get(PrismaService);

    A = await createTestCompany(app, 'TenantA');
    B = await createTestCompany(app, 'TenantB');
    companyBId = B.id;
    tokenA = A.user().token;
    tokenB = B.user().token;
  }, E2E_HOOK_TIMEOUT);

  afterAll(async () => {
    await purgeTestCompany(prisma, A?.id);
    await purgeTestCompany(prisma, B?.id);
    await app.close();
  }, E2E_HOOK_TIMEOUT);

  it('scopes the JWT to the correct company', async () => {
    const meA = await http().get('/api/v1/auth/me').set('Authorization', bearer(tokenA)).expect(200);
    const meB = await http().get('/api/v1/auth/me').set('Authorization', bearer(tokenB)).expect(200);
    expect(meA.body.companyId).not.toBe(meB.body.companyId);
    expect(meA.body.companyId).toBe(A.id);
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

  it('isolates inventory models (each company sees only its own model)', async () => {
    const idsA = (await http().get('/api/v1/inventory/models').set('Authorization', bearer(tokenA)).expect(200)).body.map((m: { id: string }) => m.id);
    const idsB = (await http().get('/api/v1/inventory/models').set('Authorization', bearer(tokenB)).expect(200)).body.map((m: { id: string }) => m.id);
    expect(idsA).toEqual([A.modelId]);
    expect(idsB).toEqual([B.modelId]);
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
