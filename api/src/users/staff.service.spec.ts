import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma, type AppRole, type User } from '@prisma/client';
import { ActivityAction, type Role } from '@azad/shared';
import { StaffService, type StaffActor } from './staff.service';
import type { UsersRepository, UserWithRole } from './users.repository';
import type { PasswordService } from '../auth/password.service';
import type { ActivityLogService } from '../activity-log/activity-log.service';

const owner: StaffActor = { id: 'owner1', role: 'OWNER' as Role };
const manager: StaffActor = { id: 'mgr1', role: 'MANAGER' as Role };

const makeUser = (over: Partial<User> = {}): UserWithRole =>
  ({
    id: 'u1', companyId: 'c1', name: 'Asha', email: 'asha@x.in', phone: null,
    passwordHash: 'HASH', role: 'MANAGER', roleId: null, isActive: true, lastLoginAt: null, refreshTokenHash: 'r',
    createdById: null, updatedById: null, createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01'),
    roleRef: null,
    ...over,
  }) as UserWithRole;

const fakeRole = (over: Partial<AppRole> = {}): AppRole =>
  ({
    id: 'role1', companyId: 'c1', key: 'MANAGER', name: 'Manager', description: null,
    isSystem: true, isProtected: false, createdById: null, updatedById: null,
    createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01'), deletedAt: null,
    ...over,
  }) as AppRole;

describe('StaffService', () => {
  let repo: jest.Mocked<
    Pick<
      UsersRepository,
      'findByEmail' | 'findById' | 'create' | 'update' | 'findMany' | 'count' | 'countActiveOwners' | 'findSystemRoleByKey' | 'findRoleById'
    >
  >;
  let passwords: jest.Mocked<Pick<PasswordService, 'hash'>>;
  let activityLog: jest.Mocked<Pick<ActivityLogService, 'record'>>;
  let service: StaffService;

  beforeEach(() => {
    repo = {
      findByEmail: jest.fn().mockResolvedValue(null),
      findById: jest.fn(),
      create: jest.fn().mockImplementation(async (data: Prisma.UserUncheckedCreateInput) => makeUser(data as Partial<User>)),
      update: jest.fn().mockImplementation(async (id: string, data: Prisma.UserUpdateInput) => makeUser({ id, ...(data as Partial<User>) })),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      countActiveOwners: jest.fn().mockResolvedValue(2),
      // Seeded system role for an enum (tenant-scoped in the real repo); custom roleId lookups opt in per test.
      findSystemRoleByKey: jest.fn().mockImplementation(async (key: string) => fakeRole({ id: `role-${key}`, key, isProtected: key === 'OWNER' })),
      findRoleById: jest.fn().mockResolvedValue(null),
    };
    passwords = { hash: jest.fn().mockResolvedValue('HASHED') };
    activityLog = { record: jest.fn().mockResolvedValue(undefined) };
    service = new StaffService(repo as unknown as UsersRepository, passwords as unknown as PasswordService, activityLog as unknown as ActivityLogService);
  });

  const validCreate = { name: 'Asha', email: 'ASHA@X.in', phone: '9876543210', role: 'MANAGER' as Role, password: 'Abcd1234' };

  describe('authorization (OWNER-only)', () => {
    it('rejects a non-owner for every operation', async () => {
      await expect(service.create(manager, validCreate)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.list(manager, { page: 1, pageSize: 20, order: 'desc' })).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.get(manager, 'u1')).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.update(manager, 'u1', { name: 'X' })).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.setActive(manager, 'u1', false)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.resetPassword(manager, 'u1', { password: 'Abcd1234' })).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('allows an owner to create', async () => {
      await expect(service.create(owner, validCreate)).resolves.toBeDefined();
    });
  });

  describe('tenant isolation (cross-company target reads back as null → NotFound)', () => {
    beforeEach(() => repo.findById.mockResolvedValue(null));
    it('get/update/setActive/resetPassword all 404 for an out-of-company id', async () => {
      await expect(service.get(owner, 'other')).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.update(owner, 'other', { name: 'X' })).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.setActive(owner, 'other', false)).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.resetPassword(owner, 'other', { password: 'Abcd1234' })).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('create', () => {
    it('hashes the password, lowercases email, defaults active, never persists plaintext', async () => {
      const dto = await service.create(owner, validCreate);
      expect(passwords.hash).toHaveBeenCalledWith('Abcd1234');
      const data = repo.create.mock.calls[0]![0];
      expect(data.email).toBe('asha@x.in');
      expect(data.passwordHash).toBe('HASHED');
      expect(data.isActive).toBe(true);
      expect(data.createdById).toBe('owner1');
      expect(JSON.stringify(data)).not.toContain('Abcd1234'); // plaintext never stored
      expect((dto as unknown as Record<string, unknown>).passwordHash).toBeUndefined();
      expect((dto as unknown as Record<string, unknown>).refreshTokenHash).toBeUndefined();
    });

    it('assigns the enum’s system roleId atomically with the row (H1)', async () => {
      await service.create(owner, validCreate); // role: MANAGER
      expect(repo.findSystemRoleByKey).toHaveBeenCalledWith('MANAGER');
      const data = repo.create.mock.calls[0]![0];
      expect(data.roleId).toBe('role-MANAGER'); // dynamic role wired, not just the enum
      expect(data.role).toBe('MANAGER'); // legacy enum kept in sync
    });

    it('honours an explicit custom roleId and keeps the legacy enum', async () => {
      repo.findRoleById.mockResolvedValue(fakeRole({ id: 'custom1', key: null, isSystem: false }));
      await service.create(owner, { ...validCreate, roleId: 'custom1' });
      expect(repo.findRoleById).toHaveBeenCalledWith('custom1');
      const data = repo.create.mock.calls[0]![0];
      expect(data.roleId).toBe('custom1');
      expect(data.role).toBe('MANAGER'); // base enum from the DTO (a custom role has no enum)
    });

    it('rejects an unknown / cross-company roleId (invisible → not found)', async () => {
      repo.findRoleById.mockResolvedValue(null);
      await expect(service.create(owner, { ...validCreate, roleId: 'other-co-role' })).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('rejects a soft-deleted roleId', async () => {
      repo.findRoleById.mockResolvedValue(fakeRole({ id: 'custom1', key: null, isSystem: false, deletedAt: new Date() }));
      await expect(service.create(owner, { ...validCreate, roleId: 'custom1' })).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('fails loudly when RBAC is not initialized for the company (no role-less user created)', async () => {
      repo.findSystemRoleByKey.mockResolvedValue(null);
      await expect(service.create(owner, validCreate)).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('rejects a duplicate email (in-company) with a clean error', async () => {
      repo.findByEmail.mockResolvedValue(makeUser());
      await expect(service.create(owner, validCreate)).rejects.toBeInstanceOf(ConflictException);
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('maps the global unique-constraint violation (P2002) to a clean conflict', async () => {
      repo.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '5' }));
      await expect(service.create(owner, validCreate)).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('update', () => {
    it('updates name/phone/role and never touches email or company', async () => {
      repo.findById.mockResolvedValue(makeUser({ role: 'SALES_EXECUTIVE' }));
      await service.update(owner, 'u1', { name: 'Asha R', phone: '900', role: 'TECHNICIAN' });
      const data = repo.update.mock.calls[0]![1] as Record<string, unknown>;
      expect(data.name).toBe('Asha R');
      expect(data.phone).toBe('900');
      expect(data.role).toBe('TECHNICIAN');
      expect(data.email).toBeUndefined();
      expect(data.companyId).toBeUndefined();
      expect(data.passwordHash).toBeUndefined();
      expect(data.isActive).toBeUndefined();
    });

    it('promotes a non-owner to OWNER', async () => {
      repo.findById.mockResolvedValue(makeUser({ role: 'MANAGER' }));
      await expect(service.update(owner, 'u1', { role: 'OWNER' })).resolves.toBeDefined();
    });

    it('a role change moves roleId to the enum’s system role (H1)', async () => {
      repo.findById.mockResolvedValue(makeUser({ role: 'SALES_EXECUTIVE' }));
      await service.update(owner, 'u1', { role: 'TECHNICIAN' });
      const data = repo.update.mock.calls[0]![1] as Record<string, unknown>;
      expect(data.roleRef).toEqual({ connect: { id: 'role-TECHNICIAN' } });
      expect(data.role).toBe('TECHNICIAN');
    });

    it('assigns an explicit custom roleId without touching the legacy enum', async () => {
      repo.findById.mockResolvedValue(makeUser({ role: 'SALES_EXECUTIVE' }));
      repo.findRoleById.mockResolvedValue(fakeRole({ id: 'custom1', key: null, isSystem: false }));
      await service.update(owner, 'u1', { roleId: 'custom1' });
      const data = repo.update.mock.calls[0]![1] as Record<string, unknown>;
      expect(data.roleRef).toEqual({ connect: { id: 'custom1' } });
      expect(data.role).toBeUndefined(); // custom role has no enum → legacy value untouched
    });

    it('blocks demoting the last active owner via a custom roleId too', async () => {
      repo.findById.mockResolvedValue(makeUser({ id: 'u1', role: 'OWNER', isActive: true }));
      repo.countActiveOwners.mockResolvedValue(1);
      repo.findRoleById.mockResolvedValue(fakeRole({ id: 'custom1', key: null, isSystem: false })); // not an owner role
      await expect(service.update(owner, 'u1', { roleId: 'custom1' })).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('self-protection', () => {
    it('owner cannot deactivate themselves', async () => {
      repo.findById.mockResolvedValue(makeUser({ id: 'owner1', role: 'OWNER' }));
      await expect(service.setActive(owner, 'owner1', false)).rejects.toBeInstanceOf(ForbiddenException);
    });
    it('owner cannot demote themselves', async () => {
      repo.findById.mockResolvedValue(makeUser({ id: 'owner1', role: 'OWNER' }));
      await expect(service.update(owner, 'owner1', { role: 'MANAGER' })).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('last active owner protection', () => {
    it('cannot deactivate the last active owner', async () => {
      repo.findById.mockResolvedValue(makeUser({ id: 'u1', role: 'OWNER', isActive: true }));
      repo.countActiveOwners.mockResolvedValue(1);
      await expect(service.setActive(owner, 'u1', false)).rejects.toBeInstanceOf(BadRequestException);
    });
    it('cannot demote the last active owner', async () => {
      repo.findById.mockResolvedValue(makeUser({ id: 'u1', role: 'OWNER', isActive: true }));
      repo.countActiveOwners.mockResolvedValue(1);
      await expect(service.update(owner, 'u1', { role: 'MANAGER' })).rejects.toBeInstanceOf(BadRequestException);
    });
    it('can deactivate an owner when another active owner remains', async () => {
      repo.findById.mockResolvedValue(makeUser({ id: 'u1', role: 'OWNER', isActive: true }));
      repo.countActiveOwners.mockResolvedValue(2);
      await expect(service.setActive(owner, 'u1', false)).resolves.toBeDefined();
    });
    it('allows demoting an already-inactive owner (not part of the active count)', async () => {
      repo.findById.mockResolvedValue(makeUser({ id: 'u1', role: 'OWNER', isActive: false }));
      repo.countActiveOwners.mockResolvedValue(1);
      await expect(service.update(owner, 'u1', { role: 'MANAGER' })).resolves.toBeDefined();
    });
  });

  describe('activation', () => {
    it('deactivation sets isActive=false and clears refreshTokenHash', async () => {
      repo.findById.mockResolvedValue(makeUser({ id: 'u1', role: 'MANAGER' }));
      await service.setActive(owner, 'u1', false);
      expect(repo.update).toHaveBeenCalledWith('u1', expect.objectContaining({ isActive: false, refreshTokenHash: null }));
    });
    it('reactivation sets isActive=true without clearing password/refresh', async () => {
      repo.findById.mockResolvedValue(makeUser({ id: 'u1', role: 'MANAGER', isActive: false }));
      await service.setActive(owner, 'u1', true);
      const data = repo.update.mock.calls[0]![1] as Record<string, unknown>;
      expect(data.isActive).toBe(true);
      expect(data.passwordHash).toBeUndefined();
      expect('refreshTokenHash' in data).toBe(false);
    });
  });

  describe('admin password reset', () => {
    it('hashes, clears refreshTokenHash, never returns the hash', async () => {
      repo.findById.mockResolvedValue(makeUser({ id: 'u1', role: 'MANAGER' }));
      const dto = await service.resetPassword(owner, 'u1', { password: 'NewPass123' });
      expect(passwords.hash).toHaveBeenCalledWith('NewPass123');
      expect(repo.update).toHaveBeenCalledWith('u1', expect.objectContaining({ passwordHash: 'HASHED', refreshTokenHash: null }));
      expect((dto as unknown as Record<string, unknown>).passwordHash).toBeUndefined();
    });
    it('rejects an owner resetting their own password here', async () => {
      repo.findById.mockResolvedValue(makeUser({ id: 'owner1', role: 'OWNER' }));
      await expect(service.resetPassword(owner, 'owner1', { password: 'NewPass123' })).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('role exposure (StaffDto.roleId / roleName)', () => {
    it('exposes the assigned roleId and the AppRole display name', async () => {
      repo.findById.mockResolvedValue({ ...makeUser({ roleId: 'custom1' }), roleRef: { name: 'Front Desk' } });
      const dto = await service.get(owner, 'u1');
      expect(dto.roleId).toBe('custom1');
      expect(dto.roleName).toBe('Front Desk');
    });

    it('returns null role name when no AppRole relation is present', async () => {
      repo.findById.mockResolvedValue(makeUser({ roleId: null }));
      const dto = await service.get(owner, 'u1');
      expect(dto.roleId).toBeNull();
      expect(dto.roleName).toBeNull();
    });
  });

  describe('audit', () => {
    // The last audit record written (the service records exactly one per successful mutation).
    const lastAudit = () => activityLog.record.mock.calls.at(-1)![0];
    // No credential value — hash, cleared-session field name, or plaintext — may appear in ANY audit payload.
    const assertNoCredentialsInAudit = (): void => {
      const dump = JSON.stringify(activityLog.record.mock.calls);
      expect(dump).not.toContain('HASHED'); // mocked password hash
      expect(dump).not.toContain('passwordHash');
      expect(dump).not.toContain('refreshTokenHash');
      expect(dump).not.toContain('Abcd1234'); // create plaintext
      expect(dump).not.toContain('NewPass123'); // reset plaintext
    };

    it('create → a single CREATE event on the User entity', async () => {
      await service.create(owner, validCreate);
      expect(activityLog.record).toHaveBeenCalledTimes(1);
      const rec = lastAudit();
      expect(rec.action).toBe(ActivityAction.CREATE);
      expect(rec.entityType).toBe('User');
      expect(rec.actorId).toBe(owner.id);
      assertNoCredentialsInAudit();
    });

    it('update details → a single UPDATE event on the User entity', async () => {
      repo.findById.mockResolvedValue(makeUser({ id: 'u1', role: 'MANAGER' }));
      await service.update(owner, 'u1', { name: 'Asha R', phone: '900' });
      expect(activityLog.record).toHaveBeenCalledTimes(1);
      const rec = lastAudit();
      expect(rec.action).toBe(ActivityAction.UPDATE);
      expect(rec.entityType).toBe('User');
      expect(rec.entityId).toBe('u1');
      assertNoCredentialsInAudit();
    });

    it('role change → an UPDATE event with no credential values in the payload', async () => {
      repo.findById.mockResolvedValue(makeUser({ id: 'u1', role: 'SALES_EXECUTIVE' }));
      await service.update(owner, 'u1', { role: 'TECHNICIAN' });
      expect(activityLog.record).toHaveBeenCalledTimes(1);
      expect(lastAudit().action).toBe(ActivityAction.UPDATE);
      expect(lastAudit().entityType).toBe('User');
      assertNoCredentialsInAudit();
    });

    it('deactivate → a single STATUS_CHANGE event on the User entity', async () => {
      repo.findById.mockResolvedValue(makeUser({ id: 'u1', role: 'MANAGER', isActive: true }));
      await service.setActive(owner, 'u1', false);
      expect(activityLog.record).toHaveBeenCalledTimes(1);
      const rec = lastAudit();
      expect(rec.action).toBe(ActivityAction.STATUS_CHANGE);
      expect(rec.entityType).toBe('User');
      assertNoCredentialsInAudit();
    });

    it('reactivate → a single STATUS_CHANGE event on the User entity', async () => {
      repo.findById.mockResolvedValue(makeUser({ id: 'u1', role: 'MANAGER', isActive: false }));
      await service.setActive(owner, 'u1', true);
      expect(activityLog.record).toHaveBeenCalledTimes(1);
      const rec = lastAudit();
      expect(rec.action).toBe(ActivityAction.STATUS_CHANGE);
      expect(rec.entityType).toBe('User');
      assertNoCredentialsInAudit();
    });

    it('admin password reset → an UPDATE event with no credential values in the payload', async () => {
      repo.findById.mockResolvedValue(makeUser({ id: 'u1', role: 'MANAGER' }));
      await service.resetPassword(owner, 'u1', { password: 'NewPass123' });
      expect(activityLog.record).toHaveBeenCalledTimes(1);
      const rec = lastAudit();
      expect(rec.action).toBe(ActivityAction.UPDATE);
      expect(rec.entityType).toBe('User');
      assertNoCredentialsInAudit();
    });

    it('records the full mutation lifecycle in order, all against the User entity, with no secrets', async () => {
      repo.findById.mockResolvedValue(makeUser({ id: 'u1', role: 'MANAGER' }));
      await service.create(owner, validCreate);
      await service.update(owner, 'u1', { name: 'X' });
      await service.setActive(owner, 'u1', false);
      await service.resetPassword(owner, 'u1', { password: 'NewPass123' });
      const actions = activityLog.record.mock.calls.map((c) => c[0].action);
      expect(actions).toEqual([
        ActivityAction.CREATE,
        ActivityAction.UPDATE,
        ActivityAction.STATUS_CHANGE,
        ActivityAction.UPDATE,
      ]);
      expect(activityLog.record.mock.calls.every((c) => c[0].entityType === 'User')).toBe(true);
      assertNoCredentialsInAudit();
    });
  });
});
