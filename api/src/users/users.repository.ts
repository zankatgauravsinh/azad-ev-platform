import { Injectable } from '@nestjs/common';
import { AppRole, Prisma, Role, User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * A user row with its assigned AppRole's display name eagerly loaded. Staff reads/writes return this
 * so StaffDto can show the real role name (system or custom) without a second query. The extra join
 * is a single indexed FK selecting one column; auth paths that consume these methods only read User
 * fields, so the wider type is harmless there.
 */
export type UserWithRole = User & { roleRef: { name: string } | null };
const withRole = { roleRef: { select: { name: true } } } satisfies Prisma.UserInclude;

@Injectable()
export class UsersRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  }

  findById(id: string): Promise<UserWithRole | null> {
    return this.prisma.user.findUnique({ where: { id }, include: withRole });
  }

  update(id: string, data: Prisma.UserUpdateInput): Promise<UserWithRole> {
    return this.prisma.user.update({ where: { id }, data, include: withRole });
  }

  // ── Staff management (companyId is injected/filtered by the tenant middleware) ──
  /** Create a staff user. companyId is supplied by the tenant middleware from the caller. */
  create(data: Prisma.UserUncheckedCreateInput): Promise<UserWithRole> {
    return this.prisma.user.create({ data, include: withRole });
  }

  /** Paginated staff list, company-scoped by the tenant middleware. */
  findMany(args: {
    where?: Prisma.UserWhereInput;
    skip?: number;
    take?: number;
    orderBy?: Prisma.UserOrderByWithRelationInput;
  }): Promise<UserWithRole[]> {
    return this.prisma.user.findMany({ ...args, include: withRole });
  }

  count(where?: Prisma.UserWhereInput): Promise<number> {
    return this.prisma.user.count({ where });
  }

  /** Active OWNERs in the current company — guards against removing/demoting the last one. */
  countActiveOwners(): Promise<number> {
    return this.prisma.user.count({ where: { role: Role.OWNER, isActive: true } });
  }

  // ── Role assignment lookups (AppRole is tenant-scoped by the middleware) ──
  /** The current company's seeded system role for a legacy enum (null if RBAC not yet initialized). */
  findSystemRoleByKey(key: Role): Promise<AppRole | null> {
    return this.prisma.appRole.findFirst({ where: { key, isSystem: true, deletedAt: null } });
  }

  /** An AppRole by id, visible only within the caller's company (findUnique → findFirst + companyId). */
  findRoleById(id: string): Promise<AppRole | null> {
    return this.prisma.appRole.findUnique({ where: { id } });
  }
}
