import { Injectable, NotFoundException } from '@nestjs/common';
import { CustomerFollowUp, Prisma } from '@prisma/client';
import {
  CustomerEventType,
  type CreateFollowUpInput,
  type CustomerFollowUpDto,
  type FollowUpReminders,
  type UpdateFollowUpInput,
} from '@azad/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { CustomerTimelineService } from './customer-timeline.service';
import { ActivityLogService } from '../../activity-log/activity-log.service';
import { changesSummary, createdFields, diffFields } from '../../activity-log/audit-diff';

const FOLLOW_UP_FIELDS = ['dueAt', 'priority', 'note', 'remindBeforeMinutes', 'assignedTo'] as const;
const followUpSnapshot = (f: { dueAt: Date; priority: string; note: string | null; remindBeforeMinutes: number | null; assignedTo?: { name: string } | null }): Record<(typeof FOLLOW_UP_FIELDS)[number], unknown> => ({ dueAt: f.dueAt, priority: f.priority, note: f.note, remindBeforeMinutes: f.remindBeforeMinutes, assignedTo: f.assignedTo?.name ?? null });

type FollowUpWithAssignee = CustomerFollowUp & {
  assignedTo: { id: string; name: string; role: string } | null;
};

const assigneeInclude = {
  assignedTo: { select: { id: true, name: true, role: true } },
} satisfies Prisma.CustomerFollowUpInclude;

@Injectable()
export class FollowUpsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly timeline: CustomerTimelineService,
    private readonly activityLog: ActivityLogService,
  ) {}

  async create(customerId: string, dto: CreateFollowUpInput, userId: string): Promise<CustomerFollowUpDto> {
    const followUp = await this.prisma.$transaction(async (tx) => {
      const created = await tx.customerFollowUp.create({
        data: {
          customerId,
          dueAt: dto.dueAt,
          priority: dto.priority,
          note: dto.note ?? null,
          remindBeforeMinutes: dto.remindBeforeMinutes ?? null,
          assignedToId: dto.assignedToId ?? null,
          createdById: userId,
          updatedById: userId,
        },
        include: assigneeInclude,
      });
      await this.timeline.record(
        {
          customerId,
          type: CustomerEventType.FOLLOW_UP_SCHEDULED,
          title: `Follow-up scheduled for ${created.dueAt.toLocaleString('en-IN')}`,
          description: created.note,
          entityType: 'CustomerFollowUp',
          entityId: created.id,
          actorId: userId,
        },
        tx,
      );
      await this.activityLog.recordInTransaction({ actorId: userId, action: 'CREATE', entityType: 'Customer', entityId: customerId, summary: `Scheduled a follow-up for ${created.dueAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}${created.note ? `: ${created.note.slice(0, 140)}` : ''}`, changes: createdFields(followUpSnapshot(created)), metadata: { followUpId: created.id } }, tx);
      return created;
    });
    return this.toDto(followUp);
  }

  async list(customerId: string): Promise<CustomerFollowUpDto[]> {
    const items = await this.prisma.customerFollowUp.findMany({
      where: { customerId },
      orderBy: [{ status: 'asc' }, { dueAt: 'asc' }],
      include: assigneeInclude,
    });
    return items.map((f) => this.toDto(f));
  }

  async update(
    customerId: string,
    id: string,
    dto: UpdateFollowUpInput,
    userId: string,
  ): Promise<CustomerFollowUpDto> {
    const before = await this.getOrThrow(customerId, id);
    const updated = await this.prisma.customerFollowUp.update({
      where: { id },
      data: {
        dueAt: dto.dueAt,
        priority: dto.priority,
        note: dto.note,
        remindBeforeMinutes: dto.remindBeforeMinutes,
        assignedToId: dto.assignedToId,
        updatedById: userId,
      },
      include: assigneeInclude,
    });
    const changes = diffFields(followUpSnapshot(before), followUpSnapshot(updated), FOLLOW_UP_FIELDS);
    await this.activityLog.record({ actorId: userId, action: 'UPDATE', entityType: 'Customer', entityId: customerId, summary: `Changed a follow-up: ${changesSummary(changes) || 'nothing changed'}`, changes, metadata: { followUpId: id } });
    return this.toDto(updated);
  }

  async complete(customerId: string, id: string, userId: string): Promise<CustomerFollowUpDto> {
    const existing = await this.getOrThrow(customerId, id);
    const updated = await this.prisma.$transaction(async (tx) => {
      const done = await tx.customerFollowUp.update({
        where: { id },
        data: { status: 'COMPLETED', completedAt: new Date(), updatedById: userId },
        include: assigneeInclude,
      });
      await this.timeline.record(
        {
          customerId,
          type: CustomerEventType.FOLLOW_UP_COMPLETED,
          title: 'Follow-up completed',
          description: existing.note,
          entityType: 'CustomerFollowUp',
          entityId: id,
          actorId: userId,
        },
        tx,
      );
      await this.activityLog.recordInTransaction({ actorId: userId, action: 'STATUS_CHANGE', entityType: 'Customer', entityId: customerId, summary: `Completed a follow-up${existing.note ? `: ${existing.note.slice(0, 140)}` : ''}`, changes: { status: { from: existing.status, to: 'COMPLETED' } }, metadata: { followUpId: id } }, tx);
      return done;
    });
    return this.toDto(updated);
  }

  async cancel(customerId: string, id: string, userId: string): Promise<CustomerFollowUpDto> {
    const existing = await this.getOrThrow(customerId, id);
    const updated = await this.prisma.customerFollowUp.update({
      where: { id },
      data: { status: 'CANCELLED', updatedById: userId },
      include: assigneeInclude,
    });
    await this.activityLog.record({ actorId: userId, action: 'CANCEL', entityType: 'Customer', entityId: customerId, summary: `Cancelled a follow-up${existing.note ? `: ${existing.note.slice(0, 140)}` : ''}`, changes: { status: { from: existing.status, to: 'CANCELLED' } }, metadata: { followUpId: id } });
    return this.toDto(updated);
  }

  /** Reminder generation: buckets all pending follow-ups into overdue / today / upcoming. */
  async reminders(): Promise<FollowUpReminders> {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfToday = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000 - 1);

    const pending = await this.prisma.customerFollowUp.findMany({
      where: { status: 'PENDING' },
      orderBy: { dueAt: 'asc' },
      include: { ...assigneeInclude, customer: { select: { id: true, name: true, phone: true } } },
      take: 500,
    });

    const result: FollowUpReminders = { overdue: [], today: [], upcoming: [] };
    for (const f of pending) {
      const dto = { ...this.toDto(f), customer: f.customer };
      if (f.dueAt < startOfToday) result.overdue.push(dto);
      else if (f.dueAt <= endOfToday) result.today.push(dto);
      else result.upcoming.push(dto);
    }
    return result;
  }

  private async getOrThrow(customerId: string, id: string): Promise<CustomerFollowUp> {
    const followUp = await this.prisma.customerFollowUp.findUnique({ where: { id } });
    if (!followUp || followUp.customerId !== customerId) {
      throw new NotFoundException('Follow-up not found');
    }
    return followUp;
  }

  private toDto(f: FollowUpWithAssignee): CustomerFollowUpDto {
    return {
      id: f.id,
      dueAt: f.dueAt.toISOString(),
      priority: f.priority,
      note: f.note,
      remindBeforeMinutes: f.remindBeforeMinutes,
      status: f.status,
      completedAt: f.completedAt ? f.completedAt.toISOString() : null,
      assignedTo: f.assignedTo,
      isOverdue: f.status === 'PENDING' && f.dueAt < new Date(),
      createdAt: f.createdAt.toISOString(),
    };
  }
}
