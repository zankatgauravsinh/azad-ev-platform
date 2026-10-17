import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, type OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ActivityAction,
  Role,
  UNIT_WARRANTY_MONTH_FIELDS,
  WARRANTY_MONTH_COMPONENTS,
  buildPageMeta,
  type CompleteFreeServiceInput,
  type CreateWarrantyInput,
  type FreeServiceDto,
  type ListWarrantiesQuery,
  type ReviseWarrantyMonthsInput,
  type Paginated,
  type UpdateWarrantyInput,
  type WarrantyClaimDto,
  type WarrantyCoverageLine,
  type WarrantyDetailDto,
  type WarrantyRecordDto,
  type WarrantyTimelineEntry,
} from '@azad/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { ActivityLogService } from '../../activity-log/activity-log.service';
import { TenantContext } from '../../tenant/tenant-context.service';
import { CustomerTimelineService } from '../customers/customer-timeline.service';
import { SequenceService } from '../sales/sequence.service';
import { BookingsService, type DeliveredVehicle } from '../sales/bookings.service';
import { addMonths, cardCoverage, componentMonthsOf, coverageLabel, daysBetween, extrasOf, normaliseCoverage, periodOf, readExtras, withMonths, type ComponentMonths } from './warranty.helpers';
import { warrantyInclude, technicianNames, type WarrantyRow } from './warranty.include';
import { toClaimDto } from './warranty-claims.service';

@Injectable()
export class WarrantyService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContext,
    private readonly sequence: SequenceService,
    private readonly timeline: CustomerTimelineService,
    private readonly bookings: BookingsService,
    private readonly activityLog: ActivityLogService,
  ) {}

  onModuleInit(): void {
    this.bookings.onDelivered((d) => this.issueOnDelivery(d));
  }

  /**
   * A delivered vehicle gets its warranty card straight away, starting on the delivery date, with the component
   * months entered on the vehicle. Skipped when the vehicle already has one (e.g. it was created by hand before
   * the delivery was recorded).
   */
  async issueOnDelivery(d: DeliveredVehicle): Promise<void> {
    if (await this.prisma.warranty.findFirst({ where: { unitId: d.unitId, status: { not: 'CANCELLED' } }, select: { id: true } })) return;
    await this.create({ unitId: d.unitId, customerId: d.customerId, bookingId: d.bookingId, saleId: d.saleId, purchaseDate: d.deliveredAt }, d.userId);
  }

  // ── Reads ──────────────────────────────────────────────
  async list(query: ListWarrantiesQuery): Promise<Paginated<WarrantyRecordDto>> {
    await this.syncExpiry();
    const where = this.buildWhere(query);
    const [rows, total] = await Promise.all([
      this.prisma.warranty.findMany({ where, include: warrantyInclude, orderBy: { createdAt: 'desc' }, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      this.prisma.warranty.count({ where }),
    ]);
    return { data: rows.map((r) => this.toRecordDto(r)), meta: buildPageMeta(query.page, query.pageSize, total) };
  }

  async detail(id: string): Promise<WarrantyDetailDto> {
    await this.syncExpiry();
    const warranty = await this.getRowOrThrow(id);
    const [freeServiceRows, claimRows, amcRows, serviceRows] = await Promise.all([
      this.prisma.freeService.findMany({ where: { warrantyId: id }, orderBy: { serviceNumber: 'asc' } }),
      this.prisma.warrantyClaim.findMany({ where: { warrantyId: id }, include: { warranty: { include: warrantyInclude } }, orderBy: { claimDate: 'desc' } }),
      this.prisma.amcPlan.findMany({ where: { unitId: warranty.unitId }, include: warrantyInclude, orderBy: { createdAt: 'desc' } }),
      this.prisma.serviceJob.findMany({ where: { unitId: warranty.unitId }, select: { id: true, code: true, status: true, type: true, createdAt: true }, orderBy: { createdAt: 'asc' }, take: 100 }),
    ]);
    const names = await technicianNames(this.prisma, [...freeServiceRows.map((f) => f.technicianId), ...claimRows.map((c) => c.technicianId)]);
    const record = this.toRecordDto(warranty);
    const freeServices = freeServiceRows.map((f) => this.toFreeServiceDto(f, names));
    const claims = claimRows.map((c) => toClaimDto(c, names));
    // AMC visits (for timeline) — one query for all plans of this unit.
    const visitRows = amcRows.length
      ? await this.prisma.amcVisit.findMany({ where: { amcPlanId: { in: amcRows.map((a) => a.id) } }, orderBy: { visitDate: 'asc' } })
      : [];
    return {
      warranty: record,
      coverage: this.readCoverage(warranty.coverage),
      freeServices,
      claims,
      amc: amcRows.map((a) => this.toAmcSummary(a)),
      timeline: this.buildTimeline(record, freeServices, claims, amcRows, visitRows, serviceRows),
    };
  }

  async dashboard() {
    await this.syncExpiry();
    const company = this.tenant.requireCompanyId();
    const now = new Date();
    const in30 = new Date(now.getTime() + 30 * 86_400_000);
    const in90 = new Date(now.getTime() + 90 * 86_400_000);

    const [wGroups, expiring90, expiring30, claimGroups, freeDue, aGroups, amcExpiring30, amcRevenue, upcomingVisits, visitAgg] = await Promise.all([
      this.prisma.warranty.groupBy({ by: ['status'], _count: true }),
      this.prisma.warranty.count({ where: { status: 'ACTIVE', endDate: { gte: now, lte: in90 } } }),
      this.prisma.warranty.count({ where: { status: 'ACTIVE', endDate: { gte: now, lte: in30 } } }),
      this.prisma.warrantyClaim.groupBy({ by: ['status'], _count: true }),
      this.prisma.freeService.count({ where: { status: 'PENDING', dueDate: { lte: in30 } } }),
      this.prisma.amcPlan.groupBy({ by: ['status'], _count: true }),
      this.prisma.amcPlan.count({ where: { status: 'ACTIVE', endDate: { gte: now, lte: in30 } } }),
      this.prisma.amcPlan.aggregate({ _sum: { price: true } }),
      this.prisma.amcPlan.count({ where: { status: 'ACTIVE', endDate: { gte: now, lte: in30 } } }),
      this.prisma.amcVisit.aggregate({ _count: true }),
    ]);
    void company;
    const wCount = (s: string): number => wGroups.find((g) => g.status === s)?._count ?? 0;
    const cCount = (s: string): number => claimGroups.find((g) => g.status === s)?._count ?? 0;
    const aCount = (s: string): number => aGroups.find((g) => g.status === s)?._count ?? 0;

    return {
      warranty: {
        active: wCount('ACTIVE'),
        expiring90,
        expiring30,
        expired: wCount('EXPIRED'),
        claimsPending: cCount('PENDING'),
        claimsApproved: cCount('APPROVED'),
        claimsRejected: cCount('REJECTED'),
        freeServicesDue: freeDue,
      },
      amc: {
        active: aCount('ACTIVE'),
        expired: aCount('EXPIRED'),
        expiring30: amcExpiring30,
        revenue: String(amcRevenue._sum.price ?? 0n),
        upcomingVisits,
        visitsUsed: visitAgg._count,
      },
    };
  }

  private buildWhere(query: ListWarrantiesQuery): Prisma.WarrantyWhereInput {
    const where: Prisma.WarrantyWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.customerId) where.customerId = query.customerId;
    if (query.expiringInDays) {
      const until = new Date(Date.now() + query.expiringInDays * 86_400_000);
      where.status = 'ACTIVE';
      where.endDate = { gte: new Date(), lte: until };
    }
    if (query.q) {
      const q = query.q;
      where.OR = [
        { warrantyNumber: { contains: q, mode: 'insensitive' } },
        { customer: { name: { contains: q, mode: 'insensitive' } } },
        { unit: { vin: { contains: q, mode: 'insensitive' } } },
        { motorNumber: { contains: q, mode: 'insensitive' } },
        { batteryNumber: { contains: q, mode: 'insensitive' } },
      ];
    }
    return where;
  }

  // ── Mutations ──────────────────────────────────────────
  async create(dto: CreateWarrantyInput, userId: string): Promise<WarrantyDetailDto> {
    const company = this.tenant.requireCompanyId();
    const unit = await this.prisma.inventoryUnit.findFirst({
      where: { id: dto.unitId },
      select: {
        id: true,
        motorNumber: true,
        batteryNumber: true,
        motorWarrantyMonths: true,
        batteryWarrantyMonths: true,
        controllerWarrantyMonths: true,
        chargerWarrantyMonths: true,
        warrantyExtras: true,
        bookings: { select: { id: true, customerId: true, actualDelivery: true, sale: { select: { invoiceNumber: true } } }, orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
    if (!unit) throw new NotFoundException('Vehicle not found');

    const existing = await this.prisma.warranty.findFirst({ where: { unitId: dto.unitId, status: { not: 'CANCELLED' } } });
    if (existing) throw new ConflictException('This vehicle already has an active warranty');

    const booking = unit.bookings[0] ?? null;
    const customerId = dto.customerId ?? booking?.customerId;
    if (!customerId) throw new BadRequestException('Customer could not be resolved for this vehicle — provide a customer or link a booking');

    const settings = await this.prisma.companySetting.findFirst();
    // Months not entered on the vehicle fall back to the period given here, else the company default.
    const fallbackMonths = dto.periodMonths ?? settings?.defaultWarrantyMonths ?? 36;
    const purchaseDate = dto.purchaseDate ?? booking?.actualDelivery ?? new Date();
    // The warranty runs from the delivery date whenever the vehicle has been delivered.
    const startDate = booking?.actualDelivery ?? purchaseDate;
    const unitMonths: ComponentMonths = Object.fromEntries(WARRANTY_MONTH_COMPONENTS.map((c) => [c, unit[UNIT_WARRANTY_MONTH_FIELDS[c]]]));
    // The card: motor, battery, controller and charger, then the extra items typed in with the scooter.
    const coverage = withMonths(dto.coverage?.length ? normaliseCoverage(dto.coverage) : cardCoverage(readExtras(unit.warrantyExtras)), startDate, unitMonths, fallbackMonths);
    const periodMonths = periodOf(coverage, fallbackMonths);
    const endDate = addMonths(startDate, periodMonths);

    const created = await this.prisma.$transaction(async (tx) => {
      const warrantyNumber = await this.sequence.next('warranty', tx);
      const warranty = await tx.warranty.create({
        data: {
          companyId: company,
          warrantyNumber,
          customerId,
          unitId: dto.unitId,
          bookingId: dto.bookingId ?? booking?.id ?? null,
          saleId: dto.saleId ?? null,
          invoiceNumber: booking?.sale?.invoiceNumber ?? null,
          motorNumber: dto.motorNumber ?? unit.motorNumber,
          batteryNumber: dto.batteryNumber ?? unit.batteryNumber,
          purchaseDate,
          startDate,
          endDate,
          periodMonths,
          coverage: coverage as unknown as Prisma.InputJsonValue,
          dealerNotes: dto.dealerNotes ?? null,
          customerNotes: dto.customerNotes ?? null,
          createdById: userId,
        },
      });
      await tx.freeService.createMany({ data: this.freeServiceSeed(company, warranty.id, startDate, settings) });
      return warranty;
    });

    await this.timeline.record({
      customerId,
      type: 'WARRANTY',
      title: `Warranty ${created.warrantyNumber} activated`,
      description: `${periodMonths}-month warranty · expires ${endDate.toLocaleDateString('en-IN')}`,
      entityType: 'Warranty',
      entityId: created.id,
      actorId: userId,
    });
    return this.detail(created.id);
  }

  /** Backfill: create warranties for delivered vehicles that don't have one yet. Idempotent. */
  async generateMissing(userId: string): Promise<{ created: number }> {
    const delivered = await this.prisma.booking.findMany({
      where: { actualDelivery: { not: null }, status: { not: 'CANCELLED' }, unit: { warranties: { none: { status: { not: 'CANCELLED' } } } } },
      select: { id: true, unitId: true },
      take: 500,
    });
    let created = 0;
    for (const b of delivered) {
      try {
        await this.create({ unitId: b.unitId, bookingId: b.id }, userId);
        created += 1;
      } catch {
        // Another warranty was created concurrently, or the unit is ineligible — skip.
      }
    }
    return { created };
  }

  async update(id: string, dto: UpdateWarrantyInput, actor: { id: string; role: Role }): Promise<WarrantyDetailDto> {
    const warranty = await this.getRowOrThrow(id);
    const userId = actor.id;
    const data: Prisma.WarrantyUpdateInput = { updatedById: userId };
    if (dto.coverage) {
      // The coverage is the warranty card: only the owner changes it. Each line keeps the months it had.
      if (actor.role !== Role.OWNER) throw new ForbiddenException('Only the owner can change the warranty coverage');
      const had = new Map(this.readCoverage(warranty.coverage).map((l) => [l.item, l.months]));
      const lines = normaliseCoverage(dto.coverage).map((l) => ({ ...l, months: had.get(l.item) ?? null }));
      data.coverage = withMonths(lines, warranty.startDate, {}, warranty.periodMonths) as unknown as Prisma.InputJsonValue;
    }
    if (dto.dealerNotes !== undefined) data.dealerNotes = dto.dealerNotes;
    if (dto.customerNotes !== undefined) data.customerNotes = dto.customerNotes;
    if (dto.status) data.status = dto.status;
    await this.prisma.warranty.update({ where: { id }, data });
    void warranty;
    return this.detail(id);
  }

  /**
   * Owner only: new months for the motor, battery, controller and charger. The card is regenerated under the same
   * warranty number and start date: each component's end date, the overall period (its longest component) and
   * the expiry move with it, and the vehicle's months are updated to match. The previous months are kept in the
   * activity log.
   */
  async reviseMonths(id: string, dto: ReviseWarrantyMonthsInput, actor: { id: string; role: Role }): Promise<WarrantyDetailDto> {
    if (actor.role !== Role.OWNER) throw new ForbiddenException('Only the owner can change the warranty months');
    const warranty = await this.getRowOrThrow(id);
    if (warranty.status === 'CANCELLED') throw new ConflictException('This warranty is cancelled');
    const current = this.readCoverage(warranty.coverage);
    const before = componentMonthsOf(current);
    const extrasBefore = extrasOf(current);
    const extras = dto.extras ?? extrasBefore;
    // Rebuilt as the four components plus the extra items (any other line of an older card is dropped); a
    // component keeps its remarks.
    const remarks = new Map(current.map((l) => [l.item, l.remarks]));
    const lines = cardCoverage(extras).map((l) => (l.item === 'CUSTOM' ? l : { ...l, remarks: remarks.get(l.item) ?? null }));
    const coverage = withMonths(lines, warranty.startDate, dto.months, warranty.periodMonths);
    const periodMonths = periodOf(coverage, warranty.periodMonths);
    const endDate = addMonths(warranty.startDate, periodMonths);
    // A claimed warranty stays claimed; otherwise the new expiry decides whether it is still running.
    const status = warranty.status === 'CLAIMED' ? warranty.status : endDate < new Date() ? 'EXPIRED' : 'ACTIVE';
    const shape = (l: WarrantyCoverageLine[]): string => JSON.stringify(l.map((c) => [c.item, c.label, c.covered, c.months ?? null]));
    if (shape(coverage) === shape(current)) throw new BadRequestException('Nothing to change: the months given match the warranty');
    const listed = (items: { name: string; months: number }[]): string => (items.length ? items.map((e) => `${e.name} ${e.months}`).join(', ') : 'none');
    const changes = [
      ...WARRANTY_MONTH_COMPONENTS.filter((c) => before[c] !== dto.months[c]).map((c) => `${coverageLabel(c)} ${before[c] ?? '—'} → ${dto.months[c]}`),
      ...(listed(extras) !== listed(extrasBefore) ? [`extra items ${listed(extrasBefore)} → ${listed(extras)}`] : []),
    ];

    await this.prisma.$transaction(async (tx) => {
      await tx.warranty.update({ where: { id }, data: { coverage: coverage as unknown as Prisma.InputJsonValue, periodMonths, endDate, status, updatedById: actor.id } });
      await tx.inventoryUnit.update({
        where: { id: warranty.unitId },
        data: {
          ...Object.fromEntries(WARRANTY_MONTH_COMPONENTS.map((c) => [UNIT_WARRANTY_MONTH_FIELDS[c], dto.months[c]])),
          warrantyExtras: extras as unknown as Prisma.InputJsonValue,
          updatedById: actor.id,
        },
      });
      await this.activityLog.recordInTransaction(
        {
          actorId: actor.id,
          action: ActivityAction.UPDATE,
          entityType: 'Warranty',
          entityId: id,
          summary: `Regenerated warranty ${warranty.warrantyNumber}${changes.length ? `: ${changes.join('; ')}` : ' as motor, battery, controller, charger and extra items'}${dto.reason ? ` — ${dto.reason}` : ''}`,
          metadata: { before, after: dto.months, extras: { from: extrasBefore, to: extras }, periodMonths: { from: warranty.periodMonths, to: periodMonths } },
        },
        tx,
      );
    });
    return this.detail(id);
  }

  async cancel(id: string, userId: string): Promise<WarrantyDetailDto> {
    await this.getRowOrThrow(id);
    await this.prisma.warranty.update({ where: { id }, data: { status: 'CANCELLED', updatedById: userId } });
    return this.detail(id);
  }

  async completeFreeService(id: string, dto: CompleteFreeServiceInput, userId: string): Promise<FreeServiceDto> {
    const free = await this.prisma.freeService.findFirst({ where: { id } });
    if (!free) throw new NotFoundException('Free service not found');
    const updated = await this.prisma.freeService.update({
      where: { id },
      data: {
        status: dto.status,
        completedDate: dto.status === 'COMPLETED' ? (dto.completedDate ?? new Date()) : null,
        technicianId: dto.technicianId ?? free.technicianId,
        remarks: dto.remarks ?? free.remarks,
      },
    });
    void userId;
    const names = await technicianNames(this.prisma, [updated.technicianId]);
    return this.toFreeServiceDto(updated, names);
  }

  // ── Internal ───────────────────────────────────────────
  /** Flip ACTIVE warranties/AMC past their end date to EXPIRED. Idempotent; cheap. */
  private async syncExpiry(): Promise<void> {
    const now = new Date();
    await Promise.all([
      this.prisma.warranty.updateMany({ where: { status: 'ACTIVE', endDate: { lt: now } }, data: { status: 'EXPIRED' } }),
      this.prisma.amcPlan.updateMany({ where: { status: 'ACTIVE', endDate: { lt: now } }, data: { status: 'EXPIRED' } }),
    ]);
  }

  private freeServiceSeed(company: string, warrantyId: string, start: Date, settings: { freeService1Days: number; freeService2Days: number; freeService3Days: number } | null): Prisma.FreeServiceCreateManyInput[] {
    const days = [settings?.freeService1Days ?? 30, settings?.freeService2Days ?? 90, settings?.freeService3Days ?? 180];
    return days.map((d, i) => ({ companyId: company, warrantyId, serviceNumber: i + 1, dueDate: new Date(start.getTime() + d * 86_400_000) }));
  }

  private async getRowOrThrow(id: string): Promise<WarrantyRow> {
    const row = await this.prisma.warranty.findFirst({ where: { id }, include: warrantyInclude });
    if (!row) throw new NotFoundException('Warranty not found');
    return row;
  }

  private readCoverage(value: Prisma.JsonValue): WarrantyCoverageLine[] {
    if (!Array.isArray(value)) return [];
    return value as unknown as WarrantyCoverageLine[];
  }

  private toRecordDto(r: WarrantyRow): WarrantyRecordDto {
    return {
      id: r.id,
      warrantyNumber: r.warrantyNumber,
      status: r.status,
      customerId: r.customerId,
      customerName: r.customer.name,
      unitId: r.unitId,
      vin: r.unit.vin,
      model: r.unit.variant.model.name,
      variant: r.unit.variant.name,
      motorNumber: r.motorNumber,
      batteryNumber: r.batteryNumber,
      controllerNumber: r.unit.controllerNumber,
      chargerNumber: r.unit.chargerNumber,
      bookingId: r.bookingId,
      bookingCode: null,
      saleId: r.saleId,
      invoiceNumber: r.invoiceNumber,
      purchaseDate: r.purchaseDate.toISOString(),
      startDate: r.startDate.toISOString(),
      endDate: r.endDate.toISOString(),
      periodMonths: r.periodMonths,
      daysToExpiry: daysBetween(new Date(), r.endDate),
      dealerNotes: r.dealerNotes,
      customerNotes: r.customerNotes,
      createdAt: r.createdAt.toISOString(),
    };
  }

  private toFreeServiceDto(f: Prisma.FreeServiceGetPayload<Record<string, never>>, names: Map<string, string>): FreeServiceDto {
    return {
      id: f.id,
      serviceNumber: f.serviceNumber,
      status: f.status,
      dueDate: f.dueDate.toISOString(),
      completedDate: f.completedDate?.toISOString() ?? null,
      technicianId: f.technicianId,
      technicianName: f.technicianId ? (names.get(f.technicianId) ?? null) : null,
      remarks: f.remarks,
    };
  }

  private toAmcSummary(a: Prisma.AmcPlanGetPayload<{ include: typeof warrantyInclude }>) {
    return {
      id: a.id,
      amcNumber: a.amcNumber,
      status: a.status,
      planType: a.planType,
      customerId: a.customerId,
      customerName: a.customer.name,
      unitId: a.unitId,
      vin: a.unit.vin,
      model: a.unit.variant.model.name,
      startDate: a.startDate.toISOString(),
      endDate: a.endDate.toISOString(),
      visitsIncluded: a.visitsIncluded,
      visitsUsed: a.visitsUsed,
      visitsRemaining: Math.max(0, a.visitsIncluded - a.visitsUsed),
      price: String(a.price),
      daysToExpiry: daysBetween(new Date(), a.endDate),
      notes: a.notes,
      createdAt: a.createdAt.toISOString(),
    };
  }

  private buildTimeline(
    record: WarrantyRecordDto,
    freeServices: FreeServiceDto[],
    claims: WarrantyClaimDto[],
    amc: Prisma.AmcPlanGetPayload<{ include: typeof warrantyInclude }>[],
    visits: Prisma.AmcVisitGetPayload<Record<string, never>>[],
    services: { id: string; code: string; status: string; type: string; createdAt: Date }[],
  ): WarrantyTimelineEntry[] {
    const entries: WarrantyTimelineEntry[] = [
      { at: record.purchaseDate, kind: 'PURCHASED', title: 'Vehicle purchased', detail: record.invoiceNumber ? `Invoice ${record.invoiceNumber}` : null },
      { at: record.startDate, kind: 'WARRANTY_ACTIVATED', title: `Warranty ${record.warrantyNumber} activated`, detail: `${record.periodMonths} months` },
      { at: record.endDate, kind: 'WARRANTY_EXPIRY', title: 'Warranty expiry', detail: null },
    ];
    for (const f of freeServices) {
      entries.push({ at: f.completedDate ?? f.dueDate, kind: 'FREE_SERVICE', title: `Free service #${f.serviceNumber} — ${f.status.toLowerCase()}`, detail: f.completedDate ? `Done ${new Date(f.completedDate).toLocaleDateString('en-IN')}` : `Due ${new Date(f.dueDate).toLocaleDateString('en-IN')}` });
    }
    for (const s of services) {
      entries.push({ at: s.createdAt.toISOString(), kind: 'SERVICE', title: `Service ${s.code}`, detail: `${s.type} · ${s.status}` });
    }
    for (const c of claims) {
      entries.push({ at: c.claimDate, kind: 'CLAIM', title: `Claim ${c.claimNumber} — ${c.status.toLowerCase()}`, detail: c.complaint });
    }
    for (const a of amc) {
      entries.push({ at: a.startDate.toISOString(), kind: 'AMC_PURCHASED', title: `AMC ${a.amcNumber} (${a.planType})`, detail: `${a.visitsIncluded} visits` });
    }
    for (const v of visits) {
      entries.push({ at: v.visitDate.toISOString(), kind: 'AMC_VISIT', title: `AMC visit #${v.visitNumber}`, detail: v.workDone });
    }
    return entries.sort((a, b) => a.at.localeCompare(b.at));
  }
}
