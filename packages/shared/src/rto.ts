import { z } from 'zod';
import { paginationQuerySchema } from './pagination';
import { isCalendarDateString } from './delivery';

/* ------------------------------------------------------------------ *
 * RTO invoice — the invoice issued for a vehicle's registration with the RTO, raised from a booking with
 * figures the dealer enters: list price − discount = taxable value, and GST is ADDED ON TOP of that.
 * One per booking; the owner may revise it (same number, revision + 1).
 * ------------------------------------------------------------------ */

export const RtoSupplyType = { INTRA: 'INTRA', INTER: 'INTER' } as const;
export type RtoSupplyType = (typeof RtoSupplyType)[keyof typeof RtoSupplyType];
export const RTO_SUPPLY_TYPES = Object.values(RtoSupplyType);
export const RTO_SUPPLY_TYPE_LABEL: Record<RtoSupplyType, string> = {
  INTRA: 'Within the state (CGST + SGST)',
  INTER: 'Another state (IGST)',
};

/** The highest GST rate accepted, in percent (the top GST slab). */
export const RTO_MAX_GST_RATE = 28;

const listPrice = z.coerce.number().int().min(1, 'Enter the list price');
const discount = z.coerce.number().int().min(0, 'The discount cannot be negative').default(0);
/** A GST rate in percent with at most two decimals (5, 12, 18, 28, 2.5 …). */
const gstRate = z.coerce
  .number()
  .min(0, 'The GST rate cannot be negative')
  .max(RTO_MAX_GST_RATE, `The GST rate cannot exceed ${RTO_MAX_GST_RATE}%`)
  .refine((v) => Number.isInteger(Math.round(v * 100)) && Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, 'Use at most two decimals for the GST rate');

const rtoFigures = {
  /** List price in paise — defaults to the scooter's list price. */
  listPrice,
  /** Discount in paise; the taxable value is listPrice − discount. */
  discount,
  /** GST rate in percent. */
  gstRate,
  supplyType: z.enum(RTO_SUPPLY_TYPES as [RtoSupplyType, ...RtoSupplyType[]]),
  /**
   * The HSN code to print, chosen from GST Management (an active HSN classification). Omitted → the vehicle
   * model's classification on a new invoice, unchanged on a revision; null → no HSN code.
   */
  taxClassificationId: z.string().uuid().nullable().optional(),
  /** Insurance policy number; '' or null leaves it blank. Omitted → the booking's policy number. */
  policyNumber: z.string().trim().max(80).nullable().optional().transform((v) => (v == null ? v : v || null)),
  /**
   * Delivery date, 'YYYY-MM-DD'; null leaves it blank. Omitted → the booking's delivery date. Only the owner may
   * send a date different from the booking's (enforced by the API).
   */
  deliveryDate: z
    .union([z.literal(''), z.string().refine(isCalendarDateString, 'Enter a valid date')])
    .nullable()
    .optional()
    .transform((v) => (v === '' ? null : v)),
};
/** The taxable value (list price − discount) must stay above zero. */
const discountBelowList = (v: { listPrice: number; discount: number }): boolean => v.discount < v.listPrice;
const DISCOUNT_MESSAGE = { message: 'The discount must be less than the list price', path: ['discount'] };

export const generateRtoInvoiceSchema = z
  .object({ customerId: z.string().uuid(), bookingId: z.string().uuid(), ...rtoFigures })
  .refine(discountBelowList, DISCOUNT_MESSAGE);
export type GenerateRtoInvoiceInput = z.infer<typeof generateRtoInvoiceSchema>;

/** Owner-only revision: new figures, same invoice number. */
export const reviseRtoInvoiceSchema = z.object(rtoFigures).refine(discountBelowList, DISCOUNT_MESSAGE);
export type ReviseRtoInvoiceInput = z.infer<typeof reviseRtoInvoiceSchema>;

export const listRtoInvoicesQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().max(100).optional(),
  customerId: z.string().uuid().optional(),
});
export type ListRtoInvoicesQuery = z.infer<typeof listRtoInvoicesQuerySchema>;

export interface RtoGst {
  /** Taxable value (= the selling price). */
  taxable: bigint;
  cgst: bigint;
  sgst: bigint;
  igst: bigint;
  gst: bigint;
  total: bigint;
}

/** Percent → basis points (5 → 500, 2.5 → 250). */
export const gstRateToBp = (percent: number): number => Math.round(percent * 100);

/**
 * GST on top of the price. GST = price × rate, rounded half-up to the paisa. Within the state it is split into
 * CGST and SGST — CGST takes the half rounded down and SGST the rest, so the two always add up to the GST.
 * The single calculation used by the API (which stores it) and the form (which previews it).
 */
export function computeRtoGst(sellingPrice: bigint, gstRateBp: number, supplyType: RtoSupplyType): RtoGst {
  const gst = (sellingPrice * BigInt(gstRateBp) * 2n + 10000n) / 20000n; // half-up: (2·p·r + 10000) / 20000
  const cgst = supplyType === RtoSupplyType.INTRA ? gst / 2n : 0n;
  const sgst = supplyType === RtoSupplyType.INTRA ? gst - cgst : 0n;
  const igst = supplyType === RtoSupplyType.INTER ? gst : 0n;
  return { taxable: sellingPrice, cgst, sgst, igst, gst, total: sellingPrice + gst };
}

export interface RtoInvoiceDto {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  booking: { id: string; code: string; status: string };
  customer: { id: string; name: string; phone: string };
  vehicle: { model: string; variant: string; colour: string; vin: string; motorNumber: string; batteryNumber: string };
  listPrice: string;
  discount: string;
  /** The taxable value: listPrice − discount. */
  sellingPrice: string;
  /** Percent, e.g. 5 or 2.5. */
  gstRate: number;
  supplyType: RtoSupplyType;
  cgst: string;
  sgst: string;
  igst: string;
  gstAmount: string;
  total: string;
  hsnCode: string | null;
  policyNumber: string | null;
  /** 'YYYY-MM-DD', or null when none was recorded. */
  deliveryDate: string | null;
  revision: number;
  createdBy: string | null;
  createdAt: string;
  updatedBy: string | null;
  updatedAt: string;
}

/** One HSN code the RTO invoice can print. */
export interface RtoHsnOption {
  id: string;
  code: string;
  name: string;
}

/** What the generate form starts from for a booking. */
export interface RtoInvoiceDefaults {
  /** The scooter's list price (paise) — the list price the form starts from. */
  listPrice: string;
  /** The company's tax percentage when set, otherwise 5. */
  gstRate: number;
  supplyType: RtoSupplyType;
  /** Why that supply type was suggested, in words. */
  supplyTypeHint: string;
  /** The booking's insurance policy number, when recorded. */
  policyNumber: string | null;
  /** The booking's delivery date ('YYYY-MM-DD'): when delivered, else the expected date, else null. */
  deliveryDate: string | null;
  /** Where deliveryDate came from: the recorded handover, the expected date, or nothing yet. */
  deliveryDateSource: 'DELIVERED' | 'EXPECTED' | null;
  /** Active HSN codes from GST Management, for the HSN picker. */
  hsnOptions: RtoHsnOption[];
  /** The vehicle model's HSN classification when it is one of hsnOptions; otherwise null. */
  taxClassificationId: string | null;
  /** The booking's RTO invoice when it already has one (a booking has at most one). */
  existing: { id: string; invoiceNumber: string } | null;
}
