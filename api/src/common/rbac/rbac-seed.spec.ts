import { seedRbac } from './rbac-seed';

/** Which companies seedRbac touches — every company by default, only the given ones when scoped. */
describe('seedRbac company scope', () => {
  const fakePrisma = () => {
    const prisma = {
      permission: { upsert: jest.fn().mockResolvedValue({}), findMany: jest.fn().mockResolvedValue([]) },
      company: { findMany: jest.fn().mockResolvedValue([]) },
      appRole: { upsert: jest.fn() },
      rolePermission: { upsert: jest.fn() },
      user: { updateMany: jest.fn() },
    };
    return prisma;
  };

  it('without options: all companies (unchanged behaviour of prisma/seed.ts and rbac-init)', async () => {
    const prisma = fakePrisma();
    await seedRbac(prisma as never);
    expect(prisma.company.findMany).toHaveBeenCalledWith({ where: undefined, select: { id: true } });
  });

  it('with companyIds: only those companies are read, so no other company is written', async () => {
    const prisma = fakePrisma();
    await seedRbac(prisma as never, { companyIds: ['c-1', 'c-2'] });
    expect(prisma.company.findMany).toHaveBeenCalledWith({ where: { id: { in: ['c-1', 'c-2'] } }, select: { id: true } });
  });

  it('with an empty companyIds list: no company at all (never "all")', async () => {
    const prisma = fakePrisma();
    await seedRbac(prisma as never, { companyIds: [] });
    expect(prisma.company.findMany).toHaveBeenCalledWith({ where: { id: { in: [] } }, select: { id: true } });
    expect(prisma.appRole.upsert).not.toHaveBeenCalled();
  });
});
