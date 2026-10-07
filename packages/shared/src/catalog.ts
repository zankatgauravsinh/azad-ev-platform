import { z } from 'zod';

/* ------------------------------------------------------------------ *
 * Catalog — scooter models and variants (the products the dealership sells)
 *
 *   ScooterModel → ScooterVariant → InventoryUnit
 *
 * M1 defines the contracts the catalog service and the later Model Management
 * screens use. Inputs never carry companyId or audit fields: the tenant comes
 * from the authenticated actor, the audit trail from the server.
 * ------------------------------------------------------------------ */

const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).optional();
/** Integer paise, never negative. */
const paise = z.coerce.number().int().min(0);
const optionalCount = z.coerce.number().int().min(0).optional();
export const HEX_COLOUR_PATTERN = /^#([0-9a-fA-F]{6})$/;

/* ── Model ── */
export const createCatalogModelSchema = z.object({
  brand: text(80),
  name: text(80),
  description: optionalText(500),
  isActive: z.boolean().optional(),
});
export type CreateCatalogModelInput = z.infer<typeof createCatalogModelSchema>;

export const updateCatalogModelSchema = createCatalogModelSchema.partial();
export type UpdateCatalogModelInput = z.infer<typeof updateCatalogModelSchema>;

export interface CatalogModelRef {
  id: string;
  brand: string;
  name: string;
}

export interface CatalogModelDto extends CatalogModelRef {
  description: string | null;
  isActive: boolean;
  /** Managed on the GST page (PUT /tax/scooter-models/:id/classification) — read-only here. */
  taxClassificationId: string | null;
  createdAt: string;
  updatedAt: string;
  /** Present on list/detail reads that count them. */
  variantCount?: number;
  unitCount?: number;
}

/* ── Variant ── */
const variantFields = {
  name: text(80),
  colour: text(60),
  hexColour: z.string().regex(HEX_COLOUR_PATTERN, 'Use a #RRGGBB hex colour').optional(),
  exShowroomPrice: paise,
  batteryType: optionalText(80),
  batteryCapacity: optionalText(80),
  rangeKm: optionalCount,
  topSpeedKmph: optionalCount,
  chargingTimeHrs: z.coerce.number().min(0).max(999.99).optional(),
  motorPowerW: optionalCount,
  warrantyMonths: optionalCount,
  isActive: z.boolean().optional(),
};

export const createCatalogVariantSchema = z.object({ modelId: z.string().uuid(), ...variantFields });
export type CreateCatalogVariantInput = z.infer<typeof createCatalogVariantSchema>;

/** The model a variant belongs to is fixed: a variant moves to another model only by re-creation. */
export const updateCatalogVariantSchema = z.object(variantFields).partial();
export type UpdateCatalogVariantInput = z.infer<typeof updateCatalogVariantSchema>;

export interface CatalogVariantDto {
  id: string;
  modelId: string;
  model: CatalogModelRef;
  name: string;
  colour: string;
  hexColour: string | null;
  /** Integer paise, serialised as a string like every other money field. */
  exShowroomPrice: string;
  batteryType: string | null;
  batteryCapacity: string | null;
  rangeKm: number | null;
  topSpeedKmph: number | null;
  /** Decimal(5,2) serialised as a string, e.g. "4.50". */
  chargingTimeHrs: string | null;
  motorPowerW: number | null;
  warrantyMonths: number | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  unitCount?: number;
}
