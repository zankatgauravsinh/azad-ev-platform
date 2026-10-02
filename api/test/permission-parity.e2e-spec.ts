import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PERMISSION_KEYS, SYSTEM_ROLE_PERMISSIONS, Role } from '@azad/shared';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { PermissionResolver } from '../src/common/rbac/permission-resolver.service';
import { RoleService, type RoleActor } from '../src/modules/roles/role.service';
import { seedRbac } from '../src/common/rbac/rbac-seed';

/**
 * Group 4 parity — the PermissionResolver (and the seeded data) reproduce the exact capability of
 * each fixed role, with the new inventory.dashboard/export behavior, OWNER allow-all, and custom
 * roles incl. cache invalidation. No endpoint is migrated; this is infrastructure parity only.
 */
describe('Permission resolver parity (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let resolver: PermissionResolver;
  let roleService: RoleService;
  const email = (process.env.SEED_OWNER_EMAIL ?? 'owner@azadev.in').toLowerCase();
  const stamp = Date.now().toString().slice(-8);
  let companyAId = '';
  let ownerId = '';
  let ownerActor: RoleActor;
  const createdUserIds: string[] = [];
  const createdRoleIds: string[] = [];
  const roleUserIds: Record<string, string> = {}; // enum role → a user's id (backfilled)

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
    prisma = app.get(PrismaService);
    resolver = app.get(PermissionResolver);
    roleService = app.get(RoleService);

    const owner = await prisma.user.findUniqueOrThrow({ where: { email } });
    companyAId = owner.companyId;
    ownerId = owner.id;
    ownerActor = { id: owner.id, role: Role.OWNER, companyId: companyAId };

    // One user per non-owner system role, then seed to backfill their roleId.
    for (const role of ['MANAGER', 'SALES_EXECUTIVE', 'TECHNICIAN', 'ACCOUNTANT'] as const) {
      const u = await prisma.user.create({
        data: { companyId: companyAId, name: `Parity ${role}`, email: `parity.${role.toLowerCase()}.${stamp}@e2e.test`, role, passwordHash: 'parity-hash', isActive: true },
      });
      createdUserIds.push(u.id);
      roleUserIds[role] = u.id;
    }
    await seedRbac(prisma); // creates the two inventory perms + backfills the new users' roleId
  }, 30000);

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await prisma.appRole.deleteMany({ where: { id: { in: createdRoleIds } } });
    await app.close();
  }, 30000);

  const sorted = (s: Iterable<string>): string[] => [...s].sort();

  it('resolves each system role to its exact seeded permission set', async () => {
    const owner = await resolver.resolve({ id: ownerId, role: Role.OWNER });
    expect(sorted(owner)).toEqual(sorted(SYSTEM_ROLE_PERMISSIONS[Role.OWNER]));

    for (const role of ['MANAGER', 'SALES_EXECUTIVE', 'TECHNICIAN', 'ACCOUNTANT'] as const) {
      const set = await resolver.resolve({ id: roleUserIds[role]!, role: role as Role });
      expect(sorted(set)).toEqual(sorted(SYSTEM_ROLE_PERMISSIONS[role as Role]));
    }
  });

  it('OWNER is allow-all (the full 73-key catalog)', async () => {
    const owner = await resolver.resolve({ id: ownerId, role: Role.OWNER });
    expect(owner.size).toBe(PERMISSION_KEYS.length);
    expect(owner.size).toBe(73);
  });

  it('enforces the inventory.view / dashboard / export boundary (Sales denied dashboard+export)', async () => {
    const owner = await resolver.resolve({ id: ownerId, role: Role.OWNER });
    const mgr = await resolver.resolve({ id: roleUserIds.MANAGER!, role: Role.MANAGER });
    const sales = await resolver.resolve({ id: roleUserIds.SALES_EXECUTIVE!, role: Role.SALES_EXECUTIVE });

    for (const set of [owner, mgr]) {
      expect(set.has('inventory.view')).toBe(true);
      expect(set.has('inventory.dashboard')).toBe(true);
      expect(set.has('inventory.export')).toBe(true);
    }
    expect(sales.has('inventory.view')).toBe(true);
    expect(sales.has('inventory.dashboard')).toBe(false);
    expect(sales.has('inventory.export')).toBe(false);
  });

  it('resolves custom roles by roleId (zero / one / many) regardless of the enum', async () => {
    const empty = await roleService.create(ownerActor, { name: `Empty ${stamp}`, permissionKeys: [] });
    const one = await roleService.create(ownerActor, { name: `One ${stamp}`, permissionKeys: ['customers.view'] });
    const many = await roleService.create(ownerActor, { name: `Many ${stamp}`, permissionKeys: ['customers.view', 'bookings.view', 'service.view'] });
    createdRoleIds.push(empty.id, one.id, many.id);

    // A user whose enum role is MANAGER but whose roleId is a custom role → resolves the CUSTOM set.
    const u = await prisma.user.create({ data: { companyId: companyAId, name: 'Custom U', email: `parity.custom.${stamp}@e2e.test`, role: 'MANAGER', passwordHash: 'h', isActive: true, roleId: one.id } });
    createdUserIds.push(u.id);

    expect((await resolver.permissionsForRole(empty.id)).size).toBe(0);
    expect(sorted(await resolver.resolve({ id: u.id, role: Role.MANAGER }))).toEqual(['customers.view']);
    expect((await resolver.permissionsForRole(many.id)).size).toBe(3);
  });

  it('refreshes the effective set after a role permission change (cache invalidation)', async () => {
    const role = await roleService.create(ownerActor, { name: `Mutable ${stamp}`, permissionKeys: ['customers.view'] });
    createdRoleIds.push(role.id);
    expect(sorted(await resolver.permissionsForRole(role.id))).toEqual(['customers.view']); // caches

    await roleService.updatePermissions(ownerActor, role.id, ['bookings.view', 'service.view']); // invalidates
    expect(sorted(await resolver.permissionsForRole(role.id))).toEqual(['bookings.view', 'service.view']);
  });
});
