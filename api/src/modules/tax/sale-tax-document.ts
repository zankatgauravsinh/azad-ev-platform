import type { GstAdjustmentTreatment, Prisma, TaxCodeType, TaxLineComponent, TaxPricingMode, TaxSupplyType, TaxTreatment } from '@prisma/client';
import { toCalendarDate, type CalendarDate } from './tax-calendar';
import type { TaxTotals } from './tax.types';

/**
 * The GST read model of an issued sale — what a document (tax invoice, report, …) is allowed to know
 * about that sale's tax. It is a plain copy of the immutable TaxSnapshot written at invoice time:
 * every tax figure here is a STORED value. Nothing is calculated, re-derived or looked up from current
 * configuration, so changing rates, classifications, mappings, policies or the company / customer GST
 * details afterwards can never alter it.
 *
 * Money is integer paise (bigint), exactly as stored.
 *
 * Only two values change REPRESENTATION (not meaning) on the way out:
 *  - `taxPoint`     the stored calendar date (a DATE column) as 'YYYY-MM-DD';
 *  - `ratePercent`  the stored DECIMAL(5,2) as a fixed two-decimal string ('5.00'), matching the engine.
 * No other field is derived. In particular a line's total is its stored `grossAmount` (the GST-inclusive
 * amount of the line) — there is no separate "line total" figure.
 */
export interface SaleTaxDocumentLine {
  position: number;
  lineKey: string;
  componentType: TaxLineComponent;
  description: string;
  /** Identifier of the originating record when there is one (e.g. the accessory id). Not a relation. */
  sourceId: string | null;
  quantity: number;
  /** The commercial amount per unit, before any pre-tax adjustment. */
  unitAmount: bigint;
  /** The classification as it was at invoice time (copied values, not the current master data). */
  classificationId: string;
  classificationName: string;
  codeType: TaxCodeType;
  code: string | null;
  treatment: TaxTreatment;
  /** Null for exempt / nil-rated / non-taxable lines. */
  ratePercent: string | null;
  pricingMode: TaxPricingMode;
  /** The GST-inclusive amount of the line — the line total. */
  grossAmount: bigint;
  taxableAmount: bigint;
  cgst: bigint;
  sgst: bigint;
  igst: bigint;
  taxTotal: bigint;
  roundOff: bigint;
}

export interface SaleTaxDocument {
  // ── Document identity (from the Sale; not tax figures) ──
  saleId: string;
  bookingId: string | null;
  invoiceNumber: string | null;
  invoicedAt: Date | null;

  // ── Frozen GST header ──
  snapshotId: string;
  /** When the snapshot was written. */
  recordedAt: Date;
  engineVersion: string;
  /** The tax-point calendar date the rates were resolved for. */
  taxPoint: CalendarDate;
  supplyType: TaxSupplyType;
  supplierGstin: string;
  supplierStateCode: string;
  placeOfSupplyStateCode: string;
  /** The treatment is null when the sale carried no such amount. */
  discount: { amount: bigint; treatment: GstAdjustmentTreatment | null };
  exchange: { amount: bigint; treatment: GstAdjustmentTreatment | null };
  totals: TaxTotals;
  /** The customer-facing total the snapshot reconciles to — equal to the sale total. */
  documentTotal: bigint;

  /** Ordered by `position`. */
  lines: SaleTaxDocumentLine[];
}

export interface SaleIdentityRow {
  id: string;
  bookingId: string | null;
  invoiceNumber: string | null;
  invoicedAt: Date | null;
}

export type TaxSnapshotWithLines = Prisma.TaxSnapshotGetPayload<{ include: { lines: true } }>;

/** Copies a stored snapshot into the read model. Pure — no database, no calculation. */
export function toSaleTaxDocument(sale: SaleIdentityRow, snapshot: TaxSnapshotWithLines): SaleTaxDocument {
  return {
    saleId: sale.id,
    bookingId: sale.bookingId,
    invoiceNumber: sale.invoiceNumber,
    invoicedAt: sale.invoicedAt,
    snapshotId: snapshot.id,
    recordedAt: snapshot.createdAt,
    engineVersion: snapshot.engineVersion,
    taxPoint: toCalendarDate(snapshot.asOf),
    supplyType: snapshot.supplyType,
    supplierGstin: snapshot.supplierGstin,
    supplierStateCode: snapshot.supplierStateCode,
    placeOfSupplyStateCode: snapshot.placeOfSupplyStateCode,
    discount: { amount: snapshot.discountAmount, treatment: snapshot.discountTreatment },
    exchange: { amount: snapshot.exchangeAmount, treatment: snapshot.exchangeTreatment },
    totals: {
      totalGross: snapshot.totalGross,
      totalTaxable: snapshot.totalTaxable,
      totalCGST: snapshot.totalCGST,
      totalSGST: snapshot.totalSGST,
      totalIGST: snapshot.totalIGST,
      totalTax: snapshot.totalTax,
      totalRoundOff: snapshot.totalRoundOff,
    },
    documentTotal: snapshot.documentTotal,
    // The query already orders by position; sorting a copy keeps the contract independent of the caller.
    lines: [...snapshot.lines]
      .sort((a, b) => a.position - b.position)
      .map((l) => ({
        position: l.position,
        lineKey: l.lineKey,
        componentType: l.componentType,
        description: l.description,
        sourceId: l.sourceId,
        quantity: l.quantity,
        unitAmount: l.unitAmount,
        classificationId: l.classificationId,
        classificationName: l.classificationName,
        codeType: l.codeType,
        code: l.code,
        treatment: l.treatment,
        ratePercent: l.ratePercent === null ? null : l.ratePercent.toFixed(2),
        pricingMode: l.pricingMode,
        grossAmount: l.grossAmount,
        taxableAmount: l.taxableAmount,
        cgst: l.cgst,
        sgst: l.sgst,
        igst: l.igst,
        taxTotal: l.taxTotal,
        roundOff: l.roundOff,
      })),
  };
}
