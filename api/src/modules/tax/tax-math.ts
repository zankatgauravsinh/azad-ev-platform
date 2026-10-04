import { TaxTreatment } from '@azad/shared';
import { isCalendarDate, type CalendarDate } from './tax-calendar';
import { TaxEngineError, TaxEngineErrorCode } from './tax.errors';
import {
  PricingMode,
  SupplyType,
  TAX_ENGINE_VERSION,
  type ResolvedTaxLine,
  type TaxAmounts,
  type TaxDocumentResult,
  type TaxLineResult,
  type TaxRateSummaryRow,
  type TaxTotals,
} from './tax.types';

/**
 * Pure GST mathematics — no database, no Nest, no I/O, no floating point. Money is integer paise
 * (bigint); rates are integer basis points (5.00% = 500). Every function is deterministic.
 *
 * This layer knows nothing about vehicles, accessories, bookings or invoices, and encodes no rate,
 * HSN/SAC or treatment decision — those arrive as input.
 */

const BASIS_POINTS_PER_UNIT = 10000n; // 100% = 10000 basis points
const MAX_BASIS_POINTS = 10000;
const RATE_PERCENT = /^(\d{1,3})(?:\.(\d{1,2}))?$/;

// ── Validation / conversion ────────────────────────────────

/**
 * "5.00" → 500. Parses the decimal STRING digit-by-digit (never through a float). Accepts 0–100 with at
 * most two decimal places; anything else is INVALID_RATE.
 */
export function toBasisPoints(ratePercent: string): number {
  const match = typeof ratePercent === 'string' ? RATE_PERCENT.exec(ratePercent) : null;
  if (!match) throw new TaxEngineError(TaxEngineErrorCode.INVALID_RATE, `Invalid tax rate "${String(ratePercent)}" — expected 0–100 with at most 2 decimal places`);
  const whole = BigInt(match[1]!);
  const fraction = BigInt((match[2] ?? '').padEnd(2, '0'));
  const basisPoints = Number(whole * 100n + fraction);
  if (basisPoints > MAX_BASIS_POINTS) throw new TaxEngineError(TaxEngineErrorCode.INVALID_RATE, `Tax rate "${ratePercent}" exceeds 100%`);
  return basisPoints;
}

/** 500 → "5.00" — the canonical 2-decimal form used in results. */
export function basisPointsToPercent(basisPoints: number): string {
  assertBasisPoints(basisPoints);
  return `${Math.trunc(basisPoints / 100)}.${String(basisPoints % 100).padStart(2, '0')}`;
}

function assertBasisPoints(basisPoints: number): void {
  if (!Number.isInteger(basisPoints) || basisPoints < 0 || basisPoints > MAX_BASIS_POINTS) {
    throw new TaxEngineError(TaxEngineErrorCode.INVALID_RATE, `Invalid basis points ${String(basisPoints)} — expected an integer 0–${MAX_BASIS_POINTS}`);
  }
}

/**
 * Validates an amount as non-negative integer paise. Accepts a bigint, or a number only when it is a
 * safe integer; everything else (fractions, NaN, unsafe magnitudes, strings, negatives) is INVALID_AMOUNT.
 */
export function toPaise(value: unknown): bigint {
  let paise: bigint;
  if (typeof value === 'bigint') paise = value;
  else if (typeof value === 'number' && Number.isSafeInteger(value)) paise = BigInt(value);
  else throw new TaxEngineError(TaxEngineErrorCode.INVALID_AMOUNT, 'Amount must be integer paise');
  if (paise < 0n) throw new TaxEngineError(TaxEngineErrorCode.INVALID_AMOUNT, 'Amount cannot be negative');
  return paise;
}

// ── Rounding (the ONLY place rounding happens) ─────────────

/**
 * numerator ÷ denominator rounded half-up to the nearest integer, for non-negative values:
 * a fraction below one half rounds down, one half or more rounds up. Paise precision only — no
 * whole-rupee rounding is applied anywhere in the engine.
 */
export function roundHalfUpDiv(numerator: bigint, denominator: bigint): bigint {
  if (numerator < 0n || denominator <= 0n) throw new TaxEngineError(TaxEngineErrorCode.INVALID_AMOUNT, 'Rounding requires a non-negative numerator and a positive denominator');
  return (2n * numerator + denominator) / (2n * denominator);
}

// ── Core calculations ──────────────────────────────────────

/**
 * Splits a tax-INCLUSIVE gross into taxable value + tax:
 *   taxable = roundHalfUp(gross × 10000 / (10000 + bp)),  tax = gross − taxable.
 * Tax is derived by subtraction, so taxable + tax === gross always — the gross never changes.
 */
export function extractInclusive(gross: bigint, basisPoints: number): { taxable: bigint; tax: bigint } {
  const g = toPaise(gross);
  assertBasisPoints(basisPoints);
  const taxable = roundHalfUpDiv(g * BASIS_POINTS_PER_UNIT, BASIS_POINTS_PER_UNIT + BigInt(basisPoints));
  return { taxable, tax: g - taxable };
}

/** Adds tax on top of a tax-EXCLUSIVE taxable value: tax = roundHalfUp(taxable × bp / 10000), gross = taxable + tax. */
export function addExclusive(taxable: bigint, basisPoints: number): { tax: bigint; gross: bigint } {
  const t = toPaise(taxable);
  assertBasisPoints(basisPoints);
  const tax = roundHalfUpDiv(t * BigInt(basisPoints), BASIS_POINTS_PER_UNIT);
  return { tax, gross: t + tax };
}

/**
 * Splits a line's tax into its components for the supply type. THE single place the CGST/SGST/IGST
 * convention lives — change it here (only) if the CA confirms a different convention.
 *
 *  INTER: igst = tax.
 *  INTRA: cgst = sgst = roundHalfUp(taxable × halfRate), computed independently from the taxable value
 *         so the two heads are always equal; roundOff = tax − cgst − sgst absorbs any odd paisa, keeping
 *         cgst + sgst + roundOff === tax. For any rate below 100% the round-off is within ±1 paisa.
 */
export function splitTax(taxable: bigint, tax: bigint, basisPoints: number, supplyType: SupplyType): Pick<TaxAmounts, 'cgst' | 'sgst' | 'igst' | 'roundOff'> {
  assertBasisPoints(basisPoints);
  if (supplyType === SupplyType.INTER) return { cgst: 0n, sgst: 0n, igst: tax, roundOff: 0n };
  if (supplyType === SupplyType.INTRA) {
    const head = roundHalfUpDiv(taxable * BigInt(basisPoints), 2n * BASIS_POINTS_PER_UNIT);
    return { cgst: head, sgst: head, igst: 0n, roundOff: tax - head - head };
  }
  throw new TaxEngineError(TaxEngineErrorCode.MISSING_SUPPLY_CONTEXT, 'supplyType must be INTRA or INTER');
}

function assertSupplyType(supplyType: unknown): asserts supplyType is SupplyType {
  if (supplyType !== SupplyType.INTRA && supplyType !== SupplyType.INTER) {
    throw new TaxEngineError(TaxEngineErrorCode.MISSING_SUPPLY_CONTEXT, 'supplyType must be INTRA or INTER');
  }
}

/** Calculates one resolved line. Any failure is attributed to the line's key. */
export function computeLine(line: ResolvedTaxLine, supplyType: SupplyType): TaxLineResult {
  try {
    assertSupplyType(supplyType);
    const amount = toPaise(line.amount);
    if (line.pricingMode !== PricingMode.INCLUSIVE && line.pricingMode !== PricingMode.EXCLUSIVE) {
      throw new TaxEngineError(TaxEngineErrorCode.INVALID_REQUEST, 'pricingMode must be INCLUSIVE or EXCLUSIVE');
    }
    const identity = {
      key: line.key,
      classificationId: line.classificationId,
      classificationName: line.classificationName,
      codeType: line.codeType,
      code: line.code,
      treatment: line.treatment,
      pricingMode: line.pricingMode,
    };

    if (line.treatment === TaxTreatment.TAXABLE) {
      if (line.code === null || line.code.trim() === '') {
        throw new TaxEngineError(TaxEngineErrorCode.TAXABLE_WITHOUT_CODE, `Taxable classification "${line.classificationName}" has no HSN/SAC code`);
      }
      if (line.ratePercent === null) throw new TaxEngineError(TaxEngineErrorCode.INVALID_RATE, 'A taxable line needs a rate');
      const basisPoints = toBasisPoints(line.ratePercent);
      let grossAmount: bigint;
      let taxableAmount: bigint;
      let taxTotal: bigint;
      if (line.pricingMode === PricingMode.INCLUSIVE) {
        const r = extractInclusive(amount, basisPoints);
        grossAmount = amount;
        taxableAmount = r.taxable;
        taxTotal = r.tax;
      } else {
        const r = addExclusive(amount, basisPoints);
        grossAmount = r.gross;
        taxableAmount = amount;
        taxTotal = r.tax;
      }
      return { ...identity, ratePercent: basisPointsToPercent(basisPoints), grossAmount, taxableAmount, taxTotal, ...splitTax(taxableAmount, taxTotal, basisPoints, supplyType) };
    }

    if (line.treatment === TaxTreatment.EXEMPT || line.treatment === TaxTreatment.NIL_RATED || line.treatment === TaxTreatment.NON_TAXABLE) {
      // No GST. The treatment is preserved on the result; how each is REPORTED is decided elsewhere.
      return { ...identity, ratePercent: null, grossAmount: amount, taxableAmount: amount, taxTotal: 0n, cgst: 0n, sgst: 0n, igst: 0n, roundOff: 0n };
    }

    throw new TaxEngineError(TaxEngineErrorCode.INVALID_REQUEST, `Unknown tax treatment "${String(line.treatment)}"`);
  } catch (e) {
    throw e instanceof TaxEngineError ? e.forLine(line.key) : e;
  }
}

const TREATMENT_ORDER: readonly TaxTreatment[] = [TaxTreatment.TAXABLE, TaxTreatment.EXEMPT, TaxTreatment.NIL_RATED, TaxTreatment.NON_TAXABLE];

const zeroAmounts = (): TaxAmounts => ({ grossAmount: 0n, taxableAmount: 0n, cgst: 0n, sgst: 0n, igst: 0n, taxTotal: 0n, roundOff: 0n });

function addInto(target: TaxAmounts, line: TaxAmounts): void {
  target.grossAmount += line.grossAmount;
  target.taxableAmount += line.taxableAmount;
  target.cgst += line.cgst;
  target.sgst += line.sgst;
  target.igst += line.igst;
  target.taxTotal += line.taxTotal;
  target.roundOff += line.roundOff;
}

/** Validates the document-level shape shared by the pure layer and the engine service. */
export function assertDocumentShape(lines: readonly { key: string }[], ctx: { supplyType: SupplyType; asOf: CalendarDate }): void {
  assertSupplyType(ctx.supplyType);
  if (!isCalendarDate(ctx.asOf)) throw new TaxEngineError(TaxEngineErrorCode.INVALID_REQUEST, "asOf must be a calendar date in 'YYYY-MM-DD' form");
  if (!Array.isArray(lines) || lines.length === 0) throw new TaxEngineError(TaxEngineErrorCode.INVALID_REQUEST, 'At least one line is required');
  const seen = new Set<string>();
  for (const line of lines) {
    if (typeof line?.key !== 'string' || line.key.trim() === '') throw new TaxEngineError(TaxEngineErrorCode.INVALID_REQUEST, 'Every line needs a non-empty key');
    if (seen.has(line.key)) throw new TaxEngineError(TaxEngineErrorCode.INVALID_REQUEST, `Duplicate line key "${line.key}"`, line.key);
    seen.add(line.key);
  }
}

/**
 * Calculates a whole document from resolved lines. All-or-nothing: any line failure throws and no
 * partial result is produced. Totals and the rate summary are SUMS OF THE LINE RESULTS — tax is never
 * recomputed from document-level amounts.
 */
export function computeDocument(lines: readonly ResolvedTaxLine[], ctx: { supplyType: SupplyType; asOf: CalendarDate }): TaxDocumentResult {
  assertDocumentShape(lines, ctx);
  const results = lines.map((line) => computeLine(line, ctx.supplyType));

  const sum = zeroAmounts();
  const groups = new Map<string, TaxRateSummaryRow>();
  for (const r of results) {
    addInto(sum, r);
    const groupKey = `${r.treatment}|${r.ratePercent ?? ''}`;
    let row = groups.get(groupKey);
    if (!row) {
      row = { treatment: r.treatment, ratePercent: r.ratePercent, lineCount: 0, ...zeroAmounts() };
      groups.set(groupKey, row);
    }
    row.lineCount += 1;
    addInto(row, r);
  }

  // Deterministic order: by treatment, then ascending rate.
  const rateSummary = [...groups.values()].sort((a, b) => {
    const byTreatment = TREATMENT_ORDER.indexOf(a.treatment) - TREATMENT_ORDER.indexOf(b.treatment);
    if (byTreatment !== 0) return byTreatment;
    return (a.ratePercent === null ? -1 : toBasisPoints(a.ratePercent)) - (b.ratePercent === null ? -1 : toBasisPoints(b.ratePercent));
  });

  const totals: TaxTotals = {
    totalGross: sum.grossAmount,
    totalTaxable: sum.taxableAmount,
    totalCGST: sum.cgst,
    totalSGST: sum.sgst,
    totalIGST: sum.igst,
    totalTax: sum.taxTotal,
    totalRoundOff: sum.roundOff,
  };

  return { lines: results, totals, rateSummary, supplyType: ctx.supplyType, asOf: ctx.asOf, engineVersion: TAX_ENGINE_VERSION };
}
