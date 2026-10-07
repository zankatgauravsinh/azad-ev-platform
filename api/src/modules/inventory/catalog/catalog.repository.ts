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

@Injectable()
export class CatalogRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ── Models ─────────────────────────────────────────────
  listModels(companyId: string, opts: { includeInactive?: boolean } = {}, db: Db = this.prisma): Promise<ModelRow[]> {
    return db.scooterModel.findMany({
      where: { companyId, ...(opts.includeInactive ? {} : { isActive: true }) },
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
  listVariants(companyId: string, opts: { modelId?: string; includeInactive?: boolean } = {}, db: Db = this.prisma): Promise<VariantRow[]> {
    return db.scooterVariant.findMany({
      where: { companyId, ...(opts.modelId ? { modelId: opts.modelId } : {}), ...(opts.includeInactive ? {} : { isActive: true }) },
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
}
