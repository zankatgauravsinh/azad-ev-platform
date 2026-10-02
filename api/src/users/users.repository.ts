import { Injectable } from '@nestjs/common';
import { AppRole, Prisma, Role, User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsersRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  }

  findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  update(id: string, data: Prisma.UserUpdateInput): Promise<User> {
    return this.prisma.user.update({ where: { id }, data });
  }

  // ── Staff management (companyId is injected/filtered by the tenant middleware) ──
  /** Create a staff user. companyId is supplied by the tenant middleware from the caller. */
  create(data: Prisma.UserUncheckedCreateInput): Promise<User> {
    return this.prisma.user.create({ data });
  }

  /** Paginated staff list, company-scoped by the tenant middleware. */
  findMany(args: {
    where?: Prisma.UserWhereInput;
    skip?: number;
    take?: number;
    orderBy?: Prisma.UserOrderByWithRelationInput;
  }): Promise<User[]> {
    return this.prisma.user.findMany(args);
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
