import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ActivityAction,
  RETURN_TERMINAL_STATUSES,
  ReturnStatus,
  buildPageMeta,
  type CancelReturnInput,
  type CreateReturnInput,
  type CreditNoteDto,
  type InspectReturnInput,
  type ListReturnsQuery,
  type Paginated,
  type RefundDto,
  type RejectReturnInput,
  type VehicleReturnDto,
} from '@azad/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantContext } from '../../tenant/tenant-context.service';
import { ActivityLogService } from '../../activity-log/activity-log.service';
import { SequenceService } from '../sales/sequence.service';

const include = {
  sale: { select: { id: true, invoiceNumber: true, total: true } },
  booking: { select: { id: true, code: true, actualDelivery: true } },
  unit: { select: { id: true, vin: true } },
  customer: { select: { id: true, name: true } },
  creditNote: true,
  refunds: { orderBy: { refundedAt: 'desc' } },
} satisfies Prisma.VehicleReturnInclude;
type ReturnRow = Prisma.VehicleReturnGetPayload<{ include: typeof include }>;

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
