import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  buildPageMeta,
  type CreateVendorInput,
  type ListVendorsQuery,
  type Paginated,
  type UpdateVendorInput,
  type VendorDto,
  type VendorLedgerDto,
} from '@azad/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantContext } from '../../tenant/tenant-context.service';
import { ActivityLogService } from '../../activity-log/activity-log.service';
import { SequenceService } from '../sales/sequence.service';

type VendorRow = Prisma.VendorGetPayload<Record<string, never>>;

@Injectable()
export class VendorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContext,
    private readonly sequence: SequenceService,
    private readonly activityLog: ActivityLogService,
  ) {}

  async list(query: ListVendorsQuery): Promise<Paginated<VendorDto>> {
    const where: Prisma.VendorWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.q) {
      where.OR = [
        { name: { contains: query.q, mode: 'insensitive' } },
        { vendorNumber: { contains: query.q, mode: 'insensitive' } },
        { mobile: { contains: query.q } },
        { gstNumber: { contains: query.q, mode: 'insensitive' } },
      ];
    }
    const [rows, total] = await Promise.all([
      this.prisma.vendor.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      this.prisma.vendor.count({ where }),
    ]);
    const totals = await this.vendorTotals(rows.map((v) => v.id));
    return { data: rows.map((v) => this.toDto(v, totals)), meta: buildPageMeta(query.page, query.pageSize, total) };
  }

  async get(id: string): Promise<VendorDto> {
    const vendor = await this.getRowOrThrow(id);
    const totals = await this.vendorTotals([id]);
    return this.toDto(vendor, totals);
  }

  async ledger(id: string): Promise<VendorLedgerDto> {
    const vendor = await this.getRowOrThrow(id);
    const expenses = await this.prisma.expense.findMany({
      where: { vendorId: id },
      include: { category: { select: { name: true } } },
      orderBy: { expenseDate: 'desc' },
      take: 500,
    });
    const totals = await this.vendorTotals([id]);
    return {
      vendor: this.toDto(vendor, totals),
      rows: expenses.map((e) => ({
        id: e.id,
        date: e.expenseDate.toISOString(),
        expenseNumber: e.expenseNumber,
        category: e.category.name,
        description: e.description,
        amount: String(e.amount + e.gstAmount),
        paid: e.paid,
      })),
    };
  }

  async create(dto: CreateVendorInput, userId: string): Promise<VendorDto> {
    const company = this.tenant.requireCompanyId();
    const vendor = await this.prisma.$transaction(async (tx) => {
      const vendorNumber = await this.sequence.next('vendor', tx);
      return tx.vendor.create({
        data: {
          companyId: company,
          vendorNumber,
          name: dto.name,
          mobile: dto.mobile ?? null,
          email: dto.email || null,
          gstNumber: dto.gstNumber ?? null,
          address: dto.address ?? null,
          city: dto.city ?? null,
          state: dto.state ?? null,
          createdById: userId,
        },
      });
    });
    await this.activityLog.record({ actorId: userId, action: 'CREATE', entityType: 'Vendor', entityId: vendor.id, summary: `Created vendor ${vendor.vendorNumber} — ${vendor.name}` });
    return this.toDto(vendor, new Map());
  }

  async update(id: string, dto: UpdateVendorInput, userId: string): Promise<VendorDto> {
    await this.getRowOrThrow(id);
    const updated = await this.prisma.vendor.update({
      where: { id },
      data: {
        name: dto.name,
        status: dto.status,
        mobile: dto.mobile,
        email: dto.email === '' ? null : dto.email,
        gstNumber: dto.gstNumber,
        address: dto.address,
        city: dto.city,
        state: dto.state,
        updatedById: userId,
      },
    });
    await this.activityLog.record({ actorId: userId, action: 'UPDATE', entityType: 'Vendor', entityId: id, summary: `Updated vendor ${updated.vendorNumber}` });
    const totals = await this.vendorTotals([id]);
    return this.toDto(updated, totals);
  }

  async remove(id: string, userId: string): Promise<void> {
    await this.getRowOrThrow(id);
    await this.prisma.vendor.update({ where: { id }, data: { deletedAt: new Date(), status: 'INACTIVE', updatedById: userId } });
    await this.activityLog.record({ actorId: userId, action: 'DELETE', entityType: 'Vendor', entityId: id, summary: 'Deleted vendor' });
  }

  /** Outstanding (unpaid approved) + total purchases per vendor, in one grouped query each. */
  private async vendorTotals(ids: string[]): Promise<Map<string, { outstanding: bigint; total: bigint }>> {
    const map = new Map<string, { outstanding: bigint; total: bigint }>();
    if (ids.length === 0) return map;
    const [totals, outstanding] = await Promise.all([
      this.prisma.expense.groupBy({ by: ['vendorId'], where: { vendorId: { in: ids }, status: { not: 'REJECTED' } }, _sum: { amount: true, gstAmount: true } }),
      this.prisma.expense.groupBy({ by: ['vendorId'], where: { vendorId: { in: ids }, status: 'APPROVED', paid: false }, _sum: { amount: true, gstAmount: true } }),
    ]);
    for (const id of ids) map.set(id, { outstanding: 0n, total: 0n });
    for (const t of totals) if (t.vendorId) map.set(t.vendorId, { ...map.get(t.vendorId)!, total: (t._sum.amount ?? 0n) + (t._sum.gstAmount ?? 0n) });
    for (const o of outstanding) if (o.vendorId) map.set(o.vendorId, { ...map.get(o.vendorId)!, outstanding: (o._sum.amount ?? 0n) + (o._sum.gstAmount ?? 0n) });
    return map;
  }

  private async getRowOrThrow(id: string): Promise<VendorRow> {
    const row = await this.prisma.vendor.findFirst({ where: { id } });
    if (!row) throw new NotFoundException('Vendor not found');
    return row;
  }

  private toDto(v: VendorRow, totals: Map<string, { outstanding: bigint; total: bigint }>): VendorDto {
    const t = totals.get(v.id) ?? { outstanding: 0n, total: 0n };
    return {
      id: v.id,
      vendorNumber: v.vendorNumber,
      name: v.name,
      mobile: v.mobile,
      email: v.email,
      gstNumber: v.gstNumber,
      address: v.address,
      city: v.city,
      state: v.state,
      status: v.status,
      outstanding: String(t.outstanding),
      totalPurchases: String(t.total),
      createdAt: v.createdAt.toISOString(),
    };
  }
}
