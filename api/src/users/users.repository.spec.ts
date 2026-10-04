import { UsersRepository } from './users.repository';
import type { PrismaService } from '../prisma/prisma.service';

describe('UsersRepository (staff methods)', () => {
  const user = { user: { create: jest.fn(), findMany: jest.fn(), count: jest.fn(), findUnique: jest.fn(), update: jest.fn() } };
  const repo = new UsersRepository(user as unknown as PrismaService);

  beforeEach(() => Object.values(user.user).forEach((fn) => fn.mockReset()));

  // Staff reads/writes eagerly load the assigned AppRole's display name for StaffDto.
  const withRole = { roleRef: { select: { name: true } } };

  it('create() delegates to prisma.user.create (companyId injected by tenant middleware)', async () => {
    user.user.create.mockResolvedValue({ id: 'u1' });
    await repo.create({ name: 'Asha', email: 'asha@azadev.in', passwordHash: 'h', role: 'MANAGER' });
    expect(user.user.create).toHaveBeenCalledWith({ data: { name: 'Asha', email: 'asha@azadev.in', passwordHash: 'h', role: 'MANAGER' }, include: withRole });
  });

  it('findMany() passes pagination args straight through (with the role name joined)', async () => {
    user.user.findMany.mockResolvedValue([]);
    const args = { where: { isActive: true }, skip: 20, take: 20, orderBy: { createdAt: 'desc' as const } };
    await repo.findMany(args);
    expect(user.user.findMany).toHaveBeenCalledWith({ ...args, include: withRole });
  });

  it('count() forwards the where filter', async () => {
    user.user.count.mockResolvedValue(3);
    await repo.count({ role: 'SALES_EXECUTIVE' });
    expect(user.user.count).toHaveBeenCalledWith({ where: { role: 'SALES_EXECUTIVE' } });
  });

  it('countActiveOwners() counts active OWNERs only', async () => {
    user.user.count.mockResolvedValue(1);
    const n = await repo.countActiveOwners();
    expect(user.user.count).toHaveBeenCalledWith({ where: { role: 'OWNER', isActive: true } });
    expect(n).toBe(1);
  });

  it('findByEmail() lower-cases the lookup', async () => {
    user.user.findUnique.mockResolvedValue(null);
    await repo.findByEmail('Asha@AZADEV.in');
    expect(user.user.findUnique).toHaveBeenCalledWith({ where: { email: 'asha@azadev.in' } });
  });
});
