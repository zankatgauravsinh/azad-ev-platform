import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  NotificationPriority,
  NotificationType,
  buildPageMeta,
  type CreateExpenseInput,
  type ExpenseAttachmentType,
  type ExpenseDto,
  type ListExpensesQuery,
  type Paginated,
  type SetExpenseStatusInput,
  type UpdateExpenseInput,
} from '@azad/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantContext } from '../../tenant/tenant-context.service';
import { ActivityLogService } from '../../activity-log/activity-log.service';
import { STORAGE_SERVICE, type StorageService } from '../../storage/storage.service';
import { SequenceService } from '../sales/sequence.service';
import { formatInr } from '../../common/utils/money';
import { MonthlyClosingService } from './monthly-closing.service';

const expenseInclude = {
  category: { select: { name: true } },
  vendor: { select: { name: true } },
  attachments: { orderBy: { createdAt: 'asc' } },
} satisfies Prisma.ExpenseInclude;
type ExpenseRow = Prisma.ExpenseGetPayload<{ include: typeof expenseInclude }>;

interface UploadedFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

@Injectable()
export class ExpensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContext,
    private readonly sequence: SequenceService,
    private readonly activityLog: ActivityLogService,
    private readonly closing: MonthlyClosingService,
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
  ) {}

  async list(query: ListExpensesQuery): Promise<Paginated<ExpenseDto>> {
    const where = this.buildWhere(query);
    const [rows, total] = await Promise.all([
      this.prisma.expense.findMany({ where, include: expenseInclude, orderBy: { expenseDate: 'desc' }, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      this.prisma.expense.count({ where }),
    ]);
    return { data: rows.map((r) => this.toDto(r)), meta: buildPageMeta(query.page, query.pageSize, total) };
  }

  async get(id: string): Promise<ExpenseDto> {
    return this.toDto(await this.getRowOrThrow(id));
  }

  async create(dto: CreateExpenseInput, userId: string): Promise<ExpenseDto> {
    const company = this.tenant.requireCompanyId();
    const category = await this.prisma.expenseCategory.findFirst({ where: { id: dto.categoryId } });
    if (!category) throw new NotFoundException('Expense category not found');
    if (dto.vendorId) {
      const vendor = await this.prisma.vendor.findFirst({ where: { id: dto.vendorId } });
      if (!vendor) throw new NotFoundException('Vendor not found');
    }
    const expenseDate = dto.expenseDate ?? new Date();
    await this.closing.assertOpen(expenseDate);
    const amount = BigInt(dto.amount);
    const gstAmount = BigInt(dto.gstAmount);

    const created = await this.prisma.$transaction(async (tx) => {
      const expenseNumber = await this.sequence.next('expense', tx);
      return tx.expense.create({
        data: {
          companyId: company,
          expenseNumber,
          expenseDate,
          categoryId: dto.categoryId,
          vendorId: dto.vendorId ?? null,
          amount,
          gstAmount,
          paymentMethod: dto.paymentMethod,
          referenceNumber: dto.referenceNumber ?? null,
          description: dto.description ?? null,
          status: dto.status ?? 'APPROVED',
          paid: dto.paid,
          dueDate: dto.dueDate ?? null,
          createdById: userId,
        },
        include: expenseInclude,
      });
    });

    await this.activityLog.record({ actorId: userId, action: 'CREATE', entityType: 'Expense', entityId: created.id, summary: `Recorded expense ${created.expenseNumber} — ${formatInr(amount + gstAmount)}` });
    await this.postCreateNotifications(company, created);
    return this.toDto(created);
  }

  async update(id: string, dto: UpdateExpenseInput, userId: string): Promise<ExpenseDto> {
    const existing = await this.getRowOrThrow(id);
    await this.closing.assertOpen(existing.expenseDate);
    if (dto.expenseDate) await this.closing.assertOpen(dto.expenseDate);
    // Financial fields freeze once approved/paid so approved figures (and P&L /
    // vendor outstanding) can't be altered after the fact.
    if ((existing.status === 'APPROVED' || existing.paid) && (dto.amount !== undefined || dto.gstAmount !== undefined || dto.expenseDate !== undefined || dto.vendorId !== undefined)) {
      throw new BadRequestException('Amount, GST, date and vendor cannot be changed after approval');
    }
    const updated = await this.prisma.expense.update({
      where: { id },
      data: {
        expenseDate: dto.expenseDate,
        categoryId: dto.categoryId,
        vendorId: dto.vendorId,
        amount: dto.amount !== undefined ? BigInt(dto.amount) : undefined,
        gstAmount: dto.gstAmount !== undefined ? BigInt(dto.gstAmount) : undefined,
        paymentMethod: dto.paymentMethod,
        referenceNumber: dto.referenceNumber,
        description: dto.description,
        dueDate: dto.dueDate,
        updatedById: userId,
      },
      include: expenseInclude,
    });
    await this.activityLog.record({ actorId: userId, action: 'UPDATE', entityType: 'Expense', entityId: id, summary: `Updated expense ${updated.expenseNumber}` });
    return this.toDto(updated);
  }

  /** Submit a draft for approval (Draft → Pending). */
  async submit(id: string, userId: string): Promise<ExpenseDto> {
    const existing = await this.getRowOrThrow(id);
    if (existing.status !== 'DRAFT') throw new BadRequestException('Only draft expenses can be submitted');
    const updated = await this.prisma.expense.update({ where: { id }, data: { status: 'PENDING', updatedById: userId }, include: expenseInclude });
    await this.activityLog.record({ actorId: userId, action: 'STATUS_CHANGE', entityType: 'Expense', entityId: id, summary: `Expense ${updated.expenseNumber} submitted for approval` });
    return this.toDto(updated);
  }

  async setStatus(id: string, dto: SetExpenseStatusInput, userId: string): Promise<ExpenseDto> {
    const existing = await this.getRowOrThrow(id);
    await this.closing.assertOpen(existing.expenseDate);
    // A settled expense is final — its approval state can't be reversed.
    if (existing.paid) throw new BadRequestException('A settled (paid) expense cannot change approval status');
    const updated = await this.prisma.expense.update({ where: { id }, data: { status: dto.status, updatedById: userId }, include: expenseInclude });
    await this.activityLog.record({ actorId: userId, action: 'STATUS_CHANGE', entityType: 'Expense', entityId: id, summary: `Expense ${updated.expenseNumber} ${dto.status.toLowerCase()}` });
    return this.toDto(updated);
  }

  async settle(id: string, userId: string): Promise<ExpenseDto> {
    const existing = await this.getRowOrThrow(id);
    // Only an approved expense can be marked paid (a draft/pending/rejected can't).
    if (existing.status !== 'APPROVED') throw new BadRequestException('Only an approved expense can be marked paid');
    await this.closing.assertOpen(existing.expenseDate);
    const updated = await this.prisma.expense.update({ where: { id }, data: { paid: true, settledDate: new Date(), updatedById: userId }, include: expenseInclude });
    await this.activityLog.record({ actorId: userId, action: 'PAYMENT', entityType: 'Expense', entityId: id, summary: `Settled expense ${updated.expenseNumber}` });
    return this.toDto(updated);
  }

  async remove(id: string, userId: string): Promise<void> {
    const existing = await this.getRowOrThrow(id);
    await this.closing.assertOpen(existing.expenseDate);
    await this.prisma.expense.update({ where: { id }, data: { deletedAt: new Date(), updatedById: userId } });
    await this.activityLog.record({ actorId: userId, action: 'DELETE', entityType: 'Expense', entityId: id, summary: 'Deleted expense' });
  }

  // ── Attachments (Invoice / GST Bill / Photo / PDF) ──
  async addAttachment(id: string, file: UploadedFile, type: string, userId: string): Promise<ExpenseDto> {
    const company = this.tenant.requireCompanyId();
    await this.getRowOrThrow(id);
    const attType = (['INVOICE', 'GST_BILL', 'PHOTO', 'PDF', 'OTHER'].includes(type) ? type : 'OTHER') as ExpenseAttachmentType;
    const stored = await this.storage.save({ buffer: file.buffer, originalName: file.originalname, mimeType: file.mimetype, folder: `expenses/${id}` });
    await this.prisma.expenseAttachment.create({
      data: { companyId: company, expenseId: id, type: attType, fileKey: stored.fileKey, fileName: file.originalname, mimeType: file.mimetype, sizeBytes: file.size, createdById: userId },
    });
    await this.activityLog.record({ actorId: userId, action: 'UPDATE', entityType: 'Expense', entityId: id, summary: `Attached ${attType.toLowerCase()} to expense` });
    return this.get(id);
  }

  async removeAttachment(id: string, attachmentId: string, userId: string): Promise<ExpenseDto> {
    const att = await this.prisma.expenseAttachment.findFirst({ where: { id: attachmentId, expenseId: id } });
    if (!att) throw new NotFoundException('Attachment not found');
    await this.prisma.expenseAttachment.delete({ where: { id: attachmentId } });
    await this.storage.remove(att.fileKey).catch(() => undefined);
    void userId;
    return this.get(id);
  }

  private buildWhere(query: ListExpensesQuery): Prisma.ExpenseWhereInput {
    const where: Prisma.ExpenseWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.categoryId) where.categoryId = query.categoryId;
    if (query.vendorId) where.vendorId = query.vendorId;
    if (query.paymentMethod) where.paymentMethod = query.paymentMethod;
    if (query.unpaidOnly === 'true') where.paid = false;
    if (query.from || query.to) where.expenseDate = { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) };
    if (query.q) {
      where.OR = [
        { expenseNumber: { contains: query.q, mode: 'insensitive' } },
        { referenceNumber: { contains: query.q, mode: 'insensitive' } },
        { description: { contains: query.q, mode: 'insensitive' } },
        { vendor: { name: { contains: query.q, mode: 'insensitive' } } },
      ];
    }
    return where;
  }

  /** Large-expense + duplicate-expense alerts (deduped, respects notifyPayment). */
  private async postCreateNotifications(company: string, e: ExpenseRow): Promise<void> {
    const settings = await this.prisma.companySetting.findFirst();
    if (!(settings?.notifyPayment ?? true)) return;
    const total = e.amount + e.gstAmount;
    if (settings && total >= settings.largeExpenseThreshold) {
      await this.emit(company, `large-expense:${e.id}`, NotificationPriority.MEDIUM, 'Large expense recorded', `${e.expenseNumber} · ${e.category.name} — ${formatInr(total)}`, e.id);
    }
    const dupWindowStart = new Date(e.expenseDate.getTime() - 86_400_000);
    const dup = await this.prisma.expense.findFirst({
      where: { id: { not: e.id }, amount: e.amount, categoryId: e.categoryId, vendorId: e.vendorId, expenseDate: { gte: dupWindowStart, lte: e.expenseDate } },
    });
    if (dup) {
      await this.emit(company, `dup-expense:${e.id}`, NotificationPriority.MEDIUM, 'Possible duplicate expense', `${e.expenseNumber} matches ${dup.expenseNumber} — ${formatInr(total)}`, e.id);
    }
  }

  private async emit(company: string, dedupeKey: string, priority: NotificationPriority, title: string, message: string, entityId: string): Promise<void> {
    try {
      await this.prisma.notification.create({
        data: { companyId: company, title, message, type: NotificationType.PAYMENT, priority, entityType: 'Expense', entityId, dedupeKey },
      });
    } catch {
      // unique (companyId, dedupeKey) — already emitted; ignore.
    }
  }

  private async getRowOrThrow(id: string): Promise<ExpenseRow> {
    const row = await this.prisma.expense.findFirst({ where: { id }, include: expenseInclude });
    if (!row) throw new NotFoundException('Expense not found');
    return row;
  }

  private toDto(e: ExpenseRow): ExpenseDto {
    return {
      id: e.id,
      expenseNumber: e.expenseNumber,
      expenseDate: e.expenseDate.toISOString(),
      categoryId: e.categoryId,
      category: e.category.name,
      vendorId: e.vendorId,
      vendorName: e.vendor?.name ?? null,
      amount: String(e.amount),
      gstAmount: String(e.gstAmount),
      total: String(e.amount + e.gstAmount),
      paymentMethod: e.paymentMethod,
      referenceNumber: e.referenceNumber,
      description: e.description,
      status: e.status,
      paid: e.paid,
      dueDate: e.dueDate?.toISOString() ?? null,
      attachments: e.attachments.map((a) => ({
        id: a.id,
        type: a.type,
        fileName: a.fileName,
        mimeType: a.mimeType,
        sizeBytes: a.sizeBytes,
        url: this.storage.urlFor(a.fileKey),
        createdAt: a.createdAt.toISOString(),
      })),
      createdAt: e.createdAt.toISOString(),
    };
  }
}
