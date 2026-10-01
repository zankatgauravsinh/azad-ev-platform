import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ActivityAction,
  RETURN_TERMINAL_STATUSES,
  ReturnStatus,
  buildPageMeta,
  type CancelReturnInput,
  type CompleteReturnInput,
  type CreateReturnInput,
  type CreditNoteDto,
  type InspectReturnInput,
  type ListReturnsQuery,
  type Paginated,
  type RefundDto,
  type RejectReturnInput,
  type ReturnDisposition,
  type VehicleReturnDto,
} from '@azad/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantContext } from '../../tenant/tenant-context.service';
import { ActivityLogService } from '../../activity-log/activity-log.service';
import { SequenceService } from '../sales/sequence.service';
import { InventoryService } from '../inventory/inventory.service';
import { MonthlyClosingService } from '../finance/monthly-closing.service';

const include = {
  sale: { select: { id: true, invoiceNumber: true, total: true, taxAmount: true } },
  booking: { select: { id: true, code: true, actualDelivery: true } },
  unit: { select: { id: true, vin: true } },
  customer: { select: { id: true, name: true } },
  creditNote: true,
  refunds: { orderBy: { refundedAt: 'desc' } },
} satisfies Prisma.VehicleReturnInclude;
type ReturnRow = Prisma.VehicleReturnGetPayload<{ include: typeof include }>;

/**
 * Everything the future accessory-restock implementation (accessory workstream Group 6)
 * receives from a completed vehicle return. It will reverse the returned vehicle's accessory
 * stock-out inside the completion transaction using these references + disposition.
 *
 * NOT YET KNOWABLE in Group 6 of the return workstream: the specific returned-accessory line
 * references. `SaleAccessory` is only populated once accessory Group 6 (delivery stock-out)
 * ships; until then this context cannot enumerate which accessories were sold with the
 * vehicle, so the seam stays a no-op and the future impl must resolve accessory lines itself
 * (e.g. from SaleAccessory-by-saleId once available).
 */
export interface AccessoryRestockContext {
  returnId: string;
  saleId: string;
  bookingId: string;
  unitId: string;
  disposition: ReturnDisposition;
}

/** Pure builder for the seam's context (kept separate so the contract is unit-testable). */
export function accessoryRestockContext(
  ret: { id: string; saleId: string; bookingId: string; unitId: string },
  disposition: ReturnDisposition,
): AccessoryRestockContext {
  return { returnId: ret.id, saleId: ret.saleId, bookingId: ret.bookingId, unitId: ret.unitId, disposition };
}

/**
 * Vehicle return workflow (Group 3): request → inspection → approval, plus reject/cancel.
 * Enforces the state machine, permissions (in the controller) and self-approval block
 * server-side, and writes an audit entry for every transition. NO financial completion,
 * credit note, refund, warranty change or inventory disposition happens here — those are
 * Group 4 COMPLETED effects. The original Booking/Sale/Payment records are never touched.
 */
@Injectable()
export class ReturnsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContext,
    private readonly sequence: SequenceService,
    private readonly activityLog: ActivityLogService,
    private readonly inventory: InventoryService,
    private readonly closing: MonthlyClosingService,
  ) {}

  async list(query: ListReturnsQuery): Promise<Paginated<VehicleReturnDto>> {
    const where: Prisma.VehicleReturnWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.customerId) where.customerId = query.customerId;
    const [rows, total] = await Promise.all([
      this.prisma.vehicleReturn.findMany({ where, include, orderBy: { createdAt: 'desc' }, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      this.prisma.vehicleReturn.count({ where }),
    ]);
    const data = await Promise.all(rows.map((r) => this.toDto(r)));
    return { data, meta: buildPageMeta(query.page, query.pageSize, total) };
  }

  async get(id: string): Promise<VehicleReturnDto> {
    return this.toDto(await this.loadOrThrow(id));
  }

  async request(dto: CreateReturnInput, userId: string): Promise<VehicleReturnDto> {
    const sale = await this.prisma.sale.findFirst({
      where: { id: dto.saleId },
      select: { id: true, bookingId: true, unitId: true, customerId: true, booking: { select: { actualDelivery: true } } },
    });
    if (!sale) throw new NotFoundException('Sale not found');
    if (!sale.bookingId || !sale.booking?.actualDelivery) {
      throw new BadRequestException('Only a delivered vehicle can be returned');
    }
    // One active (non-terminal) return per sale — friendly check ahead of the DB partial unique index.
    const active = await this.prisma.vehicleReturn.findFirst({ where: { saleId: sale.id, status: { notIn: RETURN_TERMINAL_STATUSES } }, select: { returnNumber: true } });
    if (active) throw new ConflictException(`An active return (${active.returnNumber}) already exists for this sale`);

    const created = await this.prisma.$transaction(async (tx) => {
      const returnNumber = await this.sequence.next('return', tx);
      return tx.vehicleReturn.create({
        data: {
          returnNumber,
          saleId: sale.id,
          bookingId: sale.bookingId as string,
          unitId: sale.unitId,
          customerId: sale.customerId,
          status: ReturnStatus.REQUESTED,
          reason: dto.reason,
          requestedById: userId,
          createdById: userId,
          updatedById: userId,
        },
        include,
      });
    }).catch((e: unknown) => {
      // Race against the partial unique index (concurrent request for the same sale).
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('An active return already exists for this sale');
      }
      throw e;
    });

    await this.audit(userId, ActivityAction.CREATE, created.id, `Return ${created.returnNumber} requested for ${created.sale.invoiceNumber ?? created.booking.code}`);
    return this.toDto(created);
  }

  async inspect(id: string, dto: InspectReturnInput, userId: string): Promise<VehicleReturnDto> {
    const row = await this.loadOrThrow(id);
    this.assertStatus(row, ReturnStatus.REQUESTED, 'inspect');
    await this.transition(id, ReturnStatus.REQUESTED, {
      status: ReturnStatus.INSPECTION,
      inspectionOk: dto.inspectionOk,
      inspectionNotes: dto.notes ?? null,
      inspectedById: userId,
      inspectedAt: new Date(),
      updatedById: userId,
    });
    await this.audit(userId, ActivityAction.STATUS_CHANGE, id, `Return ${row.returnNumber} inspected (${dto.inspectionOk ? 'OK' : 'issues noted'})`);
    return this.get(id);
  }

  async approve(id: string, userId: string): Promise<VehicleReturnDto> {
    const row = await this.loadOrThrow(id);
    // Inspection must precede approval.
    if (row.status === ReturnStatus.REQUESTED) throw new BadRequestException('The return must be inspected before it can be approved');
    this.assertStatus(row, ReturnStatus.INSPECTION, 'approve');
    // Self-approval block: the requester cannot approve their own return.
    if (row.requestedById === userId) throw new ForbiddenException('You cannot approve a return you requested — another owner/manager must approve it');
    await this.transition(id, ReturnStatus.INSPECTION, { status: ReturnStatus.APPROVED, approvedById: userId, approvedAt: new Date(), updatedById: userId });
    await this.audit(userId, ActivityAction.STATUS_CHANGE, id, `Return ${row.returnNumber} approved`);
    return this.get(id);
  }

  async reject(id: string, dto: RejectReturnInput, userId: string): Promise<VehicleReturnDto> {
    const row = await this.loadOrThrow(id);
    if (row.status !== ReturnStatus.REQUESTED && row.status !== ReturnStatus.INSPECTION) {
      throw new BadRequestException(`A ${row.status.toLowerCase()} return cannot be rejected`);
    }
    const updated = await this.prisma.vehicleReturn.updateMany({
      where: { id, status: { in: [ReturnStatus.REQUESTED, ReturnStatus.INSPECTION] } },
      data: { status: ReturnStatus.REJECTED, rejectionReason: dto.reason, updatedById: userId },
    });
    if (updated.count !== 1) throw new ConflictException('The return changed state — reload and try again');
    await this.audit(userId, ActivityAction.STATUS_CHANGE, id, `Return ${row.returnNumber} rejected: ${dto.reason}`);
    return this.get(id);
  }

  async cancel(id: string, dto: CancelReturnInput, userId: string): Promise<VehicleReturnDto> {
    const row = await this.loadOrThrow(id);
    if ((RETURN_TERMINAL_STATUSES as string[]).includes(row.status)) {
      throw new BadRequestException(`A ${row.status.toLowerCase()} return cannot be cancelled`);
    }
    const updated = await this.prisma.vehicleReturn.updateMany({
      where: { id, status: { notIn: RETURN_TERMINAL_STATUSES } },
      data: { status: ReturnStatus.CANCELLED, updatedById: userId },
    });
    if (updated.count !== 1) throw new ConflictException('The return changed state — reload and try again');
    await this.audit(userId, ActivityAction.STATUS_CHANGE, id, `Return ${row.returnNumber} cancelled${dto.reason ? `: ${dto.reason}` : ''}`);
    return this.get(id);
  }

  /**
   * Finalize an APPROVED return (OWNER/MANAGER): issue the full-sale CreditNote, record the
   * Refund (amountPaid − deduction, when > 0), disposition the unit (DELIVERED → RETURNED →
   * disposition via the dedicated internal transition), void the warranty, and mark COMPLETED.
   * Everything runs in one transaction and is idempotent — a status-guarded claim means a
   * second attempt (or any mid-way failure) leaves no duplicate CreditNote/Refund and never
   * leaves the vehicle incorrectly returned. Original Sale/Booking/Payment rows are untouched.
   * Deeper P&L/GST treatment is Group 5; accessory restock is a Group 6 seam (no-op here).
   */
  async complete(id: string, dto: CompleteReturnInput, userId: string): Promise<VehicleReturnDto> {
    const row = await this.loadOrThrow(id);
    this.assertStatus(row, ReturnStatus.APPROVED, 'complete');
    // Completion is dated now — respect a closed month.
    await this.closing.assertOpen(new Date());

    const paidAgg = await this.prisma.payment.aggregate({ _sum: { amount: true }, where: { OR: [{ bookingId: row.bookingId }, { saleId: row.saleId }] } });
    const amountPaid = paidAgg._sum.amount ?? 0n;
    const deduction = BigInt(dto.deductionAmount);
    if (deduction < 0n) throw new BadRequestException('Deduction cannot be negative');
    if (deduction > amountPaid) throw new BadRequestException('Deduction cannot exceed the amount the customer paid — that would leave an unexplained balance');
    const refundDue = amountPaid - deduction;

    const saleTotal = row.sale.total;
    const gst = row.sale.taxAmount ?? 0n; // structural capture for the credit note; P&L/GST integration is Group 5

    await this.prisma.$transaction(async (tx) => {
      // Idempotency lock: claim the completion. A concurrent/second attempt (status no longer
      // APPROVED) matches 0 rows and aborts before any CreditNote/Refund/unit change.
      const claimed = await tx.vehicleReturn.updateMany({
        where: { id, status: ReturnStatus.APPROVED },
        data: {
          status: ReturnStatus.COMPLETED,
          disposition: dto.disposition,
          deductionAmount: deduction,
          deductionReason: dto.deductionReason ?? null,
          completedById: userId,
          completedAt: new Date(),
          updatedById: userId,
        },
      });
      if (claimed.count !== 1) throw new ConflictException('This return is no longer awaiting completion');

      // Full-sale credit note (invoice reversal). Amounts recorded; P&L/GST wiring is Group 5.
      const creditNoteNumber = await this.sequence.next('creditNote', tx);
      await tx.creditNote.create({
        data: {
          creditNoteNumber,
          returnId: id,
          saleId: row.saleId,
          amount: saleTotal - gst,
          gstAmount: gst,
          total: saleTotal,
          reason: `Return ${row.returnNumber}: ${row.reason}`,
          issuedById: userId,
          createdById: userId,
          updatedById: userId,
        },
      });

      // Refund only when money is actually due back.
      if (refundDue > 0n) {
        const refundNumber = await this.sequence.next('refund', tx);
        await tx.refund.create({
          data: {
            refundNumber,
            returnId: id,
            saleId: row.saleId,
            customerId: row.customerId,
            amount: refundDue,
            method: dto.refundMethod,
            reference: dto.refundReference ?? null,
            note: dto.note ?? null,
            refundedById: userId,
            createdById: userId,
            updatedById: userId,
          },
        });
      }

      // Vehicle disposition via the dedicated internal transition (generic API is locked out).
      await this.inventory.applyReturnDisposition(row.unitId, dto.disposition, userId, tx);

      // Void the vehicle's formal warranty record(s).
      await tx.warranty.updateMany({ where: { unitId: row.unitId, status: { not: 'CANCELLED' } }, data: { status: 'CANCELLED' } });

      // Accessory-restock seam — reverse accessory stock-out on return. No-op until accessory Group 6.
      await this.restockReturnedAccessories(accessoryRestockContext(row, dto.disposition), tx);
    });

    await this.audit(userId, ActivityAction.STATUS_CHANGE, id, `Return ${row.returnNumber} completed → ${dto.disposition} (credit note issued${refundDue > 0n ? `, refund ${refundDue}` : ''})`);
    return this.get(id);
  }

  /**
   * Accessory-restock seam for the return-completion transaction. Intentionally a NO-OP.
   * When the accessory workstream's Group 6 (delivery stock-out via SaleAccessory) lands,
   * the reversal goes here — stock IN + an AccessoryStockMovement inside this same `tx`,
   * driven by {@link AccessoryRestockContext}. Group 6 of the *return* workstream only
   * defines and wires this seam; it changes no accessory stock, tables or accounting.
   */
  private async restockReturnedAccessories(_ctx: AccessoryRestockContext, _tx: Prisma.TransactionClient): Promise<void> {
    // No accessory stock is affected by vehicle returns yet.
  }

  // ── internals ──
  private assertStatus(row: ReturnRow, expected: ReturnStatus, action: string): void {
    if (row.status !== expected) {
      throw new BadRequestException(`Cannot ${action} a ${row.status.toLowerCase()} return`);
    }
  }

  /** Atomic guarded transition — wins the race against concurrent actors and stays tenant-scoped. */
  private async transition(id: string, from: ReturnStatus, data: Prisma.VehicleReturnUpdateManyMutationInput): Promise<void> {
    const updated = await this.prisma.vehicleReturn.updateMany({ where: { id, status: from }, data });
    if (updated.count !== 1) throw new ConflictException('The return changed state — reload and try again');
  }

  private async loadOrThrow(id: string): Promise<ReturnRow> {
    const row = await this.prisma.vehicleReturn.findFirst({ where: { id }, include });
    if (!row) throw new NotFoundException('Return not found');
    return row;
  }

  private audit(actorId: string, action: ActivityAction, entityId: string, summary: string): Promise<void> {
    return this.activityLog.record({ actorId, action, entityType: 'VehicleReturn', entityId, summary });
  }

  private async toDto(r: ReturnRow): Promise<VehicleReturnDto> {
    const paid = await this.prisma.payment.aggregate({ _sum: { amount: true }, where: { OR: [{ bookingId: r.bookingId }, { saleId: r.saleId }] } });
    const names = await this.userNames([r.requestedById, r.inspectedById, r.approvedById]);
    return {
      id: r.id,
      returnNumber: r.returnNumber,
      status: r.status as ReturnStatus,
      reason: r.reason,
      saleId: r.saleId,
      invoiceNumber: r.sale.invoiceNumber,
      bookingId: r.bookingId,
      bookingCode: r.booking.code,
      unitId: r.unitId,
      vin: r.unit.vin,
      customerId: r.customerId,
      customerName: r.customer.name,
      saleTotal: r.sale.total.toString(),
      amountPaid: (paid._sum.amount ?? 0n).toString(),
      requestedById: r.requestedById,
      requestedByName: names.get(r.requestedById) ?? null,
      requestedAt: r.requestedAt.toISOString(),
      inspectionOk: r.inspectionOk,
      inspectionNotes: r.inspectionNotes,
      inspectedByName: r.inspectedById ? names.get(r.inspectedById) ?? null : null,
      inspectedAt: r.inspectedAt?.toISOString() ?? null,
      approvedByName: r.approvedById ? names.get(r.approvedById) ?? null : null,
      approvedAt: r.approvedAt?.toISOString() ?? null,
      rejectionReason: r.rejectionReason,
      disposition: r.disposition,
      deductionAmount: r.deductionAmount.toString(),
      deductionReason: r.deductionReason,
      completedAt: r.completedAt?.toISOString() ?? null,
      creditNote: r.creditNote ? this.creditNoteDto(r.creditNote) : null,
      refunds: r.refunds.map((f) => this.refundDto(f)),
      createdAt: r.createdAt.toISOString(),
    };
  }

  private async userNames(ids: (string | null)[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((x): x is string => Boolean(x)))];
    if (unique.length === 0) return new Map();
    const users = await this.prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
    return new Map(users.map((u) => [u.id, u.name]));
  }

  private creditNoteDto(c: ReturnRow['creditNote'] & object): CreditNoteDto {
    return { id: c.id, creditNoteNumber: c.creditNoteNumber, amount: c.amount.toString(), gstAmount: c.gstAmount.toString(), total: c.total.toString(), reason: c.reason, issuedAt: c.issuedAt.toISOString() };
  }

  private refundDto(f: ReturnRow['refunds'][number]): RefundDto {
    return { id: f.id, refundNumber: f.refundNumber, amount: f.amount.toString(), method: f.method, reference: f.reference, note: f.note, refundedAt: f.refundedAt.toISOString() };
  }
}
