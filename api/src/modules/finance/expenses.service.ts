import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { isAfterBusinessToday, resolveTimeZone } from '../../common/utils/business-date';
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
import { GstFilingService } from '../gst/gst-filing.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantContext } from '../../tenant/tenant-context.service';
import { ActivityLogService } from '../../activity-log/activity-log.service';
import { STORAGE_SERVICE, type StorageService } from '../../storage/storage.service';
import { SequenceService } from '../sales/sequence.service';
import { formatInr } from '../../common/utils/money';
import { MonthlyClosingService } from './monthly-closing.service';
import { VendorBillsService } from '../vendor-payables/vendor-bills.service';
import { changesSummary, createdFields, diffFields } from '../../activity-log/audit-diff';

const EXPENSE_FIELDS = ['expenseDate', 'category', 'vendor', 'amount', 'gstAmount', 'itcEligible', 'paymentMethod', 'referenceNumber', 'description', 'dueDate', 'status', 'paid'] as const;
type ExpenseLike = { expenseDate: Date; category?: { name: string } | null; vendor?: { name: string } | null; amount: bigint; gstAmount: bigint; itcEligible?: boolean | null; paymentMethod: string; referenceNumber: string | null; description: string | null; dueDate: Date | null; status: string; paid: boolean };
const expenseSnapshot = (e: ExpenseLike): Record<(typeof EXPENSE_FIELDS)[number], unknown> => ({ expenseDate: e.expenseDate, category: e.category?.name ?? null, vendor: e.vendor?.name ?? null, amount: e.amount, gstAmount: e.gstAmount, itcEligible: e.itcEligible ?? null, paymentMethod: e.paymentMethod, referenceNumber: e.referenceNumber, description: e.description, dueDate: e.dueDate, status: e.status, paid: e.paid });

/** Scooter purchases used to be recorded as expenses in this category; since the cutover they live on the scooter. */
const VEHICLE_PURCHASE_CATEGORY = 'Vehicle Purchase';

const expenseInclude = {
  category: { select: { name: true, itcEligible: true } },
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
    private readonly vendorBills: VendorBillsService,
    private readonly gstFiling: GstFilingService,
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
    await this.assertNotFuture(dto.expenseDate);
    await this.closing.assertOpen(expenseDate);
    await this.assertNotScooterPurchase(category.name, expenseDate);
    const amount = BigInt(dto.amount);
    const gstAmount = BigInt(dto.gstAmount);
    if (gstAmount > 0n) await this.gstFiling.assertOpen(expenseDate, 'GSTR3B', 'its input tax credit');

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
          itcEligible: dto.itcEligible ?? null,
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

    await this.activityLog.record({ actorId: userId, action: 'CREATE', entityType: 'Expense', entityId: created.id, entityLabel: created.expenseNumber, summary: `Recorded expense ${created.expenseNumber} — ${formatInr(amount + gstAmount)} (${created.category.name})`, changes: createdFields(expenseSnapshot(created)) });
    await this.postCreateNotifications(company, created);
    return this.toDto(created);
  }

  async update(id: string, dto: UpdateExpenseInput, userId: string): Promise<ExpenseDto> {
    const existing = await this.getRowOrThrow(id);
    await this.closing.assertOpen(existing.expenseDate);
    if (dto.expenseDate) await this.closing.assertOpen(dto.expenseDate);
    await this.assertNotFuture(dto.expenseDate);
    // A GST bill of a month whose GSTR-3B is filed: its input credit was claimed as it stands.
    const touchesGst = dto.amount !== undefined || dto.gstAmount !== undefined || dto.expenseDate !== undefined || dto.vendorId !== undefined || dto.categoryId !== undefined || dto.itcEligible !== undefined;
    if (touchesGst && existing.gstAmount > 0n) await this.gstFiling.assertOpen(existing.expenseDate, 'GSTR3B', 'this bill’s input tax credit');
    if (touchesGst && (dto.gstAmount ?? 0) > 0 && dto.expenseDate) await this.gstFiling.assertOpen(dto.expenseDate, 'GSTR3B', 'its input tax credit');
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
        itcEligible: dto.itcEligible,
        paymentMethod: dto.paymentMethod,
        referenceNumber: dto.referenceNumber,
        description: dto.description,
        dueDate: dto.dueDate,
        updatedById: userId,
      },
      include: expenseInclude,
    });
    const changes = diffFields(expenseSnapshot(existing), expenseSnapshot(updated), EXPENSE_FIELDS);
    if (Object.keys(changes).length) {
      await this.activityLog.record({ actorId: userId, action: 'UPDATE', entityType: 'Expense', entityId: id, entityLabel: updated.expenseNumber, summary: `Updated expense ${updated.expenseNumber}: ${changesSummary(changes)}`, changes });
    }
    return this.toDto(updated);
  }

  /** Submit a draft for approval (Draft → Pending). */
  async submit(id: string, userId: string): Promise<ExpenseDto> {
    const existing = await this.getRowOrThrow(id);
    if (existing.status !== 'DRAFT') throw new BadRequestException('Only draft expenses can be submitted');
    const updated = await this.prisma.expense.update({ where: { id }, data: { status: 'PENDING', updatedById: userId }, include: expenseInclude });
    await this.activityLog.record({ actorId: userId, action: 'STATUS_CHANGE', entityType: 'Expense', entityId: id, entityLabel: updated.expenseNumber, summary: `Expense ${updated.expenseNumber} submitted for approval`, changes: { status: { from: existing.status, to: 'PENDING' } } });
    return this.toDto(updated);
  }

  async setStatus(id: string, dto: SetExpenseStatusInput, userId: string): Promise<ExpenseDto> {
    const existing = await this.getRowOrThrow(id);
    await this.closing.assertOpen(existing.expenseDate);
    // A settled expense is final — its approval state can't be reversed.
    if (existing.paid) throw new BadRequestException('A settled (paid) expense cannot change approval status');
    if ((await this.vendorBills.allocatedTo({ kind: 'EXPENSE', id })) > 0n) throw new BadRequestException('Part of this expense is paid through a vendor payment — cancel that payment before changing its approval');
    const updated = await this.prisma.expense.update({ where: { id }, data: { status: dto.status, updatedById: userId }, include: expenseInclude });
    await this.activityLog.record({ actorId: userId, action: dto.status === 'APPROVED' ? 'APPROVE' : 'STATUS_CHANGE', entityType: 'Expense', entityId: id, entityLabel: updated.expenseNumber, summary: `Expense ${updated.expenseNumber} ${dto.status.toLowerCase()} — ${formatInr(updated.amount + updated.gstAmount)}`, changes: { status: { from: existing.status, to: dto.status } } });
    return this.toDto(updated);
  }

  async settle(id: string, userId: string): Promise<ExpenseDto> {
    const existing = await this.getRowOrThrow(id);
    // Only an approved expense can be marked paid (a draft/pending/rejected can't).
    if (existing.status !== 'APPROVED') throw new BadRequestException('Only an approved expense can be marked paid');
    await this.closing.assertOpen(existing.expenseDate);
    if ((await this.vendorBills.allocatedTo({ kind: 'EXPENSE', id })) > 0n) throw new BadRequestException('Part of this expense is paid through a vendor payment — pay the rest from the vendor’s page');
    const updated = await this.prisma.expense.update({ where: { id }, data: { paid: true, settledDate: new Date(), updatedById: userId }, include: expenseInclude });
    await this.activityLog.record({ actorId: userId, action: 'PAYMENT', entityType: 'Expense', entityId: id, entityLabel: updated.expenseNumber, summary: `Settled expense ${updated.expenseNumber}: ${formatInr(updated.amount + updated.gstAmount)} (${updated.paymentMethod})`, changes: { paid: { from: false, to: true }, settledDate: { from: null, to: updated.settledDate?.toISOString() ?? null } } });
    return this.toDto(updated);
  }

  async remove(id: string, userId: string): Promise<void> {
    const existing = await this.getRowOrThrow(id);
    await this.closing.assertOpen(existing.expenseDate);
    if (existing.gstAmount > 0n) await this.gstFiling.assertOpen(existing.expenseDate, 'GSTR3B', 'this bill’s input tax credit');
    const released = await this.prisma.$transaction(async (tx) => {
      await tx.expense.update({ where: { id }, data: { deletedAt: new Date(), updatedById: userId } });
      // What vendor payments applied to it stays with the vendor as an advance.
      return this.vendorBills.releaseAllocations(tx, { kind: 'EXPENSE', id });
    });
    await this.activityLog.record({ actorId: userId, action: 'DELETE', entityType: 'Expense', entityId: id, entityLabel: existing.expenseNumber, summary: `Deleted expense ${existing.expenseNumber} of ${formatInr(existing.amount + existing.gstAmount)}${released > 0n ? ' (its vendor payment stays with the vendor as an advance)' : ''}`, changes: diffFields(expenseSnapshot(existing), {} as ReturnType<typeof expenseSnapshot>, EXPENSE_FIELDS) });
  }

  // ── Attachments (Invoice / GST Bill / Photo / PDF) ──
  async addAttachment(id: string, file: UploadedFile, type: string, userId: string): Promise<ExpenseDto> {
    const company = this.tenant.requireCompanyId();
    const expense = await this.getRowOrThrow(id);
    const attType = (['INVOICE', 'GST_BILL', 'PHOTO', 'PDF', 'OTHER'].includes(type) ? type : 'OTHER') as ExpenseAttachmentType;
    const stored = await this.storage.save({ buffer: file.buffer, originalName: file.originalname, mimeType: file.mimetype, folder: `expenses/${id}` });
    const att = await this.prisma.expenseAttachment.create({
      data: { companyId: company, expenseId: id, type: attType, fileKey: stored.fileKey, fileName: file.originalname, mimeType: file.mimetype, sizeBytes: file.size, createdById: userId },
    });
    await this.activityLog.record({ actorId: userId, action: 'UPDATE', entityType: 'Expense', entityId: id, entityLabel: expense.expenseNumber, summary: `Attached ${attType.toLowerCase().replace('_', ' ')} "${file.originalname}" to expense ${expense.expenseNumber}`, metadata: { attachmentId: att.id, fileName: file.originalname, type: attType, sizeBytes: file.size } });
    return this.get(id);
  }

  async removeAttachment(id: string, attachmentId: string, userId: string): Promise<ExpenseDto> {
    const expense = await this.getRowOrThrow(id);
    const att = await this.prisma.expenseAttachment.findFirst({ where: { id: attachmentId, expenseId: id } });
    if (!att) throw new NotFoundException('Attachment not found');
    await this.prisma.expenseAttachment.delete({ where: { id: attachmentId } });
    await this.storage.remove(att.fileKey).catch(() => undefined);
    await this.activityLog.record({ actorId: userId, action: 'DELETE', entityType: 'Expense', entityId: id, entityLabel: expense.expenseNumber, summary: `Removed attachment "${att.fileName}" from expense ${expense.expenseNumber}`, metadata: { attachmentId, fileName: att.fileName, type: att.type } });
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
      itcEligible: e.itcEligible ?? e.category.itcEligible,
      itcOverride: e.itcEligible,
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

  /** An expense is recorded for a day it was incurred — today or earlier; a bill due later carries a due date. */
  /** Since per-scooter purchase tracking, a scooter's cost is entered on the scooter — never again as an expense. */
  private async assertNotScooterPurchase(categoryName: string, expenseDate: Date): Promise<void> {
    if (categoryName !== VEHICLE_PURCHASE_CATEGORY) return;
    const setting = await this.prisma.companySetting.findFirst({ select: { scooterCostCutoverAt: true } });
    const cutover = setting?.scooterCostCutoverAt;
    if (cutover && expenseDate.toISOString().slice(0, 10) >= cutover.toISOString().slice(0, 10)) {
      throw new BadRequestException('Scooter purchases are recorded on the scooter now: add it under Inventory with its vendor and purchase price (its cost reaches the P&L when it is sold, and the vendor is owed until paid)');
    }
  }

  private async assertNotFuture(expenseDate: Date | undefined): Promise<void> {
    if (!expenseDate) return;
    const setting = await this.prisma.companySetting.findFirst({ select: { timezone: true } });
    if (isAfterBusinessToday(expenseDate, new Date(), resolveTimeZone(setting?.timezone))) throw new BadRequestException('The expense date cannot be in the future');
  }
}
