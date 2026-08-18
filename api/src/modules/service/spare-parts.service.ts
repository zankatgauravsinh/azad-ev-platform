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
    await this.activityLog.record({ actorId: userId, action: ActivityAction.CREATE, entityType: 'SparePart', entityId: created.id, summary: `Added spare part ${created.name}` });
    return this.toDto(created);
  }

  async update(id: string, dto: UpdateSparePartInput, userId: string): Promise<SparePartDto> {
    await this.getById(id);
    const data: Prisma.SparePartUpdateInput = { updatedById: userId };
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.sku !== undefined) data.sku = dto.sku;
    if (dto.quantity !== undefined) data.quantity = dto.quantity;
    if (dto.cost !== undefined) data.cost = BigInt(dto.cost);
    if (dto.sellingPrice !== undefined) data.sellingPrice = BigInt(dto.sellingPrice);
    if (dto.warrantyMonths !== undefined) data.warrantyMonths = dto.warrantyMonths;
    if (dto.minStock !== undefined) data.minStock = dto.minStock;
    const updated = await this.prisma.sparePart.update({ where: { id }, data });
    await this.activityLog.record({ actorId: userId, action: ActivityAction.UPDATE, entityType: 'SparePart', entityId: id, summary: `Updated spare part ${updated.name}` });
    return this.toDto(updated);
  }

  async adjustStock(id: string, delta: number, reason: string | undefined, userId: string): Promise<SparePartDto> {
    const part = await this.prisma.sparePart.findFirst({ where: { id } });
    if (!part) throw new NotFoundException('Spare part not found');
    if (part.quantity + delta < 0) throw new BadRequestException('Stock cannot go negative');
    const updated = await this.prisma.sparePart.update({ where: { id }, data: { quantity: { increment: delta }, updatedById: userId } });
    await this.activityLog.record({ actorId: userId, action: ActivityAction.UPDATE, entityType: 'SparePart', entityId: id, summary: `Stock ${delta >= 0 ? '+' : ''}${delta} for ${part.name}${reason ? ` (${reason})` : ''}` });
    return this.toDto(updated);
  }

  async remove(id: string, userId: string): Promise<void> {
    await this.getById(id);
    await this.prisma.sparePart.update({ where: { id }, data: { deletedAt: new Date(), updatedById: userId } });
    await this.activityLog.record({ actorId: userId, action: ActivityAction.DELETE, entityType: 'SparePart', entityId: id, summary: 'Removed spare part' });
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
