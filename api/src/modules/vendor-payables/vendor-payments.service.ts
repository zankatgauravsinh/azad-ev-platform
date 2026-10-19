import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ActivityAction,
  PURCHASE_COST_BILL_KINDS,
  VENDOR_BILL_KIND_LABEL,
  buildPageMeta,
  type ApplyVendorPaymentInput,
  type CancelVendorPaymentInput,
  type CreateVendorPaymentInput,
  type FinancePayMethod,
  type ListVendorPaymentsQuery,
  type Paginated,
  type VendorAllocationInput,
  type VendorBillKind,
  type VendorPaymentDto,
} from '@azad/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantContext } from '../../tenant/tenant-context.service';
import { ActivityLogService } from '../../activity-log/activity-log.service';
import { MonthlyClosingService } from '../finance/monthly-closing.service';
import { SequenceService } from '../sales/sequence.service';
import { isAfterBusinessToday, resolveTimeZone } from '../../common/utils/business-date';
import { formatInr } from '../../common/utils/money';
import { VendorBillsService, visibleBillKinds } from './vendor-bills.service';

type Tx = Prisma.TransactionClient;

const paymentInclude = {
  vendor: { select: { name: true } },
  purchaseOrder: { select: { poNumber: true } },
  allocations: {
    orderBy: { createdAt: 'asc' },
    include: {
      unit: { select: { vin: true, variant: { select: { name: true, colour: true, model: { select: { name: true } } } } } },
      accessoryPurchase: { select: { purchaseNumber: true, vendorInvoiceNumber: true } },
      expense: { select: { expenseNumber: true, description: true, category: { select: { name: true } } } },
    },
  },
} satisfies Prisma.VendorPaymentInclude;
type PaymentRow = Prisma.VendorPaymentGetPayload<{ include: typeof paymentInclude }>;

/** A calendar date as midnight UTC (how payment dates are stored). */
const calendarDay = (d: Date): Date => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const METHOD_LABEL: Record<FinancePayMethod, string> = { CASH: 'cash', UPI: 'UPI', CARD: 'card', BANK_TRANSFER: 'bank transfer', CHEQUE: 'cheque' };

/** Payments a caller without purchase cost may see: ones that touch expenses only (no scooter / accessory bill, no order). */
export const costFreePaymentWhere: Prisma.VendorPaymentWhereInput = {
  purchaseOrderId: null,
  allocations: { none: { kind: { in: [...PURCHASE_COST_BILL_KINDS] } } },
};

export interface CreatePaymentOptions {
  canSeeCost: boolean;
  /** The bill date the payment may not be before is not checked for advances; a one-bill "mark paid" passes it. */
  notBefore?: Date;
}

/**
 * Money paid to vendors. One payment settles several bills, each in full or in part, and what is left stays with
 * the vendor as an advance, applied to bills later. Payments follow month-close (by their date) and are never
 * edited: a wrong one is cancelled, which makes its bills unpaid again. Cash payments leave the drawer on their
 * date (the cash book reads them); the bills they settle are then left out of their own cash rows.
 */
@Injectable()
export class VendorPaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContext,
    private readonly sequence: SequenceService,
    private readonly activityLog: ActivityLogService,
    private readonly closing: MonthlyClosingService,
    private readonly bills: VendorBillsService,
  ) {}

  async list(query: ListVendorPaymentsQuery, canSeeCost: boolean): Promise<Paginated<VendorPaymentDto>> {
    const where: Prisma.VendorPaymentWhereInput = { ...(canSeeCost ? {} : costFreePaymentWhere) };
    if (query.vendorId) where.vendorId = query.vendorId;
    if (query.purchaseOrderId) where.purchaseOrderId = query.purchaseOrderId;
    if (query.status) where.status = query.status;
    if (query.from || query.to) where.paidAt = { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) };
    if (query.q) {
      where.OR = [
        { paymentNumber: { contains: query.q, mode: 'insensitive' } },
        { reference: { contains: query.q, mode: 'insensitive' } },
        { vendor: { name: { contains: query.q, mode: 'insensitive' } } },
      ];
    }
    if (query.withAdvance) {
      // Few payments carry an advance; narrow in memory after the page of candidates (active ones only).
      where.status = 'ACTIVE';
      const rows = await this.prisma.vendorPayment.findMany({ where, include: paymentInclude, orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }], take: 1000 });
      const withAdvance = rows.filter((r) => r.amount > r.allocations.reduce((a, x) => a + x.amount, 0n));
      const page = withAdvance.slice((query.page - 1) * query.pageSize, query.page * query.pageSize);
      const names = await this.userNames(page.map((r) => r.createdById));
      return { data: page.map((r) => this.toDto(r, names)), meta: buildPageMeta(query.page, query.pageSize, withAdvance.length) };
    }
    const [rows, total] = await Promise.all([
      this.prisma.vendorPayment.findMany({ where, include: paymentInclude, orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }], skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      this.prisma.vendorPayment.count({ where }),
    ]);
    const names = await this.userNames(rows.map((r) => r.createdById));
    return { data: rows.map((r) => this.toDto(r, names)), meta: buildPageMeta(query.page, query.pageSize, total) };
  }

  async get(id: string, canSeeCost: boolean): Promise<VendorPaymentDto> {
    const row = await this.getRowOrThrow(id, canSeeCost);
    return this.toDto(row, await this.userNames([row.createdById]));
  }

  async create(dto: CreateVendorPaymentInput, userId: string, options: CreatePaymentOptions): Promise<VendorPaymentDto> {
    const id = await this.prisma.$transaction((tx) => this.createInTx(tx, dto, userId, options));
    return this.get(id, options.canSeeCost);
  }

  /** Records a payment inside the caller's transaction (a scooter added as paid, an accessory bill marked paid). */
  async createInTx(tx: Tx, dto: CreateVendorPaymentInput, userId: string, options: CreatePaymentOptions): Promise<string> {
    const companyId = this.tenant.requireCompanyId();
    const vendor = await tx.vendor.findFirst({ where: { id: dto.vendorId }, select: { id: true, name: true } });
    if (!vendor) throw new NotFoundException('Vendor not found');
    if (dto.purchaseOrderId && !options.canSeeCost) throw new ForbiddenException('Purchase orders show what you pay for stock — only the owner (purchase-cost permission) can pay against them');
    if (dto.purchaseOrderId) {
      const po = await tx.purchaseOrder.findFirst({ where: { id: dto.purchaseOrderId }, select: { vendorId: true, status: true, poNumber: true } });
      if (!po) throw new NotFoundException('Purchase order not found');
      if (po.vendorId !== vendor.id) throw new BadRequestException(`${po.poNumber} is with another vendor`);
      if (po.status === 'CANCELLED') throw new BadRequestException(`${po.poNumber} is cancelled`);
    }
    const timeZone = await this.businessTimeZone(tx);
    const now = new Date();
    if (dto.paidAt && isAfterBusinessToday(dto.paidAt, now, timeZone)) throw new BadRequestException('The payment date cannot be in the future');
    const paidAt = dto.paidAt ? calendarDay(dto.paidAt) : await this.bills.businessToday(tx);
    if (options.notBefore && paidAt < calendarDay(options.notBefore)) throw new BadRequestException('The payment date cannot be before the bill date');
    await this.closing.assertOpen(paidAt);

    await this.checkAllocations(tx, vendor.id, dto.allocations, options.canSeeCost);
    const paymentNumber = await this.sequence.next('vendorPayment', tx);
    const payment = await tx.vendorPayment.create({
      data: {
        companyId,
        paymentNumber,
        vendorId: vendor.id,
        paidAt,
        method: dto.method,
        reference: dto.reference || null,
        amount: BigInt(dto.amount),
        notes: dto.notes || null,
        purchaseOrderId: dto.purchaseOrderId ?? null,
        createdById: userId,
        updatedById: userId,
        allocations: { create: dto.allocations.map((a) => ({ companyId, ...this.billRef(a), amount: BigInt(a.amount), appliedAt: paidAt, createdById: userId })) },
      },
    });
    for (const a of dto.allocations) await this.bills.syncBill(tx, { kind: a.kind, id: a.billId }, userId);
    const applied = dto.allocations.reduce((s, a) => s + a.amount, 0);
    const advance = dto.amount - applied;
    // Amounts stay out of the activity log when purchase bills are involved (read by people without purchase cost).
    const showAmount = !dto.allocations.some((a) => PURCHASE_COST_BILL_KINDS.includes(a.kind)) && !dto.purchaseOrderId;
    await this.activityLog.recordInTransaction(
      {
        actorId: userId,
        action: ActivityAction.PAYMENT,
        entityType: 'VendorPayment',
        entityId: payment.id,
        summary: `Vendor payment ${paymentNumber} to ${vendor.name}${showAmount ? ` — ${formatInr(BigInt(dto.amount))}` : ''} (${METHOD_LABEL[dto.method]}): ${dto.allocations.length} bill${dto.allocations.length === 1 ? '' : 's'}${advance > 0 ? ', part kept as advance' : ''}`,
      },
      tx,
    );
    return payment.id;
  }

  /** Applies what is left on a payment (its advance) to bills of the same vendor. */
  async apply(id: string, dto: ApplyVendorPaymentInput, userId: string, canSeeCost: boolean): Promise<VendorPaymentDto> {
    const companyId = this.tenant.requireCompanyId();
    const appliedAt = await this.bills.businessToday();
    await this.closing.assertOpen(appliedAt);
    await this.prisma.$transaction(async (tx) => {
      const [locked] = await tx.$queryRaw<{ id: string; vendorId: string; amount: bigint; status: string; paymentNumber: string }[]>`
        SELECT id, "vendorId", amount, status, "paymentNumber" FROM "VendorPayment" WHERE id = ${id} AND "companyId" = ${companyId} FOR UPDATE`;
      if (!locked) throw new NotFoundException('Vendor payment not found');
      if (!canSeeCost) await this.getRowOrThrow(id, false, tx); // a payment the caller cannot see is "not found"
      if (locked.status !== 'ACTIVE') throw new BadRequestException('This payment is cancelled');
      const applied = await tx.vendorPaymentAllocation.aggregate({ _sum: { amount: true }, where: { paymentId: id } });
      const left = locked.amount - (applied._sum.amount ?? 0n);
      const wanted = dto.allocations.reduce((s, a) => s + BigInt(a.amount), 0n);
      if (wanted > left) throw new BadRequestException(`Only ${formatInr(left)} of ${locked.paymentNumber} is left to apply`);
      await this.checkAllocations(tx, locked.vendorId, dto.allocations, canSeeCost);
      await tx.vendorPaymentAllocation.createMany({ data: dto.allocations.map((a) => ({ companyId, paymentId: id, ...this.billRef(a), amount: BigInt(a.amount), appliedAt, createdById: userId })) });
      await tx.vendorPayment.update({ where: { id }, data: { updatedById: userId } });
      for (const a of dto.allocations) await this.bills.syncBill(tx, { kind: a.kind, id: a.billId }, userId);
      await this.activityLog.recordInTransaction({ actorId: userId, action: ActivityAction.PAYMENT, entityType: 'VendorPayment', entityId: id, summary: `Applied advance of ${locked.paymentNumber} to ${dto.allocations.length} bill${dto.allocations.length === 1 ? '' : 's'}` }, tx);
    });
    return this.get(id, canSeeCost);
  }

  /** Cancels a payment: its bills are unpaid again (the cash book drops it too). */
  async cancel(id: string, dto: CancelVendorPaymentInput, userId: string, canSeeCost: boolean): Promise<VendorPaymentDto> {
    const row = await this.getRowOrThrow(id, canSeeCost);
    if (row.status === 'CANCELLED') throw new ConflictException('This payment is already cancelled');
    await this.closing.assertOpen(row.paidAt);
    for (const a of row.allocations) await this.closing.assertOpen(a.appliedAt);
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.vendorPayment.updateMany({ where: { id, status: 'ACTIVE' }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledById: userId, cancelReason: dto.reason, updatedById: userId } });
      if (claimed.count !== 1) throw new ConflictException('This payment is already cancelled');
      for (const a of row.allocations) await this.bills.syncBill(tx, { kind: a.kind, id: (a.unitId ?? a.accessoryPurchaseId ?? a.expenseId)! }, userId);
      await this.activityLog.recordInTransaction({ actorId: userId, action: ActivityAction.STATUS_CHANGE, entityType: 'VendorPayment', entityId: id, summary: `Cancelled vendor payment ${row.paymentNumber} to ${row.vendor.name} — ${dto.reason}` }, tx);
    });
    return this.get(id, canSeeCost);
  }

  // ── Internal ───────────────────────────────────────────
  /**
   * Every bill must be the vendor's, one the caller may see, not paid directly, and owe at least what is applied.
   * The bills are locked first, so two payments cannot both settle the same balance.
   */
  private async checkAllocations(tx: Tx, vendorId: string, allocations: VendorAllocationInput[], canSeeCost: boolean): Promise<void> {
    if (allocations.length === 0) return;
    const visible = visibleBillKinds(canSeeCost);
    const hidden = allocations.find((a) => !visible.includes(a.kind));
    if (hidden) throw new ForbiddenException(`${VENDOR_BILL_KIND_LABEL[hidden.kind]} bills show what you paid for stock — only the owner (purchase-cost permission) can pay them`);
    const refs = allocations.map((a) => ({ kind: a.kind, id: a.billId }));
    await this.bills.lockBills(tx, refs);
    const found = await this.bills.list({ kinds: visible, billIds: refs }, tx);
    const byKey = new Map(found.map((b) => [`${b.kind}:${b.id}`, b]));
    for (const a of allocations) {
      const bill = byKey.get(`${a.kind}:${a.billId}`);
      if (!bill) throw new NotFoundException(`${VENDOR_BILL_KIND_LABEL[a.kind]} bill not found — it may have been cancelled or deleted`);
      if (bill.vendorId !== vendorId) throw new BadRequestException(`${bill.number} is a bill of another vendor`);
      if (bill.paidDirect || bill.balance === 0n) throw new ConflictException(`${bill.number} is already paid`);
      if (BigInt(a.amount) > bill.balance) throw new BadRequestException(`Only ${formatInr(bill.balance)} is owed on ${bill.number}`);
    }
  }

  private billRef(a: { kind: VendorBillKind; billId: string }): { kind: VendorBillKind; unitId?: string; accessoryPurchaseId?: string; expenseId?: string } {
    if (a.kind === 'SCOOTER') return { kind: a.kind, unitId: a.billId };
    if (a.kind === 'ACCESSORY_PURCHASE') return { kind: a.kind, accessoryPurchaseId: a.billId };
    return { kind: a.kind, expenseId: a.billId };
  }

  private async getRowOrThrow(id: string, canSeeCost: boolean, db: Tx | PrismaService = this.prisma): Promise<PaymentRow> {
    const row = await db.vendorPayment.findFirst({ where: { id, ...(canSeeCost ? {} : costFreePaymentWhere) }, include: paymentInclude });
    if (!row) throw new NotFoundException('Vendor payment not found');
    return row;
  }

  private async businessTimeZone(db: Tx | PrismaService): Promise<string> {
    const s = await db.companySetting.findFirst({ select: { timezone: true } });
    return resolveTimeZone(s?.timezone);
  }

  private async userNames(ids: (string | null)[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((i): i is string => Boolean(i)))];
    if (!unique.length) return new Map();
    const users = await this.prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
    return new Map(users.map((u) => [u.id, u.name]));
  }

  private toDto(r: PaymentRow, names: Map<string, string>): VendorPaymentDto {
    const applied = r.allocations.reduce((a, x) => a + x.amount, 0n);
    return {
      id: r.id,
      paymentNumber: r.paymentNumber,
      vendorId: r.vendorId,
      vendorName: r.vendor.name,
      paidAt: r.paidAt.toISOString(),
      method: r.method,
      reference: r.reference,
      amount: String(r.amount),
      applied: String(r.status === 'ACTIVE' ? applied : 0n),
      unapplied: String(r.status === 'ACTIVE' ? r.amount - applied : 0n),
      notes: r.notes,
      purchaseOrderId: r.purchaseOrderId,
      poNumber: r.purchaseOrder?.poNumber ?? null,
      status: r.status,
      cancelledAt: r.cancelledAt?.toISOString() ?? null,
      cancelReason: r.cancelReason,
      createdByName: r.createdById ? (names.get(r.createdById) ?? null) : null,
      createdAt: r.createdAt.toISOString(),
      allocations: r.allocations.map((a) => {
        const unit = a.unit;
        const purchase = a.accessoryPurchase;
        const expense = a.expense;
        return {
          id: a.id,
          kind: a.kind,
          billId: (a.unitId ?? a.accessoryPurchaseId ?? a.expenseId)!,
          billNumber: unit?.vin ?? purchase?.purchaseNumber ?? expense?.expenseNumber ?? '—',
          description: unit
            ? `${unit.variant.model.name} ${unit.variant.name} (${unit.variant.colour})`
            : purchase
              ? `Accessory purchase${purchase.vendorInvoiceNumber ? ` · bill ${purchase.vendorInvoiceNumber}` : ''}`
              : expense
                ? `${expense.category.name}${expense.description ? ` — ${expense.description}` : ''}`
                : '',
          amount: String(a.amount),
          appliedAt: a.appliedAt.toISOString(),
        };
      }),
    };
  }
}
