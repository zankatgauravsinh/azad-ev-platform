import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { SYSTEM_ROLES, SYSTEM_ROLE_PERMISSIONS, Role } from '@azad/shared';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { seedRbac } from '../src/common/rbac/rbac-seed';

/**
 * Group 2 — proves the idempotent RBAC seed + tenant-safe User.roleId backfill. Authorization is
 * NOT switched to RBAC here; the existing authorization e2e suite proves behavior is unchanged.
 */
describe('RBAC seed & backfill (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const email = (process.env.SEED_OWNER_EMAIL ?? 'owner@azadev.in').toLowerCase();
  const stamp = Date.now().toString().slice(-8);
  let companyAId = '';
  const EXPECTED_COUNTS: Record<string, number> = {
    OWNER: 73, MANAGER: 70, SALES_EXECUTIVE: 27, TECHNICIAN: 15, ACCOUNTANT: 10,
  };
  const cleanup = { companyBId: '', userBId: '' };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
    prisma = app.get(PrismaService);
    const owner = await prisma.user.findUniqueOrThrow({ where: { email } });
    companyAId = owner.companyId;
  }, 30000);

  afterAll(async () => {
    if (cleanup.userBId) await prisma.user.deleteMany({ where: { id: cleanup.userBId } });
    if (cleanup.companyBId) {
      await prisma.appRole.deleteMany({ where: { companyId: cleanup.companyBId } }); // cascades RolePermission
      await prisma.company.deleteMany({ where: { id: cleanup.companyBId } });
    }
    await app.close();
  }, 30000);

  it('seeds the 73-permission global catalog and is idempotent', async () => {
    const r1 = await seedRbac(prisma);
    expect(r1.permissions).toBe(73);
    expect(await prisma.permission.count()).toBe(73);
    const r2 = await seedRbac(prisma); // second run
    expect(await prisma.permission.count()).toBe(73); // no duplicates
    expect(r2.usersBackfilled).toBe(0); // existing users already backfilled
  });

  it('creates no demo/sample data (companies, users, customers unchanged)', async () => {
    const before = {
      companies: await prisma.company.count(),
      users: await prisma.user.count(),
      customers: await prisma.customer.count(),
    };
    await seedRbac(prisma); // a pure re-run: only RBAC rows + roleId backfill, never business data
    expect(await prisma.company.count()).toBe(before.companies);
    expect(await prisma.user.count()).toBe(before.users);
    expect(await prisma.customer.count()).toBe(before.customers);
  });

  it('creates exactly five locked system roles for the company (no duplicates)', async () => {
    const roles = await prisma.appRole.findMany({ where: { companyId: companyAId } });
    expect(roles.length).toBe(5);
    for (const def of SYSTEM_ROLES) {
      const role = roles.find((r) => r.key === def.key);
      expect(role).toBeDefined();
      expect(role!.isSystem).toBe(true);
      expect(role!.name).toBe(def.name);
      expect(role!.isProtected).toBe(def.isProtected);
    }
    expect(roles.find((r) => r.key === 'OWNER')!.isProtected).toBe(true);
  });

  it('assigns each system role its exact permission bundle', async () => {
    for (const def of SYSTEM_ROLES) {
      const role = await prisma.appRole.findFirstOrThrow({ where: { companyId: companyAId, key: def.key } });
      const count = await prisma.rolePermission.count({ where: { roleId: role.id } });
      expect(count).toBe(SYSTEM_ROLE_PERMISSIONS[def.key as Role].length);
      expect(count).toBe(EXPECTED_COUNTS[def.key]); // regression lock
    }
  });

  it('reproduces the key authorization boundaries in the permission data', async () => {
    const has = async (roleKey: string, permKey: string): Promise<boolean> => {
      const role = await prisma.appRole.findFirstOrThrow({ where: { companyId: companyAId, key: roleKey } });
      const perm = await prisma.permission.findUniqueOrThrow({ where: { key: permKey } });
      return (await prisma.rolePermission.count({ where: { roleId: role.id, permissionId: perm.id } })) > 0;
    };
    // SALES: service read yes, mutation no; quotations.delete yes; search/notifications yes.
    expect(await has('SALES_EXECUTIVE', 'service.view')).toBe(true);
    expect(await has('SALES_EXECUTIVE', 'service.workflow')).toBe(false);
    expect(await has('SALES_EXECUTIVE', 'quotations.delete')).toBe(true);
    expect(await has('SALES_EXECUTIVE', 'search.use')).toBe(true);
    // TECHNICIAN: workflow yes, bill no, search no.
    expect(await has('TECHNICIAN', 'service.workflow')).toBe(true);
    expect(await has('TECHNICIAN', 'service.bill')).toBe(false);
    expect(await has('TECHNICIAN', 'search.use')).toBe(false);
    // ACCOUNTANT: finance yes; notifications/search/dashboard/inventory/returns/staff no.
    expect(await has('ACCOUNTANT', 'finance.manage')).toBe(true);
    expect(await has('ACCOUNTANT', 'notifications.use')).toBe(false);
    expect(await has('ACCOUNTANT', 'search.use')).toBe(false);
    expect(await has('ACCOUNTANT', 'dashboard.view')).toBe(false);
    expect(await has('ACCOUNTANT', 'inventory.create')).toBe(false);
    expect(await has('ACCOUNTANT', 'returns.approve')).toBe(false);
    expect(await has('ACCOUNTANT', 'staff.manage')).toBe(false);
    // Only OWNER gets the OWNER-only keys.
    expect(await has('OWNER', 'staff.manage')).toBe(true);
    expect(await has('MANAGER', 'staff.manage')).toBe(false);
    expect(await has('MANAGER', 'roles.manage')).toBe(false);
  });

  it('has no duplicate RolePermission rows (total == sum of bundles)', async () => {
    const roleIds = (await prisma.appRole.findMany({ where: { companyId: companyAId }, select: { id: true } })).map((r) => r.id);
    const total = await prisma.rolePermission.count({ where: { roleId: { in: roleIds } } });
    const expected = SYSTEM_ROLES.reduce((sum, def) => sum + SYSTEM_ROLE_PERMISSIONS[def.key as Role].length, 0);
    expect(total).toBe(expected); // 195
  });

  it('backfills the existing owner to the company OWNER role without changing the enum', async () => {
    const owner = await prisma.user.findUniqueOrThrow({ where: { email } });
    const ownerRole = await prisma.appRole.findFirstOrThrow({ where: { companyId: companyAId, key: 'OWNER' } });
    expect(owner.roleId).toBe(ownerRole.id);
    expect(owner.role).toBe('OWNER'); // legacy enum untouched
  });

  it('is tenant-safe: a second company gets its OWN roles, never company A’s', async () => {
    const companyB = await prisma.company.create({ data: { name: `RBAC B ${stamp}`, slug: `rbac-b-${stamp}` } });
    cleanup.companyBId = companyB.id;
    const userB = await prisma.user.create({
      data: { companyId: companyB.id, name: 'B Manager', email: `rbac.b.${stamp}@e2e.test`, role: 'MANAGER', passwordHash: 'seed-test-hash', isActive: true },
    });
    cleanup.userBId = userB.id;

    const res = await seedRbac(prisma);
    expect(res.usersBackfilled).toBeGreaterThanOrEqual(1); // at least userB

    const bRoles = await prisma.appRole.findMany({ where: { companyId: companyB.id } });
    expect(bRoles.length).toBe(5);
    const bManager = bRoles.find((r) => r.key === 'MANAGER')!;
    const reloadedB = await prisma.user.findUniqueOrThrow({ where: { id: userB.id } });
    expect(reloadedB.roleId).toBe(bManager.id);
    expect(bManager.companyId).toBe(companyB.id); // not company A

    // Company A owner assignment is unaffected by seeding company B.
    const ownerA = await prisma.user.findUniqueOrThrow({ where: { email } });
    const aOwnerRole = await prisma.appRole.findFirstOrThrow({ where: { companyId: companyAId, key: 'OWNER' } });
    expect(ownerA.roleId).toBe(aOwnerRole.id);
    // userB must NOT have been assigned any company-A role.
    expect(bRoles.some((r) => r.id === reloadedB.roleId)).toBe(true);
    expect(reloadedB.roleId).not.toBe(aOwnerRole.id);
  });
});
