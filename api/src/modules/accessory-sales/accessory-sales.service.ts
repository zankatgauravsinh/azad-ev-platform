import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ActivityAction,
  BookingStatus,
  CustomerEventType,
  PaymentContext,
  RtoSupplyType,
  buildPageMeta,
  splitInclusiveGst,
  type AccessoryPaymentStatus,
  type AccessorySaleDefaults,
  type AccessorySaleDetailDto,
  type AccessorySaleDto,
  type AddAccessorySalePaymentInput,
  type CancelAccessorySaleInput,
  type CreateAccessorySaleInput,
  type ListAccessorySalesQuery,
  type Paginated,
} from '@azad/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantContext } from '../../tenant/tenant-context.service';
import { ActivityLogService } from '../../activity-log/activity-log.service';
import { CustomerTimelineService } from '../customers/customer-timeline.service';
import { MonthlyClosingService } from '../finance/monthly-closing.service';
import { SequenceService } from '../sales/sequence.service';
import { PdfBrandService } from '../../common/pdf/pdf-brand.service';
import { AccessoryInvoicePdfService } from './accessory-invoice-pdf.service';
import { formatInrExact } from '../../common/utils/money';
import { resolveTimeZone } from '../../common/utils/business-date';
import { weightedAvgCost } from '../../common/utils/inventory-cost';
import { accessoryGstRates } from '../accessories/accessory-gst-rates';
import { createdFields } from '../../activity-log/audit-diff';

type Tx = Prisma.TransactionClient;

const saleInclude = {
  customer: { select: { id: true, name: true, phone: true } },
  booking: { select: { id: true, code: true } },
  items: { orderBy: { name: 'asc' } },
  payments: { orderBy: { paidAt: 'asc' } },
  refunds: { orderBy: { refundedAt: 'asc' } },
} satisfies Prisma.AccessorySaleInclude;
type SaleRow = Prisma.AccessorySaleGetPayload<{ include: typeof saleInclude }>;

/** An accessory's stock, read under a row lock. */
interface LockedStock {
  id: string;
  name: string;
  onHand: number;
  reserved: number;
  avgCost: bigint;
}

export interface Actor {
  id: string;
}

const sum = (xs: bigint[]): bigint => xs.reduce((a, b) => a + b, 0n);

/**
 * Accessory counter sales — accessories sold on their own invoice, separate from the scooter's. A sale takes the
 * pieces out of stock at once (never more than is available), at prices that default to the catalogue and may be
 * changed. When Settings puts GST on accessory invoices, the prices include GST and each line's GST is split out at
 * the accessory's classification rate (or the default rate). Payments may be part; a cancellation (owner /
 * manager) puts the stock back and refunds what was paid. Sales, payments and refunds follow month-close.
 */
@Injectable()
export class AccessorySalesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContext,
    private readonly sequence: SequenceService,
    private readonly timeline: CustomerTimelineService,
    private readonly activityLog: ActivityLogService,
    private readonly closing: MonthlyClosingService,
    private readonly pdf: AccessoryInvoicePdfService,
    private readonly brand: PdfBrandService,
  ) {}

  // ── Reads ──────────────────────────────────────────────
  async defaults(customerId?: string): Promise<AccessorySaleDefaults> {
    const settings = await this.prisma.companySetting.findFirst({ select: { accessoryGstEnabled: true, accessoryGstRateBp: true, gstStateCode: true, timezone: true } });
    const customer = customerId ? await this.prisma.customer.findFirst({ where: { id: customerId }, select: { id: true, gstStateCode: true } }) : null;
    if (customerId && !customer) throw new NotFoundException('Customer not found');
    const accessories = await this.prisma.accessory.findMany({ where: { isActive: true }, select: { id: true, taxClassificationId: true } });
    const rates = await accessoryGstRates(this.prisma, accessories, settings?.accessoryGstRateBp ?? 1800, resolveTimeZone(settings?.timezone));
    const bookings = customer
      ? await this.prisma.booking.findMany({ where: { customerId: customer.id, status: { not: BookingStatus.CANCELLED } }, select: { id: true, code: true, status: true }, orderBy: { createdAt: 'desc' }, take: 20 })
      : [];
    return {
      gstEnabled: settings?.accessoryGstEnabled ?? false,
      defaultGstRateBp: settings?.accessoryGstRateBp ?? 1800,
      rates: Object.fromEntries(rates),
      ...suggestSupply(settings?.gstStateCode ?? null, customer?.gstStateCode ?? null),
      bookings,
    };
  }

  async list(query: ListAccessorySalesQuery): Promise<Paginated<AccessorySaleDto>> {
    const where: Prisma.AccessorySaleWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.customerId) where.customerId = query.customerId;
    if (query.bookingId) where.bookingId = query.bookingId;
    if (query.accessoryId) where.items = { some: { accessoryId: query.accessoryId } };
    if (query.from || query.to) where.invoiceDate = { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) };
    if (query.q) {
      where.OR = [
        { invoiceNumber: { contains: query.q, mode: 'insensitive' } },
        { customer: { name: { contains: query.q, mode: 'insensitive' } } },
        { customer: { phone: { contains: query.q } } },
      ];
    }
    const [rows, total] = await Promise.all([
      this.prisma.accessorySale.findMany({ where, include: saleInclude, orderBy: { invoiceDate: 'desc' }, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      this.prisma.accessorySale.count({ where }),
    ]);
    const names = await this.userNames(rows.flatMap((r) => [r.createdById, r.cancelledById]));
    return { data: rows.map((r) => this.toDto(r, names)), meta: buildPageMeta(query.page, query.pageSize, total) };
  }

  async getById(id: string, canSeeCost: boolean): Promise<AccessorySaleDetailDto> {
    const row = await this.getRowOrThrow(id);
    const names = await this.userNames([row.createdById, row.cancelledById, ...row.payments.map((p) => p.receivedById)]);
    return this.toDetailDto(row, names, canSeeCost);
  }

  // ── Mutations ──────────────────────────────────────────
  async create(dto: CreateAccessorySaleInput, actor: Actor, canSeeCost: boolean): Promise<AccessorySaleDetailDto> {
    const companyId = this.tenant.requireCompanyId();
    const now = new Date();
    const customer = await this.prisma.customer.findFirst({ where: { id: dto.customerId }, select: { id: true, name: true, gstStateCode: true } });
    if (!customer) throw new NotFoundException('Customer not found');
    if (dto.bookingId) {
      const booking = await this.prisma.booking.findFirst({ where: { id: dto.bookingId }, select: { customerId: true, code: true, status: true } });
      if (!booking) throw new NotFoundException('Booking not found');
      if (booking.customerId !== customer.id) throw new BadRequestException(`Booking ${booking.code} belongs to another customer`);
      if (booking.status === BookingStatus.CANCELLED) throw new BadRequestException(`Booking ${booking.code} is cancelled`);
    }
    const accessories = await this.prisma.accessory.findMany({ where: { id: { in: dto.items.map((l) => l.accessoryId) } } });
    const byId = new Map(accessories.map((a) => [a.id, a]));
    for (const line of dto.items) {
      const a = byId.get(line.accessoryId);
      if (!a) throw new NotFoundException('Accessory not found');
      if (!a.isActive) throw new BadRequestException(`${a.name} is inactive — activate it to sell it`);
    }

    const settings = await this.prisma.companySetting.findFirst({ select: { accessoryGstEnabled: true, accessoryGstRateBp: true, gstStateCode: true, timezone: true } });
    const gstApplied = settings?.accessoryGstEnabled ?? false;
    const supplyType = dto.supplyType ?? suggestSupply(settings?.gstStateCode ?? null, customer.gstStateCode).supplyType;
    const rates = gstApplied ? await accessoryGstRates(this.prisma, accessories, settings?.accessoryGstRateBp ?? 1800, resolveTimeZone(settings?.timezone)) : new Map<string, { gstRateBp: number; hsnCode: string | null }>();
    const hsn = await this.hsnCodes(accessories);

    const lines = dto.items.map((l) => {
      const a = byId.get(l.accessoryId)!;
      const lineTotal = BigInt(l.unitPrice) * BigInt(l.qty);
      const gstRateBp = gstApplied ? (rates.get(a.id)?.gstRateBp ?? 0) : 0;
      const split = splitInclusiveGst(lineTotal, gstRateBp, supplyType);
      return { accessory: a, qty: l.qty, unitPrice: BigInt(l.unitPrice), lineTotal, gstRateBp, split };
    });
    const total = sum(lines.map((l) => l.lineTotal));
    const head = {
      subtotal: sum(lines.map((l) => l.split.taxable)),
      cgst: sum(lines.map((l) => l.split.cgst)),
      sgst: sum(lines.map((l) => l.split.sgst)),
      igst: sum(lines.map((l) => l.split.igst)),
      gstAmount: sum(lines.map((l) => l.split.gst)),
      total,
    };
    if (dto.payment && BigInt(dto.payment.amount) > total) throw new BadRequestException(`The payment exceeds the invoice total of ${formatInrExact(total)}`);
    await this.closing.assertOpen(now);

    const created = await this.prisma.$transaction(async (tx) => {
      // Lock the accessories in id order (two sales of the same items never deadlock), then check what is available.
      const locked = new Map<string, LockedStock>();
      for (const id of [...byId.keys()].sort()) locked.set(id, await lockStock(tx, companyId, id));
      for (const l of lines) {
        const s = locked.get(l.accessory.id)!;
        const available = s.onHand - s.reserved;
        if (l.qty > available) throw new ConflictException(`Only ${Math.max(0, available)} of ${s.name} ${available === 1 ? 'is' : 'are'} available`);
      }

      const invoiceNumber = await this.sequence.next('accessoryInvoice', tx);
      const sale = await tx.accessorySale.create({
        data: {
          companyId,
          invoiceNumber,
          invoiceDate: now,
          customerId: customer.id,
          bookingId: dto.bookingId ?? null,
          gstApplied,
          supplyType: gstApplied ? supplyType : null,
          ...head,
          notes: dto.notes || null,
          createdById: actor.id,
          updatedById: actor.id,
          items: {
            create: lines.map((l) => ({
              accessoryId: l.accessory.id,
              name: l.accessory.name,
              sku: l.accessory.sku,
              hsnCode: hsn.get(l.accessory.id) ?? null,
              qty: l.qty,
              unitPrice: l.unitPrice,
              gstRateBp: l.gstRateBp,
              taxable: l.split.taxable,
              gstAmount: l.split.gst,
              lineTotal: l.lineTotal,
              costAtSale: locked.get(l.accessory.id)!.avgCost,
            })),
          },
        },
      });

      for (const l of lines) {
        const s = locked.get(l.accessory.id)!;
        const onHand = s.onHand - l.qty;
        await tx.accessory.update({ where: { id: s.id }, data: { onHand, updatedById: actor.id } });
        await tx.accessoryStockMovement.create({
          data: { companyId, accessoryId: s.id, type: 'SALE_OUT', quantity: l.qty, unitCost: s.avgCost, onHandAfter: onHand, reservedAfter: s.reserved, refType: 'AccessorySale', refId: sale.id, note: `${invoiceNumber} · ${customer.name}`, createdById: actor.id },
        });
      }

      if (dto.payment) await this.insertPayment(tx, sale.id, invoiceNumber, customer.id, dto.payment, actor, now);
      await this.timeline.record({ customerId: customer.id, type: CustomerEventType.INVOICE_GENERATED, title: `Accessories invoice ${invoiceNumber}`, description: `${lines.map((l) => `${l.accessory.name} × ${l.qty}`).join(', ')} · ${formatInrExact(total)}`, entityType: 'AccessorySale', entityId: sale.id, actorId: actor.id }, tx);
      await this.activityLog.recordInTransaction({ actorId: actor.id, action: ActivityAction.CREATE, entityType: 'AccessorySale', entityId: sale.id, entityLabel: invoiceNumber, summary: `Accessory sale ${invoiceNumber} to ${customer.name} — ${formatInrExact(total)}`, changes: createdFields({ customer: customer.name, total }) }, tx);
      return sale;
    });
    return this.getById(created.id, canSeeCost);
  }

  async addPayment(id: string, dto: AddAccessorySalePaymentInput, actor: Actor, canSeeCost: boolean): Promise<AccessorySaleDetailDto> {
    const sale = await this.getRowOrThrow(id);
    if (sale.status === 'CANCELLED') throw new BadRequestException('This accessory sale is cancelled');
    const now = new Date();
    await this.closing.assertOpen(now);
    await this.prisma.$transaction(async (tx) => {
      // Locked, so two payments recorded at once cannot both pass the balance check.
      await tx.$queryRaw`SELECT id FROM "AccessorySale" WHERE id = ${id} FOR UPDATE`;
      const paid = await tx.payment.aggregate({ where: { accessorySaleId: id }, _sum: { amount: true } });
      const balance = sale.total - (paid._sum.amount ?? 0n);
      if (balance <= 0n) throw new BadRequestException('This accessory sale is already fully paid');
      if (BigInt(dto.amount) > balance) throw new BadRequestException(`The payment exceeds the balance due of ${formatInrExact(balance)}`);
      await this.insertPayment(tx, id, sale.invoiceNumber, sale.customerId, dto, actor, now);
    });
    return this.getById(id, canSeeCost);
  }

  /**
   * Owner / manager (accessories.cancel). The pieces go back into stock at the cost they left at; what was paid is
   * refunded by `refundMode`. The invoice keeps its number, marked CANCELLED.
   */
  async cancel(id: string, dto: CancelAccessorySaleInput, actor: Actor, canSeeCost: boolean): Promise<AccessorySaleDetailDto> {
    const companyId = this.tenant.requireCompanyId();
    const sale = await this.getRowOrThrow(id);
    if (sale.status === 'CANCELLED') throw new ConflictException('This accessory sale is already cancelled');
    const paid = sum(sale.payments.map((p) => p.amount));
    if (paid > 0n && !dto.refundMode) throw new BadRequestException(`${formatInrExact(paid)} was paid — choose how it is refunded`);
    const now = new Date();
    await this.closing.assertOpen(now);

    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.accessorySale.updateMany({ where: { id, status: 'ACTIVE' }, data: { status: 'CANCELLED', cancelledAt: now, cancelledById: actor.id, cancelReason: dto.reason, updatedById: actor.id } });
      if (claimed.count !== 1) throw new ConflictException('This accessory sale is already cancelled');
      // A payment recorded after the read above must be refunded too.
      const paidNow = (await tx.payment.aggregate({ where: { accessorySaleId: id }, _sum: { amount: true } }))._sum.amount ?? 0n;
      if (paidNow > 0n && !dto.refundMode) throw new BadRequestException(`${formatInrExact(paidNow)} was paid — choose how it is refunded`);

      const qtyBy = new Map<string, { qty: number; cost: bigint }>();
      for (const item of sale.items) {
        const cur = qtyBy.get(item.accessoryId) ?? { qty: 0, cost: item.costAtSale };
        qtyBy.set(item.accessoryId, { qty: cur.qty + item.qty, cost: item.costAtSale });
      }
      for (const accessoryId of [...qtyBy.keys()].sort()) {
        const back = qtyBy.get(accessoryId)!;
        const s = await lockStock(tx, companyId, accessoryId);
        const onHand = s.onHand + back.qty;
        await tx.accessory.update({ where: { id: accessoryId }, data: { onHand, avgCost: weightedAvgCost(s.onHand, s.avgCost, back.qty, back.cost), updatedById: actor.id } });
        await tx.accessoryStockMovement.create({
          data: { companyId, accessoryId, type: 'SALE_RETURN', quantity: back.qty, unitCost: back.cost, onHandAfter: onHand, reservedAfter: s.reserved, refType: 'AccessorySale', refId: id, note: `${sale.invoiceNumber} cancelled — ${dto.reason}`, createdById: actor.id },
        });
      }

      if (paidNow > 0n) {
        const refundNumber = await this.sequence.next('refund', tx);
        await tx.refund.create({
          data: { companyId, refundNumber, accessorySaleId: id, customerId: sale.customerId, amount: paidNow, method: dto.refundMode!, reference: dto.refundReference ?? null, note: `${sale.invoiceNumber} cancelled — ${dto.reason}`, refundedById: actor.id, refundedAt: now, createdById: actor.id, updatedById: actor.id },
        });
      }
      await this.timeline.record({ customerId: sale.customerId, type: CustomerEventType.NOTE_ADDED, title: `Accessories invoice ${sale.invoiceNumber} cancelled`, description: paidNow > 0n ? `${dto.reason} · refunded ${formatInrExact(paidNow)}` : dto.reason, entityType: 'AccessorySale', entityId: id, actorId: actor.id }, tx);
      await this.activityLog.recordInTransaction({ actorId: actor.id, action: ActivityAction.CANCEL, entityType: 'AccessorySale', entityId: id, entityLabel: sale.invoiceNumber, summary: `Cancelled accessory sale ${sale.invoiceNumber}${paidNow > 0n ? ` (refunded ${formatInrExact(paidNow)}${dto.refundMode ? ` by ${dto.refundMode}` : ''})` : ''}`, reason: dto.reason, changes: { status: { from: 'ACTIVE', to: 'CANCELLED' }, ...(paidNow > 0n ? { refunded: { from: null, to: paidNow.toString() } } : {}) } }, tx);
    });
    return this.getById(id, canSeeCost);
  }

  /** The invoice PDF (never shows cost). */
  async renderPdf(id: string): Promise<{ buffer: Buffer; filename: string }> {
    const row = await this.getRowOrThrow(id);
    const [customer, settings, brand] = await Promise.all([
      this.prisma.customer.findFirst({ where: { id: row.customerId }, select: { name: true, phone: true, address: true, village: true, city: true, district: true, state: true, pin: true, gstin: true } }),
      this.prisma.companySetting.findFirst({ select: { gstNumber: true, gstStateCode: true, state: true, timezone: true } }),
      this.brand.resolve(),
    ]);
    const names = await this.userNames([row.createdById, ...row.payments.map((p) => p.receivedById)]);
    const buffer = await this.pdf.render(
      { sale: this.toDetailDto(row, names, false), customer, dealer: { gstin: settings?.gstNumber ?? null, state: settings?.state ?? null, stateCode: settings?.gstStateCode ?? null }, timeZone: resolveTimeZone(settings?.timezone) },
      brand,
    );
    return { buffer, filename: `accessory-invoice-${row.invoiceNumber}.pdf` };
  }

  // ── Internal ───────────────────────────────────────────
  private async insertPayment(tx: Tx, saleId: string, invoiceNumber: string, customerId: string, dto: AddAccessorySalePaymentInput, actor: Actor, at: Date): Promise<void> {
    const receiptNumber = await this.sequence.next('receipt', tx);
    const payment = await tx.payment.create({
      data: { receiptNumber, context: PaymentContext.ACCESSORY, accessorySaleId: saleId, amount: BigInt(dto.amount), mode: dto.mode, reference: dto.reference ?? null, receivedById: actor.id, paidAt: at, createdById: actor.id, updatedById: actor.id },
    });
    await this.timeline.record({ customerId, type: CustomerEventType.ADVANCE_PAYMENT, title: `Payment received for ${invoiceNumber} (${dto.mode})`, description: `${receiptNumber} · ${formatInrExact(BigInt(dto.amount))}`, entityType: 'Payment', entityId: payment.id, actorId: actor.id }, tx);    await this.activityLog.recordInTransaction({
      actorId: actor.id, action: ActivityAction.PAYMENT, entityType: 'AccessorySale', entityId: saleId, entityLabel: invoiceNumber,
      summary: `Received ${formatInrExact(payment.amount)} (${payment.mode}) for accessory invoice ${invoiceNumber} — receipt ${receiptNumber}`,
      changes: createdFields({ receiptNumber, amount: payment.amount, mode: payment.mode, reference: payment.reference, paidAt: payment.paidAt }),
      metadata: { paymentId: payment.id },
    }, tx);
  }

  private async hsnCodes(accessories: { id: string; taxClassificationId: string | null }[]): Promise<Map<string, string | null>> {
    const classIds = [...new Set(accessories.map((a) => a.taxClassificationId).filter((c): c is string => Boolean(c)))];
    const classes = classIds.length ? await this.prisma.taxClassification.findMany({ where: { id: { in: classIds } }, select: { id: true, code: true } }) : [];
    const code = new Map(classes.map((c) => [c.id, c.code]));
    return new Map(accessories.map((a) => [a.id, a.taxClassificationId ? (code.get(a.taxClassificationId) ?? null) : null]));
  }

  private async getRowOrThrow(id: string): Promise<SaleRow> {
    const row = await this.prisma.accessorySale.findFirst({ where: { id }, include: saleInclude });
    if (!row) throw new NotFoundException('Accessory sale not found');
    return row;
  }

  private async userNames(ids: (string | null)[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((i): i is string => Boolean(i)))];
    if (!unique.length) return new Map();
    const users = await this.prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
    return new Map(users.map((u) => [u.id, u.name]));
  }

  private toDto(r: SaleRow, names: Map<string, string>): AccessorySaleDto {
    const paid = sum(r.payments.map((p) => p.amount));
    const refunded = sum(r.refunds.map((f) => f.amount));
    const cancelled = r.status === 'CANCELLED';
    const balance = cancelled ? 0n : r.total - paid;
    const paymentStatus: AccessoryPaymentStatus = paid <= 0n ? 'PENDING' : paid >= r.total ? 'PAID' : 'PARTIAL';
    return {
      id: r.id,
      invoiceNumber: r.invoiceNumber,
      invoiceDate: r.invoiceDate.toISOString(),
      status: r.status,
      customer: r.customer,
      booking: r.booking,
      gstApplied: r.gstApplied,
      supplyType: (r.supplyType as RtoSupplyType | null) ?? null,
      subtotal: r.subtotal.toString(),
      cgst: r.cgst.toString(),
      sgst: r.sgst.toString(),
      igst: r.igst.toString(),
      gstAmount: r.gstAmount.toString(),
      total: r.total.toString(),
      paid: paid.toString(),
      refunded: refunded.toString(),
      balance: balance.toString(),
      paymentStatus,
      itemCount: r.items.reduce((n, i) => n + i.qty, 0),
      itemsSummary: r.items.map((i) => (i.qty > 1 ? `${i.name} × ${i.qty}` : i.name)).join(', '),
      notes: r.notes,
      cancelledAt: r.cancelledAt?.toISOString() ?? null,
      cancelReason: r.cancelReason,
      cancelledByName: r.cancelledById ? (names.get(r.cancelledById) ?? null) : null,
      createdByName: r.createdById ? (names.get(r.createdById) ?? null) : null,
      createdAt: r.createdAt.toISOString(),
    };
  }

  private toDetailDto(r: SaleRow, names: Map<string, string>, canSeeCost: boolean): AccessorySaleDetailDto {
    return {
      ...this.toDto(r, names),
      items: r.items.map((i) => ({
        id: i.id,
        accessoryId: i.accessoryId,
        name: i.name,
        sku: i.sku,
        hsnCode: i.hsnCode,
        qty: i.qty,
        unitPrice: i.unitPrice.toString(),
        gstRateBp: i.gstRateBp,
        taxable: i.taxable.toString(),
        gstAmount: i.gstAmount.toString(),
        lineTotal: i.lineTotal.toString(),
        ...(canSeeCost ? { costAtSale: i.costAtSale.toString() } : {}),
      })),
      payments: r.payments.map((p) => ({ id: p.id, receiptNumber: p.receiptNumber, amount: p.amount.toString(), mode: p.mode, reference: p.reference, paidAt: p.paidAt.toISOString(), receivedByName: names.get(p.receivedById) ?? null })),
      refunds: r.refunds.map((f) => ({ id: f.id, refundNumber: f.refundNumber, amount: f.amount.toString(), method: f.method, reference: f.reference, refundedAt: f.refundedAt.toISOString() })),
    };
  }
}

/** Locks the accessory's row for the rest of the transaction, so concurrent stock changes apply one at a time. */
async function lockStock(tx: Tx, companyId: string, id: string): Promise<LockedStock> {
  const [row] = await tx.$queryRaw<LockedStock[]>`
    SELECT id, name, "onHand", reserved, "avgCost" FROM "Accessory" WHERE id = ${id} AND "companyId" = ${companyId} FOR UPDATE`;
  if (!row) throw new NotFoundException('Accessory not found');
  return row;
}

/** Same GST state codes → within the state (CGST + SGST); different → IGST. Unknown → within the state. */
function suggestSupply(companyCode: string | null, customerCode: string | null): { supplyType: RtoSupplyType; supplyTypeHint: string } {
  const a = companyCode?.trim();
  const b = customerCode?.trim();
  if (a && b) {
    return a === b
      ? { supplyType: RtoSupplyType.INTRA, supplyTypeHint: `The customer is in your state (GST state code ${b}).` }
      : { supplyType: RtoSupplyType.INTER, supplyTypeHint: `The customer's GST state code (${b}) differs from yours (${a}).` };
  }
  return { supplyType: RtoSupplyType.INTRA, supplyTypeHint: !b ? "The customer's GST state code is not recorded — assumed to be in your state." : 'Your GST state code is not set in Settings — assumed to be the same state.' };
}

