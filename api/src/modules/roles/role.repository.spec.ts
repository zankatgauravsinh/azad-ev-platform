import { RoleRepository } from './role.repository';
import type { PrismaService } from '../../prisma/prisma.service';

/** Verifies the repository's transactional write behavior (interactive-transaction convention). */
describe('RoleRepository', () => {
  const tx = {
    appRole: { create: jest.fn(), update: jest.fn() },
    rolePermission: { createMany: jest.fn(), deleteMany: jest.fn() },
  };
  const prisma = {
    appRole: { findMany: jest.fn(), count: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn(), deleteMany: jest.fn() },
    rolePermission: { findMany: jest.fn(), groupBy: jest.fn() },
    permission: { findMany: jest.fn() },
    user: { count: jest.fn(), groupBy: jest.fn() },
    $transaction: jest.fn(async (fn: (c: typeof tx) => unknown) => fn(tx)),
  };
  const repo = new RoleRepository(prisma as unknown as PrismaService);

  beforeEach(() => jest.clearAllMocks());

  it('create() runs in a transaction: role then RolePermission rows', async () => {
    tx.appRole.create.mockResolvedValue({ id: 'new' });
    await repo.create({ companyId: 'c1', name: 'X', isSystem: false, isProtected: false }, ['p1', 'p2']);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.appRole.create).toHaveBeenCalled();
    expect(tx.rolePermission.createMany).toHaveBeenCalledWith({
      data: [{ roleId: 'new', permissionId: 'p1' }, { roleId: 'new', permissionId: 'p2' }],
    });
  });

  it('create() with zero permissions skips createMany', async () => {
    tx.appRole.create.mockResolvedValue({ id: 'new' });
    await repo.create({ companyId: 'c1', name: 'X', isSystem: false, isProtected: false }, []);
    expect(tx.rolePermission.createMany).not.toHaveBeenCalled();
  });

  it('update() replaces permissions atomically (deleteMany + createMany)', async () => {
    tx.appRole.update.mockResolvedValue({ id: 'r1' });
    await repo.update('r1', { name: 'Y' }, ['p3']);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.rolePermission.deleteMany).toHaveBeenCalledWith({ where: { roleId: 'r1' } });
    expect(tx.rolePermission.createMany).toHaveBeenCalledWith({ data: [{ roleId: 'r1', permissionId: 'p3' }] });
  });

  it('update() without permissionIds leaves permissions untouched', async () => {
    tx.appRole.update.mockResolvedValue({ id: 'r1' });
    await repo.update('r1', { name: 'Y' });
    expect(tx.rolePermission.deleteMany).not.toHaveBeenCalled();
    expect(tx.rolePermission.createMany).not.toHaveBeenCalled();
  });

  it('update() with an empty array removes all permissions', async () => {
    tx.appRole.update.mockResolvedValue({ id: 'r1' });
    await repo.update('r1', {}, []);
    expect(tx.rolePermission.deleteMany).toHaveBeenCalledWith({ where: { roleId: 'r1' } });
    expect(tx.rolePermission.createMany).not.toHaveBeenCalled();
  });

  it('deleteCustom() guards on isSystem=false and returns the row count', async () => {
    prisma.appRole.deleteMany.mockResolvedValue({ count: 1 });
    const n = await repo.deleteCustom('r1');
    expect(prisma.appRole.deleteMany).toHaveBeenCalledWith({ where: { id: 'r1', isSystem: false } });
    expect(n).toBe(1);
  });

  it('findByNameInsensitive() filters case-insensitively and excludes soft-deleted', async () => {
    prisma.appRole.findFirst.mockResolvedValue(null);
    await repo.findByNameInsensitive('Manager');
    expect(prisma.appRole.findFirst).toHaveBeenCalledWith({
      where: { name: { equals: 'Manager', mode: 'insensitive' }, deletedAt: null },
    });
  });
});
