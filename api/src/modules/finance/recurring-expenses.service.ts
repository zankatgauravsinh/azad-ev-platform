import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  type CreateRecurringExpenseInput,
  type RecurringExpenseDto,
  type UpdateRecurringExpenseInput,
} from '@azad/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantContext } from '../../tenant/tenant-context.service';
import { ActivityLogService } from '../../activity-log/activity-log.service';
import { ExpensesService } from './expenses.service';

const recurringInclude = {
  category: { select: { name: true } },
  vendor: { select: { name: true } },
} satisfies Prisma.RecurringExpenseInclude;
type RecurringRow = Prisma.RecurringExpenseGetPayload<{ include: typeof recurringInclude }>;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

@Injectable()
export class RecurringExpensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContext,
    private readonly activityLog: ActivityLogService,
    private readonly expenses: ExpensesService,
  ) {}

  async list(): Promise<RecurringExpenseDto[]> {
    const rows = await this.prisma.recurringExpense.findMany({ include: recurringInclude, orderBy: { createdAt: 'desc' } });
    return rows.map((r) => this.toDto(r));
  }

  async create(dto: CreateRecurringExpenseInput, userId: string): Promise<RecurringExpenseDto> {
    const company = this.tenant.requireCompanyId();
    const created = await this.prisma.recurringExpense.create({
      data: {
        companyId: company,
        name: dto.name,
        categoryId: dto.categoryId,
        vendorId: dto.vendorId ?? null,
        amount: BigInt(dto.amount),
        gstAmount: BigInt(dto.gstAmount),
        paymentMethod: dto.paymentMethod,
        dayOfMonth: dto.dayOfMonth,
        description: dto.description ?? null,
        createdById: userId,
      },
      include: recurringInclude,
    });
    await this.activityLog.record({ actorId: userId, action: 'CREATE', entityType: 'RecurringExpense', entityId: created.id, summary: `Created recurring expense ${created.name}` });
    return this.toDto(created);
  }

  async update(id: string, dto: UpdateRecurringExpenseInput, userId: string): Promise<RecurringExpenseDto> {
    await this.getRowOrThrow(id);
    const updated = await this.prisma.recurringExpense.update({
      where: { id },
      data: {
        name: dto.name,
        categoryId: dto.categoryId,
        vendorId: dto.vendorId,
        amount: dto.amount !== undefined ? BigInt(dto.amount) : undefined,
        gstAmount: dto.gstAmount !== undefined ? BigInt(dto.gstAmount) : undefined,
        paymentMethod: dto.paymentMethod,
        dayOfMonth: dto.dayOfMonth,
        description: dto.description,
        active: dto.active,
        updatedById: userId,
      },
      include: recurringInclude,
    });
    return this.toDto(updated);
  }

  async remove(id: string, userId: string): Promise<void> {
    await this.getRowOrThrow(id);
    await this.prisma.recurringExpense.delete({ where: { id } });
    await this.activityLog.record({ actorId: userId, action: 'DELETE', entityType: 'RecurringExpense', entityId: id, summary: 'Deleted recurring expense' });
  }

  /**
   * Generate this month's expense for each active template that hasn't run yet.
   * Idempotent — a second call in the same month creates nothing. This is the seam
   * a future scheduled job would call.
   */
  async runDue(userId: string): Promise<{ created: number }> {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const active = await this.prisma.recurringExpense.findMany({ where: { active: true }, take: 200 });
    // Skip templates already generated this month (null lastRun would break a SQL NOT filter).
    const due = active.filter((t) => t.lastRunYear !== year || t.lastRunMonth !== month);
    let created = 0;
    for (const t of due) {
      // Atomically claim the template for this month BEFORE creating, so two
      // concurrent runs (a scheduled job and a manual trigger, or a double
      // click) can never both generate the same month's expense. Optimistic
      // lock on the exact lastRun values we read: Prisma emits `IS NULL` for a
      // never-run row, so the guard matches correctly and only one run wins.
      const claimed = await this.prisma.recurringExpense.updateMany({
        where: { id: t.id, lastRunYear: t.lastRunYear, lastRunMonth: t.lastRunMonth },
        data: { lastRunYear: year, lastRunMonth: month },
      });
      if (claimed.count !== 1) continue; // another run already claimed it this month
      const lastDay = new Date(year, month, 0).getDate();
      const expenseDate = new Date(year, month - 1, Math.min(t.dayOfMonth, lastDay));
      try {
        await this.expenses.create(
          {
            expenseDate,
            categoryId: t.categoryId,
            vendorId: t.vendorId ?? undefined,
            amount: Number(t.amount),
            gstAmount: Number(t.gstAmount),
            paymentMethod: t.paymentMethod,
            description: `${t.name} (recurring · ${MONTHS[month - 1]} ${year})`,
            paid: false,
          },
          userId,
        );
        created += 1;
      } catch {
        // Month closed or a transient failure — release the claim so a later run retries.
        await this.prisma.recurringExpense
          .updateMany({ where: { id: t.id }, data: { lastRunYear: t.lastRunYear, lastRunMonth: t.lastRunMonth } })
          .catch(() => undefined);
      }
    }
    return { created };
  }

  private async getRowOrThrow(id: string): Promise<RecurringRow> {
    const row = await this.prisma.recurringExpense.findFirst({ where: { id }, include: recurringInclude });
    if (!row) throw new NotFoundException('Recurring expense not found');
    return row;
  }

  private toDto(r: RecurringRow): RecurringExpenseDto {
    return {
      id: r.id,
      name: r.name,
      categoryId: r.categoryId,
      category: r.category.name,
      vendorId: r.vendorId,
      vendorName: r.vendor?.name ?? null,
      amount: String(r.amount),
      gstAmount: String(r.gstAmount),
      total: String(r.amount + r.gstAmount),
      paymentMethod: r.paymentMethod,
      dayOfMonth: r.dayOfMonth,
      description: r.description,
      active: r.active,
      lastRun: r.lastRunYear && r.lastRunMonth ? `${MONTHS[r.lastRunMonth - 1]} ${r.lastRunYear}` : null,
      createdAt: r.createdAt.toISOString(),
    };
  }
}
