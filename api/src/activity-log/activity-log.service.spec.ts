import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { ActivityLogService } from './activity-log.service';

describe('ActivityLogService', () => {
  const input = { actorId: 'user-1', action: 'UPDATE' as const, entityType: 'InventoryUnit', entityId: 'unit-1', summary: 's', metadata: { a: 1 } };
  const row = { actorId: 'user-1', action: 'UPDATE', entityType: 'InventoryUnit', entityId: 'unit-1', summary: 's', metadata: { a: 1 }, ip: null };

  it('record writes through the root client and swallows failures (the request path never breaks)', async () => {
    const create = jest.fn().mockRejectedValue(new Error('db down'));
    const service = new ActivityLogService({ activityLog: { create } } as unknown as PrismaService);
    await expect(service.record(input)).resolves.toBeUndefined();
    expect(create).toHaveBeenCalledWith({ data: row });
  });

  it('recordInTransaction writes through the given transaction and lets failures propagate', async () => {
    const root = jest.fn();
    const create = jest.fn().mockResolvedValue({});
    const service = new ActivityLogService({ activityLog: { create: root } } as unknown as PrismaService);
    const tx = { activityLog: { create } } as unknown as Prisma.TransactionClient;
    await service.recordInTransaction(input, tx);
    expect(create).toHaveBeenCalledWith({ data: row });
    expect(root).not.toHaveBeenCalled();

    create.mockRejectedValue(new Error('db down'));
    await expect(service.recordInTransaction(input, tx)).rejects.toThrow('db down');
  });
});
