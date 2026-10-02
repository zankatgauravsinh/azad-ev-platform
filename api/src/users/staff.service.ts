import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type User } from '@prisma/client';
import {
  ActivityAction,
  Role,
  buildPageMeta,
  type CreateStaffInput,
  type ListStaffQuery,
  type Paginated,
  type ResetStaffPasswordInput,
  type StaffDto,
  type UpdateStaffInput,
} from '@azad/shared';
import { UsersRepository } from './users.repository';
import { PasswordService } from '../auth/password.service';
import { ActivityLogService } from '../activity-log/activity-log.service';

export interface StaffActor {
  id: string;
  role: Role;
}

/**
 * Staff management service (OWNER-only). Tenant isolation is provided by the Prisma tenant
 * middleware: UsersRepository reads/creates are auto-scoped to the caller's company (findById
 * rewrites to findFirst + companyId, create injects companyId), so a cross-company target is
 * simply invisible → NotFound. companyId is never accepted from the client.
 *
 * Authorization is enforced here (assertOwner) as the authoritative check; the Group 3
 * controller will additionally carry @Roles(Role.OWNER) as defense-in-depth.
 */
@Injectable()
export class StaffService {
  constructor(
    private readonly repo: UsersRepository,
    private readonly passwords: PasswordService,
    private readonly activityLog: ActivityLogService,
  ) {}

  async create(actor: StaffActor, dto: CreateStaffInput): Promise<StaffDto> {
    this.assertOwner(actor);
    const email = dto.email.trim().toLowerCase();
    // Clean duplicate check within the company; the global unique index is the final backstop.
    if (await this.repo.findByEmail(email)) {
      throw new ConflictException('A user with this email already exists');
    }
    const passwordHash = await this.passwords.hash(dto.password);
    let user: User;
    try {
      user = await this.repo.create({
        name: dto.name,
        email,
        phone: dto.phone ?? null,
        role: dto.role,
        passwordHash,
        isActive: true,
        createdById: actor.id,
        updatedById: actor.id,
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('A user with this email already exists');
      }
      throw e;
    }
    await this.audit(actor, ActivityAction.CREATE, user, `Created staff ${user.name} (${user.role})`);
    return StaffService.toDto(user);
  }

  async list(actor: StaffActor, query: ListStaffQuery): Promise<Paginated<StaffDto>> {
    this.assertOwner(actor);
    const where: Prisma.UserWhereInput = {};
    if (query.role) where.role = query.role;
    if (query.isActive !== undefined) where.isActive = query.isActive;
    if (query.q) {
      where.OR = [
        { name: { contains: query.q, mode: 'insensitive' } },
        { email: { contains: query.q, mode: 'insensitive' } },
      ];
    }
    const [rows, total] = await Promise.all([
      this.repo.findMany({ where, skip: (query.page - 1) * query.pageSize, take: query.pageSize, orderBy: { createdAt: query.order } }),
      this.repo.count(where),
    ]);
    return { data: rows.map((u) => StaffService.toDto(u)), meta: buildPageMeta(query.page, query.pageSize, total) };
  }

  async get(actor: StaffActor, id: string): Promise<StaffDto> {
    this.assertOwner(actor);
    return StaffService.toDto(await this.loadOrThrow(id));
  }

  async update(actor: StaffActor, id: string, dto: UpdateStaffInput): Promise<StaffDto> {
    this.assertOwner(actor);
    const target = await this.loadOrThrow(id);

    const demotingOwner = dto.role !== undefined && target.role === Role.OWNER && dto.role !== Role.OWNER;
    if (demotingOwner) {
      if (target.id === actor.id) throw new ForbiddenException('You cannot change your own role');
      await this.assertNotLastActiveOwner(target, 'demote');
    }

    const data: Prisma.UserUpdateInput = { updatedById: actor.id };
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.phone !== undefined) data.phone = dto.phone;
    if (dto.role !== undefined) data.role = dto.role;
    const updated = await this.repo.update(id, data);

    const roleChanged = dto.role !== undefined && dto.role !== target.role;
    await this.audit(actor, ActivityAction.UPDATE, updated, roleChanged ? `Updated staff ${updated.name}; role ${target.role} → ${updated.role}` : `Updated staff ${updated.name}`);
    return StaffService.toDto(updated);
  }

  async setActive(actor: StaffActor, id: string, isActive: boolean): Promise<StaffDto> {
    this.assertOwner(actor);
    const target = await this.loadOrThrow(id);

    if (!isActive) {
      if (target.id === actor.id) throw new ForbiddenException('You cannot deactivate your own account');
      if (target.role === Role.OWNER) await this.assertNotLastActiveOwner(target, 'deactivate');
    }

    // Deactivation also kills the refresh session; JwtStrategy already blocks inactive users per request.
    const updated = await this.repo.update(id, isActive ? { isActive: true, updatedById: actor.id } : { isActive: false, refreshTokenHash: null, updatedById: actor.id });
    await this.audit(actor, ActivityAction.STATUS_CHANGE, updated, `${isActive ? 'Activated' : 'Deactivated'} staff ${updated.name}`);
    return StaffService.toDto(updated);
  }

  async resetPassword(actor: StaffActor, id: string, dto: ResetStaffPasswordInput): Promise<StaffDto> {
    this.assertOwner(actor);
    const target = await this.loadOrThrow(id);
    // An owner changes their own password via the self-service Change Password flow, not here.
    if (target.id === actor.id) throw new BadRequestException('Use Change Password to update your own password');
    const passwordHash = await this.passwords.hash(dto.password);
    // Clearing refreshTokenHash invalidates the target's existing sessions.
    const updated = await this.repo.update(id, { passwordHash, refreshTokenHash: null, updatedById: actor.id });
    await this.audit(actor, ActivityAction.UPDATE, updated, `Reset password for staff ${updated.name}`);
    return StaffService.toDto(updated);
  }

  // ── internals ──
  private assertOwner(actor: StaffActor): void {
    if (actor.role !== Role.OWNER) throw new ForbiddenException('Only an owner can manage staff');
  }

  private async loadOrThrow(id: string): Promise<User> {
    // Tenant-scoped: a user in another company reads back as null → NotFound (no cross-tenant leak).
    const user = await this.repo.findById(id);
    if (!user) throw new NotFoundException('Staff member not found');
    return user;
  }

  /**
   * Blocks an operation that would drop the company to zero active OWNERs.
   * LIMITATION: the count-then-write is not atomic. Two concurrent demotions/deactivations of
   * two different active owners could each observe ≥2 and both proceed, leaving zero. For this
   * single-owner small-dealer context the window is negligible; a future hardening would wrap
   * the check + write in a transaction with row locks (SELECT … FOR UPDATE) or a DB constraint/trigger.
   */
  private async assertNotLastActiveOwner(target: User, verb: string): Promise<void> {
    if (!target.isActive) return; // an already-inactive owner isn't part of the active count
    const activeOwners = await this.repo.countActiveOwners();
    if (activeOwners <= 1) throw new BadRequestException(`Cannot ${verb} the last active owner`);
  }

  private audit(actor: StaffActor, action: ActivityAction, user: User, summary: string): Promise<void> {
    // Never logs passwordHash / refreshTokenHash — only id + human summary.
    return this.activityLog.record({ actorId: actor.id, action, entityType: 'User', entityId: user.id, summary });
  }

  /** Client-safe projection — never leaks passwordHash / refreshTokenHash. */
  static toDto(user: User): StaffDto {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role as Role,
      isActive: user.isActive,
      lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
      createdAt: user.createdAt.toISOString(),
    };
  }
}
