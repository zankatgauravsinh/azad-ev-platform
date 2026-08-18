import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  buildPageMeta,
  type CreateIncomeInput,
  type IncomeDto,
  type IncomeSource,
  type ListIncomeQuery,
  type Paginated,
} from '@azad/shared';
import type { CustomerEventType } from '@azad/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantContext } from '../../tenant/tenant-context.service';
import { ActivityLogService } from '../../activity-log/activity-log.service';
import { CustomerTimelineService } from '../customers/customer-timeline.service';
import { SequenceService } from '../sales/sequence.service';
import { formatInr } from '../../common/utils/money';
import { MonthlyClosingService } from './monthly-closing.service';

const incomeInclude = { customer: { select: { name: true } } } satisfies Prisma.IncomeInclude;
type IncomeRow = Prisma.IncomeGetPayload<{ include: typeof incomeInclude }>;

/** Sources that append to the customer timeline, with the timeline event type they map to. */
const TIMELINE_EVENT: Partial<Record<IncomeSource, { type: CustomerEventType; label: string }>> = {
  FINANCE_COMMISSION: { type: 'FINANCE_APPROVED', label: 'Finance commission' },
  INSURANCE_COMMISSION: { type: 'INSURANCE_ADDED', label: 'Insurance commission' },
  ACCESSORIES: { type: 'NOTE_ADDED', label: 'Accessory purchase' },
  AMC: { type: 'WARRANTY', label: 'AMC income' },
  WARRANTY_RECOVERY: { type: 'WARRANTY', label: 'Warranty recovery' },
};

@Injectable()
export class IncomeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContext,
    private readonly sequence: SequenceService,
    private readonly timeline: CustomerTimelineService,
    private readonly activityLog: ActivityLogService,
    private readonly closing: MonthlyClosingService,
  ) {}

  async list(query: ListIncomeQuery): Promise<Paginated<IncomeDto>> {
    const where: Prisma.IncomeWhereInput = {};
    if (query.source) where.source = query.source;
    if (query.from || query.to) where.incomeDate = { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) };
    if (query.q) {
      where.OR = [
        { incomeNumber: { contains: query.q, mode: 'insensitive' } },
        { referenceNumber: { contains: query.q, mode: 'insensitive' } },
        { description: { contains: query.q, mode: 'insensitive' } },
        { customer: { name: { contains: query.q, mode: 'insensitive' } } },
      ];
    }
    const [rows, total] = await Promise.all([
      this.prisma.income.findMany({ where, include: incomeInclude, orderBy: { incomeDate: 'desc' }, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      this.prisma.income.count({ where }),
    ]);
    return { data: rows.map((r) => this.toDto(r)), meta: buildPageMeta(query.page, query.pageSize, total) };
  }

  async get(id: string): Promise<IncomeDto> {
    const row = await this.prisma.income.findFirst({ where: { id }, include: incomeInclude });
    if (!row) throw new NotFoundException('Income not found');
    return this.toDto(row);
  }

  async create(dto: CreateIncomeInput, userId: string): Promise<IncomeDto> {
    const company = this.tenant.requireCompanyId();
    if (dto.customerId) {
      const customer = await this.prisma.customer.findFirst({ where: { id: dto.customerId } });
      if (!customer) throw new NotFoundException('Customer not found');
    }
    const incomeDate = dto.incomeDate ?? new Date();
    await this.closing.assertOpen(incomeDate);
    const amount = BigInt(dto.amount);
    const gstAmount = BigInt(dto.gstAmount);
    const created = await this.prisma.$transaction(async (tx) => {
      const incomeNumber = await this.sequence.next('income', tx);
      return tx.income.create({
        data: {
          companyId: company,
          incomeNumber,
          incomeDate,
          source: dto.source,
          amount,
          gstAmount,
          paymentMethod: dto.paymentMethod,
          referenceNumber: dto.referenceNumber ?? null,
          description: dto.description ?? null,
          customerId: dto.customerId ?? null,
          createdById: userId,
        },
        include: incomeInclude,
      });
    });

    await this.activityLog.record({ actorId: userId, action: 'CREATE', entityType: 'Income', entityId: created.id, summary: `Recorded income ${created.incomeNumber} — ${formatInr(amount + gstAmount)}` });
    const event = TIMELINE_EVENT[dto.source];
    if (created.customerId && event) {
      await this.timeline.record({
        customerId: created.customerId,
        type: event.type,
        title: `${event.label} — ${formatInr(amount + gstAmount)}`,
        description: created.description,
        entityType: 'Income',
        entityId: created.id,
        actorId: userId,
      });
    }
    return this.toDto(created);
  }

  async remove(id: string, userId: string): Promise<void> {
    const found = await this.prisma.income.findFirst({ where: { id } });
    if (!found) throw new NotFoundException('Income not found');
    await this.closing.assertOpen(found.incomeDate);
    await this.prisma.income.delete({ where: { id } });
    await this.activityLog.record({ actorId: userId, action: 'DELETE', entityType: 'Income', entityId: id, summary: `Deleted income ${found.incomeNumber}` });
  }

  private toDto(i: IncomeRow): IncomeDto {
    return {
      id: i.id,
      incomeNumber: i.incomeNumber,
      incomeDate: i.incomeDate.toISOString(),
      source: i.source,
      amount: String(i.amount),
      gstAmount: String(i.gstAmount),
      total: String(i.amount + i.gstAmount),
      paymentMethod: i.paymentMethod,
      referenceNumber: i.referenceNumber,
      description: i.description,
      customerId: i.customerId,
      customerName: i.customer?.name ?? null,
      createdAt: i.createdAt.toISOString(),
    };
  }
}
