import { INestApplication } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createE2eApp, E2E_HOOK_TIMEOUT } from './support/e2e-app';
import { createTestCompany, purgeTestCompany, TestCompany } from './support/e2e-company';

/**
 * Staff management (OWNER-only) e2e — authorization, tenant isolation across two companies,
 * security (no credential leakage), and the business rules enforced server-side.
 */
describe('Staff Management (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const stamp = Date.now().toString().slice(-8);
  const http = () => request(app.getHttpServer());
  const auth = (t: string): string => `Bearer ${t}`;
  const login = (e: string, p: string): request.Test => http().post('/api/v1/auth/login').send({ email: e, password: p });
  const token = async (e: string, p: string): Promise<string> => (await login(e, p).expect(200)).body.accessToken;

  let ownerAToken = '';
  let ownerBToken = '';
  // Two throwaway companies (see support/e2e-company); A is the one whose staff are managed.
  let coA: TestCompany;
  let coB: TestCompany;
  let companyAId = '';
  let companyBId = '';
  const roleTokens: Record<string, string> = {};

  // bcrypt(12) dominates setup time; memoize by plaintext so each distinct test password is hashed once.
  const hashCache = new Map<string, string>();
  const hashPw = async (p: string): Promise<string> => {
    const cached = hashCache.get(p);
    if (cached) return cached;
    const h = await bcrypt.hash(p, 12);
    hashCache.set(p, h);
    return h;
  };

  const mkUser = async (companyId: string, role: string, pwd: string): Promise<{ id: string; email: string }> => {
    const e = `${role.toLowerCase()}.${stamp}.${Math.random().toString(36).slice(2, 6)}@e2e.test`;
    const u = await prisma.user.create({ data: { companyId, name: `${role} ${stamp}`, email: e, role: role as never, passwordHash: await hashPw(pwd), isActive: true } });
    return { id: u.id, email: e };
  };

  beforeAll(async () => {
    app = await createE2eApp();
    prisma = app.get(PrismaService);

    // Each company gets its own owner and the system roles (staff creation assigns a dynamic AppRole).
    coA = await createTestCompany(app, 'StaffA');
    coB = await createTestCompany(app, 'StaffB');
    companyAId = coA.id;
    companyBId = coB.id;
    ownerAToken = coA.user().token;
    ownerBToken = coB.user().token;

    // One non-owner of each role in company A, to prove rejection.
    for (const role of ['MANAGER', 'SALES_EXECUTIVE', 'TECHNICIAN', 'ACCOUNTANT']) {
      const u = await mkUser(companyAId, role, 'Role@12345');
      roleTokens[role] = await token(u.email, 'Role@12345');
    }
  }, E2E_HOOK_TIMEOUT); // bootstrapping the Nest app + several bcrypt logins can exceed the 5s hook default under full-suite load

  afterAll(async () => {
    // Everything either company owns — staff created through the API and custom roles included.
    await purgeTestCompany(prisma, coA?.id);
    await purgeTestCompany(prisma, coB?.id);
    await app.close();
  }, E2E_HOOK_TIMEOUT);

  const newStaff = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    name: 'Asha', email: `asha.api.${stamp}.${Math.random().toString(36).slice(2, 6)}@e2e.test`, phone: '9876543210', role: 'SALES_EXECUTIVE', password: 'Abcd1234', ...over,
  });
  const assertNoSecrets = (body: unknown): void => {
    const s = JSON.stringify(body);
    expect(s).not.toContain('passwordHash');
    expect(s).not.toContain('refreshTokenHash');
  };

  // ── Authorization ──
  it('rejects unauthenticated access', async () => {
    await http().get('/api/v1/users/staff').expect(401);
  });

  it('rejects every non-owner role (403)', async () => {
    for (const role of ['MANAGER', 'SALES_EXECUTIVE', 'TECHNICIAN', 'ACCOUNTANT']) {
      await http().get('/api/v1/users/staff').set('Authorization', auth(roleTokens[role]!)).expect(403);
      await http().post('/api/v1/users/staff').set('Authorization', auth(roleTokens[role]!)).send(newStaff()).expect(403);
    }
  });

  // ── OWNER happy path + security ──
  let staffId = '';
  it('OWNER creates a staff user (no secrets, no plaintext, active by default)', async () => {
    const body = newStaff({ role: 'MANAGER' });
    const res = await http().post('/api/v1/users/staff').set('Authorization', auth(ownerAToken)).send(body).expect(201);
    staffId = res.body.id;
    expect(res.body.role).toBe('MANAGER');
    expect(res.body.roleId).toBeTruthy(); // assigned system AppRole id surfaced to the client
    expect(res.body.roleName).toBe('MANAGER'); // system AppRole display name
    expect(res.body.isActive).toBe(true);
    assertNoSecrets(res.body);
    expect(JSON.stringify(res.body)).not.toContain('Abcd1234');
    // Associated with company A via the tenant mechanism (companyId never sent).
    const row = await prisma.user.findUniqueOrThrow({ where: { id: staffId } });
    expect(row.companyId).toBe(companyAId);
    expect(row.passwordHash).not.toBe('Abcd1234'); // hashed
  });

  it('OWNER lists / gets staff (no secrets)', async () => {
    const list = await http().get('/api/v1/users/staff?pageSize=100').set('Authorization', auth(ownerAToken)).expect(200);
    expect(list.body.data.some((u: { id: string }) => u.id === staffId)).toBe(true);
    assertNoSecrets(list.body);
    const one = await http().get(`/api/v1/users/staff/${staffId}`).set('Authorization', auth(ownerAToken)).expect(200);
    assertNoSecrets(one.body);
  });

  it('OWNER updates staff name/phone/role', async () => {
    const res = await http().patch(`/api/v1/users/staff/${staffId}`).set('Authorization', auth(ownerAToken)).send({ name: 'Asha R', role: 'TECHNICIAN' }).expect(200);
    expect(res.body.name).toBe('Asha R');
    expect(res.body.role).toBe('TECHNICIAN');
  });

  it('rejects a duplicate email with a clean 409 (no Prisma/P2002/stack leak)', async () => {
    const res = await http().post('/api/v1/users/staff').set('Authorization', auth(ownerAToken)).send(newStaff({ email: coA.user().email })).expect(409);
    const s = JSON.stringify(res.body);
    expect(s).not.toContain('P2002');
    expect(s).not.toContain('prisma');
  });

  // ── Tenant isolation (A owner vs B staff) ──
  it('prevents cross-company read/update/deactivate/reset and does not leak existence', async () => {
    const bStaff = await mkUser(companyBId, 'MANAGER', 'Role@12345');
    // Owner A acting on a company-B user → 404 (invisible), never 200/403 leak.
    const get = await http().get(`/api/v1/users/staff/${bStaff.id}`).set('Authorization', auth(ownerAToken)).expect(404);
    expect(JSON.stringify(get.body)).not.toContain(bStaff.email);
    await http().patch(`/api/v1/users/staff/${bStaff.id}`).set('Authorization', auth(ownerAToken)).send({ name: 'X' }).expect(404);
    await http().patch(`/api/v1/users/staff/${bStaff.id}/active`).set('Authorization', auth(ownerAToken)).send({ isActive: false }).expect(404);
    await http().post(`/api/v1/users/staff/${bStaff.id}/reset-password`).set('Authorization', auth(ownerAToken)).send({ password: 'Abcd1234' }).expect(404);
    // Owner A's list never shows company B users.
    const list = await http().get('/api/v1/users/staff?pageSize=100').set('Authorization', auth(ownerAToken)).expect(200);
    expect(list.body.data.some((u: { id: string }) => u.id === bStaff.id)).toBe(false);

    // Symmetrically, Owner B cannot see or act on company A's staff.
    await http().get(`/api/v1/users/staff/${staffId}`).set('Authorization', auth(ownerBToken)).expect(404);
    await http().patch(`/api/v1/users/staff/${staffId}`).set('Authorization', auth(ownerBToken)).send({ name: 'Y' }).expect(404);
    const listB = await http().get('/api/v1/users/staff?pageSize=100').set('Authorization', auth(ownerBToken)).expect(200);
    expect(listB.body.data.some((u: { id: string }) => u.id === staffId)).toBe(false);
  });

  // ── Self-protection ──
  it('owner cannot deactivate or demote themselves', async () => {
    const me = await http().get('/api/v1/auth/me').set('Authorization', auth(ownerAToken)).expect(200);
    await http().patch(`/api/v1/users/staff/${me.body.id}/active`).set('Authorization', auth(ownerAToken)).send({ isActive: false }).expect(403);
    await http().patch(`/api/v1/users/staff/${me.body.id}`).set('Authorization', auth(ownerAToken)).send({ role: 'MANAGER' }).expect(403);
  });

  // ── Two owners: one can deactivate the other, one remains ──
  it('with two active owners, one owner can deactivate the other', async () => {
    const created = await http().post('/api/v1/users/staff').set('Authorization', auth(ownerAToken)).send(newStaff({ role: 'OWNER' })).expect(201);
    const res = await http().patch(`/api/v1/users/staff/${created.body.id}/active`).set('Authorization', auth(ownerAToken)).send({ isActive: false }).expect(200);
    expect(res.body.isActive).toBe(false);
  });

  // ── Deactivation invalidates sessions immediately ──
  it('deactivation blocks access and invalidates the refresh session', async () => {
    const u = await mkUser(companyAId, 'MANAGER', 'Role@12345');
    const loginRes = await login(u.email, 'Role@12345').expect(200);
    const { accessToken, refreshToken } = loginRes.body;
    await http().get('/api/v1/auth/me').set('Authorization', auth(accessToken)).expect(200);
    await http().patch(`/api/v1/users/staff/${u.id}/active`).set('Authorization', auth(ownerAToken)).send({ isActive: false }).expect(200);
    await http().get('/api/v1/auth/me').set('Authorization', auth(accessToken)).expect(401); // JwtStrategy re-checks isActive
    await http().post('/api/v1/auth/refresh').send({ refreshToken }).expect(401); // refresh hash cleared
    // Reactivation does not change the password.
    await http().patch(`/api/v1/users/staff/${u.id}/active`).set('Authorization', auth(ownerAToken)).send({ isActive: true }).expect(200);
    await login(u.email, 'Role@12345').expect(200);
  });

  // ── Admin password reset ──
  it('admin reset changes the password, clears sessions, returns no secrets', async () => {
    const u = await mkUser(companyAId, 'SALES_EXECUTIVE', 'Role@12345');
    const first = await login(u.email, 'Role@12345').expect(200);
    const res = await http().post(`/api/v1/users/staff/${u.id}/reset-password`).set('Authorization', auth(ownerAToken)).send({ password: 'NewPass123' }).expect(201);
    assertNoSecrets(res.body);
    expect(JSON.stringify(res.body)).not.toContain('NewPass123');
    await http().post('/api/v1/auth/refresh').send({ refreshToken: first.body.refreshToken }).expect(401); // old session dead
    await login(u.email, 'Role@12345').expect(401); // old password rejected
    await login(u.email, 'NewPass123').expect(200); // new password works
  });

  // ── Audit ──
  it('writes audit records for mutations with no credential values', async () => {
    const entries = await prisma.activityLog.findMany({ where: { entityType: 'User', entityId: staffId }, orderBy: { createdAt: 'asc' } });
    expect(entries.some((e) => e.action === 'CREATE')).toBe(true);
    expect(entries.some((e) => e.action === 'UPDATE')).toBe(true);
    const dump = JSON.stringify(entries);
    expect(dump).not.toContain('passwordHash');
    expect(dump).not.toContain('Abcd1234');
  });

  // ── H1: dynamic role (roleId) assignment — created/updated staff get working permissions ──
  const sysRole = (companyId: string, key: string) => prisma.appRole.findFirstOrThrow({ where: { companyId, key } });

  it('create wires roleId to the enum’s system role, and the new staff can use those permissions', async () => {
    const res = await http().post('/api/v1/users/staff').set('Authorization', auth(ownerAToken)).send(newStaff({ role: 'MANAGER', password: 'Mgr@12345' })).expect(201);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(row.roleId).toBe((await sysRole(companyAId, 'MANAGER')).id); // not just the legacy enum
    const me = await http().get('/api/v1/auth/me').set('Authorization', auth(await token(row.email, 'Mgr@12345'))).expect(200);
    expect(me.body.permissions).toContain('inventory.view'); // MANAGER has it
    expect(me.body.permissions).not.toContain('staff.manage'); // MANAGER lacks it
  });

  it('changing the role moves roleId and the effective permissions with it (same token, re-validated per request)', async () => {
    const created = await http().post('/api/v1/users/staff').set('Authorization', auth(ownerAToken)).send(newStaff({ role: 'SALES_EXECUTIVE', password: 'Sls@12345' })).expect(201);
    const t = await token(created.body.email, 'Sls@12345');
    const before = await http().get('/api/v1/auth/me').set('Authorization', auth(t)).expect(200);
    expect(before.body.permissions).toContain('service.view');
    expect(before.body.permissions).not.toContain('finance.manage');

    await http().patch(`/api/v1/users/staff/${created.body.id}`).set('Authorization', auth(ownerAToken)).send({ role: 'ACCOUNTANT' }).expect(200);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(row.roleId).toBe((await sysRole(companyAId, 'ACCOUNTANT')).id);
    const after = await http().get('/api/v1/auth/me').set('Authorization', auth(t)).expect(200);
    expect(after.body.permissions).toContain('finance.manage');
    expect(after.body.permissions).not.toContain('service.view');
  });

  it('assigns an explicit custom roleId and preserves the legacy enum', async () => {
    const custom = await prisma.appRole.create({ data: { companyId: companyAId, name: `Custom ${stamp}`, isSystem: false } });
    const perm = await prisma.permission.findUniqueOrThrow({ where: { key: 'dashboard.view' } });
    await prisma.rolePermission.create({ data: { roleId: custom.id, permissionId: perm.id } });

    const res = await http().post('/api/v1/users/staff').set('Authorization', auth(ownerAToken)).send(newStaff({ role: 'SALES_EXECUTIVE', roleId: custom.id, password: 'Cst@12345' })).expect(201);
    // The DTO surfaces the assigned AppRole so the UI can display/edit the real role (not just the enum).
    expect(res.body.roleId).toBe(custom.id);
    expect(res.body.roleName).toBe(`Custom ${stamp}`);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(row.roleId).toBe(custom.id);
    expect(row.role).toBe('SALES_EXECUTIVE'); // legacy enum kept (a custom role has no enum)
    const me = await http().get('/api/v1/auth/me').set('Authorization', auth(await token(row.email, 'Cst@12345'))).expect(200);
    expect(me.body.permissions).toEqual(['dashboard.view']); // exactly the custom role's single grant
  });

  it('rejects a roleId from another company (400, no id leak)', async () => {
    const bManager = await sysRole(companyBId, 'MANAGER');
    const res = await http().post('/api/v1/users/staff').set('Authorization', auth(ownerAToken)).send(newStaff({ roleId: bManager.id })).expect(400);
    expect(JSON.stringify(res.body)).not.toContain(bManager.id);
  });
});
