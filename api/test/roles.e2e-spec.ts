import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createE2eApp, E2E_HOOK_TIMEOUT } from './support/e2e-app';
import { createTestCompany, purgeTestCompany, TestCompany } from './support/e2e-company';

/**
 * Group 3B — HTTP role management (OWNER-only). Proves CRUD, permission replacement, system-role
 * protection, OWNER-duplication block, delete guards, tenant isolation (two companies), and audit.
 * Authorization is still enum/RolesGuard based; existing behavior is unchanged.
 */
describe('Role management (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let A: TestCompany;
  let B: TestCompany;
  const stamp = Date.now().toString().slice(-8);
  const http = () => request(app.getHttpServer());
  const auth = (t: string): string => `Bearer ${t}`;

  let ownerToken = '';
  let managerToken = '';
  let companyAId = '';
  let ownerRoleId = '';
  let managerRoleId = '';
  const createdRoleIds: string[] = [];
  const createdUserIds: string[] = [];
  let companyBId = '';
  let bRoleId = '';

  beforeAll(async () => {
    app = await createE2eApp();
    prisma = app.get(PrismaService);

    // Company A: a throwaway company with an OWNER and a MANAGER (system roles seeded for it alone).
    A = await createTestCompany(app, 'Roles', { roles: ['MANAGER'] });
    companyAId = A.id;
    ownerToken = A.user().token;
    managerToken = A.user('MANAGER').token;
    createdUserIds.push(A.user('MANAGER').id); // the user a custom role is temporarily assigned to

    const aRoles = await prisma.appRole.findMany({ where: { companyId: companyAId } });
    ownerRoleId = aRoles.find((r) => r.key === 'OWNER')!.id;
    managerRoleId = aRoles.find((r) => r.key === 'MANAGER')!.id;

    // A second throwaway company with one custom role, for tenant-isolation checks.
    B = await createTestCompany(app, 'RolesB');
    companyBId = B.id;
    const bRole = await prisma.appRole.create({ data: { companyId: companyBId, name: 'B Custom', isSystem: false, isProtected: false } });
    bRoleId = bRole.id;
  }, E2E_HOOK_TIMEOUT);

  afterAll(async () => {
    await purgeTestCompany(prisma, A?.id); // its users, system and custom roles go with it
    await purgeTestCompany(prisma, B?.id);
    await app.close();
  }, E2E_HOOK_TIMEOUT);

  // ── authorization ──
  it('rejects unauthenticated and non-owner callers', async () => {
    await http().get('/api/v1/roles').expect(401);
    await http().get('/api/v1/roles').set('Authorization', auth(managerToken)).expect(403);
    await http().post('/api/v1/roles').set('Authorization', auth(managerToken)).send({ name: 'Nope', permissionKeys: [] }).expect(403);
  });

  // ── list ──
  it('lists roles including the locked system roles', async () => {
    const res = await http().get('/api/v1/roles?pageSize=100').set('Authorization', auth(ownerToken)).expect(200);
    const mgr = res.body.data.find((r: { id: string }) => r.id === managerRoleId);
    expect(mgr.isSystem).toBe(true);
    expect(mgr.permissionCount).toBe(72);
  });

  // ── create / get / update / permissions ──
  let roleId = '';
  it('creates a custom role', async () => {
    const name = `Sales Manager ${stamp}`;
    const res = await http().post('/api/v1/roles').set('Authorization', auth(ownerToken))
      .send({ name, description: 'Sales floor lead', permissionKeys: ['customers.view', 'bookings.view'] }).expect(201);
    roleId = res.body.id;
    createdRoleIds.push(roleId);
    expect(res.body.isSystem).toBe(false);
    expect(res.body.isProtected).toBe(false);
    expect(res.body.permissionKeys.sort()).toEqual(['bookings.view', 'customers.view']);
    // associated with company A via the tenant mechanism, not the client
    const row = await prisma.appRole.findUniqueOrThrow({ where: { id: roleId } });
    expect(row.companyId).toBe(companyAId);
  });

  it('rejects a duplicate (case-insensitive) name', async () => {
    await http().post('/api/v1/roles').set('Authorization', auth(ownerToken))
      .send({ name: `sales manager ${stamp}`, permissionKeys: [] }).expect(409);
  });

  it('rejects an unknown permission key and an invalid name', async () => {
    await http().post('/api/v1/roles').set('Authorization', auth(ownerToken)).send({ name: `Bad ${stamp}`, permissionKeys: ['customers.destroy'] }).expect(400);
    await http().post('/api/v1/roles').set('Authorization', auth(ownerToken)).send({ name: 'A', permissionKeys: [] }).expect(400);
  });

  it('PATCH edits profile only and never changes permissions', async () => {
    const got = await http().get(`/api/v1/roles/${roleId}`).set('Authorization', auth(ownerToken)).expect(200);
    expect(got.body.permissionKeys).toContain('customers.view');

    // PATCH updates name/description; permissions are untouched (permissionKeys not part of PATCH).
    const patched = await http().patch(`/api/v1/roles/${roleId}`).set('Authorization', auth(ownerToken))
      .send({ name: `Sales Lead ${stamp}`, description: 'Lead' }).expect(200);
    expect(patched.body.name).toBe(`Sales Lead ${stamp}`);
    expect(patched.body.permissionKeys.sort()).toEqual(['bookings.view', 'customers.view']); // unchanged

    // PATCH cannot be used to manage permissions: a body with only permissionKeys has no valid field.
    await http().patch(`/api/v1/roles/${roleId}`).set('Authorization', auth(ownerToken)).send({ permissionKeys: ['customers.view'] }).expect(400);
  });

  it('PUT /permissions is the sole permission-replacement endpoint', async () => {
    const set = await http().put(`/api/v1/roles/${roleId}/permissions`).set('Authorization', auth(ownerToken)).send({ permissionKeys: ['customers.view'] }).expect(200);
    expect(set.body.permissionKeys).toEqual(['customers.view']);
    const cleared = await http().put(`/api/v1/roles/${roleId}/permissions`).set('Authorization', auth(ownerToken)).send({ permissionKeys: [] }).expect(200);
    expect(cleared.body.permissionKeys).toEqual([]);
  });

  // ── system-role protection ──
  it('protects system roles from edit / permission-change / delete', async () => {
    await http().patch(`/api/v1/roles/${managerRoleId}`).set('Authorization', auth(ownerToken)).send({ name: 'Renamed' }).expect(403);
    await http().put(`/api/v1/roles/${managerRoleId}/permissions`).set('Authorization', auth(ownerToken)).send({ permissionKeys: [] }).expect(403);
    await http().delete(`/api/v1/roles/${managerRoleId}`).set('Authorization', auth(ownerToken)).expect(403);
  });

  // ── duplicate ──
  it('blocks duplicating OWNER but allows duplicating a system role', async () => {
    await http().post(`/api/v1/roles/${ownerRoleId}/duplicate`).set('Authorization', auth(ownerToken)).send({ name: `Clone ${stamp}` }).expect(403);

    const dup = await http().post(`/api/v1/roles/${managerRoleId}/duplicate`).set('Authorization', auth(ownerToken)).send({ name: `Branch Manager ${stamp}` }).expect(201);
    createdRoleIds.push(dup.body.id);
    expect(dup.body.isSystem).toBe(false);
    expect(dup.body.permissionKeys.length).toBe(72); // copied MANAGER permissions
  });

  // ── delete + name reuse ──
  it('deletes an unassigned custom role and frees its name for reuse', async () => {
    const name = `Temp Role ${stamp}`;
    const created = await http().post('/api/v1/roles').set('Authorization', auth(ownerToken)).send({ name, permissionKeys: [] }).expect(201);
    await http().delete(`/api/v1/roles/${created.body.id}`).set('Authorization', auth(ownerToken)).expect(204);
    await http().get(`/api/v1/roles/${created.body.id}`).set('Authorization', auth(ownerToken)).expect(404);
    // name is immediately reusable (hard delete)
    const recreated = await http().post('/api/v1/roles').set('Authorization', auth(ownerToken)).send({ name, permissionKeys: [] }).expect(201);
    createdRoleIds.push(recreated.body.id);
  });

  it('refuses to delete a role that still has users assigned', async () => {
    const created = await http().post('/api/v1/roles').set('Authorization', auth(ownerToken)).send({ name: `Assigned ${stamp}`, permissionKeys: [] }).expect(201);
    createdRoleIds.push(created.body.id);
    await prisma.user.update({ where: { id: createdUserIds[0] }, data: { roleId: created.body.id } });
    await http().delete(`/api/v1/roles/${created.body.id}`).set('Authorization', auth(ownerToken)).expect(409);
    await prisma.user.update({ where: { id: createdUserIds[0] }, data: { roleId: null } }); // unassign for cleanup
  });

  // ── tenant isolation ──
  it('treats another company’s role id as NotFound (no leak)', async () => {
    const get = await http().get(`/api/v1/roles/${bRoleId}`).set('Authorization', auth(ownerToken)).expect(404);
    expect(JSON.stringify(get.body)).not.toContain('B Custom');
    await http().patch(`/api/v1/roles/${bRoleId}`).set('Authorization', auth(ownerToken)).send({ name: 'Hijack' }).expect(404);
    await http().put(`/api/v1/roles/${bRoleId}/permissions`).set('Authorization', auth(ownerToken)).send({ permissionKeys: [] }).expect(404);
    await http().delete(`/api/v1/roles/${bRoleId}`).set('Authorization', auth(ownerToken)).expect(404);
    await http().post(`/api/v1/roles/${bRoleId}/duplicate`).set('Authorization', auth(ownerToken)).send({ name: `Steal ${stamp}` }).expect(404);
    const list = await http().get('/api/v1/roles?pageSize=100').set('Authorization', auth(ownerToken)).expect(200);
    expect(list.body.data.some((r: { id: string }) => r.id === bRoleId)).toBe(false);
  });

  // ── audit ──
  it('writes a ROLE_CREATED audit entry', async () => {
    const entries = await prisma.activityLog.findMany({ where: { entityType: 'Role', entityId: roleId } });
    expect(entries.some((e) => e.action === 'CREATE')).toBe(true);
    const dump = JSON.stringify(entries);
    expect(dump).toContain('ROLE_');
    expect(dump).not.toContain('passwordHash');
  });
});
