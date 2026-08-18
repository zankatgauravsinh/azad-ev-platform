import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  NotificationPriority,
  NotificationType,
  buildPageMeta,
  type CreateWarrantyClaimInput,
  type ListClaimsQuery,
  type Paginated,
  type UpdateClaimStatusInput,
  type WarrantyClaimDto,
  type WarrantyPartLine,
} from '@azad/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantContext } from '../../tenant/tenant-context.service';
import { CustomerTimelineService } from '../customers/customer-timeline.service';
import { SequenceService } from '../sales/sequence.service';
import { warrantyInclude, technicianNames } from './warranty.include';

const claimInclude = { warranty: { include: warrantyInclude } } satisfies Prisma.WarrantyClaimInclude;
type ClaimRow = Prisma.WarrantyClaimGetPayload<{ include: typeof claimInclude }>;

function readParts(value: Prisma.JsonValue): WarrantyPartLine[] {
  return Array.isArray(value) ? (value as unknown as WarrantyPartLine[]) : [];
}

/** Map a claim row (with its warranty) to a DTO. Shared with the warranty detail view. */
export function toClaimDto(c: ClaimRow, names: Map<string, string>): WarrantyClaimDto {
  return {
    id: c.id,
    claimNumber: c.claimNumber,
    warrantyId: c.warrantyId,
    warrantyNumber: c.warranty.warrantyNumber,
    status: c.status,
    customerName: c.warranty.customer.name,
    vin: c.warranty.unit.vin,
    complaint: c.complaint,
    diagnosis: c.diagnosis,
    partsReplaced: readParts(c.partsReplaced),
    labour: c.labour,
    claimDate: c.claimDate.toISOString(),
    completionDate: c.completionDate?.toISOString() ?? null,
    claimCost: String(c.claimCost),
    manufacturerClaimAmount: String(c.manufacturerClaimAmount),
    dealerCost: String(c.dealerCost),
    technicianId: c.technicianId,
    technicianName: c.technicianId ? (names.get(c.technicianId) ?? null) : null,
    createdAt: c.createdAt.toISOString(),
  };
}

@Injectable()
export class WarrantyClaimsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContext,
    private readonly sequence: SequenceService,
    private readonly timeline: CustomerTimelineService,
  ) {}

  async list(query: ListClaimsQuery): Promise<Paginated<WarrantyClaimDto>> {
    const where: Prisma.WarrantyClaimWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.warrantyId) where.warrantyId = query.warrantyId;
    if (query.q) {
      where.OR = [
        { claimNumber: { contains: query.q, mode: 'insensitive' } },
        { complaint: { contains: query.q, mode: 'insensitive' } },
        { warranty: { warrantyNumber: { contains: query.q, mode: 'insensitive' } } },
        { warranty: { customer: { name: { contains: query.q, mode: 'insensitive' } } } },
      ];
    }
    const [rows, total] = await Promise.all([
      this.prisma.warrantyClaim.findMany({ where, include: claimInclude, orderBy: { claimDate: 'desc' }, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      this.prisma.warrantyClaim.count({ where }),
    ]);
    const names = await technicianNames(this.prisma, rows.map((r) => r.technicianId));
    return { data: rows.map((r) => toClaimDto(r, names)), meta: buildPageMeta(query.page, query.pageSize, total) };
  }

  async get(id: string): Promise<WarrantyClaimDto> {
    const row = await this.getRowOrThrow(id);
    const names = await technicianNames(this.prisma, [row.technicianId]);
    return toClaimDto(row, names);
  }

  async create(dto: CreateWarrantyClaimInput, userId: string): Promise<WarrantyClaimDto> {
    const company = this.tenant.requireCompanyId();
    const warranty = await this.prisma.warranty.findFirst({ where: { id: dto.warrantyId }, include: warrantyInclude });
    if (!warranty) throw new NotFoundException('Warranty not found');

    const claimCost = BigInt(dto.claimCost);
    const manufacturerClaimAmount = BigInt(dto.manufacturerClaimAmount);
    const dealerCost = claimCost > manufacturerClaimAmount ? claimCost - manufacturerClaimAmount : 0n;

    const created = await this.prisma.$transaction(async (tx) => {
      const claimNumber = await this.sequence.next('claim', tx);
      return tx.warrantyClaim.create({
        data: {
          companyId: company,
          claimNumber,
          warrantyId: dto.warrantyId,
          complaint: dto.complaint,
          diagnosis: dto.diagnosis ?? null,
          partsReplaced: (dto.partsReplaced ?? []) as unknown as Prisma.InputJsonValue,
          labour: dto.labour ?? null,
          technicianId: dto.technicianId ?? null,
          claimDate: dto.claimDate ?? new Date(),
          claimCost,
          manufacturerClaimAmount,
          dealerCost,
          createdById: userId,
        },
        include: claimInclude,
      });
    });

    await this.timeline.record({
      customerId: warranty.customerId,
      type: 'WARRANTY',
      title: `Warranty claim ${created.claimNumber} raised`,
      description: dto.complaint,
      entityType: 'WarrantyClaim',
      entityId: created.id,
      actorId: userId,
    });
    await this.notify(company, created, 'raised');
    const names = await technicianNames(this.prisma, [created.technicianId]);
    return toClaimDto(created, names);
  }

  async updateStatus(id: string, dto: UpdateClaimStatusInput, userId: string): Promise<WarrantyClaimDto> {
    const company = this.tenant.requireCompanyId();
    const existing = await this.getRowOrThrow(id);
    const data: Prisma.WarrantyClaimUpdateInput = { status: dto.status, updatedById: userId };
    if (dto.diagnosis !== undefined) data.diagnosis = dto.diagnosis;
    const claimCost = dto.claimCost !== undefined ? BigInt(dto.claimCost) : existing.claimCost;
    const manufacturerClaimAmount = dto.manufacturerClaimAmount !== undefined ? BigInt(dto.manufacturerClaimAmount) : existing.manufacturerClaimAmount;
    if (dto.claimCost !== undefined || dto.manufacturerClaimAmount !== undefined) {
      data.claimCost = claimCost;
      data.manufacturerClaimAmount = manufacturerClaimAmount;
      data.dealerCost = claimCost > manufacturerClaimAmount ? claimCost - manufacturerClaimAmount : 0n;
    }
    if (dto.status === 'COMPLETED') data.completionDate = new Date();

    const updated = await this.prisma.warrantyClaim.update({ where: { id }, data, include: claimInclude });
    // A completed claim marks the warranty as CLAIMED (it has been drawn on).
    if (dto.status === 'COMPLETED') {
      await this.prisma.warranty.updateMany({ where: { id: existing.warrantyId, status: 'ACTIVE' }, data: { status: 'CLAIMED' } });
    }
    await this.timeline.record({
      customerId: updated.warranty.customerId,
      type: 'WARRANTY',
      title: `Claim ${updated.claimNumber} ${dto.status.toLowerCase()}`,
      description: dto.note ?? null,
      entityType: 'WarrantyClaim',
      entityId: updated.id,
      actorId: userId,
    });
    if (dto.status === 'APPROVED' || dto.status === 'REJECTED') await this.notify(company, updated, dto.status.toLowerCase());
    const names = await technicianNames(this.prisma, [updated.technicianId]);
    return toClaimDto(updated, names);
  }

  private async getRowOrThrow(id: string): Promise<ClaimRow> {
    const row = await this.prisma.warrantyClaim.findFirst({ where: { id }, include: claimInclude });
    if (!row) throw new NotFoundException('Warranty claim not found');
    return row;
  }

  /** Emit a de-duplicated WARRANTY notification for a claim event. */
  private async notify(company: string, claim: ClaimRow, event: string): Promise<void> {
    const dedupeKey = `claim-${event}:${claim.id}`;
    const priority = event === 'rejected' ? NotificationPriority.HIGH : NotificationPriority.MEDIUM;
    try {
      await this.prisma.notification.create({
        data: {
          companyId: company,
          title: `Warranty claim ${event}`,
          message: `${claim.claimNumber} · ${claim.warranty.customer.name} — ${claim.warranty.unit.vin}`,
          type: NotificationType.WARRANTY,
          priority,
          entityType: 'WarrantyClaim',
          entityId: claim.id,
          dedupeKey,
        },
      });
    } catch {
      // Unique (companyId, dedupeKey) — already notified for this event; ignore.
    }
  }
}
