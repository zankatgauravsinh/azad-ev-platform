import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';

type Db = PrismaService | Prisma.TransactionClient;

/**
 * Data access for the catalog (ScooterModel, ScooterVariant). Every method takes the company
 * explicitly and puts it in the query: the Prisma tenant middleware still applies, but the catalog
 * never relies on it alone, so a model or variant of another company is simply never found or changed.
 *
 * Models and variants are retained forever (isActive, no deletedAt): inactive ones leave the lookup
 * lists but stay valid for every unit, booking and sale that references them.
 */
export const modelSelect = {
  id: true, brand: true, name: true, description: true, isActive: true, taxClassificationId: true, createdAt: true, updatedAt: true,
} satisfies Prisma.ScooterModelSelect;
export type ModelRow = Prisma.ScooterModelGetPayload<{ select: typeof modelSelect }>;

export const variantInclude = { model: { select: { id: true, brand: true, name: true } } } satisfies Prisma.ScooterVariantInclude;
export type VariantRow = Prisma.ScooterVariantGetPayload<{ include: typeof variantInclude }>;

/** The variant key is exact: "Red", "red" and "Red " would be three variants (inputs are trimmed by the schemas, case is kept). */
export type VariantKey = { modelId: string; name: string; colour: string };

/** Which records a list returns. Default: active only (what the lookups always showed). */
export interface ListOptions {
  status?: 'active' | 'inactive' | 'all';
  /** Shorthand for status 'all' (M1 callers). */
  includeInactive?: boolean;
  q?: string;
}
const statusWhere = (opts: ListOptions): { isActive?: boolean } => {
  const status = opts.status ?? (opts.includeInactive ? 'all' : 'active');
  return status === 'all' ? {} : { isActive: status === 'active' };
};

@Injectable()
export class CatalogRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ── Models ─────────────────────────────────────────────
  listModels(companyId: string, opts: ListOptions = {}, db: Db = this.prisma): Promise<ModelRow[]> {
    return db.scooterModel.findMany({
      where: {
        companyId,
        ...statusWhere(opts),
        ...(opts.q ? { OR: [{ name: { contains: opts.q, mode: 'insensitive' } }, { brand: { contains: opts.q, mode: 'insensitive' } }] } : {}),
      },
      select: modelSelect,
      orderBy: [{ brand: 'asc' }, { name: 'asc' }],
    });
  }

  /** Active or not — the caller decides what an inactive model means. */
  findModelById(companyId: string, id: string, db: Db = this.prisma): Promise<ModelRow | null> {
    return db.scooterModel.findFirst({ where: { id, companyId }, select: modelSelect });
  }

  /** Case-insensitive on the name, across brands — the application rule the existing create path enforces. */
  findModelByName(companyId: string, name: string, db: Db = this.prisma): Promise<ModelRow | null> {
    return db.scooterModel.findFirst({ where: { companyId, name: { equals: name, mode: 'insensitive' } }, select: modelSelect });
  }

  /** Case-insensitive on brand and name — mirrors the database key (companyId, brand, name). */
  findModelByBrandAndName(companyId: string, brand: string, name: string, db: Db = this.prisma): Promise<ModelRow | null> {
    return db.scooterModel.findFirst({
      where: { companyId, brand: { equals: brand, mode: 'insensitive' }, name: { equals: name, mode: 'insensitive' } },
      select: modelSelect,
    });
  }

  /** variantId → modelId and the two per-model counts, for a list in two queries instead of 2N. */
  async countsByModel(companyId: string, db: Db = this.prisma): Promise<Map<string, { variantCount: number; unitCount: number }>> {
    const variants = await db.scooterVariant.findMany({ where: { companyId }, select: { id: true, modelId: true } });
    const units = await db.inventoryUnit.groupBy({ by: ['variantId'], where: { companyId, deletedAt: null }, _count: { _all: true } });
    const unitsByVariant = new Map(units.map((u) => [u.variantId, u._count._all]));
    const out = new Map<string, { variantCount: number; unitCount: number }>();
    for (const v of variants) {
      const row = out.get(v.modelId) ?? { variantCount: 0, unitCount: 0 };
      row.variantCount += 1;
      row.unitCount += unitsByVariant.get(v.id) ?? 0;
      out.set(v.modelId, row);
    }
    return out;
  }

  /** variantId → units on the books. */
  async unitCountsByVariant(companyId: string, variantIds: string[], db: Db = this.prisma): Promise<Map<string, number>> {
    if (variantIds.length === 0) return new Map();
    const units = await db.inventoryUnit.groupBy({ by: ['variantId'], where: { companyId, deletedAt: null, variantId: { in: variantIds } }, _count: { _all: true } });
    return new Map(units.map((u) => [u.variantId, u._count._all]));
  }

  countVariants(companyId: string, modelId: string, db: Db = this.prisma): Promise<number> {
    return db.scooterVariant.count({ where: { companyId, modelId } });
  }

  /** Units still on the books (soft-deleted units are not counted). */
  countModelUnits(companyId: string, modelId: string, db: Db = this.prisma): Promise<number> {
    return db.inventoryUnit.count({ where: { companyId, deletedAt: null, variant: { modelId, companyId } } });
  }

  createModel(companyId: string, data: Omit<Prisma.ScooterModelUncheckedCreateInput, 'companyId' | 'id' | 'createdAt' | 'updatedAt'>, db: Db = this.prisma): Promise<ModelRow> {
    return db.scooterModel.create({ data: { ...data, companyId }, select: modelSelect });
  }

  /** Scoped write: changes nothing — and reports 0 — when the model is not this company's. */
  async updateModel(companyId: string, id: string, data: Prisma.ScooterModelUncheckedUpdateManyInput, db: Db = this.prisma): Promise<number> {
    const { count } = await db.scooterModel.updateMany({ where: { id, companyId }, data });
    return count;
  }

  setModelActive(companyId: string, id: string, isActive: boolean, updatedById: string, db: Db = this.prisma): Promise<number> {
    return this.updateModel(companyId, id, { isActive, updatedById }, db);
  }

  // ── Variants ───────────────────────────────────────────
  listVariants(companyId: string, opts: ListOptions & { modelId?: string } = {}, db: Db = this.prisma): Promise<VariantRow[]> {
    return db.scooterVariant.findMany({
      where: { companyId, ...(opts.modelId ? { modelId: opts.modelId } : {}), ...statusWhere(opts) },
      include: variantInclude,
      orderBy: [{ name: 'asc' }, { colour: 'asc' }],
    });
  }

  findVariantById(companyId: string, id: string, db: Db = this.prisma): Promise<VariantRow | null> {
    return db.scooterVariant.findFirst({ where: { id, companyId }, include: variantInclude });
  }

  /** Exact match on the database key — no case folding (see VariantKey). */
  findVariantByKey(companyId: string, key: VariantKey, db: Db = this.prisma): Promise<VariantRow | null> {
    return db.scooterVariant.findFirst({ where: { companyId, modelId: key.modelId, name: key.name, colour: key.colour }, include: variantInclude });
  }

  /**
   * The variant an inventory unit may be attached to. Verifies all four conditions explicitly — the
   * variant belongs to the company, its model belongs to the company, and both are active — and says
   * which one failed so the caller can answer 404 (not this company's) or 409 (inactive).
   */
  async findActiveVariantForUnit(companyId: string, variantId: string, db: Db = this.prisma): Promise<{ variant: VariantRow } | { error: 'NOT_FOUND' | 'MODEL_INACTIVE' | 'VARIANT_INACTIVE' }> {
    const row = await db.scooterVariant.findFirst({
      where: { id: variantId, companyId, model: { companyId } },
      include: { model: { select: { id: true, brand: true, name: true, isActive: true } } },
    });
    if (!row) return { error: 'NOT_FOUND' };
    if (!row.model.isActive) return { error: 'MODEL_INACTIVE' };
    if (!row.isActive) return { error: 'VARIANT_INACTIVE' };
    const { model, ...rest } = row;
    return { variant: { ...rest, model: { id: model.id, brand: model.brand, name: model.name } } };
  }

  countVariantUnits(companyId: string, variantId: string, db: Db = this.prisma): Promise<number> {
    return db.inventoryUnit.count({ where: { companyId, variantId, deletedAt: null } });
  }

  /** The caller must have checked that `data.modelId` is this company's model. */
  createVariant(companyId: string, data: Omit<Prisma.ScooterVariantUncheckedCreateInput, 'companyId' | 'id' | 'createdAt' | 'updatedAt'>, db: Db = this.prisma): Promise<VariantRow> {
    return db.scooterVariant.create({ data: { ...data, companyId }, include: variantInclude });
  }

  async updateVariant(companyId: string, id: string, data: Prisma.ScooterVariantUncheckedUpdateManyInput, db: Db = this.prisma): Promise<number> {
    const { count } = await db.scooterVariant.updateMany({ where: { id, companyId }, data });
    return count;
  }

  setVariantActive(companyId: string, id: string, isActive: boolean, updatedById: string, db: Db = this.prisma): Promise<number> {
    return this.updateVariant(companyId, id, { isActive, updatedById }, db);
  }

  transaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(fn);
  }

  // ── Identity protection (M4B.5) ────────────────────────
  /*
   * A variant's identity (name, colour) — and its model's (brand, name) — is LOCKED once any unit of it
   * is BOOKED, DELIVERED, IN_SERVICE or RETURNED, or has a Sale (soft-deleted included), a Warranty
   * (cancelled included) or an AMC plan (cancelled included): renaming it would change how invoices,
   * delivery notes, warranties, AMC and service records of those vehicles read. Soft-deleted units count
   * too (their records remain). Quotations and service jobs alone do not lock. Every query is scoped to
   * the company explicitly.
   */

  /** Of the given variants, those whose identity is locked. */
  async lockedVariantIds(companyId: string, variantIds: string[], db: Db = this.prisma): Promise<Set<string>> {
    if (variantIds.length === 0) return new Set();
    const rows = await db.$queryRaw<{ id: string }[]>`
      SELECT DISTINCT u."variantId" AS id FROM "InventoryUnit" u
      WHERE u."companyId" = ${companyId} AND u."variantId" IN (${Prisma.join(variantIds)}) AND ${lockingUnit(companyId)}`;
    return new Set(rows.map((r) => r.id));
  }

  /** Models of the company (all, or the given ones) with at least one locked variant. */
  async lockedModelIds(companyId: string, modelIds?: string[], db: Db = this.prisma): Promise<Set<string>> {
    if (modelIds && modelIds.length === 0) return new Set();
    const rows = await db.$queryRaw<{ id: string }[]>`
      SELECT DISTINCT v."modelId" AS id FROM "InventoryUnit" u
      JOIN "ScooterVariant" v ON v.id = u."variantId" AND v."companyId" = ${companyId}
      WHERE u."companyId" = ${companyId} ${modelIds ? Prisma.sql`AND v."modelId" IN (${Prisma.join(modelIds)})` : Prisma.empty} AND ${lockingUnit(companyId)}`;
    return new Set(rows.map((r) => r.id));
  }

  async isVariantIdentityLocked(companyId: string, variantId: string, db: Db = this.prisma): Promise<boolean> {
    return (await this.lockedVariantIds(companyId, [variantId], db)).has(variantId);
  }

  async isModelIdentityLocked(companyId: string, modelId: string, db: Db = this.prisma): Promise<boolean> {
    return (await this.lockedModelIds(companyId, [modelId], db)).has(modelId);
  }

  /*
   * Lock protocol for an identity change (run first in the renaming transaction; the lock check and the
   * update follow under these locks). Order: the units, then the catalogue row(s), then the units again.
   *  1. Units FOR UPDATE, in id order: booking / delivery / status changes UPDATE the unit, and creating a
   *     Sale, Warranty or AMC plan (or a booking / service job) inserts a row whose foreign key takes KEY
   *     SHARE on the unit; both conflict with FOR UPDATE, so a unit cannot become locking until we end.
   *  2. Catalogue rows FOR UPDATE (variant; or model, then its variants in id order): creating a unit in, or
   *     moving a unit into, a variant takes KEY SHARE on the variant row (creating a variant, on its model
   *     row), so nothing can join until we end; anything mid-creation is waited for.
   *  3. Units again, NOWAIT: locks any unit that joined while we waited in step 2. It never waits: those
   *     units arrived after step 1, so waiting for them could break the id order and deadlock. If one is
   *     held elsewhere the change stops with 'BUSY' (409, try again) instead.
   * So a rename only ever WAITS while holding unit locks taken in id order (step 1) or catalogue rows
   * (step 2, and nothing that holds a catalogue row waits for a unit). Other paths lock a unit first and a
   * catalogue row (KEY SHARE) second, which this order cannot cycle with.
   */

  async lockVariantForIdentityChange(companyId: string, variantId: string, tx: Prisma.TransactionClient): Promise<IdentityLock> {
    await tx.$queryRaw`
      SELECT id FROM "InventoryUnit" WHERE "companyId" = ${companyId} AND "variantId" = ${variantId} ORDER BY id FOR UPDATE`;
    const variants = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "ScooterVariant" WHERE id = ${variantId} AND "companyId" = ${companyId} FOR UPDATE`;
    if (variants.length === 0) return 'NOT_FOUND';
    return lockNowait(() => tx.$queryRaw`
      SELECT id FROM "InventoryUnit" WHERE "companyId" = ${companyId} AND "variantId" = ${variantId} ORDER BY id FOR UPDATE NOWAIT`);
  }

  async lockModelForIdentityChange(companyId: string, modelId: string, tx: Prisma.TransactionClient): Promise<IdentityLock> {
    const unitsOfModel = (nowait: boolean) => tx.$queryRaw`
      SELECT u.id FROM "InventoryUnit" u
      JOIN "ScooterVariant" v ON v.id = u."variantId" AND v."companyId" = ${companyId}
      WHERE u."companyId" = ${companyId} AND v."modelId" = ${modelId}
      ORDER BY u.id FOR UPDATE OF u ${nowait ? Prisma.sql`NOWAIT` : Prisma.empty}`;
    await unitsOfModel(false);
    const models = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "ScooterModel" WHERE id = ${modelId} AND "companyId" = ${companyId} FOR UPDATE`;
    if (models.length === 0) return 'NOT_FOUND';
    await tx.$queryRaw`
      SELECT id FROM "ScooterVariant" WHERE "modelId" = ${modelId} AND "companyId" = ${companyId} ORDER BY id FOR UPDATE`;
    return lockNowait(() => unitsOfModel(true));
  }
}

/** LOCKED: the protocol holds every lock. NOT_FOUND: not this company's. BUSY: a joining unit is held elsewhere. */
export type IdentityLock = 'LOCKED' | 'NOT_FOUND' | 'BUSY';

/** Runs a NOWAIT locking query; "lock not available" (55P03) means another transaction holds a row. */
async function lockNowait(query: () => Promise<unknown>): Promise<IdentityLock> {
  try {
    await query();
    return 'LOCKED';
  } catch (e) {
    const code = (e as { meta?: { code?: string } }).meta?.code;
    if (code === '55P03' || /55P03|could not obtain lock/i.test((e as Error).message ?? '')) return 'BUSY';
    throw e;
  }
}

/** The unit (alias u) makes its variant's identity locked: committed status or committed history. */
const lockingUnit = (companyId: string): Prisma.Sql => Prisma.sql`(
  u.status IN ('BOOKED', 'DELIVERED', 'IN_SERVICE', 'RETURNED')
  OR EXISTS (SELECT 1 FROM "Sale" s WHERE s."unitId" = u.id AND s."companyId" = ${companyId})
  OR EXISTS (SELECT 1 FROM "Warranty" w WHERE w."unitId" = u.id AND w."companyId" = ${companyId})
  OR EXISTS (SELECT 1 FROM "AmcPlan" a WHERE a."unitId" = u.id AND a."companyId" = ${companyId}))`;
