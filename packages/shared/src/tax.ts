import { z } from 'zod';

/**
 * GST / Tax management contracts (Stage A — configuration/master data only).
 * These describe the tax-classification + effective-dated rate master. NOTHING here calculates tax,
 * and no Booking/Sale/invoice/Delivery behaviour depends on it yet — a later engine consumes it.
 * A rate is a single combined percentage; the CGST/SGST/IGST split is derived per transaction later,
 * never stored in config.
 */

export const TaxCodeType = { HSN: 'HSN', SAC: 'SAC' } as const;
export type TaxCodeType = (typeof TaxCodeType)[keyof typeof TaxCodeType];
export const TAX_CODE_TYPES = Object.values(TaxCodeType);

export const TaxTreatment = {
  TAXABLE: 'TAXABLE',
  EXEMPT: 'EXEMPT',
  NON_TAXABLE: 'NON_TAXABLE',
  NIL_RATED: 'NIL_RATED',
} as const;
export type TaxTreatment = (typeof TaxTreatment)[keyof typeof TaxTreatment];
export const TAX_TREATMENTS = Object.values(TaxTreatment);

// ── Classifications ────────────────────────────────────────
export const createTaxClassificationSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(100),
    codeType: z.enum(TAX_CODE_TYPES as [TaxCodeType, ...TaxCodeType[]]),
    // HSN (goods) / SAC (services) code. Required for a TAXABLE classification.
    code: z.string().trim().max(20).optional().nullable(),
    treatment: z.enum(TAX_TREATMENTS as [TaxTreatment, ...TaxTreatment[]]).default(TaxTreatment.TAXABLE),
    description: z.string().trim().max(500).optional().nullable(),
    isActive: z.boolean().optional().default(true),
  })
  .refine((v) => v.treatment !== TaxTreatment.TAXABLE || (v.code != null && v.code.trim().length > 0), {
    message: 'A taxable classification needs an HSN/SAC code',
    path: ['code'],
  });
export type CreateTaxClassificationInput = z.infer<typeof createTaxClassificationSchema>;

export const updateTaxClassificationSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    codeType: z.enum(TAX_CODE_TYPES as [TaxCodeType, ...TaxCodeType[]]).optional(),
    code: z.string().trim().max(20).nullable().optional(),
    treatment: z.enum(TAX_TREATMENTS as [TaxTreatment, ...TaxTreatment[]]).optional(),
    description: z.string().trim().max(500).nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'No changes provided' });
export type UpdateTaxClassificationInput = z.infer<typeof updateTaxClassificationSchema>;

// ── Rates ──────────────────────────────────────────────────
// A single combined GST rate (e.g. 5.00). effectiveTo = null means open-ended.
// effectiveFrom / effectiveTo are CALENDAR DATES ('YYYY-MM-DD'), both inclusive: a rate ending
// 2026-06-30 and the next starting 2026-07-01 are adjacent with no gap. Any time-of-day is ignored.
const calendarDay = (d: Date): string => d.toISOString().slice(0, 10);
export const createTaxRateSchema = z
  .object({
    ratePercent: z.number().min(0, 'Rate cannot be negative').max(100, 'Rate cannot exceed 100%'),
    effectiveFrom: z.coerce.date(),
    effectiveTo: z.coerce.date().optional().nullable(),
    // Optional on input; the service defaults a new rate to active.
    isActive: z.boolean().optional(),
  })
  .refine((v) => v.effectiveTo == null || calendarDay(v.effectiveTo) >= calendarDay(v.effectiveFrom), {
    message: 'Effective-to cannot be before effective-from',
    path: ['effectiveTo'],
  });
export type CreateTaxRateInput = z.infer<typeof createTaxRateSchema>;

export const updateTaxRateSchema = z
  .object({
    ratePercent: z.number().min(0).max(100).optional(),
    effectiveFrom: z.coerce.date().optional(),
    effectiveTo: z.coerce.date().nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'No changes provided' });
export type UpdateTaxRateInput = z.infer<typeof updateTaxRateSchema>;

export const listTaxClassificationsQuerySchema = z.object({
  includeInactive: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});
export type ListTaxClassificationsQuery = z.infer<typeof listTaxClassificationsQuerySchema>;

// ── DTOs (client-safe projections) ─────────────────────────
export interface TaxRateDto {
  id: string;
  classificationId: string;
  /** Serialised Decimal, e.g. "5.00". */
  ratePercent: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface TaxClassificationDto {
  id: string;
  name: string;
  codeType: TaxCodeType;
  code: string | null;
  treatment: TaxTreatment;
  description: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  rates: TaxRateDto[];
}

// ─────────────────────────── GST configuration (Stage C.1) ───────────────────────────
// Administration contracts for the settings the sale-time GST calculation reads. None of this
// calculates tax, and none of it carries a default: an unset value stays unset.

/** A GST state code is exactly two digits. It is recorded, never derived from a state name or address. */
export const GST_STATE_CODE_PATTERN = /^\d{2}$/;
export const isGstStateCode = (value: unknown): value is string => typeof value === 'string' && GST_STATE_CODE_PATTERN.test(value);

/**
 * STRUCTURAL GSTIN check only: 15 characters — 2-digit state code, 10-character PAN, entity code,
 * 'Z', check character. It does NOT verify the number with the GST portal or validate the checksum,
 * so a value that passes is merely well-formed.
 */
export const GSTIN_PATTERN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const isWellFormedGstin = (value: unknown): value is string => typeof value === 'string' && GSTIN_PATTERN.test(value);

/** How a booking's discount / exchange value relates to the vehicle's taxable value (a CA decision). */
export const GstAdjustmentTreatment = {
  REDUCES_VEHICLE_TAXABLE_VALUE: 'REDUCES_VEHICLE_TAXABLE_VALUE',
  AFTER_TAX_ADJUSTMENT: 'AFTER_TAX_ADJUSTMENT',
} as const;
export type GstAdjustmentTreatment = (typeof GstAdjustmentTreatment)[keyof typeof GstAdjustmentTreatment];
export const GST_ADJUSTMENT_TREATMENTS = Object.values(GstAdjustmentTreatment);

/** Booking components classified by a per-company mapping (they have no product master of their own). */
export const TaxMappedComponent = {
  EXTENDED_WARRANTY: 'EXTENDED_WARRANTY',
  RTO: 'RTO',
  INSURANCE: 'INSURANCE',
  REGISTRATION: 'REGISTRATION',
} as const;
export type TaxMappedComponent = (typeof TaxMappedComponent)[keyof typeof TaxMappedComponent];
export const TAX_MAPPED_COMPONENTS = Object.values(TaxMappedComponent);

export const taxMappedComponentSchema = z.enum(TAX_MAPPED_COMPONENTS as [TaxMappedComponent, ...TaxMappedComponent[]]);

export const setComponentMappingSchema = z.object({ classificationId: z.string().uuid() });
export type SetComponentMappingInput = z.infer<typeof setComponentMappingSchema>;

/** Assign (uuid) or clear (null) the tax classification of a scooter model / accessory. */
export const setProductTaxClassificationSchema = z.object({ taxClassificationId: z.string().uuid().nullable() });
export type SetProductTaxClassificationInput = z.infer<typeof setProductTaxClassificationSchema>;

export interface TaxClassificationRef {
  id: string;
  name: string;
  codeType: TaxCodeType;
  code: string | null;
  treatment: TaxTreatment;
}

export interface TaxComponentMappingDto {
  component: TaxMappedComponent;
  /** null = not mapped. */
  classification: TaxClassificationRef | null;
  /** false when the mapped classification has since been deactivated or archived. */
  usable: boolean;
}

export interface ProductTaxClassificationDto {
  id: string;
  taxClassificationId: string | null;
}

/**
 * Informational summary for the GST settings page. It is NOT the enforcement point — sale-time
 * validation is — and it never treats an unused component or an unclassified product as an error.
 */
export interface GstReadinessDto {
  gstEnabled: boolean;
  registration: {
    gstinPresent: boolean;
    gstinWellFormed: boolean;
    stateCodePresent: boolean;
    stateCodeValid: boolean;
    /** null when either value is missing; otherwise whether the GSTIN starts with the state code. */
    stateCodeMatchesGstin: boolean | null;
  };
  /** Whether GST could be switched on right now, and what is missing if not. */
  canEnable: boolean;
  blockers: string[];
  discountTreatment: GstAdjustmentTreatment | null;
  exchangeTreatment: GstAdjustmentTreatment | null;
  componentMappings: TaxComponentMappingDto[];
  classifications: { active: number; taxableWithoutCurrentRate: number };
  scooterModels: { total: number; classified: number; missing: number };
  accessories: { total: number; classified: number; missing: number };
}

/**
 * What stops GST being switched on for a company, given its registration details. Deliberately limited
 * to the registration itself: classifications, mappings and policies are only needed by the sales that
 * actually use them, and that is enforced when an invoice is generated — not here.
 */
export function gstActivationBlockers(registration: { gstNumber: string | null | undefined; gstStateCode: string | null | undefined }): string[] {
  const blockers: string[] = [];
  const gstin = registration.gstNumber?.trim() ?? '';
  const stateCode = registration.gstStateCode?.trim() ?? '';
  if (gstin === '') blockers.push('the company GSTIN is not set');
  else if (!isWellFormedGstin(gstin)) blockers.push('the company GSTIN is not a well-formed 15-character GSTIN');
  if (stateCode === '') blockers.push('the company GST state code is not set');
  else if (!isGstStateCode(stateCode)) blockers.push('the company GST state code must be two digits');
  if (isWellFormedGstin(gstin) && isGstStateCode(stateCode) && !gstin.startsWith(stateCode)) {
    blockers.push('the GST state code does not match the first two digits of the GSTIN');
  }
  return blockers;
}
