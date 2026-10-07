import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { CatalogModelDto, CatalogVariantDto, CreateCatalogModelInput, CreateCatalogVariantInput, UpdateCatalogModelInput, UpdateCatalogVariantInput } from '@azad/shared';
import { ActivityLogService } from '../../../activity-log/activity-log.service';
import { TenantContext } from '../../../tenant/tenant-context.service';
import { catalogActivation, catalogCreated, catalogUpdated, diffFields, type CatalogAuditEvent } from './catalog-audit';
import { CatalogRepository, type ModelRow, type VariantRow } from './catalog.repository';

/**
 * Catalog service (M1 foundation): tenant-safe model / variant lookups, the validation future CRUD
 * needs, create / update / activate with an audit entry for each. No HTTP surface yet — the public
 * endpoints and the Model Management screens come in M2 / M3 and will call these methods.
 *
 * The company is always the authenticated actor's (TenantContext); it is never taken from a payload.
 * Pricing, GST classification (PUT /tax/scooter-models/:id/classification) and the existing unit
 * flows are untouched.
 */
const MODEL_FIELDS = ['brand', 'name', 'description', 'isActive'] as const;
const VARIANT_FIELDS = ['name', 'colour', 'hexColour', 'exShowroomPrice', 'batteryType', 'batteryCapacity', 'rangeKm', 'topSpeedKmph', 'chargingTimeHrs', 'motorPowerW', 'warrantyMonths', 'isActive'] as const;

@Injectable()
export class CatalogService {
  constructor(
    private readonly repo: CatalogRepository,
    private readonly tenant: TenantContext,
    private readonly activityLog: ActivityLogService,
  ) {}

  // ── Lookups ────────────────────────────────────────────
  listModels(opts: { includeInactive?: boolean } = {}): Promise<ModelRow[]> {
    return this.repo.listModels(this.tenant.requireCompanyId(), opts);
  }

  listVariants(opts: { modelId?: string; includeInactive?: boolean } = {}): Promise<VariantRow[]> {
    return this.repo.listVariants(this.tenant.requireCompanyId(), opts);
  }

  /** The company's model, active or inactive. Another company's model is not found. */
  async getModel(id: string): Promise<ModelRow> {
    const model = await this.repo.findModelById(this.tenant.requireCompanyId(), id);
    if (!model) throw new NotFoundException('Model not found');
    return model;
  }

  async getVariant(id: string): Promise<VariantRow> {
    const variant = await this.repo.findVariantById(this.tenant.requireCompanyId(), id);
    if (!variant) throw new NotFoundException('Variant not found');
    return variant;
  }

  async modelDto(model: ModelRow): Promise<CatalogModelDto> {
    const companyId = this.tenant.requireCompanyId();
    const [variantCount, unitCount] = await Promise.all([this.repo.countVariants(companyId, model.id), this.repo.countModelUnits(companyId, model.id)]);
    return CatalogService.toModelDto(model, { variantCount, unitCount });
  }

  async variantDto(variant: VariantRow): Promise<CatalogVariantDto> {
    const unitCount = await this.repo.countVariantUnits(this.tenant.requireCompanyId(), variant.id);
    return CatalogService.toVariantDto(variant, { unitCount });
  }

  // ── Validation helpers ─────────────────────────────────
  /** The existing rule: a model name is unique within the company regardless of brand, case-insensitively. */
  async assertModelNameAvailable(name: string, excludeId?: string): Promise<void> {
    const existing = await this.repo.findModelByName(this.tenant.requireCompanyId(), name);
    if (existing && existing.id !== excludeId) throw new ConflictException(`Model "${existing.name}" already exists`);
  }

  /** The database key (model, name, colour) is exact; this is the friendly check ahead of it. */
  async assertVariantKeyAvailable(key: { modelId: string; name: string; colour: string }, excludeId?: string): Promise<void> {
    const existing = await this.repo.findVariantByKey(this.tenant.requireCompanyId(), key);
    if (existing && existing.id !== excludeId) throw new ConflictException(`Variant "${key.name}" in "${key.colour}" already exists for this model`);
  }

  // ── Models ─────────────────────────────────────────────
  async createModel(input: CreateCatalogModelInput, userId: string): Promise<ModelRow> {
    const companyId = this.tenant.requireCompanyId();
    await this.assertModelNameAvailable(input.name);
    const created = await this.repo
      .createModel(companyId, { brand: input.brand, name: input.name, description: input.description ?? null, isActive: input.isActive ?? true, createdById: userId, updatedById: userId })
      .catch(CatalogService.uniqueRace(`Model "${input.name}" already exists`));
    await this.audit(userId, catalogCreated('ScooterModel', created.id, `${created.brand} ${created.name}`, { brand: created.brand, name: created.name, description: created.description, isActive: created.isActive }));
    return created;
  }

  async updateModel(id: string, input: UpdateCatalogModelInput, userId: string): Promise<ModelRow> {
    const companyId = this.tenant.requireCompanyId();
    const before = await this.getModel(id);
    if (input.name !== undefined) await this.assertModelNameAvailable(input.name, id);
    const data: Prisma.ScooterModelUncheckedUpdateManyInput = { updatedById: userId };
    if (input.brand !== undefined) data.brand = input.brand;
    if (input.name !== undefined) data.name = input.name;
    if (input.description !== undefined) data.description = input.description || null;
    if (input.isActive !== undefined) data.isActive = input.isActive;
    const count = await this.repo.updateModel(companyId, id, data).catch(CatalogService.uniqueRace(`Model "${input.name ?? before.name}" already exists`));
    if (count !== 1) throw new NotFoundException('Model not found');
    const after = await this.getModel(id);
    const changes = diffFields(before, after, MODEL_FIELDS);
    if (Object.keys(changes).length > 0) await this.audit(userId, catalogUpdated('ScooterModel', id, `${after.brand} ${after.name}`, changes));
    return after;
  }

  async setModelActive(id: string, isActive: boolean, userId: string): Promise<ModelRow> {
    const companyId = this.tenant.requireCompanyId();
    const before = await this.getModel(id);
    if (before.isActive === isActive) return before;
    const count = await this.repo.setModelActive(companyId, id, isActive, userId);
    if (count !== 1) throw new NotFoundException('Model not found');
    await this.audit(userId, catalogActivation('ScooterModel', id, `${before.brand} ${before.name}`, isActive));
    return this.getModel(id);
  }

  // ── Variants ───────────────────────────────────────────
  async createVariant(input: CreateCatalogVariantInput, userId: string): Promise<VariantRow> {
    const companyId = this.tenant.requireCompanyId();
    const model = await this.getModel(input.modelId); // the model must be this company's
    await this.assertVariantKeyAvailable({ modelId: model.id, name: input.name, colour: input.colour });
    const created = await this.repo
      .createVariant(companyId, {
        modelId: model.id,
        name: input.name,
        colour: input.colour,
        hexColour: input.hexColour ?? null,
        exShowroomPrice: BigInt(input.exShowroomPrice),
        batteryType: input.batteryType ?? null,
        batteryCapacity: input.batteryCapacity ?? null,
        rangeKm: input.rangeKm ?? null,
        topSpeedKmph: input.topSpeedKmph ?? null,
        chargingTimeHrs: input.chargingTimeHrs === undefined ? null : new Prisma.Decimal(input.chargingTimeHrs),
        motorPowerW: input.motorPowerW ?? null,
        warrantyMonths: input.warrantyMonths ?? null,
        isActive: input.isActive ?? true,
        createdById: userId,
        updatedById: userId,
      })
      .catch(CatalogService.uniqueRace(`Variant "${input.name}" in "${input.colour}" already exists for this model`));
    await this.audit(userId, catalogCreated('ScooterVariant', created.id, CatalogService.variantName(created), { modelId: created.modelId, name: created.name, colour: created.colour, hexColour: created.hexColour, exShowroomPrice: created.exShowroomPrice, isActive: created.isActive }));
    return created;
  }

  async updateVariant(id: string, input: UpdateCatalogVariantInput, userId: string): Promise<VariantRow> {
    const companyId = this.tenant.requireCompanyId();
    const before = await this.getVariant(id);
    const key = { modelId: before.modelId, name: input.name ?? before.name, colour: input.colour ?? before.colour };
    if (input.name !== undefined || input.colour !== undefined) await this.assertVariantKeyAvailable(key, id);
    const data: Prisma.ScooterVariantUncheckedUpdateManyInput = { updatedById: userId };
    if (input.name !== undefined) data.name = input.name;
    if (input.colour !== undefined) data.colour = input.colour;
    if (input.hexColour !== undefined) data.hexColour = input.hexColour || null;
    if (input.exShowroomPrice !== undefined) data.exShowroomPrice = BigInt(input.exShowroomPrice);
    if (input.batteryType !== undefined) data.batteryType = input.batteryType || null;
    if (input.batteryCapacity !== undefined) data.batteryCapacity = input.batteryCapacity || null;
    if (input.rangeKm !== undefined) data.rangeKm = input.rangeKm;
    if (input.topSpeedKmph !== undefined) data.topSpeedKmph = input.topSpeedKmph;
    if (input.chargingTimeHrs !== undefined) data.chargingTimeHrs = new Prisma.Decimal(input.chargingTimeHrs);
    if (input.motorPowerW !== undefined) data.motorPowerW = input.motorPowerW;
    if (input.warrantyMonths !== undefined) data.warrantyMonths = input.warrantyMonths;
    if (input.isActive !== undefined) data.isActive = input.isActive;
    const count = await this.repo.updateVariant(companyId, id, data).catch(CatalogService.uniqueRace(`Variant "${key.name}" in "${key.colour}" already exists for this model`));
    if (count !== 1) throw new NotFoundException('Variant not found');
    const after = await this.getVariant(id);
    const changes = diffFields(before, after, VARIANT_FIELDS);
    if (Object.keys(changes).length > 0) await this.audit(userId, catalogUpdated('ScooterVariant', id, CatalogService.variantName(after), changes));
    return after;
  }

  async setVariantActive(id: string, isActive: boolean, userId: string): Promise<VariantRow> {
    const companyId = this.tenant.requireCompanyId();
    const before = await this.getVariant(id);
    if (before.isActive === isActive) return before;
    const count = await this.repo.setVariantActive(companyId, id, isActive, userId);
    if (count !== 1) throw new NotFoundException('Variant not found');
    await this.audit(userId, catalogActivation('ScooterVariant', id, CatalogService.variantName(before), isActive));
    return this.getVariant(id);
  }

  // ── Mapping ────────────────────────────────────────────
  static toModelDto(m: ModelRow, counts: { variantCount?: number; unitCount?: number } = {}): CatalogModelDto {
    return { id: m.id, brand: m.brand, name: m.name, description: m.description, isActive: m.isActive, taxClassificationId: m.taxClassificationId, createdAt: m.createdAt.toISOString(), updatedAt: m.updatedAt.toISOString(), ...counts };
  }

  static toVariantDto(v: VariantRow, counts: { unitCount?: number } = {}): CatalogVariantDto {
    return {
      id: v.id, modelId: v.modelId, model: v.model, name: v.name, colour: v.colour, hexColour: v.hexColour,
      exShowroomPrice: v.exShowroomPrice.toString(), batteryType: v.batteryType, batteryCapacity: v.batteryCapacity, rangeKm: v.rangeKm, topSpeedKmph: v.topSpeedKmph,
      chargingTimeHrs: v.chargingTimeHrs === null ? null : v.chargingTimeHrs.toFixed(2), motorPowerW: v.motorPowerW, warrantyMonths: v.warrantyMonths, isActive: v.isActive,
      createdAt: v.createdAt.toISOString(), updatedAt: v.updatedAt.toISOString(), ...counts,
    };
  }

  private static variantName(v: VariantRow): string {
    return `${v.model.brand} ${v.model.name} ${v.name} (${v.colour})`;
  }

  /** A concurrent create that loses the race against the unique index surfaces as the same 409. */
  private static uniqueRace(message: string) {
    return (e: unknown): never => {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException(message);
      throw e;
    };
  }

  private audit(actorId: string, event: CatalogAuditEvent): Promise<void> {
    return this.activityLog.record({ actorId, ...event });
  }
}
