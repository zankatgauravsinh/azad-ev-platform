import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  buildPageMeta,
  type CompleteFreeServiceInput,
  type CreateWarrantyInput,
  type FreeServiceDto,
  type ListWarrantiesQuery,
  type Paginated,
  type UpdateWarrantyInput,
  type WarrantyClaimDto,
  type WarrantyCoverageLine,
  type WarrantyDetailDto,
  type WarrantyRecordDto,
  type WarrantyTimelineEntry,
} from '@azad/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantContext } from '../../tenant/tenant-context.service';
import { CustomerTimelineService } from '../customers/customer-timeline.service';
import { SequenceService } from '../sales/sequence.service';
import { addMonths, daysBetween, defaultCoverage, normaliseCoverage } from './warranty.helpers';
import { warrantyInclude, technicianNames, type WarrantyRow } from './warranty.include';
import { toClaimDto } from './warranty-claims.service';

@Injectable()
export class WarrantyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContext,
    private readonly sequence: SequenceService,
    private readonly timeline: CustomerTimelineService,
  ) {}

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
      select: { id: true, motorNumber: true, batteryNumber: true, bookings: { select: { id: true, customerId: true, actualDelivery: true, sale: { select: { invoiceNumber: true } } }, orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    if (!unit) throw new NotFoundException('Vehicle not found');

    const existing = await this.prisma.warranty.findFirst({ where: { unitId: dto.unitId, status: { not: 'CANCELLED' } } });
    if (existing) throw new NotFoundException('This vehicle already has an active warranty');

    const booking = unit.bookings[0] ?? null;
    const customerId = dto.customerId ?? booking?.customerId;
    if (!customerId) throw new NotFoundException('Customer could not be resolved for this vehicle');

    const settings = await this.prisma.companySetting.findFirst();
    const periodMonths = dto.periodMonths ?? settings?.defaultWarrantyMonths ?? 36;
    const purchaseDate = dto.purchaseDate ?? booking?.actualDelivery ?? new Date();
    const startDate = purchaseDate;
    const endDate = addMonths(startDate, periodMonths);
    const coverage = dto.coverage?.length ? normaliseCoverage(dto.coverage) : defaultCoverage();

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

  async update(id: string, dto: UpdateWarrantyInput, userId: string): Promise<WarrantyDetailDto> {
    const warranty = await this.getRowOrThrow(id);
    const data: Prisma.WarrantyUpdateInput = { updatedById: userId };
    if (dto.coverage) data.coverage = normaliseCoverage(dto.coverage) as unknown as Prisma.InputJsonValue;
    if (dto.dealerNotes !== undefined) data.dealerNotes = dto.dealerNotes;
    if (dto.customerNotes !== undefined) data.customerNotes = dto.customerNotes;
    if (dto.status) data.status = dto.status;
    await this.prisma.warranty.update({ where: { id }, data });
    void warranty;
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
