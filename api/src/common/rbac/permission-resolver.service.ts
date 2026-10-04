import { Injectable } from '@nestjs/common';
import { PERMISSION_KEYS, Role, type AuthUser } from '@azad/shared';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Resolves a user's effective permission key set for the (future) PermissionsGuard and /auth/me.
 *
 * OWNER is allow-all — it resolves to the ACTUAL full catalog (no "*" sentinel), so callers always
 * reason about real permission keys. Non-owners resolve from roleId → RolePermission → keys, cached
 * per roleId (roles are per-company and stable-keyed); callers invalidate on any permission change.
 *
 * Group 4 is infrastructure only: no endpoint consumes this yet. User.role / RolesGuard remain
 * authoritative, so this never affects an authorization decision for an existing endpoint.
 */
@Injectable()
export class PermissionResolver {
  private readonly cache = new Map<string, Set<string>>();

  constructor(private readonly prisma: PrismaService) {}

  /** Effective permissions for a user (OWNER → the full catalog). */
  async resolve(user: Pick<AuthUser, 'id' | 'role'>): Promise<Set<string>> {
    if (user.role === Role.OWNER) return new Set(PERMISSION_KEYS);
    const row = await this.prisma.user.findUnique({ where: { id: user.id }, select: { roleId: true } });
    if (!row?.roleId) return new Set();
    return this.permissionsForRole(row.roleId);
  }

  /** Cached permission keys granted by a role. */
  async permissionsForRole(roleId: string): Promise<Set<string>> {
    const cached = this.cache.get(roleId);
    if (cached) return cached;
    const rows = await this.prisma.rolePermission.findMany({
      where: { roleId },
      select: { permission: { select: { key: true } } },
    });
    const set = new Set(rows.map((r) => r.permission.key));
    this.cache.set(roleId, set);
    return set;
  }

  /** Drop a single role's cached permissions (call after its permissions change). */
  invalidate(roleId: string): void {
    this.cache.delete(roleId);
  }

  /** Drop the whole cache. */
  invalidateAll(): void {
    this.cache.clear();
  }
}
