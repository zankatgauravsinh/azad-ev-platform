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
