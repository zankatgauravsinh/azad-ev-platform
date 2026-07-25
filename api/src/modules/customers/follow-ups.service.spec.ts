import { FollowUpsService } from './follow-ups.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { CustomerTimelineService } from './customer-timeline.service';

const hoursFromNow = (h: number): Date => new Date(Date.now() + h * 3600 * 1000);

describe('FollowUpsService.reminders (reminder generation)', () => {
  let prisma: { customerFollowUp: { findMany: jest.Mock } };
  let service: FollowUpsService;

  beforeEach(() => {
    prisma = { customerFollowUp: { findMany: jest.fn() } };
    service = new FollowUpsService(
      prisma as unknown as PrismaService,
      {} as CustomerTimelineService,
    );
  });

  it('buckets pending follow-ups into overdue / today / upcoming', async () => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const base = {
      priority: 'MEDIUM',
      note: null,
      remindBeforeMinutes: null,
      status: 'PENDING',
      completedAt: null,
      assignedTo: null,
      createdAt: new Date(),
      customer: { id: 'c1', name: 'A', phone: '9825012345' },
    };
    prisma.customerFollowUp.findMany.mockResolvedValue([
      { ...base, id: 'overdue', dueAt: new Date(startOfToday.getTime() - 3600 * 1000) }, // yesterday-ish (before start of today)
      { ...base, id: 'today', dueAt: hoursFromNow(1) < endOfToday() ? hoursFromNow(1) : new Date(startOfToday.getTime() + 3600 * 1000) },
      { ...base, id: 'upcoming', dueAt: hoursFromNow(72) },
    ]);

    const result = await service.reminders();
    expect(result.overdue.map((f) => f.id)).toContain('overdue');
    expect(result.upcoming.map((f) => f.id)).toContain('upcoming');
    expect(result.overdue[0]?.isOverdue).toBe(true);
  });

  it('returns empty buckets when nothing is pending', async () => {
    prisma.customerFollowUp.findMany.mockResolvedValue([]);
    const result = await service.reminders();
    expect(result).toEqual({ overdue: [], today: [], upcoming: [] });
  });
});

function endOfToday(): Date {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
}
