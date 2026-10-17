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
/** An optional identification number (controller / charger): normalised like the others; '' or null clears it. */
const optionalIdentifierField = z
  .union([z.literal(''), identifierField])
  .nullable()
  .optional()
  .transform((v) => (v === '' ? null : v));

/* ── Purchase cost ──────────────────────────────────────────────────────────────────────────────
 * What the dealer paid for a vehicle: price + GST paid + transport charge = purchaseCost. The GST is
 * worked out from a rate by default; the owner may type the amount instead. Only users with
 * `inventory.cost` (the owner, by default) see or set any of these — the API removes them from every
 * response for anyone else.
 */
export const PURCHASE_COST_PERMISSION = 'inventory.cost';
/**
 * Response keys that carry purchase-cost data (removed for users without inventory.cost): a vehicle's purchase
 * breakdown, and an accessory's weighted-average cost and its cost at sale.
 */
export const PURCHASE_COST_FIELDS = ['purchaseCost', 'purchasePrice', 'purchaseGstRateBp', 'purchaseGst', 'transportCharge', 'avgCost', 'costAtSale'] as const;
/** Request keys that set purchase-cost data (refused from users without inventory.cost). */
export const PURCHASE_COST_INPUTS = ['purchasePrice', 'purchaseGstRate', 'purchaseGst', 'transportCharge'] as const;

export interface PurchaseCostBreakdown {
  purchasePrice: bigint;
  /** null when the GST amount was typed in. */
  purchaseGstRateBp: number | null;
  purchaseGst: bigint;
  transportCharge: bigint;
  purchaseCost: bigint;
}

/**
 * price + GST + transport. GST = price × rate (half-up to the paisa) unless an amount is given, which then
 * wins. Shared by the API (which stores it) and the form (which previews it).
 */
export function computePurchaseCost(price: bigint, gst: { rateBp: number } | { amount: bigint }, transport: bigint): PurchaseCostBreakdown {
  const purchaseGst = 'amount' in gst ? gst.amount : (price * BigInt(gst.rateBp) * 2n + 10000n) / 20000n;
  return { purchasePrice: price, purchaseGstRateBp: 'amount' in gst ? null : gst.rateBp, purchaseGst, transportCharge: transport, purchaseCost: price + purchaseGst + transport };
}

/* ── Component warranty ─────────────────────────────────────────────────────────────────────────
 * Months of warranty for each main component, entered with the scooter. Delivery issues the warranty card
 * from them, starting on the delivery date. 0 = not covered; blank = the company's default warranty period.
 * Once the warranty exists, only the owner changes them — from the warranty, which regenerates the card.
 */
export const WARRANTY_MONTH_COMPONENTS = ['MOTOR', 'BATTERY', 'CONTROLLER', 'CHARGER'] as const;
export type WarrantyMonthComponent = (typeof WARRANTY_MONTH_COMPONENTS)[number];
/** The InventoryUnit column holding each component's months. */
export const UNIT_WARRANTY_MONTH_FIELDS = {
  MOTOR: 'motorWarrantyMonths',
  BATTERY: 'batteryWarrantyMonths',
  CONTROLLER: 'controllerWarrantyMonths',
  CHARGER: 'chargerWarrantyMonths',
} as const satisfies Record<WarrantyMonthComponent, string>;
export type UnitWarrantyMonthField = (typeof UNIT_WARRANTY_MONTH_FIELDS)[WarrantyMonthComponent];
export const WARRANTY_MONTHS_MAX = 240;
/** Whole months, 0–240. */
export const warrantyMonthsSchema = z.coerce.number().int('Whole months only').min(0).max(WARRANTY_MONTHS_MAX, `At most ${WARRANTY_MONTHS_MAX} months`);
/** Optional on a unit: '' or null → not entered (the company default applies). */
const unitWarrantyMonthsField = z.preprocess((v) => (v === '' ? null : v), warrantyMonthsSchema.nullable().optional());

/** An extra item typed in for the warranty card (e.g. "Hub motor bearings", 12 months). A type alias, so it can
 * ride in JSON columns and activity-log metadata. */
export type WarrantyExtra = { name: string; months: number };
export const WARRANTY_EXTRAS_MAX = 10;
export const warrantyExtraSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(60, 'At most 60 characters'),
  months: z.coerce.number().int('Whole months only').min(1, 'At least 1 month').max(WARRANTY_MONTHS_MAX, `At most ${WARRANTY_MONTHS_MAX} months`),
});
export const warrantyExtrasSchema = z
  .array(warrantyExtraSchema)
  .max(WARRANTY_EXTRAS_MAX, `At most ${WARRANTY_EXTRAS_MAX} extra items`)
  .refine((items) => new Set(items.map((i) => i.name.toLowerCase())).size === items.length, { message: 'Each extra item needs a different name' });

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
  controllerNumber: optionalIdentifierField,
  chargerNumber: optionalIdentifierField,
  // Component warranty months (see UNIT_WARRANTY_MONTH_FIELDS); locked once the vehicle has a warranty.
  motorWarrantyMonths: unitWarrantyMonthsField,
  batteryWarrantyMonths: unitWarrantyMonthsField,
  controllerWarrantyMonths: unitWarrantyMonthsField,
  chargerWarrantyMonths: unitWarrantyMonthsField,
  warrantyExtras: warrantyExtrasSchema.optional(),
  purchaseDate: z.coerce.date().optional(),
  // Purchase cost (inventory.cost only). Omitted → unchanged on an edit, zero on a new unit.
  purchasePrice: paise.optional(),
  /** GST rate in percent, used when no GST amount is given. */
  purchaseGstRate: z.coerce.number().min(0).max(100).optional(),
  /** GST amount typed in (owner's override); wins over the rate. */
  purchaseGst: paise.optional(),
  transportCharge: paise.optional(),
  sellingPrice: paise.optional(),
  supplier: optionalTrimmed,
  location: optionalTrimmed,
  /** The ignition key's number (printed on the RTO invoice); upper-cased. '' clears it. */
  keyNumber: z.string().trim().max(30).nullable().optional().transform((v) => (v == null ? v : v.toUpperCase() || null)),
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
    controllerNumber: optionalIdentifierField,
    chargerNumber: optionalIdentifierField,
    reason: z
      .string({ required_error: 'A reason is required' })
      .trim()
      .min(IDENTIFICATION_CORRECTION_REASON_MIN, `Give a reason of at least ${IDENTIFICATION_CORRECTION_REASON_MIN} characters`)
      .max(500),
  })
  .refine((v) => v.vin !== undefined || v.motorNumber !== undefined || v.batteryNumber !== undefined || v.controllerNumber !== undefined || v.chargerNumber !== undefined, {
    message: 'Give the VIN, motor, battery, controller or charger number to correct',
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

/** A blank CSV cell is "not given" (not zero). */
const blankAsMissing = (v: unknown): unknown => (typeof v === 'string' && v.trim() === '' ? undefined : v);

/**
 * One row of a bulk CSV import (values arrive as strings; rupees, not paise). Brand is optional and
 * narrows the model match. A blank selling price means "use the variant's list price". The purchase
 * date and status are checked by the import itself (strict formats, AVAILABLE only).
 */
export const csvUnitRowSchema = z.object({
  brand: z.string().trim().optional(),
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
  sellingPrice: z.preprocess(blankAsMissing, z.coerce.number().min(0).optional()),
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
  controllerNumber: string | null;
  chargerNumber: string | null;
  /** Component warranty months; null = the company default applies. */
  motorWarrantyMonths: number | null;
  batteryWarrantyMonths: number | null;
  controllerWarrantyMonths: number | null;
  chargerWarrantyMonths: number | null;
  /** Extra items printed on the warranty card after the four components. */
  warrantyExtras: WarrantyExtra[];
  purchaseDate: string | null;
  /** Purchase-cost fields: present only for users with inventory.cost. */
  purchaseCost?: string;
  purchasePrice?: string;
  purchaseGstRateBp?: number | null;
  purchaseGst?: string;
  transportCharge?: string;
  sellingPrice: string;
  supplier: string | null;
  location: string | null;
  keyNumber: string | null;
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
/*
 * M4D.2 — CSV import PREVIEW (POST /inventory/units/import/preview, multipart field "file"). A dry run:
 * it validates every row exactly as the import does and reports what would happen, writing nothing. It is
 * advisory — the catalogue and inventory can change before an import runs, so the import re-validates
 * every row itself.
 *
 * HTTP errors: 400 — no file, an unreadable CSV (the message names the line) or more than
 * CSV_IMPORT_MAX_ROWS rows; 413 — larger than CSV_IMPORT_MAX_BYTES; 429 — more than 10 previews by this
 * user in a minute; 503 — the database could not serve the check in time (try again); 401 / 403 — not
 * signed in, or no inventory.create permission. Problems in individual rows are never HTTP errors: they
 * are row issues.
 */

/** Data rows (excluding the header) one preview accepts. */
export const CSV_IMPORT_MAX_ROWS = 2000;
/** Largest CSV file one preview accepts (bytes). */
export const CSV_IMPORT_MAX_BYTES = 2 * 1024 * 1024;

/** The CSV column an issue is about (null: the row as a whole). */
export type CsvImportField =
  | 'brand' | 'model' | 'variant' | 'colour' | 'vin' | 'motorNumber' | 'batteryNumber'
  | 'purchaseDate' | 'purchaseCost' | 'sellingPrice' | 'supplier' | 'location' | 'status';

/**
 * Why a row cannot be imported. The `message` that comes with it says what to fix.
 * - INVALID_VALUE: a value is missing, not a number, negative, too short or too long.
 * - INVALID_DATE: the purchase date is not YYYY-MM-DD or D/M/YYYY (day first), or is not a real date.
 * - STATUS_NOT_ALLOWED: only AVAILABLE units can be imported (Status blank or AVAILABLE).
 * - MODEL_NOT_FOUND / VARIANT_NOT_FOUND: no such model (for the brand, if given) / variant and colour of
 *   that model in the company's catalogue. The import never creates catalogue entries.
 * - MODEL_INACTIVE / VARIANT_INACTIVE: it exists but is inactive.
 * - MODEL_AMBIGUOUS / VARIANT_AMBIGUOUS: more than one active entry matches (add a Brand column for a
 *   model name used by several brands; names that differ only in case need fixing in the catalogue).
 * - DUPLICATE_IN_FILE: another row of this file has the same VIN, motor or battery number — every row
 *   involved is invalid, none is chosen.
 * - ALREADY_EXISTS: that VIN, motor or battery number is already used by a scooter in YOUR company's
 *   inventory (deleted scooters included).
 * - IDENTIFIER_UNAVAILABLE: that number is already registered outside your company. These numbers are
 *   unique across the whole system, so it cannot be used; nothing else about it is disclosed.
 */
export type CsvImportIssueCode =
  | 'INVALID_VALUE' | 'INVALID_DATE' | 'STATUS_NOT_ALLOWED'
  | 'MODEL_NOT_FOUND' | 'MODEL_INACTIVE' | 'MODEL_AMBIGUOUS'
  | 'VARIANT_NOT_FOUND' | 'VARIANT_INACTIVE' | 'VARIANT_AMBIGUOUS'
  | 'DUPLICATE_IN_FILE' | 'ALREADY_EXISTS' | 'IDENTIFIER_UNAVAILABLE';

export interface CsvImportIssue {
  code: CsvImportIssueCode;
  field: CsvImportField | null;
  message: string;
}

/** What the import would create for a VALID row (money in paise, as strings). */
export interface CsvImportPreviewUnit {
  modelId: string;
  variantId: string;
  brand: string;
  model: string;
  variant: string;
  colour: string;
  status: 'AVAILABLE';
  sellingPrice: string;
  /** FILE: the row's own price; LIST_PRICE: the row left it blank, so the variant's list price applies. */
  sellingPriceSource: 'FILE' | 'LIST_PRICE';
  purchaseCost: string;
  /** Calendar date, YYYY-MM-DD. */
  purchaseDate: string | null;
}

export interface CsvImportPreviewRow {
  /** The line of the file the row starts on (header = line 1; blank lines and multi-line cells counted). */
  row: number;
  status: 'VALID' | 'INVALID';
  /** The row's VIN as it would be stored (trimmed, upper-case), to identify the row; null when blank. */
  vin: string | null;
  /** Empty for a VALID row. */
  issues: CsvImportIssue[];
  /** Only for a VALID row. */
  unit: CsvImportPreviewUnit | null;
}

export interface CsvImportPreview {
  /** When the preview was computed (ISO). Advisory: the import re-validates every row when it runs. */
  checkedAt: string;
  /** SHA-256 (hex) of the file's bytes. Send it back as `expectedSha256` when confirming the import. */
  fileSha256: string;
  maxRows: number;
  summary: {
    /** Data rows read from the file. */
    total: number;
    valid: number;
    invalid: number;
    /** Rows with a DUPLICATE_IN_FILE, ALREADY_EXISTS or IDENTIFIER_UNAVAILABLE issue (also counted as invalid). */
    duplicate: number;
  };
  /** Every row, in file order. */
  rows: CsvImportPreviewRow[];
}

/*
 * M4D.3 — confirmed CSV import (POST /inventory/units/import, multipart "file" + optional text field
 * "expectedSha256"). ALL OR NOTHING: the server re-validates the whole file inside one transaction (the
 * preview is never trusted) and creates every row, or none.
 *
 * - expectedSha256 (the preview's fileSha256): when given and the uploaded bytes differ → 409, nothing
 *   imported ("preview it again"). The server stores no CSV; the hash is how a confirmation is tied to
 *   the previewed file. Without it the file is still fully re-validated.
 * - 200 IMPORTED: every row was created (one transaction: units, their history events, one audit entry).
 * - 200 REJECTED: nothing was created; `preview` is the server's validation at import time (row issues
 *   as in the preview). Includes numbers taken by a concurrent import or edit after validation.
 * - 400 no file / unreadable CSV (line named) / more than CSV_IMPORT_MAX_ROWS rows / no data rows;
 *   413 larger than CSV_IMPORT_MAX_BYTES; 409 file changed since the preview, or a concurrent change
 *   (including a deadlock with another import) that could not be attributed to a row (retry); 503 the
 *   transaction could not finish in time (retry or split the file); 429 more than 10 imports by this user
 *   in a minute (preview has its own limit of 10); 401 / 403 auth. Nothing is imported
 *   on any non-IMPORTED outcome.
 */
export interface CsvImportResult {
  status: 'IMPORTED' | 'REJECTED';
  /** Units created (0 when REJECTED). */
  created: number;
  /** Rows that blocked the import (0 when IMPORTED). */
  failed: number;
  /** One entry per invalid row, its issue messages joined — the shape the current import dialog shows. */
  errors: { row: number; message: string }[];
  fileSha256: string;
  /** REJECTED: the full validation at import time. IMPORTED: null. */
  preview: CsvImportPreview | null;
}

export const inventoryDocumentTypes = DOCUMENT_TYPES;
