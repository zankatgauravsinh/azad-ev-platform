import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ActivityAction,
  type CreateTaxClassificationInput,
  type CreateTaxRateInput,
  type ListTaxClassificationsQuery,
  type TaxClassificationDto,
  type TaxRateDto,
  type UpdateTaxClassificationInput,
  type UpdateTaxRateInput,
} from '@azad/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { ActivityLogService } from '../../activity-log/activity-log.service';

type ClassificationWithRates = Prisma.TaxClassificationGetPayload<{ include: { rates: true } }>;
type RateRow = Prisma.TaxRateGetPayload<Record<string, never>>;

/**
 * GST / tax configuration (Stage A — master data only). Tenant isolation is provided by the Prisma
 * tenant middleware (reads/creates auto-scoped to the caller's company); classifications are
 * soft-deleted. NOTHING here calculates tax or touches Booking/Sale/invoice/Delivery.
 */
@Injectable()
export class TaxService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activityLog: ActivityLogService,
  ) {}

  // ── Classifications ──────────────────────────────────────
  async listClassifications(query: ListTaxClassificationsQuery): Promise<TaxClassificationDto[]> {
    const where: Prisma.TaxClassificationWhereInput = {};
    if (!query.includeInactive) where.isActive = true;
    const rows = await this.prisma.taxClassification.findMany({
      where,
      include: { rates: { orderBy: { effectiveFrom: 'desc' } } },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    });
    return rows.map((r) => TaxService.toDto(r));
  }

  async getClassification(id: string): Promise<TaxClassificationDto> {
    return TaxService.toDto(await this.loadClassification(id));
  }

  async createClassification(dto: CreateTaxClassificationInput, userId: string): Promise<TaxClassificationDto> {
    await this.assertNameFree(dto.name);
    const created = await this.prisma.taxClassification.create({
      data: {
        name: dto.name,
        codeType: dto.codeType,
        code: dto.code ?? null,
        treatment: dto.treatment,
        description: dto.description ?? null,
        isActive: dto.isActive ?? true,
        createdById: userId,
        updatedById: userId,
      },
      include: { rates: true },
    });
    await this.audit(userId, ActivityAction.CREATE, created.id, `Created tax classification ${created.name}`);
    return TaxService.toDto(created);
  }

  async updateClassification(id: string, dto: UpdateTaxClassificationInput, userId: string): Promise<TaxClassificationDto> {
    const existing = await this.loadClassification(id);
    if (dto.name !== undefined && dto.name !== existing.name) await this.assertNameFree(dto.name);
    // Guard: a classification cannot become/stay TAXABLE without an HSN/SAC code.
    const treatment = dto.treatment ?? existing.treatment;
    const code = dto.code !== undefined ? dto.code : existing.code;
    if (treatment === 'TAXABLE' && (code == null || code.trim() === '')) {
      throw new BadRequestException('A taxable classification needs an HSN/SAC code');
    }
    await this.prisma.taxClassification.update({
      where: { id },
      data: {
        name: dto.name,
        codeType: dto.codeType,
        code: dto.code,
        treatment: dto.treatment,
        description: dto.description,
        isActive: dto.isActive,
        updatedById: userId,
      },
    });
    await this.audit(userId, ActivityAction.UPDATE, id, `Updated tax classification ${dto.name ?? existing.name}`);
    return this.getClassification(id);
  }

  async removeClassification(id: string, userId: string): Promise<{ id: string }> {
    const existing = await this.loadClassification(id);
    // Soft delete (middleware converts delete → set deletedAt). Rates stay attached to the archived row.
    await this.prisma.taxClassification.delete({ where: { id } });
    await this.audit(userId, ActivityAction.DELETE, id, `Deleted tax classification ${existing.name}`);
    return { id };
  }

  // ── Rates ────────────────────────────────────────────────
  async addRate(classificationId: string, dto: CreateTaxRateInput, userId: string): Promise<TaxRateDto> {
    await this.loadClassification(classificationId);
    const isActive = dto.isActive ?? true;
    if (isActive) await this.assertNoOverlap(classificationId, dto.effectiveFrom, dto.effectiveTo ?? null, null);
    const created = await this.prisma.taxRate.create({
      data: {
        classificationId,
        ratePercent: new Prisma.Decimal(dto.ratePercent),
        effectiveFrom: dto.effectiveFrom,
        effectiveTo: dto.effectiveTo ?? null,
        isActive,
        createdById: userId,
        updatedById: userId,
      },
    });
    await this.audit(userId, ActivityAction.CREATE, classificationId, `Added tax rate ${dto.ratePercent}%`);
    return TaxService.toRateDto(created);
  }

  async updateRate(rateId: string, dto: UpdateTaxRateInput, userId: string): Promise<TaxRateDto> {
    const existing = await this.loadRate(rateId);
    const from = dto.effectiveFrom ?? existing.effectiveFrom;
    const to = dto.effectiveTo !== undefined ? dto.effectiveTo : existing.effectiveTo;
    if (to != null && to <= from) throw new BadRequestException('Effective-to must be after effective-from');
    const isActive = dto.isActive ?? existing.isActive;
    if (isActive) await this.assertNoOverlap(existing.classificationId, from, to, rateId);
    await this.prisma.taxRate.update({
      where: { id: rateId },
      data: {
        ratePercent: dto.ratePercent !== undefined ? new Prisma.Decimal(dto.ratePercent) : undefined,
        effectiveFrom: dto.effectiveFrom,
        effectiveTo: dto.effectiveTo,
        isActive: dto.isActive,
        updatedById: userId,
      },
    });
    await this.audit(userId, ActivityAction.UPDATE, existing.classificationId, `Updated a tax rate`);
    return TaxService.toRateDto(await this.loadRate(rateId));
  }

  async removeRate(rateId: string, userId: string): Promise<{ id: string }> {
    const existing = await this.loadRate(rateId);
    await this.prisma.taxRate.delete({ where: { id: rateId } });
    await this.audit(userId, ActivityAction.DELETE, existing.classificationId, `Removed a tax rate`);
    return { id: rateId };
  }

  // ── internals ────────────────────────────────────────────
  private async loadClassification(id: string): Promise<ClassificationWithRates> {
    // Tenant-scoped by middleware: a row from another company reads back null → NotFound.
    const row = await this.prisma.taxClassification.findFirst({ where: { id }, include: { rates: { orderBy: { effectiveFrom: 'desc' } } } });
    if (!row) throw new NotFoundException('Tax classification not found');
    return row;
  }

  private async loadRate(id: string): Promise<RateRow> {
    const row = await this.prisma.taxRate.findFirst({ where: { id } });
    if (!row) throw new NotFoundException('Tax rate not found');
    return row;
  }

  private async assertNameFree(name: string): Promise<void> {
    const clash = await this.prisma.taxClassification.findFirst({ where: { name } });
    if (clash) throw new ConflictException('A tax classification with this name already exists');
  }

  /** Active rate periods for a classification may not overlap. Open-ended (effectiveTo null) = +∞. */
  private async assertNoOverlap(classificationId: string, from: Date, to: Date | null, excludeRateId: string | null): Promise<void> {
    const actives = await this.prisma.taxRate.findMany({ where: { classificationId, isActive: true } });
    for (const r of actives) {
      if (excludeRateId && r.id === excludeRateId) continue;
      const rTo = r.effectiveTo;
      // [from,to) overlaps [r.from,r.to) when each starts before the other ends.
      const startsBeforeOtherEnds = rTo == null || from < rTo;
      const otherStartsBeforeThisEnds = to == null || r.effectiveFrom < to;
      if (startsBeforeOtherEnds && otherStartsBeforeThisEnds) {
        throw new ConflictException('An active rate already covers part of this period');
      }
    }
  }

  private audit(userId: string, action: ActivityAction, entityId: string, summary: string): Promise<void> {
    return this.activityLog.record({ actorId: userId, action, entityType: 'TaxClassification', entityId, summary });
  }

  static toDto(c: ClassificationWithRates): TaxClassificationDto {
    return {
      id: c.id,
      name: c.name,
      codeType: c.codeType,
      code: c.code,
      treatment: c.treatment,
      description: c.description,
      isActive: c.isActive,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
      rates: c.rates.map((r) => TaxService.toRateDto(r)),
    };
  }

  static toRateDto(r: RateRow): TaxRateDto {
    return {
      id: r.id,
      classificationId: r.classificationId,
      ratePercent: r.ratePercent.toFixed(2),
      effectiveFrom: r.effectiveFrom.toISOString(),
      effectiveTo: r.effectiveTo ? r.effectiveTo.toISOString() : null,
      isActive: r.isActive,
      createdAt: r.createdAt.toISOString(),
    };
  }
}
