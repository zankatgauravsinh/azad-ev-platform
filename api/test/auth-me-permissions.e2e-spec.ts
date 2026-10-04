import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { seedRbac } from '../src/common/rbac/rbac-seed';

/**
 * Group 5 — /auth/me exposes the caller's effective permission keys. Infrastructure only: no
 * endpoint consumes permissions for authorization yet; User.role / RolesGuard remain authoritative.
 */
describe('GET /auth/me effective permissions (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const email = (process.env.SEED_OWNER_EMAIL ?? 'owner@azadev.in').toLowerCase();
  const password = process.env.SEED_OWNER_PASSWORD ?? 'Azad@12345';
  const stamp = Date.now().toString().slice(-8);
  const http = () => request(app.getHttpServer());
  const token: Record<string, string> = {};
  const createdUserIds: string[] = [];
  let inactiveToken = '';
  let inactiveId = '';

  const login = async (mail: string, pass: string): Promise<string> =>
    (await http().post('/api/v1/auth/login').send({ email: mail, password: pass }).expect(200)).body.accessToken;
  const me = (t: string): request.Test => http().get('/api/v1/auth/me').set('Authorization', `Bearer ${t}`);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
    prisma = app.get(PrismaService);

    const owner = await prisma.user.findUniqueOrThrow({ where: { email } });
    const hash = await bcrypt.hash('Test@12345', 12);
    for (const role of ['MANAGER', 'SALES_EXECUTIVE', 'TECHNICIAN', 'ACCOUNTANT'] as const) {
      const u = await prisma.user.create({
        data: { companyId: owner.companyId, name: `Me ${role}`, email: `me.${role.toLowerCase()}.${stamp}@e2e.test`, role, passwordHash: hash, isActive: true },
      });
      createdUserIds.push(u.id);
    }
    const inactive = await prisma.user.create({
      data: { companyId: owner.companyId, name: 'Me Inactive', email: `me.inactive.${stamp}@e2e.test`, role: 'MANAGER', passwordHash: hash, isActive: true },
    });
    createdUserIds.push(inactive.id);
    inactiveId = inactive.id;

    await seedRbac(prisma); // backfill roleId for the new users
    token.OWNER = await login(email, password);
    for (const role of ['MANAGER', 'SALES_EXECUTIVE', 'TECHNICIAN', 'ACCOUNTANT'] as const) {
      token[role] = await login(`me.${role.toLowerCase()}.${stamp}@e2e.test`, 'Test@12345');
    }
    inactiveToken = await login(`me.inactive.${stamp}@e2e.test`, 'Test@12345');
    await prisma.user.update({ where: { id: inactiveId }, data: { isActive: false } }); // deactivate after issuing the token
  }, 30000);

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await app.close();
  }, 30000);

  const perms = async (t: string): Promise<string[]> => (await me(t).expect(200)).body.permissions as string[];

  it('returns the exact effective permission count per role', async () => {
    expect((await perms(token.OWNER!)).length).toBe(73);
    expect((await perms(token.MANAGER!)).length).toBe(70);
    expect((await perms(token.SALES_EXECUTIVE!)).length).toBe(27);
    expect((await perms(token.TECHNICIAN!)).length).toBe(15);
    expect((await perms(token.ACCOUNTANT!)).length).toBe(10);
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
