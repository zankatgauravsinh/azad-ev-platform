import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type AppRole } from '@prisma/client';
import {
  ActivityAction,
  Role,
  buildPageMeta,
  isPermissionKey,
  type CreateRoleInput,
  type DuplicateRoleInput,
  type ListRolesQuery,
  type Paginated,
  type RoleDetail,
  type RoleListItem,
} from '@azad/shared';
import { RoleRepository } from './role.repository';
import { ActivityLogService } from '../../activity-log/activity-log.service';
import { PermissionResolver } from '../../common/rbac/permission-resolver.service';

/** Authenticated caller — always derived from the JWT/DB user, never from client input. */
export interface RoleActor {
  id: string;
  role: Role;
  companyId: string;
}

/**
 * Internal combined update input. The HTTP PATCH contract (shared `updateRoleSchema`) only carries
 * name/description — permissions are replaced via PUT /roles/:id/permissions, which calls
 * updatePermissions() → update() with `permissionKeys`. This type keeps that combined path usable
 * internally without exposing a second permission channel over HTTP.
 */
export interface UpdateRoleData {
  name?: string;
  description?: string | null;
  permissionKeys?: string[];
}

/**
 * Business layer for dynamic Role management (Group 3A — service only, no HTTP).
 *
 * Authorization here still uses the EXISTING role enum: every operation is OWNER-only via
 * assertOwner(actor). This does NOT introduce RBAC authorization — User.role / @Roles / RolesGuard
 * remain authoritative elsewhere. Tenant isolation relies on the Prisma tenant middleware plus
 * read-before-write (loadOrThrow), so a cross-company role id is simply NotFound.
 */
@Injectable()
export class RoleService {
  constructor(
    private readonly repo: RoleRepository,
    private readonly activityLog: ActivityLogService,
    private readonly permissions: PermissionResolver,
  ) {}

  async list(actor: RoleActor, query: ListRolesQuery): Promise<Paginated<RoleListItem>> {
    this.assertOwner(actor);
    const where: Prisma.AppRoleWhereInput = { deletedAt: null };
    if (query.type === 'system') where.isSystem = true;
    if (query.type === 'custom') where.isSystem = false;
    if (query.q) where.name = { contains: query.q, mode: 'insensitive' };

    const [rows, total] = await Promise.all([
      this.repo.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: { createdAt: query.order ?? 'desc' },
      }),
      this.repo.count(where),
    ]);
    const ids = rows.map((r) => r.id);
    const [permCounts, userCounts] = await Promise.all([
      this.repo.permissionCountByRole(ids),
      this.repo.userCountByRole(ids),
    ]);
    const data = rows.map((r) => this.toListItem(r, permCounts.get(r.id) ?? 0, userCounts.get(r.id) ?? 0));
    return { data, meta: buildPageMeta(query.page, query.pageSize, total) };
  }

  async get(actor: RoleActor, id: string): Promise<RoleDetail> {
    this.assertOwner(actor);
    const role = await this.loadOrThrow(id);
    const [permissionKeys, assignedUserCount] = await Promise.all([
      this.repo.findPermissionKeys(id),
      this.repo.countAssignedUsers(id),
    ]);
    return this.toDetail(role, permissionKeys, assignedUserCount);
  }

  async create(actor: RoleActor, input: CreateRoleInput): Promise<RoleDetail> {
    this.assertOwner(actor);
    const name = this.normalizeName(input.name);
    await this.assertNameAvailable(name);
    const description = this.normalizeDescription(input.description);
    const permissionIds = await this.resolvePermissionIds(input.permissionKeys);

    const role = await this.repo.create(
      { companyId: actor.companyId, key: null, name, description, isSystem: false, isProtected: false, createdById: actor.id, updatedById: actor.id },
      permissionIds,
    );
    this.permissions.invalidate(role.id);
    const permissionKeys = [...new Set(input.permissionKeys)];
    await this.audit(actor, ActivityAction.CREATE, role, `Created role ${role.name}`, { event: 'ROLE_CREATED', name: role.name, type: 'custom', permissionKeys });
    return this.toDetail(role, permissionKeys, 0);
  }

  async update(actor: RoleActor, id: string, input: UpdateRoleData): Promise<RoleDetail> {
    this.assertOwner(actor);
    const role = await this.loadOrThrow(id);
    this.assertCustom(role);

    const data: Prisma.AppRoleUpdateInput = { updatedById: actor.id };
    const changed: string[] = [];
    if (input.name !== undefined) {
      const name = this.normalizeName(input.name);
      await this.assertNameAvailable(name, id);
      data.name = name;
      changed.push('name');
    }
    if (input.description !== undefined) {
      data.description = this.normalizeDescription(input.description);
      changed.push('description');
    }

    // Capture the before-set only when permissions are being replaced (for the diff audit).
    const replacingPermissions = input.permissionKeys !== undefined;
    const before = replacingPermissions ? await this.repo.findPermissionKeys(id) : [];
    const permissionIds = replacingPermissions ? await this.resolvePermissionIds(input.permissionKeys!) : undefined;

    const updated = await this.repo.update(id, data, permissionIds);
    if (replacingPermissions) this.permissions.invalidate(id);

    if (changed.length > 0) {
      await this.audit(actor, ActivityAction.UPDATE, updated, `Updated role ${updated.name}`, { event: 'ROLE_UPDATED', name: updated.name, changed });
    }
    if (replacingPermissions) {
      const after = [...new Set(input.permissionKeys)];
      await this.audit(actor, ActivityAction.UPDATE, updated, `Changed permissions for role ${updated.name}`, {
        event: 'ROLE_PERMISSIONS_CHANGED',
        name: updated.name,
        before: [...before].sort(),
        after: [...after].sort(),
      });
    }
    const permissionKeys = replacingPermissions ? [...new Set(input.permissionKeys)] : await this.repo.findPermissionKeys(id);
    return this.toDetail(updated, permissionKeys, await this.repo.countAssignedUsers(id));
  }

  /** Convenience: replace a custom role's permissions (complete-replacement semantics). */
  updatePermissions(actor: RoleActor, id: string, permissionKeys: string[]): Promise<RoleDetail> {
    return this.update(actor, id, { permissionKeys });
  }

  async duplicate(actor: RoleActor, id: string, input: DuplicateRoleInput): Promise<RoleDetail> {
    this.assertOwner(actor);
    const source = await this.loadOrThrow(id);
    if (source.isProtected || source.key === Role.OWNER) {
      throw new ForbiddenException('The OWNER role cannot be duplicated');
    }
    const name = this.normalizeName(input.name);
    await this.assertNameAvailable(name);
    const description = this.normalizeDescription(input.description);
    const permissionIds = await this.repo.findRolePermissionIds(id);

    const role = await this.repo.create(
      { companyId: actor.companyId, key: null, name, description, isSystem: false, isProtected: false, createdById: actor.id, updatedById: actor.id },
      permissionIds,
    );
    this.permissions.invalidate(role.id);
    const permissionKeys = await this.repo.findPermissionKeys(role.id);
    await this.audit(actor, ActivityAction.CREATE, role, `Duplicated role ${source.name} → ${role.name}`, {
      event: 'ROLE_DUPLICATED',
      name: role.name,
      duplicatedFromRoleId: source.id,
      duplicatedFromName: source.name,
      permissionKeys,
    });
    return this.toDetail(role, permissionKeys, 0);
  }

  async remove(actor: RoleActor, id: string): Promise<void> {
    this.assertOwner(actor);
    const role = await this.loadOrThrow(id);
    if (role.isSystem || role.isProtected) throw new ForbiddenException('System roles cannot be deleted');

    const assigned = await this.repo.countAssignedUsers(id);
    if (assigned > 0) {
      throw new ConflictException(`This role is assigned to ${assigned} user(s) — reassign them before deleting it`);
    }
    try {
      const deleted = await this.repo.deleteCustom(id);
      if (deleted !== 1) throw new NotFoundException('Role not found');
      this.permissions.invalidate(id);
    } catch (e) {
      // A user assigned between the count check and the delete trips the onDelete:Restrict FK.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003') {
        throw new ConflictException('This role was just assigned to a user — reassign before deleting it');
      }
      throw e;
    }
    await this.audit(actor, ActivityAction.DELETE, role, `Deleted role ${role.name}`, { event: 'ROLE_DELETED', name: role.name, type: 'custom' });
  }

  // ── internals ──
  private assertOwner(actor: RoleActor): void {
    if (actor.role !== Role.OWNER) throw new ForbiddenException('Only an owner can manage roles');
  }

  private assertCustom(role: AppRole): void {
    if (role.isSystem) throw new ForbiddenException('System roles cannot be modified');
  }

  private async loadOrThrow(id: string): Promise<AppRole> {
    // Tenant-scoped read: a role in another company reads back as null → NotFound (no leak).
    const role = await this.repo.findById(id);
    if (!role || role.deletedAt) throw new NotFoundException('Role not found');
    return role;
  }

  private normalizeName(raw: string): string {
    const name = raw.trim();
    if (name.length < 2) throw new BadRequestException('Role name must be at least 2 characters');
    if (name.length > 60) throw new BadRequestException('Role name must be at most 60 characters');
    return name;
  }

  private normalizeDescription(raw?: string | null): string | null {
    if (raw === undefined || raw === null) return null;
    const d = raw.trim();
    if (d.length > 200) throw new BadRequestException('Description must be at most 200 characters');
    return d.length === 0 ? null : d;
  }

  /** Case-insensitive, company-scoped uniqueness (system-role names are reserved by their rows). */
  private async assertNameAvailable(name: string, excludeId?: string): Promise<void> {
    const existing = await this.repo.findByNameInsensitive(name);
    if (existing && existing.id !== excludeId) throw new ConflictException('A role with this name already exists');
  }

  /** Validate every key against the global catalog; unknown keys → BadRequest (never ignored). */
  private async resolvePermissionIds(keys: string[]): Promise<string[]> {
    const unique = [...new Set(keys)];
    if (unique.length === 0) return [];
    const unknownInCatalog = unique.filter((k) => !isPermissionKey(k));
    if (unknownInCatalog.length > 0) throw new BadRequestException(`Unknown permission(s): ${unknownInCatalog.join(', ')}`);
    const found = await this.repo.findPermissionsByKeys(unique);
    if (found.length !== unique.length) {
      const foundKeys = new Set(found.map((f) => f.key));
      const missing = unique.filter((k) => !foundKeys.has(k));
      throw new BadRequestException(`Unknown permission(s): ${missing.join(', ')}`);
    }
    return found.map((f) => f.id);
  }

  private audit(actor: RoleActor, action: ActivityAction, role: AppRole, summary: string, metadata: Prisma.InputJsonValue): Promise<void> {
    return this.activityLog.record({ actorId: actor.id, action, entityType: 'Role', entityId: role.id, summary, metadata });
  }

  private toListItem(role: AppRole, permissionCount: number, assignedUserCount: number): RoleListItem {
    return {
      id: role.id,
      name: role.name,
      description: role.description,
      isSystem: role.isSystem,
      isProtected: role.isProtected,
      assignedUserCount,
      permissionCount,
      createdAt: role.createdAt.toISOString(),
      updatedAt: role.updatedAt.toISOString(),
    };
  }

  private toDetail(role: AppRole, permissionKeys: string[], assignedUserCount: number): RoleDetail {
    return {
      id: role.id,
      name: role.name,
      description: role.description,
      isSystem: role.isSystem,
      isProtected: role.isProtected,
      assignedUserCount,
      permissionKeys,
      createdAt: role.createdAt.toISOString(),
      updatedAt: role.updatedAt.toISOString(),
    };
  }
}
