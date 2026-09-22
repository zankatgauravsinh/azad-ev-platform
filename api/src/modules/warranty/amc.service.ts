import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  buildPageMeta,
  type AmcPlanDetailDto,
  type AmcPlanDto,
  type AmcVisitDto,
  type CreateAmcInput,
  type CreateAmcVisitInput,
  type ListAmcQuery,
  type Paginated,
} from '@azad/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantContext } from '../../tenant/tenant-context.service';
import { CustomerTimelineService } from '../customers/customer-timeline.service';
import { SequenceService } from '../sales/sequence.service';
import { addMonths, daysBetween } from './warranty.helpers';
import { warrantyInclude, technicianNames, type AmcRow } from './warranty.include';

@Injectable()
export class AmcService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContext,
    private readonly sequence: SequenceService,
    private readonly timeline: CustomerTimelineService,
  ) {}

  async list(query: ListAmcQuery): Promise<Paginated<AmcPlanDto>> {
    await this.prisma.amcPlan.updateMany({ where: { status: 'ACTIVE', endDate: { lt: new Date() } }, data: { status: 'EXPIRED' } });
    const where: Prisma.AmcPlanWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.planType) where.planType = query.planType;
    if (query.customerId) where.customerId = query.customerId;
    if (query.q) {
      where.OR = [
        { amcNumber: { contains: query.q, mode: 'insensitive' } },
        { customer: { name: { contains: query.q, mode: 'insensitive' } } },
        { unit: { vin: { contains: query.q, mode: 'insensitive' } } },
      ];
    }
    const [rows, total] = await Promise.all([
      this.prisma.amcPlan.findMany({ where, include: warrantyInclude, orderBy: { createdAt: 'desc' }, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      this.prisma.amcPlan.count({ where }),
    ]);
    return { data: rows.map((r) => this.toDto(r)), meta: buildPageMeta(query.page, query.pageSize, total) };
  }

  async detail(id: string): Promise<AmcPlanDetailDto> {
    const row = await this.getRowOrThrow(id);
    const visits = await this.prisma.amcVisit.findMany({ where: { amcPlanId: id }, orderBy: { visitNumber: 'asc' } });
    const names = await technicianNames(this.prisma, visits.map((v) => v.technicianId));
    return { ...this.toDto(row), visits: visits.map((v) => this.toVisitDto(v, names)) };
  }

  async create(dto: CreateAmcInput, userId: string): Promise<AmcPlanDetailDto> {
    const company = this.tenant.requireCompanyId();
    const unit = await this.prisma.inventoryUnit.findFirst({
      where: { id: dto.unitId },
      select: { id: true, bookings: { select: { customerId: true }, orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    if (!unit) throw new NotFoundException('Vehicle not found');
    const customerId = dto.customerId ?? unit.bookings[0]?.customerId;
    if (!customerId) throw new NotFoundException('Customer could not be resolved for this vehicle');

    const startDate = dto.startDate ?? new Date();
    const endDate = addMonths(startDate, dto.months);

    const created = await this.prisma.$transaction(async (tx) => {
      const amcNumber = await this.sequence.next('amc', tx);
      return tx.amcPlan.create({
        data: {
          companyId: company,
          amcNumber,
          planType: dto.planType,
          customerId,
          unitId: dto.unitId,
          startDate,
          endDate,
          visitsIncluded: dto.visitsIncluded,
          price: BigInt(dto.price),
          notes: dto.notes ?? null,
          createdById: userId,
        },
        include: warrantyInclude,
      });
    });

    await this.timeline.record({
      customerId,
      type: 'WARRANTY',
      title: `AMC ${created.amcNumber} (${dto.planType}) purchased`,
      description: `${dto.visitsIncluded} visits · expires ${endDate.toLocaleDateString('en-IN')}`,
      entityType: 'AmcPlan',
      entityId: created.id,
      actorId: userId,
    });
    return this.detail(created.id);
  }

  async recordVisit(id: string, dto: CreateAmcVisitInput, userId: string): Promise<AmcVisitDto> {
    const plan = await this.getRowOrThrow(id);
    if (plan.status !== 'ACTIVE') throw new BadRequestException('AMC plan is not active');
    if (dto.coveredUnderAmc && plan.visitsUsed >= plan.visitsIncluded) {
      throw new BadRequestException('All included AMC visits have already been used');
    }

    const visit = await this.prisma.$transaction(async (tx) => {
      const count = await tx.amcVisit.count({ where: { amcPlanId: id } });
      const created = await tx.amcVisit.create({
        data: {
          companyId: plan.companyId,
          amcPlanId: id,
          visitNumber: count + 1,
          visitDate: dto.visitDate ?? new Date(),
          technicianId: dto.technicianId ?? null,
          workDone: dto.workDone,
          partsUsed: dto.partsUsed ?? null,
          amount: BigInt(dto.amount),
          coveredUnderAmc: dto.coveredUnderAmc,
          createdById: userId,
        },
      });
      if (dto.coveredUnderAmc) {
        await tx.amcPlan.update({ where: { id }, data: { visitsUsed: { increment: 1 } } });
      }
      return created;
    });

    await this.timeline.record({
      customerId: plan.customerId,
      type: 'WARRANTY',
      title: `AMC visit #${visit.visitNumber} — ${plan.amcNumber}`,
      description: dto.workDone,
      entityType: 'AmcPlan',
      entityId: plan.id,
      actorId: userId,
    });
    const names = await technicianNames(this.prisma, [visit.technicianId]);
    return this.toVisitDto(visit, names);
  }

  private async getRowOrThrow(id: string): Promise<AmcRow> {
    const row = await this.prisma.amcPlan.findFirst({ where: { id }, include: warrantyInclude });
    if (!row) throw new NotFoundException('AMC plan not found');
    return row;
  }

  private toDto(a: AmcRow): AmcPlanDto {
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

  private toVisitDto(v: Prisma.AmcVisitGetPayload<Record<string, never>>, names: Map<string, string>): AmcVisitDto {
    return {
      id: v.id,
      amcPlanId: v.amcPlanId,
      visitNumber: v.visitNumber,
      visitDate: v.visitDate.toISOString(),
      technicianId: v.technicianId,
      technicianName: v.technicianId ? (names.get(v.technicianId) ?? null) : null,
      workDone: v.workDone,
      partsUsed: v.partsUsed,
      amount: String(v.amount),
      coveredUnderAmc: v.coveredUnderAmc,
    };
  }
}
