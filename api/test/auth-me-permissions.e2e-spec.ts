import { INestApplication } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createE2eApp, E2E_HOOK_TIMEOUT } from './support/e2e-app';
import { createTestCompany, purgeTestCompany, TEST_PASSWORD, TestCompany } from './support/e2e-company';
import { seedRbac } from '../src/common/rbac/rbac-seed';

/**
 * Group 5 — /auth/me exposes the caller's effective permission keys. Infrastructure only: no
 * endpoint consumes permissions for authorization yet; User.role / RolesGuard remain authoritative.
 */
describe('GET /auth/me effective permissions (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let co: TestCompany;
  const stamp = Date.now().toString().slice(-8);
  const http = () => request(app.getHttpServer());
  const token: Record<string, string> = {};
  let inactiveToken = '';
  let inactiveId = '';

  const login = async (mail: string, pass: string): Promise<string> =>
    (await http().post('/api/v1/auth/login').send({ email: mail, password: pass }).expect(200)).body.accessToken;
  const me = (t: string): request.Test => http().get('/api/v1/auth/me').set('Authorization', `Bearer ${t}`);

  beforeAll(async () => {
    app = await createE2eApp();
    prisma = app.get(PrismaService);

    co = await createTestCompany(app, 'Me', { roles: ['MANAGER', 'SALES_EXECUTIVE', 'TECHNICIAN', 'ACCOUNTANT'] });
    for (const role of ['OWNER', 'MANAGER', 'SALES_EXECUTIVE', 'TECHNICIAN', 'ACCOUNTANT'] as const) token[role] = co.user(role).token;
    const inactive = await prisma.user.create({
      data: { companyId: co.id, name: 'Me Inactive', email: `me.inactive.${stamp}.${co.tag}@e2e.test`.toLowerCase(), role: 'MANAGER', passwordHash: await bcrypt.hash(TEST_PASSWORD, 12), isActive: true },
    });
    inactiveId = inactive.id;
    await seedRbac(prisma, { companyIds: [co.id] }); // backfill the extra user's roleId
    inactiveToken = await login(inactive.email, TEST_PASSWORD);
    await prisma.user.update({ where: { id: inactiveId }, data: { isActive: false } }); // deactivate after issuing the token
  }, E2E_HOOK_TIMEOUT);

  afterAll(async () => {
    await purgeTestCompany(prisma, co?.id);
    await app.close();
  }, E2E_HOOK_TIMEOUT);

  const perms = async (t: string): Promise<string[]> => (await me(t).expect(200)).body.permissions as string[];

  it('returns the exact effective permission count per role', async () => {
    expect((await perms(token.OWNER!)).length).toBe(83); // + rto.view / rto.generate / rto.edit, + inventory.cost, + accessories.sell / cancel, + audit.view, + bookings.terms
    expect((await perms(token.MANAGER!)).length).toBe(76); // + rto.view / rto.generate (rto.edit is owner-only), + accessories.sell / cancel, + audit.view
    expect((await perms(token.SALES_EXECUTIVE!)).length).toBe(28); // + accessories.sell
    expect((await perms(token.TECHNICIAN!)).length).toBe(15);
    expect((await perms(token.ACCOUNTANT!)).length).toBe(14); // + rto.view, + accessories.view, + gst.view / gst.manage
  });

  it('OWNER receives the full catalog including admin + inventory.export (no "*")', async () => {
    const p = await perms(token.OWNER!);
    expect(p).toContain('staff.manage');
    expect(p).toContain('roles.manage');
    expect(p).toContain('inventory.export');
    expect(p).not.toContain('*');
  });

  it('returns only the caller’s own keys — no owner-only leakage into MANAGER', async () => {
    const p = await perms(token.MANAGER!);
    expect(p).not.toContain('staff.manage');
    expect(p).not.toContain('roles.manage');
    expect(p).not.toContain('settings.manage');
    expect(p).toContain('inventory.dashboard'); // MANAGER keeps dashboard/export
  });

  it('reflects the role boundaries (SALES read-only service; TECH/ACCOUNTANT exclusions)', async () => {
    const sales = await perms(token.SALES_EXECUTIVE!);
    expect(sales).toContain('service.view');
    expect(sales).not.toContain('service.workflow');
    expect(sales).not.toContain('inventory.dashboard');
    const tech = await perms(token.TECHNICIAN!);
    expect(tech).toContain('service.workflow');
    expect(tech).not.toContain('search.use');
    const acct = await perms(token.ACCOUNTANT!);
    expect(acct).toContain('finance.view');
    expect(acct).not.toContain('notifications.use');
  });

  it('preserves existing /auth/me fields and leaks no secrets or internal ids', async () => {
    const res = await me(token.MANAGER!).expect(200);
    expect(res.body).toMatchObject({ email: expect.any(String), role: 'MANAGER', isActive: true, companyId: expect.any(String), id: expect.any(String) });
    expect(Array.isArray(res.body.permissions)).toBe(true);
    expect(res.body.permissions.every((k: unknown) => typeof k === 'string')).toBe(true);
    const dump = JSON.stringify(res.body);
    expect(dump).not.toContain('passwordHash');
    expect(dump).not.toContain('refreshTokenHash');
    expect(res.body.roleId).toBeUndefined(); // internal FK not exposed
  });

  it('still rejects a deactivated user exactly as before', async () => {
    await me(inactiveToken).expect(401);
  });
});
