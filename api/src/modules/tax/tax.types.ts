import type { TaxCodeType, TaxTreatment } from '@azad/shared';
import type { CalendarDate } from './tax-calendar';

/**
 * Tax engine contracts. Server-side only — there is one authoritative implementation of the tax
 * mathematics, in this module. All money is integer paise (bigint); all results are deterministic.
 */

/** Immutable marker stored with every calculation so a later algorithm change never reinterprets old results. */
export const TAX_ENGINE_VERSION = '1';

export const SupplyType = { INTRA: 'INTRA', INTER: 'INTER' } as const;
export type SupplyType = (typeof SupplyType)[keyof typeof SupplyType];

export const PricingMode = { INCLUSIVE: 'INCLUSIVE', EXCLUSIVE: 'EXCLUSIVE' } as const;
export type PricingMode = (typeof PricingMode)[keyof typeof PricingMode];

// ── Request ────────────────────────────────────────────────
export interface TaxLineInput {
  /** Caller-chosen identifier, unique within the request; echoed on the result line. */
  key: string;
  classificationId: string;
  /** Integer paise. INCLUSIVE: the gross (tax-inclusive) amount. EXCLUSIVE: the pre-tax amount. */
  amount: bigint | number;
  pricingMode: PricingMode;
}

export interface TaxCalculationRequest {
  /**
   * The tax-point CALENDAR DATE ('YYYY-MM-DD') in the company's business calendar. The engine does not
   * decide which event sets it (invoice, delivery, …) — the caller supplies it.
   */
  asOf: CalendarDate;
  /** INTRA (CGST + SGST) or INTER (IGST). Always explicit — never inferred by the engine. */
  supplyType: SupplyType;
  lines: TaxLineInput[];
}

// ── Rate resolution ────────────────────────────────────────
export interface ResolvedTaxRate {
  classificationId: string;
  classificationName: string;
  codeType: TaxCodeType;
  code: string | null;
  treatment: TaxTreatment;
  /** Canonical 2-decimal percent (e.g. "5.00") for TAXABLE; null for every other treatment (no rate applies). */
  ratePercent: string | null;
}

/** A request line joined with its resolved classification/rate — the input to the pure math. */
export interface ResolvedTaxLine extends ResolvedTaxRate {
  key: string;
  amount: bigint | number;
  pricingMode: PricingMode;
}

// ── Result ─────────────────────────────────────────────────
export interface TaxAmounts {
  grossAmount: bigint;
  /**
   * grossAmount − taxTotal. For a TAXABLE line this is the taxable value. For EXEMPT / NIL_RATED /
   * NON_TAXABLE lines it is simply the line value and carries NO reporting meaning by itself — use
   * `treatment` to decide how such a line is reported.
   */
  taxableAmount: bigint;
  cgst: bigint;
  sgst: bigint;
  igst: bigint;
  /** Always grossAmount − taxableAmount. */
  taxTotal: bigint;
  /** taxTotal − cgst − sgst − igst. Non-zero only for INTRA lines whose tax does not split evenly. */
  roundOff: bigint;
}

export interface TaxLineResult extends TaxAmounts {
  key: string;
  classificationId: string;
  classificationName: string;
  codeType: TaxCodeType;
  code: string | null;
  treatment: TaxTreatment;
  ratePercent: string | null;
  pricingMode: PricingMode;
}

export interface TaxTotals {
  totalGross: bigint;
  totalTaxable: bigint;
  totalCGST: bigint;
  totalSGST: bigint;
  totalIGST: bigint;
  totalTax: bigint;
  totalRoundOff: bigint;
}

/** Line results summed per (treatment, rate). */
export interface TaxRateSummaryRow extends TaxAmounts {
  treatment: TaxTreatment;
  ratePercent: string | null;
  lineCount: number;
}

export interface TaxDocumentResult {
  lines: TaxLineResult[];
  /** Sums of the line results — never recomputed from document-level amounts. */
  totals: TaxTotals;
  rateSummary: TaxRateSummaryRow[];
  supplyType: SupplyType;
  asOf: CalendarDate;
  engineVersion: string;
}
