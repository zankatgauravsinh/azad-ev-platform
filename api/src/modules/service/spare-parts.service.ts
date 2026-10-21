import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ActivityAction,
  buildPageMeta,
  type CreateSparePartInput,
  type ListSparePartsQuery,
  type Paginated,
  type SparePartDto,
  type UpdateSparePartInput,
} from '@azad/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { ActivityLogService } from '../../activity-log/activity-log.service';
import { changesSummary, createdFields, diffFields } from '../../activity-log/audit-diff';

const PART_FIELDS = ['name', 'sku', 'quantity', 'cost', 'sellingPrice', 'warrantyMonths', 'minStock'] as const;
const partSnapshot = (p: Record<(typeof PART_FIELDS)[number], unknown>): Record<(typeof PART_FIELDS)[number], unknown> => Object.fromEntries(PART_FIELDS.map((f) => [f, p[f]])) as Record<(typeof PART_FIELDS)[number], unknown>;

type SparePartRow = Prisma.SparePartGetPayload<Record<string, never>>;

@Injectable()
export class SparePartsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activityLog: ActivityLogService,
  ) {}

  async list(query: ListSparePartsQuery): Promise<Paginated<SparePartDto>> {
    const where: Prisma.SparePartWhereInput = {};
    if (query.q) {
      where.OR = [
        { name: { contains: query.q, mode: 'insensitive' } },
        { sku: { contains: query.q, mode: 'insensitive' } },
      ];
    }
    const [rows, total] = await Promise.all([
      this.prisma.sparePart.findMany({ where, orderBy: { [query.sort]: query.sort === 'name' || query.sort === 'sku' ? 'asc' : 'desc' }, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      this.prisma.sparePart.count({ where }),
    ]);
    // lowStock is a computed predicate (quantity <= minStock); filter in-memory to keep it simple and correct.
    let data = rows.map((r) => this.toDto(r));
    if (query.lowStock) data = data.filter((d) => d.lowStock);
    return { data, meta: buildPageMeta(query.page, query.pageSize, total) };
  }

  async lowStock(): Promise<SparePartDto[]> {
    const rows = await this.prisma.sparePart.findMany({ orderBy: { quantity: 'asc' } });
    return rows.map((r) => this.toDto(r)).filter((d) => d.lowStock);
  }

  async getById(id: string): Promise<SparePartDto> {
    const row = await this.prisma.sparePart.findFirst({ where: { id } });
    if (!row) throw new NotFoundException('Spare part not found');
    return this.toDto(row);
  }

  async create(dto: CreateSparePartInput, userId: string): Promise<SparePartDto> {
    const created = await this.prisma.sparePart.create({
      data: {
        name: dto.name, sku: dto.sku, quantity: dto.quantity,
        cost: BigInt(dto.cost), sellingPrice: BigInt(dto.sellingPrice),
        warrantyMonths: dto.warrantyMonths, minStock: dto.minStock,
        createdById: userId, updatedById: userId,
      },
    });
    await this.activityLog.record({ actorId: userId, action: ActivityAction.CREATE, entityType: 'SparePart', entityId: created.id, entityLabel: `${created.name} (${created.sku})`, summary: `Added spare part ${created.name} (${created.sku}): ${created.quantity} in stock`, changes: createdFields(partSnapshot(created)) });
    return this.toDto(created);
  }

  async update(id: string, dto: UpdateSparePartInput, userId: string): Promise<SparePartDto> {
    await this.getById(id);
    const before = await this.prisma.sparePart.findFirstOrThrow({ where: { id } });
    const data: Prisma.SparePartUpdateInput = { updatedById: userId };
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.sku !== undefined) data.sku = dto.sku;
    if (dto.quantity !== undefined) data.quantity = dto.quantity;
    if (dto.cost !== undefined) data.cost = BigInt(dto.cost);
    if (dto.sellingPrice !== undefined) data.sellingPrice = BigInt(dto.sellingPrice);
    if (dto.warrantyMonths !== undefined) data.warrantyMonths = dto.warrantyMonths;
    if (dto.minStock !== undefined) data.minStock = dto.minStock;
    const updated = await this.prisma.sparePart.update({ where: { id }, data });
    const changes = diffFields(partSnapshot(before), partSnapshot(updated), PART_FIELDS);
    await this.activityLog.record({ actorId: userId, action: ActivityAction.UPDATE, entityType: 'SparePart', entityId: id, entityLabel: `${updated.name} (${updated.sku})`, summary: Object.keys(changes).length ? `Updated spare part ${updated.name}: ${changesSummary(changes)}` : `Saved spare part ${updated.name} — nothing changed`, changes });
    return this.toDto(updated);
  }

  async adjustStock(id: string, delta: number, reason: string | undefined, userId: string): Promise<SparePartDto> {
    const part = await this.prisma.sparePart.findFirst({ where: { id } });
    if (!part) throw new NotFoundException('Spare part not found');
    // Atomic guarded adjustment: for a decrement, only apply if enough stock remains,
    // so concurrent adjustments can't drive quantity below zero.
    const guard = delta < 0 ? { quantity: { gte: -delta } } : {};
    const adjusted = await this.prisma.sparePart.updateMany({ where: { id, ...guard }, data: { quantity: { increment: delta }, updatedById: userId } });
    if (adjusted.count !== 1) throw new BadRequestException('Stock cannot go negative');
    const updated = await this.prisma.sparePart.findFirstOrThrow({ where: { id } });
    await this.activityLog.record({ actorId: userId, action: ActivityAction.UPDATE, entityType: 'SparePart', entityId: id, entityLabel: `${part.name} (${part.sku})`, summary: `Stock ${delta >= 0 ? '+' : ''}${delta} for ${part.name}${reason ? ` (${reason})` : ''}`, changes: { quantity: { from: part.quantity, to: updated.quantity } }, reason: reason ?? null });
    return this.toDto(updated);
  }

  async remove(id: string, userId: string): Promise<void> {
    await this.getById(id);
    const part = await this.prisma.sparePart.findFirstOrThrow({ where: { id } });
    await this.prisma.sparePart.update({ where: { id }, data: { deletedAt: new Date(), updatedById: userId } });
    await this.activityLog.record({ actorId: userId, action: ActivityAction.DELETE, entityType: 'SparePart', entityId: id, entityLabel: `${part.name} (${part.sku})`, summary: `Removed spare part ${part.name} (${part.quantity} in stock)`, changes: diffFields(partSnapshot(part), {} as ReturnType<typeof partSnapshot>, PART_FIELDS) });
  }

  private toDto(r: SparePartRow): SparePartDto {
    return {
      id: r.id, name: r.name, sku: r.sku, quantity: r.quantity,
      cost: r.cost.toString(), sellingPrice: r.sellingPrice.toString(),
      warrantyMonths: r.warrantyMonths, minStock: r.minStock,
      lowStock: r.quantity <= r.minStock,
    };
  }
}
