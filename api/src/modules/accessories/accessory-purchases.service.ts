import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ActivityAction,
  buildPageMeta,
  computePurchaseLine,
  type AccessoryPurchaseDetailDto,
  type AccessoryPurchaseDto,
  type CancelAccessoryPurchaseInput,
  type CreateAccessoryPurchaseInput,
  type ListAccessoryPurchasesQuery,
  type MarkAccessoryPurchasePaidInput,
  type Paginated,
} from '@azad/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantContext } from '../../tenant/tenant-context.service';
import { ActivityLogService } from '../../activity-log/activity-log.service';
import { MonthlyClosingService } from '../finance/monthly-closing.service';
import { SequenceService } from '../sales/sequence.service';
import { isAfterBusinessToday, resolveTimeZone } from '../../common/utils/business-date';
import { avgCostAfterRemoval, weightedAvgCost } from '../../common/utils/inventory-cost';
import { accessoryGstRates, type AccessoryGstRate } from './accessory-gst-rates';

type Tx = Prisma.TransactionClient;

const purchaseInclude = {
  vendor: { select: { id: true, name: true } },
  items: { include: { accessory: { select: { name: true, sku: true } } }, orderBy: { id: 'asc' } },
} satisfies Prisma.AccessoryPurchaseInclude;
type PurchaseRow = Prisma.AccessoryPurchaseGetPayload<{ include: typeof purchaseInclude }>;

interface LockedStock {
  id: string;
  name: string;
  onHand: number;
  reserved: number;
  avgCost: bigint;
}

const sum = (xs: bigint[]): bigint => xs.reduce((a, b) => a + b, 0n);
/** A calendar date as midnight UTC (how purchase and bill dates are stored). */
const calendarDay = (d: Date): Date => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/**
 * Accessories bought from vendors. A purchase adds the pieces to stock at once and recomputes the weighted-
 * average cost from the cost before GST; its GST is input GST. It is paid now (method + date) or owed — the
 * vendor's outstanding — and marked paid later. A wrong purchase is cancelled only while all its pieces are still
 * available: they leave stock again and the average cost is reversed. Purchases follow month-close. Everything
 * here is purchase cost, so the controller lets only inventory.cost holders in.
 */
@Injectable()
export class AccessoryPurchasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContext,
    private readonly sequence: SequenceService,
    private readonly activityLog: ActivityLogService,
    private readonly closing: MonthlyClosingService,
  ) {}

  /** The GST rate to suggest per active accessory (its classification, else the accessory default in Settings). */
  async defaults(): Promise<{ rates: Record<string, AccessoryGstRate> }> {
    const settings = await this.prisma.companySetting.findFirst({ select: { accessoryGstRateBp: true, timezone: true } });
    const accessories = await this.prisma.accessory.findMany({ where: { isActive: true }, select: { id: true, taxClassificationId: true } });
    const rates = await accessoryGstRates(this.prisma, accessories, settings?.accessoryGstRateBp ?? 1800, resolveTimeZone(settings?.timezone));
    return { rates: Object.fromEntries(rates) };
  }

  async list(query: ListAccessoryPurchasesQuery): Promise<Paginated<AccessoryPurchaseDto>> {
    const where: Prisma.AccessoryPurchaseWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.vendorId) where.vendorId = query.vendorId;
    if (query.paid !== undefined) where.paid = query.paid;
    if (query.accessoryId) where.items = { some: { accessoryId: query.accessoryId } };
    if (query.from || query.to) where.purchaseDate = { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) };
    if (query.q) {
      where.OR = [
        { purchaseNumber: { contains: query.q, mode: 'insensitive' } },
        { vendorInvoiceNumber: { contains: query.q, mode: 'insensitive' } },
        { vendor: { name: { contains: query.q, mode: 'insensitive' } } },
      ];
    }
    const [rows, total] = await Promise.all([
      this.prisma.accessoryPurchase.findMany({ where, include: purchaseInclude, orderBy: [{ purchaseDate: 'desc' }, { createdAt: 'desc' }], skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      this.prisma.accessoryPurchase.count({ where }),
    ]);
    const names = await this.userNames(rows.flatMap((r) => [r.createdById, r.cancelledById]));
    return { data: rows.map((r) => this.toDto(r, names)), meta: buildPageMeta(query.page, query.pageSize, total) };
  }

  async getById(id: string): Promise<AccessoryPurchaseDetailDto> {
    const row = await this.getRowOrThrow(id);
    const names = await this.userNames([row.createdById, row.cancelledById]);
    return this.toDetailDto(row, names);
  }

  async create(dto: CreateAccessoryPurchaseInput, userId: string): Promise<AccessoryPurchaseDetailDto> {
    const companyId = this.tenant.requireCompanyId();
    const timeZone = await this.businessTimeZone();
    const now = new Date();
    const purchaseDate = calendarDay(dto.purchaseDate ?? now);
    if (dto.purchaseDate && isAfterBusinessToday(dto.purchaseDate, now, timeZone)) throw new BadRequestException('The bill date cannot be in the future');
    const paidAt = dto.payment ? this.paidAtOf(dto.payment.paidAt, purchaseDate, timeZone) : null;

    const vendor = dto.vendorId ? await this.prisma.vendor.findFirst({ where: { id: dto.vendorId, deletedAt: null }, select: { id: true, name: true } }) : null;
    if (dto.vendorId && !vendor) throw new NotFoundException('Vendor not found');
    const accessories = await this.prisma.accessory.findMany({ where: { id: { in: dto.items.map((l) => l.accessoryId) } }, select: { id: true, name: true, isActive: true } });
    const byId = new Map(accessories.map((a) => [a.id, a]));
    for (const line of dto.items) {
      const a = byId.get(line.accessoryId);
      if (!a) throw new NotFoundException('Accessory not found');
      if (!a.isActive) throw new BadRequestException(`${a.name} is inactive — activate it before buying it`);
    }
    const lines = dto.items.map((l) => ({
      accessoryId: l.accessoryId,
      quantity: l.quantity,
      unitCost: BigInt(l.unitCost),
      ...computePurchaseLine(BigInt(l.unitCost), l.quantity, l.gstAmount !== undefined ? { amount: BigInt(l.gstAmount) } : { rateBp: Math.round((l.gstRate ?? 0) * 100) }),
    }));
    await this.closing.assertOpen(purchaseDate);
    if (paidAt) await this.closing.assertOpen(paidAt);

    const created = await this.prisma.$transaction(async (tx) => {
      const locked = new Map<string, LockedStock>();
      for (const id of [...byId.keys()].sort()) locked.set(id, await lockStock(tx, companyId, id));
      const purchaseNumber = await this.sequence.next('accessoryPurchase', tx);
      const purchase = await tx.accessoryPurchase.create({
        data: {
          companyId,
          purchaseNumber,
          vendorId: vendor?.id ?? null,
          vendorInvoiceNumber: dto.vendorInvoiceNumber || null,
          purchaseDate,
          notes: dto.notes || null,
          subtotal: sum(lines.map((l) => l.taxable)),
          gstAmount: sum(lines.map((l) => l.gst)),
          total: sum(lines.map((l) => l.lineTotal)),
          paid: Boolean(dto.payment),
          paidAt,
          paymentMethod: dto.payment?.method ?? null,
          paymentReference: dto.payment?.reference || null,
          createdById: userId,
          updatedById: userId,
          items: { create: lines.map((l) => ({ accessoryId: l.accessoryId, quantity: l.quantity, unitCost: l.unitCost, gstRateBp: l.gstRateBp, gstAmount: l.gst, lineTotal: l.lineTotal })) },
        },
      });
      for (const l of lines) {
        const s = locked.get(l.accessoryId)!;
        const onHand = s.onHand + l.quantity;
        await tx.accessory.update({ where: { id: s.id }, data: { onHand, avgCost: weightedAvgCost(s.onHand, s.avgCost, l.quantity, l.unitCost), updatedById: userId } });
        await tx.accessoryStockMovement.create({
          data: { companyId, accessoryId: s.id, type: 'PURCHASE_IN', quantity: l.quantity, unitCost: l.unitCost, onHandAfter: onHand, reservedAfter: s.reserved, refType: 'AccessoryPurchase', refId: purchase.id, note: `${purchaseNumber} · ${vendor?.name ?? 'no vendor'}`, createdById: userId },
        });
        s.onHand = onHand; // a later line of the same accessory is impossible (refused by the schema), but keep the lock state true
      }
      // No amounts in the summary: the activity log is read by people who may not see purchase cost.
      await this.activityLog.recordInTransaction({ actorId: userId, action: ActivityAction.CREATE, entityType: 'AccessoryPurchase', entityId: purchase.id, summary: `Accessory purchase ${purchaseNumber}${vendor ? ` from ${vendor.name}` : ''}: ${lines.length} item${lines.length === 1 ? '' : 's'}, ${lines.reduce((n, l) => n + l.quantity, 0)} pieces${dto.payment ? ' (paid)' : ' (unpaid)'}` }, tx);
      return purchase;
    });
    return this.getById(created.id);
  }

  async markPaid(id: string, dto: MarkAccessoryPurchasePaidInput, userId: string): Promise<AccessoryPurchaseDetailDto> {
    const row = await this.getRowOrThrow(id);
    if (row.status === 'CANCELLED') throw new BadRequestException('This purchase is cancelled');
    if (row.paid) throw new ConflictException('This purchase is already paid');
    const paidAt = this.paidAtOf(dto.paidAt, row.purchaseDate, await this.businessTimeZone());
    await this.closing.assertOpen(paidAt);
    const { count } = await this.prisma.accessoryPurchase.updateMany({ where: { id, status: 'ACTIVE', paid: false }, data: { paid: true, paidAt, paymentMethod: dto.method, paymentReference: dto.reference || null, updatedById: userId } });
    if (count !== 1) throw new ConflictException('This purchase was changed by someone else — reload and try again');
    await this.activityLog.record({ actorId: userId, action: ActivityAction.PAYMENT, entityType: 'AccessoryPurchase', entityId: id, summary: `Paid accessory purchase ${row.purchaseNumber}${row.vendor ? ` to ${row.vendor.name}` : ''} (${dto.method.replace('_', ' ')})` });
    return this.getById(id);
  }

  /**
   * Takes the purchase back out: every line must still be available (not sold or reserved). The pieces leave stock
   * at their purchase cost (the average is reversed) and the bill stops counting — for the vendor's outstanding,
   * input GST and, when it was paid, the cash book (the vendor is assumed to refund).
   */
  async cancel(id: string, dto: CancelAccessoryPurchaseInput, userId: string): Promise<AccessoryPurchaseDetailDto> {
    const companyId = this.tenant.requireCompanyId();
    const row = await this.getRowOrThrow(id);
    if (row.status === 'CANCELLED') throw new ConflictException('This purchase is already cancelled');
    await this.closing.assertOpen(row.purchaseDate);
    if (row.paidAt) await this.closing.assertOpen(row.paidAt);
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.accessoryPurchase.updateMany({ where: { id, status: 'ACTIVE' }, data: { status: 'CANCELLED', cancelledAt: now, cancelledById: userId, cancelReason: dto.reason, updatedById: userId } });
      if (claimed.count !== 1) throw new ConflictException('This purchase is already cancelled');
      for (const item of [...row.items].sort((a, b) => a.accessoryId.localeCompare(b.accessoryId))) {
        const s = await lockStock(tx, companyId, item.accessoryId);
        const available = s.onHand - s.reserved;
        if (available < item.quantity) {
          throw new ConflictException(`Only ${Math.max(0, available)} of ${s.name} ${available === 1 ? 'is' : 'are'} still in stock (${item.quantity} were bought) — adjust the stock instead`);
        }
        const onHand = s.onHand - item.quantity;
        await tx.accessory.update({ where: { id: s.id }, data: { onHand, avgCost: avgCostAfterRemoval(s.onHand, s.avgCost, item.quantity, item.unitCost), updatedById: userId } });
        await tx.accessoryStockMovement.create({
          data: { companyId, accessoryId: s.id, type: 'PURCHASE_RETURN', quantity: item.quantity, unitCost: item.unitCost, onHandAfter: onHand, reservedAfter: s.reserved, refType: 'AccessoryPurchase', refId: id, note: `${row.purchaseNumber} cancelled — ${dto.reason}`, createdById: userId },
        });
      }
      await this.activityLog.recordInTransaction({ actorId: userId, action: ActivityAction.STATUS_CHANGE, entityType: 'AccessoryPurchase', entityId: id, summary: `Cancelled accessory purchase ${row.purchaseNumber} — ${dto.reason}` }, tx);
    });
    return this.getById(id);
  }

  // ── Internal ───────────────────────────────────────────
  /** When it was paid: the date given (not in the future, not before the bill), else the bill date. */
  private paidAtOf(given: Date | undefined, purchaseDate: Date, timeZone: string): Date {
    if (!given) return purchaseDate;
    if (isAfterBusinessToday(given, new Date(), timeZone)) throw new BadRequestException('The payment date cannot be in the future');
    const day = calendarDay(given);
    if (day < purchaseDate) throw new BadRequestException('The payment date cannot be before the bill date');
    return day;
  }

  private async businessTimeZone(): Promise<string> {
    const s = await this.prisma.companySetting.findFirst({ select: { timezone: true } });
    return resolveTimeZone(s?.timezone);
  }

  private async getRowOrThrow(id: string): Promise<PurchaseRow> {
    const row = await this.prisma.accessoryPurchase.findFirst({ where: { id }, include: purchaseInclude });
    if (!row) throw new NotFoundException('Accessory purchase not found');
    return row;
  }

  private async userNames(ids: (string | null)[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((i): i is string => Boolean(i)))];
    if (!unique.length) return new Map();
    const users = await this.prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
    return new Map(users.map((u) => [u.id, u.name]));
  }

  private toDto(r: PurchaseRow, names: Map<string, string>): AccessoryPurchaseDto {
    return {
      id: r.id,
      purchaseNumber: r.purchaseNumber,
      vendorInvoiceNumber: r.vendorInvoiceNumber,
      vendorId: r.vendorId,
      vendorName: r.vendor?.name ?? null,
      purchaseDate: r.purchaseDate.toISOString(),
      notes: r.notes,
      status: r.status,
      subtotal: r.subtotal.toString(),
      gstAmount: r.gstAmount.toString(),
      total: r.total.toString(),
      paid: r.paid,
      paidAt: r.paidAt?.toISOString() ?? null,
      paymentMethod: r.paymentMethod,
      paymentReference: r.paymentReference,
      itemCount: r.items.reduce((n, i) => n + i.quantity, 0),
      itemsSummary: r.items.map((i) => `${i.accessory.name} × ${i.quantity}`).join(', '),
      cancelledAt: r.cancelledAt?.toISOString() ?? null,
      cancelReason: r.cancelReason,
      cancelledByName: r.cancelledById ? (names.get(r.cancelledById) ?? null) : null,
      createdByName: r.createdById ? (names.get(r.createdById) ?? null) : null,
      createdAt: r.createdAt.toISOString(),
    };
  }

  private toDetailDto(r: PurchaseRow, names: Map<string, string>): AccessoryPurchaseDetailDto {
    return {
      ...this.toDto(r, names),
      items: r.items.map((i) => ({
        id: i.id,
        accessoryId: i.accessoryId,
        accessoryName: i.accessory.name,
        sku: i.accessory.sku,
        quantity: i.quantity,
        unitCost: i.unitCost.toString(),
        gstRateBp: i.gstRateBp,
        gstAmount: i.gstAmount.toString(),
        lineTotal: i.lineTotal.toString(),
      })),
    };
  }
}

async function lockStock(tx: Tx, companyId: string, id: string): Promise<LockedStock> {
  const [row] = await tx.$queryRaw<LockedStock[]>`
    SELECT id, name, "onHand", reserved, "avgCost" FROM "Accessory" WHERE id = ${id} AND "companyId" = ${companyId} FOR UPDATE`;
  if (!row) throw new NotFoundException('Accessory not found');
  return row;
}
