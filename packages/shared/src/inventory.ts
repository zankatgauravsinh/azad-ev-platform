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
