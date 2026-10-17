import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type Accessory, type AccessoryStockMovement } from '@prisma/client';
import {
  ActivityAction,
  type AccessoryDetailDto,
  type AccessoryDto,
  type AccessoryMovementDto,
  type CreateAccessoryInput,
  type ListAccessoriesQuery,
  type OpeningStockInput,
  type StockAdjustmentInput,
  type UpdateAccessoryInput,
} from '@azad/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantContext } from '../../tenant/tenant-context.service';
import { ActivityLogService } from '../../activity-log/activity-log.service';
import { formatInrExact } from '../../common/utils/money';
import { weightedAvgCost } from '../../common/utils/inventory-cost';

/** An accessory's stock, read under a row lock. */
interface LockedStock {
  id: string;
  name: string;
  onHand: number;
  reserved: number;
  avgCost: bigint;
}

/** A showroom's accessory catalogue is small; the list is returned whole (no paging) for the pickers. */
const LIST_LIMIT = 1000;
/** Stock movements shown with one accessory, newest first. */
const DETAIL_MOVEMENTS = 50;

/** onHand − reserved: what can still be put on a booking. */
export const availableOf = (a: Pick<Accessory, 'onHand' | 'reserved'>): number => a.onHand - a.reserved;
/** Low when what is available is at or below the alert level (out of stock counts as low). */
export const isLowStock = (a: Pick<Accessory, 'onHand' | 'reserved' | 'minStock'>): boolean => availableOf(a) <= a.minStock;

export function toAccessoryDto(a: Accessory): AccessoryDto {
  return {
    id: a.id,
    name: a.name,
    sku: a.sku,
    category: a.category,
    sellPrice: a.sellPrice.toString(),
    avgCost: a.avgCost.toString(), // removed for users without inventory.cost (PurchaseCostInterceptor)
    onHand: a.onHand,
    reserved: a.reserved,
    available: availableOf(a),
    minStock: a.minStock,
    lowStock: isLowStock(a),
    isPart: a.isPart,
    isActive: a.isActive,
    taxClassificationId: a.taxClassificationId,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}

function toMovementDto(m: AccessoryStockMovement, canSeeCost: boolean, names: Map<string, string>): AccessoryMovementDto {
  return {
    id: m.id,
    accessoryId: m.accessoryId,
    type: m.type,
    quantity: m.quantity,
    ...(canSeeCost ? { unitCost: m.unitCost.toString() } : {}),
    onHandAfter: m.onHandAfter,
    reservedAfter: m.reservedAfter,
    refType: m.refType,
    refId: m.refId,
    note: m.note,
    createdByName: m.createdById ? (names.get(m.createdById) ?? null) : null,
    createdAt: m.createdAt.toISOString(),
  };
}

/**
 * The accessory catalogue: name, SKU, category, selling price and low-stock level. Stock (on hand, reserved) and
 * the weighted-average cost are never edited here — they move only through the stock ledger (opening stock,
 * purchases, adjustments, booking reservations, deliveries). Accessories are deactivated, never deleted: bookings,
 * quotations, sales and the ledger keep pointing at them.
 */
@Injectable()
export class AccessoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContext,
    private readonly activityLog: ActivityLogService,
  ) {}

  async list(query: ListAccessoriesQuery): Promise<AccessoryDto[]> {
    const where: Prisma.AccessoryWhereInput = {};
    if (query.status !== 'all') where.isActive = query.status === 'active';
    if (query.isPart !== undefined) where.isPart = query.isPart;
    if (query.category) where.category = { equals: query.category, mode: 'insensitive' };
    if (query.q) {
      where.OR = [
        { name: { contains: query.q, mode: 'insensitive' } },
        { sku: { contains: query.q, mode: 'insensitive' } },
        { category: { contains: query.q, mode: 'insensitive' } },
      ];
    }
    const rows = await this.prisma.accessory.findMany({ where, orderBy: { name: 'asc' }, take: LIST_LIMIT });
    const dtos = rows.map(toAccessoryDto);
    return query.lowStock ? dtos.filter((d) => d.lowStock) : dtos;
  }

  /** Categories in use, for the category picker (case-insensitively distinct, sorted). */
  async categories(): Promise<string[]> {
    const rows = await this.prisma.accessory.findMany({ where: { category: { not: null } }, select: { category: true }, distinct: ['category'] });
    const byKey = new Map<string, string>();
    for (const r of rows) if (r.category && !byKey.has(r.category.toLowerCase())) byKey.set(r.category.toLowerCase(), r.category);
    return [...byKey.values()].sort((a, b) => a.localeCompare(b));
  }

  async getById(id: string, canSeeCost: boolean): Promise<AccessoryDetailDto> {
    const accessory = await this.getRowOrThrow(id);
    const [movements, otherMoves] = await Promise.all([
      this.prisma.accessoryStockMovement.findMany({ where: { accessoryId: id }, orderBy: { createdAt: 'desc' }, take: DETAIL_MOVEMENTS }),
      this.prisma.accessoryStockMovement.count({ where: { accessoryId: id, type: { not: 'OPENING' } } }),
    ]);
    const userIds = [...new Set(movements.map((m) => m.createdById).filter((u): u is string => Boolean(u)))];
    const users = userIds.length ? await this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [];
    const names = new Map(users.map((u) => [u.id, u.name]));
    return { ...toAccessoryDto(accessory), movements: movements.map((m) => toMovementDto(m, canSeeCost, names)), openingAllowed: otherMoves === 0 };
  }

  /**
   * Pieces already in the showroom, with their ex-GST cost each; sets the weighted-average cost. Allowed (in one
   * or more lots) only until the first purchase, adjustment or booking — after that the ledger has moved on and
   * stock changes go through those. The caller has checked inventory.cost.
   */
  async addOpeningStock(id: string, dto: OpeningStockInput, userId: string): Promise<AccessoryDetailDto> {
    const companyId = this.tenant.requireCompanyId();
    await this.prisma.$transaction(async (tx) => {
      const stock = await this.lockStock(tx, companyId, id);
      const moved = await tx.accessoryStockMovement.count({ where: { accessoryId: id, type: { not: 'OPENING' } } });
      if (moved > 0) throw new ConflictException(`Opening stock can only be entered before ${stock.name}'s first purchase, adjustment or booking — use an adjustment instead`);
      const onHand = stock.onHand + dto.quantity;
      const avgCost = weightedAvgCost(stock.onHand, stock.avgCost, dto.quantity, BigInt(dto.unitCost));
      await tx.accessory.update({ where: { id }, data: { onHand, avgCost, updatedById: userId } });
      await tx.accessoryStockMovement.create({
        data: { companyId, accessoryId: id, type: 'OPENING', quantity: dto.quantity, unitCost: BigInt(dto.unitCost), onHandAfter: onHand, reservedAfter: stock.reserved, note: dto.note || 'Opening stock', createdById: userId },
      });
      // No cost in the summary: the activity log is read by people who may not see purchase cost.
      await this.activityLog.recordInTransaction({ actorId: userId, action: ActivityAction.UPDATE, entityType: 'Accessory', entityId: id, summary: `Opening stock for ${stock.name}: +${dto.quantity} (on hand ${onHand})` }, tx);
    });
    return this.getById(id, true);
  }

  /**
   * A counted correction. + adds pieces at the current average cost, − removes them; the average cost does not
   * change. On hand may not drop below what is reserved for bookings (available never goes negative).
   */
  async adjustStock(id: string, dto: StockAdjustmentInput, userId: string, canSeeCost: boolean): Promise<AccessoryDetailDto> {
    const companyId = this.tenant.requireCompanyId();
    await this.prisma.$transaction(async (tx) => {
      const stock = await this.lockStock(tx, companyId, id);
      const onHand = stock.onHand + dto.delta;
      if (onHand < stock.reserved) {
        const available = stock.onHand - stock.reserved;
        throw new ConflictException(
          stock.reserved > 0
            ? `Only ${available} of ${stock.name} can be removed — ${stock.reserved} more ${stock.reserved === 1 ? 'is' : 'are'} reserved for bookings`
            : `Only ${stock.onHand} of ${stock.name} ${stock.onHand === 1 ? 'is' : 'are'} in stock`,
        );
      }
      await tx.accessory.update({ where: { id }, data: { onHand, updatedById: userId } });
      await tx.accessoryStockMovement.create({
        data: { companyId, accessoryId: id, type: 'ADJUSTMENT', quantity: dto.delta, unitCost: stock.avgCost, onHandAfter: onHand, reservedAfter: stock.reserved, note: dto.reason, createdById: userId },
      });
      const signed = dto.delta > 0 ? `+${dto.delta}` : String(dto.delta);
      await this.activityLog.recordInTransaction({ actorId: userId, action: ActivityAction.UPDATE, entityType: 'Accessory', entityId: id, summary: `Adjusted stock of ${stock.name}: ${signed} (on hand ${onHand}) — ${dto.reason}` }, tx);
    });
    return this.getById(id, canSeeCost);
  }

  async create(dto: CreateAccessoryInput, userId: string): Promise<AccessoryDto> {
    await this.assertNameFree(dto.name);
    const created = await this.withSkuCheck(dto.sku, () =>
      this.prisma.accessory.create({
        data: {
          name: dto.name,
          sku: dto.sku ?? null,
          category: dto.category ?? null,
          sellPrice: BigInt(dto.sellPrice),
          minStock: dto.minStock,
          isPart: dto.isPart,
          createdById: userId,
          updatedById: userId,
        },
      }),
    );
    await this.activityLog.record({ actorId: userId, action: ActivityAction.CREATE, entityType: 'Accessory', entityId: created.id, summary: `Added accessory ${created.name} (${formatInrExact(created.sellPrice)})` });
    return toAccessoryDto(created);
  }

  async update(id: string, dto: UpdateAccessoryInput, userId: string): Promise<AccessoryDto> {
    const existing = await this.getRowOrThrow(id);
    if (dto.name !== undefined && dto.name.toLowerCase() !== existing.name.toLowerCase()) await this.assertNameFree(dto.name, id);

    const data: Prisma.AccessoryUpdateInput = { updatedById: userId };
    const changes: string[] = [];
    const change = (label: string, from: string, to: string): void => {
      if (from !== to) changes.push(`${label} ${from} → ${to}`);
    };
    if (dto.name !== undefined) {
      data.name = dto.name;
      change('name', existing.name, dto.name);
    }
    if (dto.sku !== undefined) {
      data.sku = dto.sku;
      change('SKU', existing.sku ?? '—', dto.sku ?? '—');
    }
    if (dto.category !== undefined) {
      data.category = dto.category;
      change('category', existing.category ?? '—', dto.category ?? '—');
    }
    if (dto.sellPrice !== undefined) {
      data.sellPrice = BigInt(dto.sellPrice);
      change('price', formatInrExact(existing.sellPrice), formatInrExact(BigInt(dto.sellPrice)));
    }
    if (dto.minStock !== undefined) {
      data.minStock = dto.minStock;
      change('low-stock level', String(existing.minStock), String(dto.minStock));
    }
    if (changes.length === 0) return toAccessoryDto(existing);

    const updated = await this.withSkuCheck(dto.sku, () => this.prisma.accessory.update({ where: { id }, data }));
    await this.activityLog.record({ actorId: userId, action: ActivityAction.UPDATE, entityType: 'Accessory', entityId: id, summary: `Updated accessory ${updated.name}: ${changes.join('; ')}` });
    return toAccessoryDto(updated);
  }

  /**
   * Deactivated accessories leave the booking / quotation pickers but keep their history. One with pieces
   * reserved for bookings cannot be deactivated until those bookings release them.
   */
  async setActive(id: string, active: boolean, userId: string): Promise<AccessoryDto> {
    const existing = await this.getRowOrThrow(id);
    if (existing.isActive === active) return toAccessoryDto(existing);
    if (!active && existing.reserved > 0) {
      throw new ConflictException(`${existing.reserved} of ${existing.name} ${existing.reserved === 1 ? 'is' : 'are'} reserved for bookings — deliver or remove them from those bookings first`);
    }
    // Guarded on the state just read, so a reservation made meanwhile is not left on an inactive item.
    const { count } = await this.prisma.accessory.updateMany({ where: { id, isActive: existing.isActive, ...(active ? {} : { reserved: 0 }) }, data: { isActive: active, updatedById: userId } });
    if (count === 0) throw new ConflictException('This accessory was changed by someone else — reload and try again');
    await this.activityLog.record({ actorId: userId, action: ActivityAction.STATUS_CHANGE, entityType: 'Accessory', entityId: id, summary: `${active ? 'Activated' : 'Deactivated'} accessory ${existing.name}` });
    return toAccessoryDto(await this.getRowOrThrow(id));
  }

  // ── Internal ───────────────────────────────────────────
  /** Locks the accessory's row for the rest of the transaction, so concurrent stock changes apply one at a time. */
  private async lockStock(tx: Prisma.TransactionClient, companyId: string, id: string): Promise<LockedStock> {
    const [row] = await tx.$queryRaw<LockedStock[]>`
      SELECT id, name, "onHand", reserved, "avgCost" FROM "Accessory" WHERE id = ${id} AND "companyId" = ${companyId} FOR UPDATE`;
    if (!row) throw new NotFoundException('Accessory not found');
    return row;
  }

  private async getRowOrThrow(id: string): Promise<Accessory> {
    const row = await this.prisma.accessory.findFirst({ where: { id } });
    if (!row) throw new NotFoundException('Accessory not found');
    return row;
  }

  /** Names are unique within the company, ignoring case — active or not, so history never reads ambiguously. */
  private async assertNameFree(name: string, exceptId?: string): Promise<void> {
    const clash = await this.prisma.accessory.findFirst({ where: { name: { equals: name, mode: 'insensitive' }, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { name: true, isActive: true } });
    if (clash) throw new ConflictException(`An accessory named "${clash.name}" already exists${clash.isActive ? '' : ' (inactive — activate it instead)'}`);
  }

  /** A SKU is unique within the company; a clash surfaces as a 409 instead of a 500. */
  private async withSkuCheck<T>(sku: string | null | undefined, write: () => Promise<T>): Promise<T> {
    try {
      return await write();
    } catch (e) {
      if (sku && e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException(`SKU ${sku} is already used by another accessory`);
      throw e;
    }
  }
}
