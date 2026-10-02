import { Injectable } from '@nestjs/common';
import { Prisma, type AppRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Data access for dynamic roles (Group 3A). Tenant isolation comes from the Prisma tenant
 * middleware (AppRole is a tenant model): list/count/findFirst are auto-scoped to the caller's
 * company, and findById (findUnique → findFirst + companyId) reads a cross-company id back as null.
 * Single update/delete are NOT auto-scoped, so RoleService always reads-before-write (loadOrThrow)
 * or uses a guarded deleteMany (which IS scoped). Transactional writes use the project's
 * interactive-transaction convention.
 */
@Injectable()
export class RoleRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ── reads (tenant-scoped by middleware) ──
  findMany(args: {
    where?: Prisma.AppRoleWhereInput;
    skip?: number;
    take?: number;
    orderBy?: Prisma.AppRoleOrderByWithRelationInput;
  }): Promise<AppRole[]> {
    return this.prisma.appRole.findMany(args);
  }

  count(where?: Prisma.AppRoleWhereInput): Promise<number> {
    return this.prisma.appRole.count({ where });
  }

  findById(id: string): Promise<AppRole | null> {
    return this.prisma.appRole.findUnique({ where: { id } });
  }

  /** Case-insensitive name lookup within the company (for duplicate detection). */
  findByNameInsensitive(name: string): Promise<AppRole | null> {
    return this.prisma.appRole.findFirst({ where: { name: { equals: name, mode: 'insensitive' }, deletedAt: null } });
  }

  countAssignedUsers(roleId: string): Promise<number> {
    return this.prisma.user.count({ where: { roleId } });
  }

  async findPermissionKeys(roleId: string): Promise<string[]> {
    const rows = await this.prisma.rolePermission.findMany({
      where: { roleId },
      select: { permission: { select: { key: true } } },
    });
    return rows.map((r) => r.permission.key);
  }

  async findRolePermissionIds(roleId: string): Promise<string[]> {
    const rows = await this.prisma.rolePermission.findMany({ where: { roleId }, select: { permissionId: true } });
    return rows.map((r) => r.permissionId);
  }

  /** Resolve permission KEYS → {id,key} from the global catalog (Permission is not tenant-scoped). */
  findPermissionsByKeys(keys: string[]): Promise<{ id: string; key: string }[]> {
    return this.prisma.permission.findMany({ where: { key: { in: keys } }, select: { id: true, key: true } });
  }

  async permissionCountByRole(roleIds: string[]): Promise<Map<string, number>> {
    if (roleIds.length === 0) return new Map();
    const grouped = await this.prisma.rolePermission.groupBy({
      by: ['roleId'],
      where: { roleId: { in: roleIds } },
      _count: { roleId: true },
    });
    return new Map(grouped.map((g) => [g.roleId, g._count.roleId]));
  }

  async userCountByRole(roleIds: string[]): Promise<Map<string, number>> {
    if (roleIds.length === 0) return new Map();
    const grouped = await this.prisma.user.groupBy({
      by: ['roleId'],
      where: { roleId: { in: roleIds } },
      _count: { roleId: true },
    });
    return new Map(grouped.filter((g) => g.roleId).map((g) => [g.roleId as string, g._count.roleId]));
  }

  // ── transactional writes (interactive-transaction convention) ──
  /** Create a role and its RolePermission rows atomically. */
  create(data: Prisma.AppRoleUncheckedCreateInput, permissionIds: string[]): Promise<AppRole> {
    return this.prisma.$transaction(async (tx) => {
      const role = await tx.appRole.create({ data });
      if (permissionIds.length > 0) {
        await tx.rolePermission.createMany({ data: permissionIds.map((permissionId) => ({ roleId: role.id, permissionId })) });
      }
      return role;
    });
  }

  /**
   * Update role fields and, when `permissionIds` is provided, REPLACE its permission set atomically.
   * `permissionIds === undefined` leaves permissions untouched; `[]` removes all permissions.
   */
  update(id: string, data: Prisma.AppRoleUpdateInput, permissionIds?: string[]): Promise<AppRole> {
    return this.prisma.$transaction(async (tx) => {
      const role = await tx.appRole.update({ where: { id }, data });
      if (permissionIds !== undefined) {
        await tx.rolePermission.deleteMany({ where: { roleId: id } });
        if (permissionIds.length > 0) {
          await tx.rolePermission.createMany({ data: permissionIds.map((permissionId) => ({ roleId: id, permissionId })) });
        }
      }
      return role;
    });
  }

  /** Hard-delete a CUSTOM role only (guarded); RolePermission rows cascade. Returns rows affected. */
  async deleteCustom(id: string): Promise<number> {
    const res = await this.prisma.appRole.deleteMany({ where: { id, isSystem: false } });
    return res.count;
  }
}
