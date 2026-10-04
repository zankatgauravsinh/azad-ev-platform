import { PERMISSION_KEYS, Role } from '@azad/shared';
import { PermissionResolver } from './permission-resolver.service';
import type { PrismaService } from '../../prisma/prisma.service';

describe('PermissionResolver', () => {
  const prisma = {
    user: { findUnique: jest.fn() },
    rolePermission: { findMany: jest.fn() },
  };
  let resolver: PermissionResolver;

  beforeEach(() => {
    jest.clearAllMocks();
    resolver = new PermissionResolver(prisma as unknown as PrismaService);
  });

  const keyRows = (keys: string[]): { permission: { key: string } }[] => keys.map((key) => ({ permission: { key } }));

  it('resolves OWNER to the full catalog without touching the DB', async () => {
    const set = await resolver.resolve({ id: 'o1', role: Role.OWNER });
    expect(set.size).toBe(PERMISSION_KEYS.length); // 73
    expect(set.has('staff.manage')).toBe(true);
    expect(set.has('inventory.export')).toBe(true);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('resolves a non-owner from roleId → RolePermission keys', async () => {
    prisma.user.findUnique.mockResolvedValue({ roleId: 'role-x' });
    prisma.rolePermission.findMany.mockResolvedValue(keyRows(['customers.view', 'bookings.view']));
    const set = await resolver.resolve({ id: 'u1', role: Role.SALES_EXECUTIVE });
    expect([...set].sort()).toEqual(['bookings.view', 'customers.view']);
  });

  it('resolves a user with no roleId to an empty set', async () => {
    prisma.user.findUnique.mockResolvedValue({ roleId: null });
    const set = await resolver.resolve({ id: 'u1', role: Role.MANAGER });
    expect(set.size).toBe(0);
    expect(prisma.rolePermission.findMany).not.toHaveBeenCalled();
  });

  it('caches per role and refreshes only after invalidation', async () => {
    prisma.rolePermission.findMany
      .mockResolvedValueOnce(keyRows(['customers.view'])) // first load
      .mockResolvedValueOnce(keyRows(['customers.view', 'bookings.view'])); // after change

    const first = await resolver.permissionsForRole('role-x');
    expect([...first]).toEqual(['customers.view']);

    const cached = await resolver.permissionsForRole('role-x'); // served from cache
    expect([...cached]).toEqual(['customers.view']);
    expect(prisma.rolePermission.findMany).toHaveBeenCalledTimes(1);

    resolver.invalidate('role-x'); // role permissions changed
    const refreshed = await resolver.permissionsForRole('role-x');
    expect([...refreshed].sort()).toEqual(['bookings.view', 'customers.view']);
    expect(prisma.rolePermission.findMany).toHaveBeenCalledTimes(2);
  });

  it('handles zero / one / multiple permission roles', async () => {
    prisma.rolePermission.findMany.mockResolvedValueOnce([]);
    expect((await resolver.permissionsForRole('empty')).size).toBe(0);
    prisma.rolePermission.findMany.mockResolvedValueOnce(keyRows(['customers.view']));
    expect((await resolver.permissionsForRole('one')).size).toBe(1);
    prisma.rolePermission.findMany.mockResolvedValueOnce(keyRows(['a', 'b', 'c']));
    expect((await resolver.permissionsForRole('many')).size).toBe(3);
  });

  it('invalidateAll clears every cached role', async () => {
    prisma.rolePermission.findMany.mockResolvedValue(keyRows(['customers.view']));
    await resolver.permissionsForRole('r1');
    await resolver.permissionsForRole('r2');
    resolver.invalidateAll();
    await resolver.permissionsForRole('r1');
    expect(prisma.rolePermission.findMany).toHaveBeenCalledTimes(3); // r1, r2, r1-again
  });
});
