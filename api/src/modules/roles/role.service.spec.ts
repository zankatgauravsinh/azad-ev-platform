import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma, type AppRole } from '@prisma/client';
import { Role } from '@azad/shared';
import { RoleService, type RoleActor } from './role.service';
import type { RoleRepository } from './role.repository';
import type { ActivityLogService } from '../../activity-log/activity-log.service';
import type { PermissionResolver } from '../../common/rbac/permission-resolver.service';

const owner: RoleActor = { id: 'owner1', role: Role.OWNER, companyId: 'c1' };
const manager: RoleActor = { id: 'mgr1', role: Role.MANAGER, companyId: 'c1' };

const makeRole = (over: Partial<AppRole> = {}): AppRole =>
  ({
    id: 'r1', companyId: 'c1', key: null, name: 'Sales Manager', description: null,
    isSystem: false, isProtected: false, createdById: null, updatedById: null,
    createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01'), deletedAt: null,
    ...over,
  }) as AppRole;

describe('RoleService', () => {
  let repo: jest.Mocked<RoleRepository>;
  let activityLog: jest.Mocked<Pick<ActivityLogService, 'record'>>;
  let permissions: jest.Mocked<Pick<PermissionResolver, 'invalidate'>>;
  let service: RoleService;

  beforeEach(() => {
    repo = {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      findById: jest.fn().mockResolvedValue(makeRole()),
      findByNameInsensitive: jest.fn().mockResolvedValue(null),
      countAssignedUsers: jest.fn().mockResolvedValue(0),
      findPermissionKeys: jest.fn().mockResolvedValue([]),
      findRolePermissionIds: jest.fn().mockResolvedValue([]),
      findPermissionsByKeys: jest.fn().mockImplementation(async (keys: string[]) => keys.map((k) => ({ id: `perm-${k}`, key: k }))),
      permissionCountByRole: jest.fn().mockResolvedValue(new Map()),
      userCountByRole: jest.fn().mockResolvedValue(new Map()),
      create: jest.fn().mockImplementation(async (data: Prisma.AppRoleUncheckedCreateInput) => makeRole({ id: 'new', ...(data as Partial<AppRole>) })),
      update: jest.fn().mockImplementation(async (id: string, data: Prisma.AppRoleUpdateInput) => makeRole({ id, ...(data as Partial<AppRole>) })),
      deleteCustom: jest.fn().mockResolvedValue(1),
    } as unknown as jest.Mocked<RoleRepository>;
    activityLog = { record: jest.fn().mockResolvedValue(undefined) };
    permissions = { invalidate: jest.fn() };
    service = new RoleService(
      repo as unknown as RoleRepository,
      activityLog as unknown as ActivityLogService,
      permissions as unknown as PermissionResolver,
    );
  });

  const validCreate = { name: 'Sales Manager', permissionKeys: ['customers.view', 'bookings.view'] };

  describe('authorization (OWNER-only)', () => {
    it('rejects a non-owner for every operation', async () => {
      await expect(service.list(manager, { page: 1, pageSize: 20, order: 'desc' })).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.get(manager, 'r1')).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.create(manager, validCreate)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.update(manager, 'r1', { name: 'X1' })).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.duplicate(manager, 'r1', { name: 'Copy' })).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.remove(manager, 'r1')).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.create).not.toHaveBeenCalled();
    });
  });

  describe('create', () => {
    it('creates a custom role with companyId from the actor (never from input)', async () => {
      await service.create(owner, validCreate);
      const data = repo.create.mock.calls[0]![0];
      expect(data.companyId).toBe('c1');
      expect(data.isSystem).toBe(false);
      expect(data.isProtected).toBe(false);
      expect(data.key).toBeNull();
      expect(data.createdById).toBe('owner1');
      expect(repo.create.mock.calls[0]![1]).toEqual(['perm-customers.view', 'perm-bookings.view']);
    });

    it('trims the name', async () => {
      await service.create(owner, { ...validCreate, name: '  Sales Manager  ' });
      expect(repo.create.mock.calls[0]![0].name).toBe('Sales Manager');
    });

    it('rejects names shorter than 2, whitespace-only, or longer than 60', async () => {
      await expect(service.create(owner, { ...validCreate, name: 'A' })).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.create(owner, { ...validCreate, name: '   ' })).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.create(owner, { ...validCreate, name: 'x'.repeat(61) })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a case-insensitive duplicate name', async () => {
      repo.findByNameInsensitive.mockResolvedValue(makeRole({ id: 'other', name: 'Manager' }));
      await expect(service.create(owner, { ...validCreate, name: 'manager' })).rejects.toBeInstanceOf(ConflictException);
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('allows a zero-permission role (no catalog lookup needed)', async () => {
      await service.create(owner, { name: 'Empty', permissionKeys: [] });
      expect(repo.findPermissionsByKeys).not.toHaveBeenCalled();
      expect(repo.create.mock.calls[0]![1]).toEqual([]);
    });

    it('rejects an unknown permission key (catalog)', async () => {
      await expect(service.create(owner, { name: 'Bad', permissionKeys: ['customers.destroy'] })).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('rejects a key missing from the DB even if catalog-shaped', async () => {
      repo.findPermissionsByKeys.mockResolvedValue([{ id: 'perm-customers.view', key: 'customers.view' }]); // one of two
      await expect(service.create(owner, { name: 'Bad', permissionKeys: ['customers.view', 'bookings.view'] })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('normalizes an empty description to null and audits ROLE_CREATED', async () => {
      await service.create(owner, { ...validCreate, description: '   ' });
      expect(repo.create.mock.calls[0]![0].description).toBeNull();
      const rec = activityLog.record.mock.calls.at(-1)![0];
      expect(rec.action).toBe('CREATE');
      expect(rec.entityType).toBe('Role');
      expect((rec.metadata as { event: string }).event).toBe('ROLE_CREATED');
    });
  });

  describe('update', () => {
    it('replaces permissions and records a before/after diff', async () => {
      repo.findById.mockResolvedValue(makeRole({ id: 'r1' }));
      repo.findPermissionKeys.mockResolvedValueOnce(['customers.view', 'customers.create']); // before
      await service.update(owner, 'r1', { permissionKeys: ['customers.view'] });
      expect(repo.update).toHaveBeenCalledWith('r1', expect.objectContaining({ updatedById: 'owner1' }), ['perm-customers.view']);
      const rec = activityLog.record.mock.calls.find((c) => (c[0].metadata as { event: string }).event === 'ROLE_PERMISSIONS_CHANGED')!;
      expect((rec[0].metadata as { before: string[]; after: string[] }).before).toEqual(['customers.create', 'customers.view']);
      expect((rec[0].metadata as { before: string[]; after: string[] }).after).toEqual(['customers.view']);
    });

    it('allows emptying the permission set', async () => {
      await service.update(owner, 'r1', { permissionKeys: [] });
      expect(repo.update).toHaveBeenCalledWith('r1', expect.anything(), []);
    });

    it('invalidates the permission cache when permissions change', async () => {
      await service.update(owner, 'r1', { permissionKeys: ['customers.view'] });
      expect(permissions.invalidate).toHaveBeenCalledWith('r1');
    });

    it('rejects modifying a system role', async () => {
      repo.findById.mockResolvedValue(makeRole({ isSystem: true, name: 'MANAGER', key: 'MANAGER' }));
      await expect(service.update(owner, 'r1', { name: 'X1' })).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.updatePermissions(owner, 'r1', [])).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('rejects a duplicate name on rename (excluding self)', async () => {
      repo.findById.mockResolvedValue(makeRole({ id: 'r1' }));
      repo.findByNameInsensitive.mockResolvedValue(makeRole({ id: 'other', name: 'Taken' }));
      await expect(service.update(owner, 'r1', { name: 'taken' })).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('duplicate', () => {
    it('blocks duplicating the OWNER role', async () => {
      repo.findById.mockResolvedValue(makeRole({ isSystem: true, isProtected: true, key: 'OWNER', name: 'OWNER' }));
      await expect(service.duplicate(owner, 'r1', { name: 'Clone' })).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('duplicates a system role into a new custom role without touching the source', async () => {
      repo.findById.mockResolvedValue(makeRole({ id: 'sys', isSystem: true, key: 'MANAGER', name: 'MANAGER' }));
      repo.findRolePermissionIds.mockResolvedValue(['perm-a', 'perm-b']);
      await service.duplicate(owner, 'sys', { name: 'Branch Manager' });
      const data = repo.create.mock.calls[0]![0];
      expect(data.isSystem).toBe(false);
      expect(data.isProtected).toBe(false);
      expect(data.key).toBeNull();
      expect(data.name).toBe('Branch Manager');
      expect(repo.create.mock.calls[0]![1]).toEqual(['perm-a', 'perm-b']); // copied perms
      expect(repo.update).not.toHaveBeenCalled(); // source untouched
      const rec = activityLog.record.mock.calls.at(-1)![0];
      expect((rec.metadata as { event: string; duplicatedFromRoleId: string }).event).toBe('ROLE_DUPLICATED');
      expect((rec.metadata as { duplicatedFromRoleId: string }).duplicatedFromRoleId).toBe('sys');
    });

    it('duplicates a custom role', async () => {
      repo.findById.mockResolvedValue(makeRole({ id: 'cust', isSystem: false, name: 'Custom A' }));
      await expect(service.duplicate(owner, 'cust', { name: 'Custom B' })).resolves.toBeDefined();
    });
  });

  describe('delete', () => {
    it('hard-deletes an unassigned custom role and audits', async () => {
      repo.findById.mockResolvedValue(makeRole({ id: 'r1' }));
      repo.countAssignedUsers.mockResolvedValue(0);
      await service.remove(owner, 'r1');
      expect(repo.deleteCustom).toHaveBeenCalledWith('r1');
      expect(activityLog.record.mock.calls.at(-1)![0].action).toBe('DELETE');
    });

    it('rejects deleting a role with assigned users (no silent reassignment)', async () => {
      repo.countAssignedUsers.mockResolvedValue(3);
      await expect(service.remove(owner, 'r1')).rejects.toBeInstanceOf(ConflictException);
      expect(repo.deleteCustom).not.toHaveBeenCalled();
    });

    it('rejects deleting a system/protected role', async () => {
      repo.findById.mockResolvedValue(makeRole({ isSystem: true, key: 'ACCOUNTANT', name: 'ACCOUNTANT' }));
      await expect(service.remove(owner, 'r1')).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.deleteCustom).not.toHaveBeenCalled();
    });

    it('allows reusing the name after deletion (name is free once no row exists)', async () => {
      // After a hard delete the name lookup returns null → a new create with the same name succeeds.
      repo.findByNameInsensitive.mockResolvedValue(null);
      await expect(service.create(owner, { name: 'Sales Manager', permissionKeys: [] })).resolves.toBeDefined();
    });
  });

  describe('tenant isolation', () => {
    it('treats a cross-company / missing role id as NotFound', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.get(owner, 'other')).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.update(owner, 'other', { name: 'X1' })).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.duplicate(owner, 'other', { name: 'Clone' })).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.remove(owner, 'other')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('also treats a soft-deleted role as NotFound', async () => {
      repo.findById.mockResolvedValue(makeRole({ deletedAt: new Date() }));
      await expect(service.get(owner, 'r1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('list & get', () => {
    it('lists roles with permission and user counts (OWNER)', async () => {
      repo.findMany.mockResolvedValue([makeRole({ id: 'r1' }), makeRole({ id: 'r2', name: 'Other' })]);
      repo.count.mockResolvedValue(2);
      repo.permissionCountByRole.mockResolvedValue(new Map([['r1', 5], ['r2', 0]]));
      repo.userCountByRole.mockResolvedValue(new Map([['r1', 2]]));
      const res = await service.list(owner, { page: 1, pageSize: 20, order: 'desc' });
      expect(res.meta.total).toBe(2);
      expect(res.data[0]).toMatchObject({ id: 'r1', permissionCount: 5, assignedUserCount: 2 });
      expect(res.data[1]).toMatchObject({ id: 'r2', permissionCount: 0, assignedUserCount: 0 });
    });

    it('returns role detail with permission keys and assigned-user count', async () => {
      repo.findById.mockResolvedValue(makeRole({ id: 'r1' }));
      repo.findPermissionKeys.mockResolvedValue(['customers.view']);
      repo.countAssignedUsers.mockResolvedValue(4);
      const detail = await service.get(owner, 'r1');
      expect(detail.permissionKeys).toEqual(['customers.view']);
      expect(detail.assignedUserCount).toBe(4);
    });
  });
});
