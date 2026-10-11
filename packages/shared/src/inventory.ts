import { z } from 'zod';
import { UnitStatus, UNIT_STATUSES, DocumentType, DOCUMENT_TYPES } from './enums';
import { paginationQuerySchema } from './pagination';

/** A non-negative integer amount of paise (₹ × 100). */
const paise = z.coerce.number().int().min(0);
const optionalTrimmed = z
  .string()
  .trim()
  .max(200)
  .optional()
  .transform((v) => (v === '' ? undefined : v));

const vinField = z
  .string()
  .trim()
  .min(3, 'Too short')
  .max(64)
  .transform((v) => v.toUpperCase());

const identifierField = z.string().trim().min(1).max(64).transform((v) => v.toUpperCase());

/**
 * A unit names its catalogue entry in one of two ways:
 *  - CURATED (preferred): `variantId` — an existing, active variant of an active model in the company.
 *    Nothing is created. When both are sent, variantId is authoritative and the free-text fields are ignored.
 *  - LEGACY (temporary, retired in M4E): `modelId` + `variant` + `colour` (+ `hexColour`), which still
 *    creates the variant on the fly when the combination does not exist.
 * `sellingPrice` omitted → the variant's list price for a curated unit, 0 for a legacy one.
 */
const unitFields = {
  variantId: z.string().uuid('Select a variant').optional(),
  modelId: z.string().uuid('Select a model').optional(),
  variant: z.string().trim().min(1, 'Variant is required').max(80).optional(),
  colour: z.string().trim().min(1, 'Colour is required').max(60).optional(),
  hexColour: z
    .string()
    .regex(/^#([0-9a-fA-F]{6})$/, 'Use a #RRGGBB hex colour')
    .optional(),
  vin: vinField,
  motorNumber: identifierField,
  batteryNumber: identifierField,
  purchaseDate: z.coerce.date().optional(),
  purchaseCost: paise.default(0),
  sellingPrice: paise.optional(),
  supplier: optionalTrimmed,
  location: optionalTrimmed,
  notes: z.string().trim().max(1000).optional(),
  status: z.enum(UNIT_STATUSES as [UnitStatus, ...UnitStatus[]]).default(UnitStatus.AVAILABLE),
};
const unitObject = z.object(unitFields);

/** Either shape; a create must identify its variant one way or the other. */
export const createUnitSchema = unitObject.superRefine((v, ctx) => {
  if (v.variantId) return;
  if (!v.modelId) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['modelId'], message: 'Select a model' });
  if (!v.variant) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['variant'], message: 'Variant is required' });
  if (!v.colour) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['colour'], message: 'Colour is required' });
});
export type CreateUnitInput = z.infer<typeof createUnitSchema>;

export const updateUnitSchema = unitObject.omit({ status: true }).partial();
export type UpdateUnitInput = z.infer<typeof updateUnitSchema>;

/** Shortest acceptable reason for an identification correction, counted after trimming. */
export const IDENTIFICATION_CORRECTION_REASON_MIN = 5;

/** A correction never touches the catalogue identity: these keys are refused outright, not ignored. */
const notCorrectable = z.undefined({ invalid_type_error: 'Model, variant and colour cannot be changed by an identification correction' });

/**
 * Owner-only correction of the identification numbers of a delivered, in-service or returned vehicle,
 * or of any vehicle with a sale, warranty or AMC history. The identifiers are normalised exactly like an
 * ordinary edit (trimmed, upper-cased); a reason is always required. Model / variant / colour keys are
 * rejected. Other unknown keys (e.g. companyId, userId) are stripped — the tenant and the actor come from
 * the session, never from the request.
 */
export const identificationCorrectionSchema = z
  .object({
    variantId: notCorrectable,
    modelId: notCorrectable,
    variant: notCorrectable,
    colour: notCorrectable,
    hexColour: notCorrectable,
    vin: vinField.optional(),
    motorNumber: identifierField.optional(),
    batteryNumber: identifierField.optional(),
    reason: z
      .string({ required_error: 'A reason is required' })
      .trim()
      .min(IDENTIFICATION_CORRECTION_REASON_MIN, `Give a reason of at least ${IDENTIFICATION_CORRECTION_REASON_MIN} characters`)
      .max(500),
  })
  .refine((v) => v.vin !== undefined || v.motorNumber !== undefined || v.batteryNumber !== undefined, {
    message: 'Give the VIN, motor number or battery number to correct',
    path: ['vin'],
  });
export type IdentificationCorrectionInput = z.infer<typeof identificationCorrectionSchema>;

export const changeUnitStatusSchema = z.object({
  toStatus: z.enum(UNIT_STATUSES as [UnitStatus, ...UnitStatus[]]),
  note: z.string().trim().max(500).optional(),
});
export type ChangeUnitStatusInput = z.infer<typeof changeUnitStatusSchema>;

export const listUnitsQuerySchema = paginationQuerySchema.extend({
  status: z.enum(UNIT_STATUSES as [UnitStatus, ...UnitStatus[]]).optional(),
  modelId: z.string().uuid().optional(),
  supplier: z.string().trim().optional(),
  sort: z
    .enum(['createdAt', 'vin', 'status', 'sellingPrice', 'purchaseDate'])
    .default('createdAt'),
});
export type ListUnitsQuery = z.infer<typeof listUnitsQuerySchema>;

/** One row of a bulk CSV import (values arrive as strings; rupees, not paise). */
export const csvUnitRowSchema = z.object({
  model: z.string().trim().min(1),
  variant: z.string().trim().min(1),
  colour: z.string().trim().min(1),
  vin: vinField,
  motorNumber: identifierField,
  batteryNumber: identifierField,
  purchaseDate: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : undefined)),
  purchaseCost: z.coerce.number().min(0).default(0),
  sellingPrice: z.coerce.number().min(0).default(0),
  supplier: z.string().trim().optional(),
  location: z.string().trim().optional(),
  status: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v.toUpperCase() : undefined)),
});
export type CsvUnitRow = z.infer<typeof csvUnitRowSchema>;

// ── Response DTOs ─────────────────────────────────────────
export interface InventoryModelRef {
  id: string;
  name: string;
  brand: string;
}
export interface InventoryVariantRef {
  id: string;
  name: string;
  colour: string;
  hexColour: string | null;
  model: InventoryModelRef;
}
export interface InventoryUnitDto {
  id: string;
  vin: string;
  motorNumber: string;
  batteryNumber: string;
  status: UnitStatus;
  purchaseDate: string | null;
  purchaseCost: string;
  sellingPrice: string;
  supplier: string | null;
  location: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  variant: InventoryVariantRef;
}
/**
 * How a unit's identity may change right now, computed by the server from its status and committed
 * history (M4B.4) and returned with the unit's detail. For presentation only: the server re-checks
 * every change and stays authoritative.
 */
export interface UnitIdentityPolicy {
  /** The vehicle has a Sale (soft-deleted included), a Warranty or an AMC plan (cancelled included). */
  committed: boolean;
  /** The ordinary edit may change its model / variant / colour. */
  catalogueEditable: boolean;
  /** The ordinary edit may change its VIN / motor / battery number. */
  identificationEditable: boolean;
  /** The owner identification correction applies (the user must still be an OWNER with inventory.update). */
  correctionEligible: boolean;
}

export interface InventoryEventDto {
  id: string;
  fromStatus: UnitStatus | null;
  toStatus: UnitStatus;
  note: string | null;
  createdAt: string;
  createdById: string | null;
}
export interface InventoryStats {
  total: number;
  available: number;
  reserved: number;
  booked: number;
  delivered: number;
  inService: number;
  returned: number;
}
export interface InventoryUnitPhotoDto {
  id: string;
  fileKey: string;
  url: string;
  label: string | null;
  createdAt: string;
}
export interface InventoryUnitDocumentDto {
  id: string;
  type: DocumentType;
  fileKey: string;
  url: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}
export interface CsvImportResult {
  created: number;
  failed: number;
  errors: { row: number; message: string }[];
}

export const inventoryDocumentTypes = DOCUMENT_TYPES;
