import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ActivityAction,
  buildPageMeta,
  computeOrderLine,
  type CancelPurchaseOrderInput,
  type CreatePurchaseOrderInput,
  type ListPurchaseOrdersQuery,
  type Paginated,
  type PurchaseOrderDetailDto,
  type PurchaseOrderDocumentType,
  type PurchaseOrderDto,
  type PurchaseOrderLineInput,
  type PurchaseOrderReceipt,
  type UpdatePurchaseOrderInput,
} from '@azad/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantContext } from '../../tenant/tenant-context.service';
import { ActivityLogService } from '../../activity-log/activity-log.service';
import { STORAGE_SERVICE, type StorageService } from '../../storage/storage.service';
import { SequenceService } from '../sales/sequence.service';
import { isAfterBusinessToday, resolveTimeZone } from '../../common/utils/business-date';
import { diffFields } from '../../activity-log/audit-diff';

/** A purchase order as the audit trail records it (prices are purchase cost: shown only to inventory.cost holders). */
const ORDER_AUDIT_FIELDS = ['vendor', 'orderDate', 'expectedDate', 'piNumber', 'piDate', 'notes', 'lines', 'subtotal', 'gstAmount', 'total'] as const;
type OrderAuditRow = { vendor: { name: string }; orderDate: Date; expectedDate: Date | null; piNumber: string | null; piDate: Date | null; notes: string | null; subtotal: bigint; gstAmount: bigint; total: bigint; lines: { description: string; quantity: number; unitCost: bigint; gstRateBp: number }[] };
const orderAuditSnapshot = (o: OrderAuditRow): Record<(typeof ORDER_AUDIT_FIELDS)[number], unknown> => ({
  vendor: o.vendor.name, orderDate: o.orderDate, expectedDate: o.expectedDate, piNumber: o.piNumber, piDate: o.piDate, notes: o.notes,
  lines: o.lines.map((l) => `${l.description} × ${l.quantity} @ ${l.unitCost} + ${l.gstRateBp / 100}%`).join('; '),
  subtotal: o.subtotal, gstAmount: o.gstAmount, total: o.total,
});

type Tx = Prisma.TransactionClient;

const orderInclude = {
  vendor: { select: { name: true } },
  lines: {
    orderBy: { sortOrder: 'asc' },
    include: {
      variant: { select: { id: true, name: true, colour: true, model: { select: { id: true, brand: true, name: true } } } },
      accessory: { select: { name: true } },
    },
  },
  documents: { orderBy: { createdAt: 'asc' } },
  payments: { where: { status: 'ACTIVE' }, select: { amount: true } },
} satisfies Prisma.PurchaseOrderInclude;
type OrderRow = Prisma.PurchaseOrderGetPayload<{ include: typeof orderInclude }>;

interface UploadedFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

/** A calendar date as midnight UTC (how order dates are stored). */
/** A line as stored (without its order and position). */
interface LineData {
  kind: 'SCOOTER' | 'ACCESSORY';
  variantId: string | null;
  accessoryId: string | null;
  description: string;
  quantity: number;
  unitCost: bigint;
  gstRateBp: number;
  gstAmount: bigint;
  lineTotal: bigint;
}

const calendarDay = (d: Date): Date => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const sum = (xs: bigint[]): bigint => xs.reduce((a, b) => a + b, 0n);

/**
 * Purchase orders: what was ordered from a vendor, the vendor's PI and documents, and what has been received
 * against each line (counted live from the scooters and accessory purchases linked to it). A DRAFT is edited
 * freely; once ORDERED its lines may still change, but a line never drops below what it has received and a line
 * that has received something keeps its item. Receiving itself happens where stock is added (Inventory and
 * Accessory purchases), against a line of an ORDERED order.
 */
@Injectable()
export class PurchaseOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContext,
    private readonly sequence: SequenceService,
    private readonly activityLog: ActivityLogService,
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
  ) {}

  async list(query: ListPurchaseOrdersQuery): Promise<Paginated<PurchaseOrderDto>> {
    const where: Prisma.PurchaseOrderWhereInput = {};
    if (query.vendorId) where.vendorId = query.vendorId;
    if (query.status) where.status = query.status;
    if (query.pending) where.status = 'ORDERED';
    if (query.q) {
      where.OR = [
        { poNumber: { contains: query.q, mode: 'insensitive' } },
        { piNumber: { contains: query.q, mode: 'insensitive' } },
        { vendor: { name: { contains: query.q, mode: 'insensitive' } } },
      ];
    }
    const [rows, total] = await Promise.all([
      this.prisma.purchaseOrder.findMany({ where, include: orderInclude, orderBy: [{ orderDate: 'desc' }, { createdAt: 'desc' }], skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      this.prisma.purchaseOrder.count({ where }),
    ]);
    const received = await this.receivedByLine(rows.flatMap((r) => r.lines));
    const names = await this.userNames(rows.map((r) => r.createdById));
    return { data: rows.map((r) => this.toDto(r, received, names)), meta: buildPageMeta(query.page, query.pageSize, total) };
  }

  async get(id: string): Promise<PurchaseOrderDetailDto> {
    const row = await this.getRowOrThrow(id);
    const lineIds = row.lines.map((l) => l.id);
    const [received, names, units, accessoryPurchases, payments] = await Promise.all([
      this.receivedByLine(row.lines),
      this.userNames([row.createdById]),
      lineIds.length
        ? this.prisma.inventoryUnit.findMany({ where: { purchaseOrderLineId: { in: lineIds } }, select: { id: true, purchaseOrderLineId: true, vin: true, status: true, purchaseDate: true }, orderBy: { createdAt: 'asc' } })
        : Promise.resolve([]),
      this.prisma.accessoryPurchase.findMany({ where: { purchaseOrderId: id }, select: { id: true, purchaseNumber: true, purchaseDate: true, vendorInvoiceNumber: true, total: true, status: true }, orderBy: { createdAt: 'asc' } }),
      this.prisma.vendorPayment.findMany({ where: { purchaseOrderId: id }, select: { id: true, paymentNumber: true, paidAt: true, method: true, amount: true, status: true }, orderBy: { paidAt: 'asc' } }),
    ]);
    return {
      ...this.toDto(row, received, names),
      lines: row.lines.map((l) => ({
        id: l.id,
        kind: l.kind,
        variantId: l.variantId,
        variant: l.variant,
        accessoryId: l.accessoryId,
        accessoryName: l.accessory?.name ?? null,
        description: l.description,
        quantity: l.quantity,
        received: received.get(l.id) ?? 0,
        unitCost: String(l.unitCost),
        gstRateBp: l.gstRateBp,
        gstAmount: String(l.gstAmount),
        lineTotal: String(l.lineTotal),
      })),
      documents: row.documents.map((d) => ({ id: d.id, type: d.type, fileName: d.fileName, mimeType: d.mimeType, sizeBytes: d.sizeBytes, url: this.storage.urlFor(d.fileKey), createdAt: d.createdAt.toISOString() })),
      units: units.map((u) => ({ id: u.id, lineId: u.purchaseOrderLineId!, vin: u.vin, status: u.status, purchaseDate: u.purchaseDate?.toISOString() ?? null })),
      accessoryPurchases: accessoryPurchases.map((p) => ({ id: p.id, purchaseNumber: p.purchaseNumber, purchaseDate: p.purchaseDate.toISOString(), vendorInvoiceNumber: p.vendorInvoiceNumber, total: String(p.total), status: p.status })),
      payments: payments.map((p) => ({ id: p.id, paymentNumber: p.paymentNumber, paidAt: p.paidAt.toISOString(), method: p.method, amount: String(p.amount), status: p.status })),
    };
  }

  /** The vendor's details for the PO PDF. */
  async vendorOf(id: string): Promise<{ name: string; gstNumber: string | null; address: string | null; mobile: string | null }> {
    const row = await this.prisma.purchaseOrder.findFirst({ where: { id }, select: { vendor: { select: { name: true, gstNumber: true, address: true, city: true, state: true, mobile: true } } } });
    if (!row) throw new NotFoundException('Purchase order not found');
    const v = row.vendor;
    return { name: v.name, gstNumber: v.gstNumber, address: [v.address, v.city, v.state].filter(Boolean).join(', ') || null, mobile: v.mobile };
  }

  async create(dto: CreatePurchaseOrderInput, userId: string): Promise<PurchaseOrderDetailDto> {
    const companyId = this.tenant.requireCompanyId();
    await this.assertVendor(dto.vendorId);
    const orderDate = await this.orderDateOf(dto.orderDate);
    const lines = await this.resolveLines(dto.lines);
    const created = await this.prisma.$transaction(async (tx) => {
      const poNumber = await this.sequence.next('purchaseOrder', tx);
      const order = await tx.purchaseOrder.create({
        data: {
          companyId,
          poNumber,
          vendorId: dto.vendorId,
          orderDate,
          expectedDate: dto.expectedDate ? calendarDay(dto.expectedDate) : null,
          piNumber: dto.piNumber || null,
          piDate: dto.piDate ? calendarDay(dto.piDate) : null,
          notes: dto.notes || null,
          ...this.totals(lines),
          createdById: userId,
          updatedById: userId,
          lines: { create: lines.map((l, i) => ({ ...l.data, sortOrder: i })) },
        },
      });
      await this.activityLog.recordInTransaction({ actorId: userId, action: ActivityAction.CREATE, entityType: 'PurchaseOrder', entityId: order.id, summary: `Purchase order ${poNumber}: ${lines.length} line${lines.length === 1 ? '' : 's'}, ${lines.reduce((n, l) => n + l.data.quantity, 0)} pieces` }, tx);
      return order;
    });
    return this.get(created.id);
  }

  async update(id: string, dto: UpdatePurchaseOrderInput, userId: string): Promise<PurchaseOrderDetailDto> {
    const row = await this.getRowOrThrow(id);
    if (row.status !== 'DRAFT' && row.status !== 'ORDERED') throw new ConflictException(`${row.poNumber} is ${row.status.toLowerCase()} — it can no longer be changed`);
    if (dto.vendorId && dto.vendorId !== row.vendorId) {
      if (row.status !== 'DRAFT') throw new ConflictException('The vendor of an order already sent cannot change — cancel it and order again');
      if (row.payments.length) throw new ConflictException('An advance was paid against this order — its vendor cannot change');
      await this.assertVendor(dto.vendorId);
    }
    const orderDate = dto.orderDate ? await this.orderDateOf(dto.orderDate) : undefined;
    const lines = dto.lines ? await this.resolveLines(dto.lines) : null;
    await this.prisma.$transaction(async (tx) => {
      await this.lockOrder(tx, id);
      if (lines) {
        const received = await this.receivedByLine(row.lines, tx);
        const existing = new Map(row.lines.map((l) => [l.id, l]));
        for (const l of lines) if (l.id && !existing.has(l.id)) throw new BadRequestException('A line of another order was sent — reload and try again');
        const kept = new Set(lines.filter((l) => l.id).map((l) => l.id!));
        for (const old of row.lines) {
          const got = received.get(old.id) ?? 0;
          if (!kept.has(old.id) && got > 0) throw new ConflictException(`${old.description} has ${got} received — it cannot be removed`);
        }
        for (const l of lines) {
          const old = l.id ? existing.get(l.id) : undefined;
          const got = old ? (received.get(old.id) ?? 0) : 0;
          if (old && got > 0 && (old.kind !== l.data.kind || old.variantId !== l.data.variantId || old.accessoryId !== l.data.accessoryId)) {
            throw new ConflictException(`${old.description} has ${got} received — its item cannot change`);
          }
          if (got > l.data.quantity) throw new ConflictException(`${old!.description} has ${got} received — order at least that many`);
        }
        await tx.purchaseOrderLine.deleteMany({ where: { purchaseOrderId: id, id: { notIn: [...kept] } } });
        for (const [i, l] of lines.entries()) {
          if (l.id) await tx.purchaseOrderLine.update({ where: { id: l.id }, data: { ...l.data, sortOrder: i } });
          else await tx.purchaseOrderLine.create({ data: { ...l.data, purchaseOrderId: id, sortOrder: i } });
        }
      }
      await tx.purchaseOrder.update({
        where: { id },
        data: {
          vendorId: dto.vendorId,
          orderDate,
          expectedDate: dto.expectedDate === undefined ? undefined : dto.expectedDate ? calendarDay(dto.expectedDate) : null,
          piNumber: dto.piNumber === undefined ? undefined : dto.piNumber || null,
          piDate: dto.piDate === undefined ? undefined : dto.piDate ? calendarDay(dto.piDate) : null,
          notes: dto.notes === undefined ? undefined : dto.notes || null,
          ...(lines ? this.totals(lines) : {}),
          updatedById: userId,
        },
      });
      const after = await tx.purchaseOrder.findFirstOrThrow({ where: { id }, include: { vendor: { select: { name: true } }, lines: { orderBy: { sortOrder: 'asc' } } } });
      const changes = diffFields(orderAuditSnapshot(row), orderAuditSnapshot(after), ORDER_AUDIT_FIELDS);
      await this.activityLog.recordInTransaction({ actorId: userId, action: ActivityAction.UPDATE, entityType: 'PurchaseOrder', entityId: id, entityLabel: row.poNumber, summary: Object.keys(changes).length ? `Updated purchase order ${row.poNumber}: ${Object.keys(changes).join(', ')} changed` : `Saved purchase order ${row.poNumber} — nothing changed`, changes }, tx);
    });
    return this.get(id);
  }

  /** Sent to the vendor: from now on stock is received against it. */
  async markOrdered(id: string, userId: string): Promise<PurchaseOrderDetailDto> {
    const row = await this.getRowOrThrow(id);
    if (row.status !== 'DRAFT') throw new ConflictException(`${row.poNumber} is already ${row.status.toLowerCase()}`);
    await this.transition(id, 'DRAFT', { status: 'ORDERED', orderedAt: new Date(), updatedById: userId });
    await this.activityLog.record({ actorId: userId, action: ActivityAction.STATUS_CHANGE, entityType: 'PurchaseOrder', entityId: id, summary: `Purchase order ${row.poNumber} sent to ${row.vendor.name}` });
    return this.get(id);
  }

  /** Closes an order whose remaining pieces will not come (a fully received order closes by itself). */
  async close(id: string, userId: string): Promise<PurchaseOrderDetailDto> {
    const row = await this.getRowOrThrow(id);
    if (row.status !== 'ORDERED') throw new ConflictException(row.status === 'DRAFT' ? 'A draft is cancelled, not closed' : `${row.poNumber} is already ${row.status.toLowerCase()}`);
    await this.transition(id, 'ORDERED', { status: 'CLOSED', closedAt: new Date(), updatedById: userId });
    await this.activityLog.record({ actorId: userId, action: ActivityAction.STATUS_CHANGE, entityType: 'PurchaseOrder', entityId: id, summary: `Closed purchase order ${row.poNumber}` });
    return this.get(id);
  }

  /** Opens a closed order again (more stock is coming after all, or a receipt was reversed). */
  async reopen(id: string, userId: string): Promise<PurchaseOrderDetailDto> {
    const row = await this.getRowOrThrow(id);
    if (row.status !== 'CLOSED') throw new ConflictException('Only a closed order can be reopened');
    await this.transition(id, 'CLOSED', { status: 'ORDERED', closedAt: null, updatedById: userId });
    await this.activityLog.record({ actorId: userId, action: ActivityAction.STATUS_CHANGE, entityType: 'PurchaseOrder', entityId: id, summary: `Reopened purchase order ${row.poNumber}` });
    return this.get(id);
  }

  /** Cancels an order nothing was received against. An advance paid against it stays with the vendor. */
  async cancel(id: string, dto: CancelPurchaseOrderInput, userId: string): Promise<PurchaseOrderDetailDto> {
    const row = await this.getRowOrThrow(id);
    if (row.status === 'CANCELLED') throw new ConflictException(`${row.poNumber} is already cancelled`);
    if (row.status === 'CLOSED') throw new ConflictException(`${row.poNumber} is closed`);
    await this.prisma.$transaction(async (tx) => {
      await this.lockOrder(tx, id);
      const received = await this.receivedByLine(row.lines, tx);
      if ([...received.values()].some((n) => n > 0)) throw new ConflictException('Stock was received against this order — close it instead');
      await tx.purchaseOrder.update({ where: { id }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledById: userId, cancelReason: dto.reason, updatedById: userId } });
      await this.activityLog.recordInTransaction({ actorId: userId, action: ActivityAction.STATUS_CHANGE, entityType: 'PurchaseOrder', entityId: id, summary: `Cancelled purchase order ${row.poNumber} — ${dto.reason}` }, tx);
    });
    return this.get(id);
  }

  async addDocument(id: string, file: UploadedFile, type: PurchaseOrderDocumentType, userId: string): Promise<PurchaseOrderDetailDto> {
    const row = await this.getRowOrThrow(id);
    const stored = await this.storage.save({ buffer: file.buffer, originalName: file.originalname, mimeType: file.mimetype, folder: `purchase-orders/${id}` });
    try {
      await this.prisma.purchaseOrderDocument.create({
        data: { companyId: this.tenant.requireCompanyId(), purchaseOrderId: id, type, fileKey: stored.fileKey, fileName: file.originalname, mimeType: file.mimetype, sizeBytes: file.size, createdById: userId },
      });
    } catch (error) {
      await this.storage.remove(stored.fileKey).catch(() => undefined);
      throw error;
    }
    await this.activityLog.record({ actorId: userId, action: ActivityAction.UPDATE, entityType: 'PurchaseOrder', entityId: id, summary: `Attached ${type === 'PROFORMA_INVOICE' ? 'the PI' : type.toLowerCase().replace(/_/g, ' ')} to ${row.poNumber}` });
    return this.get(id);
  }

  async removeDocument(id: string, documentId: string, userId: string): Promise<PurchaseOrderDetailDto> {
    const row = await this.getRowOrThrow(id);
    const doc = await this.prisma.purchaseOrderDocument.findFirst({ where: { id: documentId, purchaseOrderId: id } });
    if (!doc) throw new NotFoundException('Document not found');
    await this.prisma.purchaseOrderDocument.deleteMany({ where: { id: documentId } });
    await this.storage.remove(doc.fileKey).catch(() => undefined);
    await this.activityLog.record({ actorId: userId, action: ActivityAction.UPDATE, entityType: 'PurchaseOrder', entityId: id, summary: `Removed ${doc.fileName} from ${row.poNumber}` });
    return this.get(id);
  }

  // ── Internal ───────────────────────────────────────────
  /** Lines as stored: the item checked against the catalogue, its description and price worked out. */
  private async resolveLines(input: PurchaseOrderLineInput[]): Promise<{ id?: string; data: LineData }[]> {
    const variantIds = [...new Set(input.filter((l) => l.kind === 'SCOOTER').map((l) => l.variantId!))];
    const accessoryIds = [...new Set(input.filter((l) => l.kind === 'ACCESSORY').map((l) => l.accessoryId!))];
    const [variants, accessories] = await Promise.all([
      variantIds.length ? this.prisma.scooterVariant.findMany({ where: { id: { in: variantIds } }, select: { id: true, name: true, colour: true, model: { select: { brand: true, name: true } } } }) : Promise.resolve([]),
      accessoryIds.length ? this.prisma.accessory.findMany({ where: { id: { in: accessoryIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
    ]);
    const variantById = new Map(variants.map((v) => [v.id, v]));
    const accessoryById = new Map(accessories.map((a) => [a.id, a]));
    return input.map((l) => {
      let name: string;
      if (l.kind === 'SCOOTER') {
        const v = variantById.get(l.variantId!);
        if (!v) throw new NotFoundException('Scooter variant not found — pick it from the catalogue');
        name = `${v.model.brand} ${v.model.name} ${v.name} (${v.colour})`;
      } else {
        const a = accessoryById.get(l.accessoryId!);
        if (!a) throw new NotFoundException('Accessory not found');
        name = a.name;
      }
      const gstRateBp = Math.round(l.gstRate * 100);
      const figures = computeOrderLine(BigInt(l.unitCost), l.quantity, gstRateBp);
      return {
        id: l.id,
        data: {
          kind: l.kind,
          variantId: l.kind === 'SCOOTER' ? l.variantId! : null,
          accessoryId: l.kind === 'ACCESSORY' ? l.accessoryId! : null,
          description: l.description || name,
          quantity: l.quantity,
          unitCost: BigInt(l.unitCost),
          gstRateBp,
          gstAmount: figures.gst,
          lineTotal: figures.lineTotal,
        },
      };
    });
  }

  private totals(lines: { data: LineData }[]): { subtotal: bigint; gstAmount: bigint; total: bigint } {
    const subtotal = sum(lines.map((l) => l.data.unitCost * BigInt(l.data.quantity)));
    const gstAmount = sum(lines.map((l) => l.data.gstAmount));
    return { subtotal, gstAmount, total: subtotal + gstAmount };
  }

  /** What each line has received: live scooters linked to it, pieces on live accessory purchases. */
  private async receivedByLine(lines: { id: string; kind: string }[], db: Tx | PrismaService = this.prisma): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    const scooterLines = lines.filter((l) => l.kind === 'SCOOTER').map((l) => l.id);
    const accessoryLines = lines.filter((l) => l.kind === 'ACCESSORY').map((l) => l.id);
    const [units, items] = await Promise.all([
      scooterLines.length ? db.inventoryUnit.groupBy({ by: ['purchaseOrderLineId'], where: { purchaseOrderLineId: { in: scooterLines } }, _count: { _all: true } }) : Promise.resolve([]),
      accessoryLines.length
        ? db.accessoryPurchaseItem.groupBy({ by: ['purchaseOrderLineId'], where: { purchaseOrderLineId: { in: accessoryLines }, purchase: { status: 'ACTIVE' } }, _sum: { quantity: true } })
        : Promise.resolve([]),
    ]);
    for (const u of units) if (u.purchaseOrderLineId) map.set(u.purchaseOrderLineId, u._count._all);
    for (const i of items) if (i.purchaseOrderLineId) map.set(i.purchaseOrderLineId, i._sum.quantity ?? 0);
    return map;
  }

  private async transition(id: string, from: 'DRAFT' | 'ORDERED' | 'CLOSED', data: Prisma.PurchaseOrderUpdateManyMutationInput): Promise<void> {
    const { count } = await this.prisma.purchaseOrder.updateMany({ where: { id, status: from }, data });
    if (count !== 1) throw new ConflictException('This order was changed by someone else — reload and try again');
  }

  private async lockOrder(tx: Tx, id: string): Promise<void> {
    await tx.$queryRaw`SELECT id FROM "PurchaseOrder" WHERE id = ${id} AND "companyId" = ${this.tenant.requireCompanyId()} FOR UPDATE`;
  }

  private async assertVendor(vendorId: string): Promise<void> {
    const vendor = await this.prisma.vendor.findFirst({ where: { id: vendorId }, select: { status: true, name: true } });
    if (!vendor) throw new NotFoundException('Vendor not found');
    if (vendor.status === 'INACTIVE') throw new BadRequestException(`${vendor.name} is inactive — make it active under Vendors first`);
  }

  private async orderDateOf(given: Date | undefined): Promise<Date> {
    const s = await this.prisma.companySetting.findFirst({ select: { timezone: true } });
    if (given && isAfterBusinessToday(given, new Date(), resolveTimeZone(s?.timezone))) throw new BadRequestException('The order date cannot be in the future');
    return calendarDay(given ?? new Date());
  }

  private async getRowOrThrow(id: string): Promise<OrderRow> {
    const row = await this.prisma.purchaseOrder.findFirst({ where: { id }, include: orderInclude });
    if (!row) throw new NotFoundException('Purchase order not found');
    return row;
  }

  private async userNames(ids: (string | null)[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((i): i is string => Boolean(i)))];
    if (!unique.length) return new Map();
    const users = await this.prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
    return new Map(users.map((u) => [u.id, u.name]));
  }

  private toDto(r: OrderRow, received: Map<string, number>, names: Map<string, string>): PurchaseOrderDto {
    const orderedQty = r.lines.reduce((n, l) => n + l.quantity, 0);
    const receivedQty = r.lines.reduce((n, l) => n + Math.min(l.quantity, received.get(l.id) ?? 0), 0);
    const receipt: PurchaseOrderReceipt = receivedQty === 0 ? 'NONE' : receivedQty >= orderedQty ? 'FULL' : 'PARTIAL';
    return {
      id: r.id,
      poNumber: r.poNumber,
      vendorId: r.vendorId,
      vendorName: r.vendor.name,
      orderDate: r.orderDate.toISOString(),
      expectedDate: r.expectedDate?.toISOString() ?? null,
      status: r.status,
      receipt,
      piNumber: r.piNumber,
      piDate: r.piDate?.toISOString() ?? null,
      notes: r.notes,
      subtotal: String(r.subtotal),
      gstAmount: String(r.gstAmount),
      total: String(r.total),
      orderedQty,
      receivedQty,
      advancePaid: String(sum(r.payments.map((p) => p.amount))),
      documentCount: r.documents.length,
      cancelReason: r.cancelReason,
      createdByName: r.createdById ? (names.get(r.createdById) ?? null) : null,
      createdAt: r.createdAt.toISOString(),
    };
  }
}
