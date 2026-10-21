import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { TenantContext, type RequestAudit } from '../tenant/tenant-context.service';
import { ActivityLogService } from './activity-log.service';

describe('ActivityLogService', () => {
  const input = { actorId: 'user-1', action: 'UPDATE' as const, entityType: 'InventoryUnit', entityId: 'unit-1', summary: 's', metadata: { a: 1 } };
  const request = (): RequestAudit => ({ requestId: 'req-1', actorId: 'user-1', actorName: 'Asha', actorRole: 'MANAGER', ip: '203.0.113.9', userAgent: 'Chrome', written: 0 });
  const tenant = new TenantContext();

  it('record writes through the root client and swallows failures (the request path never breaks)', async () => {
    const create = jest.fn().mockRejectedValue(new Error('db down'));
    const service = new ActivityLogService({ activityLog: { create }, user: { findFirst: jest.fn() } } as unknown as PrismaService, tenant);
    await expect(service.record(input)).resolves.toBeUndefined();
    expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({ actorId: 'user-1', action: 'UPDATE', entityType: 'InventoryUnit', entityId: 'unit-1', summary: 's', metadata: { a: 1 }, source: 'USER' }) });
  });

  it('recordInTransaction writes through the given transaction and lets failures propagate', async () => {
    const root = jest.fn();
    const create = jest.fn().mockResolvedValue({});
    const service = new ActivityLogService({ activityLog: { create: root } } as unknown as PrismaService, tenant);
    const tx = { activityLog: { create }, user: { findFirst: jest.fn().mockResolvedValue({ name: 'Ravi', role: 'OWNER' }) } } as unknown as Prisma.TransactionClient;
    await service.recordInTransaction(input, tx);
    expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({ actorId: 'user-1', actorName: 'Ravi', actorRole: 'OWNER' }) });
    expect(root).not.toHaveBeenCalled();

    create.mockRejectedValue(new Error('db down'));
    await expect(service.recordInTransaction(input, tx)).rejects.toThrow('db down');
  });

  it('fills who / from where from the request and counts the entry', async () => {
    const create = jest.fn().mockResolvedValue({});
    const findFirst = jest.fn();
    const service = new ActivityLogService({ activityLog: { create }, user: { findFirst } } as unknown as PrismaService, tenant);
    const r = request();
    await tenant.runRequest('company-1', r, () => service.record({ action: 'DELETE', entityType: 'Quotation', entityId: 'q1', entityLabel: 'QT0007', summary: 'Deleted quotation', changes: { status: { from: 'DRAFT', to: null } }, reason: 'duplicate' }));
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ actorId: 'user-1', actorName: 'Asha', actorRole: 'MANAGER', ip: '203.0.113.9', userAgent: 'Chrome', requestId: 'req-1', entityLabel: 'QT0007', changes: { status: { from: 'DRAFT', to: null } }, reason: 'duplicate', source: 'USER' }),
    });
    expect(findFirst).not.toHaveBeenCalled(); // the request user's name is already known
    expect(r.written).toBe(1);
  });

  it('a SYSTEM entry has no actor; an empty change set is not stored; an explicit company wins (public routes)', async () => {
    const create = jest.fn().mockResolvedValue({});
    const service = new ActivityLogService({ activityLog: { create }, user: { findFirst: jest.fn() } } as unknown as PrismaService, tenant);
    await tenant.runRequest(null, request(), () => service.record({ action: 'STATUS_CHANGE', source: 'SYSTEM', entityType: 'Warranty', summary: 'Expired', changes: {}, companyId: 'company-9' }));
    const data = create.mock.calls[0][0].data;
    expect(data).toMatchObject({ actorId: null, actorName: null, source: 'SYSTEM', companyId: 'company-9' });
    expect(data.changes).toBeUndefined();
  });
});
