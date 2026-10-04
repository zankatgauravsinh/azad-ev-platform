import { Role as PrismaRole, type PrismaClient } from '@prisma/client';
import { PERMISSIONS, SYSTEM_ROLES, SYSTEM_ROLE_PERMISSIONS } from '@azad/shared';

export interface RbacSeedResult {
  permissions: number;
  companies: number;
  rolesUpserted: number;
  rolePermissions: number;
  usersBackfilled: number;
}

/**
 * Idempotently seeds the RBAC foundation and backfills users (Group 2):
 *  1. upsert the global Permission catalog (by key),
 *  2. upsert the five locked system roles per company (by companyId+name),
 *  3. assign each system role its exact permission bundle (by composite PK),
 *  4. backfill User.roleId for legacy users whose roleId is still NULL, within their OWN company
 *     (never cross-company, and never overwriting an existing non-null — system or custom — assignment).
 *
 * Does NOT change authorization behavior: User.role / @Roles / RolesGuard remain authoritative.
 * Safe to run repeatedly — a second run creates nothing new and backfills zero users.
 */
export async function seedRbac(prisma: PrismaClient): Promise<RbacSeedResult> {
  // 1. Permission catalog (global, system-defined).
  for (let i = 0; i < PERMISSIONS.length; i++) {
    const p = PERMISSIONS[i]!;
    const data = { module: p.module, action: p.action, label: p.label, isDangerous: p.isDangerous, sortOrder: i };
    await prisma.permission.upsert({ where: { key: p.key }, create: { key: p.key, ...data }, update: data });
  }
  const permissionIdByKey = new Map(
    (await prisma.permission.findMany({ select: { id: true, key: true } })).map((p) => [p.key, p.id]),
  );

  const companies = await prisma.company.findMany({ select: { id: true } });
  let rolesUpserted = 0;
  let rolePermissions = 0;
  let usersBackfilled = 0;

  for (const { id: companyId } of companies) {
    // 2. Five locked system roles for this company.
    const roleIdByKey = new Map<string, string>();
    for (const def of SYSTEM_ROLES) {
      const role = await prisma.appRole.upsert({
        where: { companyId_name: { companyId, name: def.name } },
        create: { companyId, key: def.key, name: def.name, isSystem: true, isProtected: def.isProtected },
        update: { key: def.key, isSystem: true, isProtected: def.isProtected },
      });
      roleIdByKey.set(def.key, role.id);
      rolesUpserted += 1;
    }

    // 3. Exact permission bundle per system role.
    for (const def of SYSTEM_ROLES) {
      const roleId = roleIdByKey.get(def.key)!;
      for (const key of SYSTEM_ROLE_PERMISSIONS[def.key]) {
        const permissionId = permissionIdByKey.get(key);
        if (!permissionId) throw new Error(`System-role mapping references unknown permission key: ${key}`);
        await prisma.rolePermission.upsert({
          where: { roleId_permissionId: { roleId, permissionId } },
          create: { roleId, permissionId },
          update: {},
        });
        rolePermissions += 1;
      }
    }

    // 4. Tenant-safe backfill — assign the matching system role ONLY to legacy users of THIS company
    //    whose roleId is still NULL. A non-null roleId is an intentional assignment (a system role set
    //    by StaffService, or a custom role via the H1 roleId path) and is NEVER overwritten here —
    //    otherwise a deploy re-run would revert custom-role staff to their base system role. The FK
    //    (AppRole onDelete: Restrict) plus RoleService's delete-blocked-when-assigned rule guarantee a
    //    non-null roleId always points to a live role, so there is no stale/orphan roleId to repair.
    for (const def of SYSTEM_ROLES) {
      const roleId = roleIdByKey.get(def.key)!;
      const res = await prisma.user.updateMany({
        where: {
          companyId,
          role: def.key as unknown as PrismaRole,
          roleId: null,
        },
        data: { roleId },
      });
      usersBackfilled += res.count;
    }
  }

  return { permissions: PERMISSIONS.length, companies: companies.length, rolesUpserted, rolePermissions, usersBackfilled };
}
