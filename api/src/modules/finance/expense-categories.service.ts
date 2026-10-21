import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { BLOCKED_CREDIT_CATEGORIES, DEFAULT_EXPENSE_CATEGORIES, type CreateExpenseCategoryInput, type ExpenseCategoryDto, type UpdateExpenseCategoryInput } from '@azad/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantContext } from '../../tenant/tenant-context.service';
import { changesSummary, diffFields } from '../../activity-log/audit-diff';
import { ActivityLogService } from '../../activity-log/activity-log.service';

@Injectable()
export class ExpenseCategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContext,
    private readonly activityLog: ActivityLogService,
  ) {}

  /** Seed the 15 standard categories for the company on first use (idempotent). */
  async ensureDefaults(): Promise<void> {
    const company = this.tenant.requireCompanyId();
    const count = await this.prisma.expenseCategory.count();
    if (count > 0) return;
    await this.prisma.expenseCategory.createMany({
      data: DEFAULT_EXPENSE_CATEGORIES.map((name, i) => ({ companyId: company, name, isSystem: true, sortOrder: i, itcEligible: !BLOCKED_CREDIT_CATEGORIES.includes(name) })),
      skipDuplicates: true,
    });
  }

  async list(): Promise<ExpenseCategoryDto[]> {
    await this.ensureDefaults();
    const rows = await this.prisma.expenseCategory.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { expenses: true } } },
    });
    return rows.map((c) => ({ id: c.id, name: c.name, isSystem: c.isSystem, active: c.active, itcEligible: c.itcEligible, expenseCount: c._count.expenses }));
  }

  async create(dto: CreateExpenseCategoryInput, userId: string): Promise<ExpenseCategoryDto> {
    const company = this.tenant.requireCompanyId();
    const exists = await this.prisma.expenseCategory.findFirst({ where: { name: { equals: dto.name, mode: 'insensitive' } } });
    if (exists) throw new BadRequestException('A category with this name already exists');
    const created = await this.prisma.expenseCategory.create({ data: { companyId: company, name: dto.name, itcEligible: dto.itcEligible ?? true, createdById: userId } });
    await this.activityLog.record({ actorId: userId, action: 'CREATE', entityType: 'ExpenseCategory', entityId: created.id, entityLabel: created.name, summary: `Added expense category ${created.name}`, changes: { name: { from: null, to: created.name } } });
    return { id: created.id, name: created.name, isSystem: created.isSystem, active: created.active, itcEligible: created.itcEligible, expenseCount: 0 };
  }

  async update(id: string, dto: UpdateExpenseCategoryInput, userId: string): Promise<ExpenseCategoryDto> {
    const found = await this.prisma.expenseCategory.findFirst({ where: { id } });
    if (!found) throw new NotFoundException('Category not found');
    const updated = await this.prisma.expenseCategory.update({
      where: { id },
      data: { name: dto.name ?? found.name, active: dto.active ?? found.active, itcEligible: dto.itcEligible ?? found.itcEligible, updatedById: userId },
      include: { _count: { select: { expenses: true } } },
    });
    const changes = diffFields(found, updated, ['name', 'active', 'itcEligible']);
    await this.activityLog.record({ actorId: userId, action: 'UPDATE', entityType: 'ExpenseCategory', entityId: id, entityLabel: updated.name, summary: `Updated expense category ${updated.name}: ${changesSummary(changes) || 'nothing changed'}`, changes });
    return { id: updated.id, name: updated.name, isSystem: updated.isSystem, active: updated.active, itcEligible: updated.itcEligible, expenseCount: updated._count.expenses };
  }
}
