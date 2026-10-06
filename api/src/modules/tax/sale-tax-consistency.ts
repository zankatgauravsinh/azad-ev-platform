import type { SaleTaxDocument } from './sale-tax-document';

/**
 * Consistency checks for a sale's stored GST record (the D1 read model). Pure — no database, no Nest,
 * no calculation. The ONE place every consumer of a snapshot (the tax invoice, the credit note of a
 * return, …) decides whether the stored figures can be trusted.
 *
 * It only READS: it confirms the relationships the snapshot was written with still hold between the
 * stored values. It never corrects, rounds or re-derives a figure. Anything that does not add up is
 * refused with a coded error, and the caller must then refuse its own operation.
 */

/** Snapshot engine versions whose stored figures the consumers know how to present and reverse. */
export const SUPPORTED_TAX_ENGINE_VERSIONS: readonly string[] = ['1'];

export const SaleTaxConsistencyCode = {
  UNSUPPORTED_ENGINE_VERSION: 'UNSUPPORTED_ENGINE_VERSION',
  INVOICE_IDENTITY_MISSING: 'INVOICE_IDENTITY_MISSING',
  SUPPLY_DETAILS_INVALID: 'SUPPLY_DETAILS_INVALID',
  NO_LINES: 'NO_LINES',
  LINE_ORDER_INVALID: 'LINE_ORDER_INVALID',
  LINE_FIELDS_INVALID: 'LINE_FIELDS_INVALID',
  LINE_NOT_RECONCILED: 'LINE_NOT_RECONCILED',
  SUPPLY_TYPE_MISMATCH: 'SUPPLY_TYPE_MISMATCH',
  TOTALS_NOT_RECONCILED: 'TOTALS_NOT_RECONCILED',
  ADJUSTMENT_INVALID: 'ADJUSTMENT_INVALID',
  ADJUSTMENT_NOT_RECONCILED: 'ADJUSTMENT_NOT_RECONCILED',
  DOCUMENT_TOTAL_NOT_RECONCILED: 'DOCUMENT_TOTAL_NOT_RECONCILED',
} as const;
export type SaleTaxConsistencyCode = (typeof SaleTaxConsistencyCode)[keyof typeof SaleTaxConsistencyCode];

/** The stored GST record does not add up. Nothing was changed. */
export class SaleTaxConsistencyError extends Error {
  constructor(
    readonly code: SaleTaxConsistencyCode,
    message: string,
    readonly lineKey?: string,
  ) {
    super(message);
    this.name = 'SaleTaxConsistencyError';
  }
}

/** The stored discount / exchange amounts, split by how the snapshot says they were applied. */
export interface StoredAdjustments {
  /** Already taken off the vehicle line's value before tax. */
  beforeTax: bigint;
  /** Reduce only the amount payable: totalGross − afterTax = documentTotal. */
  afterTax: bigint;
}

const STATE_CODE = /^\d{2}$/;

function fail(code: SaleTaxConsistencyCode, message: string, lineKey?: string): never {
  throw new SaleTaxConsistencyError(code, message, lineKey);
}

function splitAdjustments(tax: SaleTaxDocument): StoredAdjustments {
  let beforeTax = 0n;
  let afterTax = 0n;
  for (const [name, adj] of [['discount', tax.discount], ['exchange', tax.exchange]] as const) {
    if (adj.amount < 0n) fail(SaleTaxConsistencyCode.ADJUSTMENT_INVALID, `the stored ${name} amount is negative`);
    if (adj.amount === 0n) {
      if (adj.treatment !== null) fail(SaleTaxConsistencyCode.ADJUSTMENT_INVALID, `a ${name} treatment is stored without a ${name} amount`);
      continue;
    }
    if (adj.treatment === 'REDUCES_VEHICLE_TAXABLE_VALUE') beforeTax += adj.amount;
    else if (adj.treatment === 'AFTER_TAX_ADJUSTMENT') afterTax += adj.amount;
    else fail(SaleTaxConsistencyCode.ADJUSTMENT_INVALID, `a ${name} amount is stored without its treatment`);
  }
  return { beforeTax, afterTax };
}

/**
 * Checks that the stored record is complete and adds up, using only the relationships the snapshot was
 * written with. Returns the stored adjustments split by treatment (useful to consumers, never changed).
 *
 * @throws SaleTaxConsistencyError on the first failing check.
 */
export function assertSaleTaxDocumentConsistent(tax: SaleTaxDocument): StoredAdjustments {
  if (!SUPPORTED_TAX_ENGINE_VERSIONS.includes(tax.engineVersion)) {
    fail(SaleTaxConsistencyCode.UNSUPPORTED_ENGINE_VERSION, `the GST record was written by tax engine version "${tax.engineVersion}", which this release does not know how to read`);
  }
  if (!tax.invoiceNumber || !tax.invoicedAt) fail(SaleTaxConsistencyCode.INVOICE_IDENTITY_MISSING, 'the sale has no invoice number or invoice date');
  if (!tax.supplierGstin.trim()) fail(SaleTaxConsistencyCode.SUPPLY_DETAILS_INVALID, 'the stored supplier GSTIN is empty');
  if (!STATE_CODE.test(tax.supplierStateCode) || !STATE_CODE.test(tax.placeOfSupplyStateCode)) fail(SaleTaxConsistencyCode.SUPPLY_DETAILS_INVALID, 'a stored state code is not two digits');
  if (tax.supplyType !== 'INTRA' && tax.supplyType !== 'INTER') fail(SaleTaxConsistencyCode.SUPPLY_DETAILS_INVALID, 'the stored supply type is not recognised');
  if (tax.lines.length === 0) fail(SaleTaxConsistencyCode.NO_LINES, 'the GST record has no lines');

  const adjustments = splitAdjustments(tax);

  const positions = new Set<number>();
  const keys = new Set<string>();
  const sum = { gross: 0n, taxable: 0n, cgst: 0n, sgst: 0n, igst: 0n, tax: 0n, roundOff: 0n };
  let offVehicle = 0n;
  let previous = 0;
  for (const l of tax.lines) {
    if (!Number.isInteger(l.position) || l.position < 1 || positions.has(l.position) || keys.has(l.lineKey)) fail(SaleTaxConsistencyCode.LINE_ORDER_INVALID, 'line positions are not unique', l.lineKey);
    if (l.position < previous) fail(SaleTaxConsistencyCode.LINE_ORDER_INVALID, 'lines are not in position order', l.lineKey);
    previous = l.position;
    positions.add(l.position);
    keys.add(l.lineKey);

    if (!Number.isInteger(l.quantity) || l.quantity < 1) fail(SaleTaxConsistencyCode.LINE_FIELDS_INVALID, 'a line quantity is not a positive whole number', l.lineKey);
    if (l.unitAmount < 0n || l.grossAmount < 0n || l.taxableAmount < 0n || l.taxTotal < 0n || l.cgst < 0n || l.sgst < 0n || l.igst < 0n) fail(SaleTaxConsistencyCode.LINE_FIELDS_INVALID, 'a line carries a negative amount', l.lineKey);

    if (l.treatment === 'TAXABLE') {
      if (l.ratePercent === null) fail(SaleTaxConsistencyCode.LINE_FIELDS_INVALID, 'a taxable line has no stored rate', l.lineKey);
      if (!l.code?.trim()) fail(SaleTaxConsistencyCode.LINE_FIELDS_INVALID, 'a taxable line has no stored HSN / SAC code', l.lineKey);
    } else if (l.treatment === 'EXEMPT' || l.treatment === 'NIL_RATED' || l.treatment === 'NON_TAXABLE') {
      if (l.ratePercent !== null) fail(SaleTaxConsistencyCode.LINE_FIELDS_INVALID, 'a line that carries no GST has a stored rate', l.lineKey);
      if (l.taxTotal !== 0n || l.cgst !== 0n || l.sgst !== 0n || l.igst !== 0n || l.roundOff !== 0n) fail(SaleTaxConsistencyCode.LINE_FIELDS_INVALID, 'a line that carries no GST has a stored tax amount', l.lineKey);
    } else {
      fail(SaleTaxConsistencyCode.LINE_FIELDS_INVALID, 'a line has an unrecognised treatment', l.lineKey);
    }

    // The snapshot's own definitions: value + tax = line total; the tax heads + round-off = tax.
    if (l.taxableAmount + l.taxTotal !== l.grossAmount) fail(SaleTaxConsistencyCode.LINE_NOT_RECONCILED, 'a line value and its tax do not add up to the line total', l.lineKey);
    if (l.cgst + l.sgst + l.igst + l.roundOff !== l.taxTotal) fail(SaleTaxConsistencyCode.LINE_NOT_RECONCILED, "a line's CGST / SGST / IGST and round-off do not add up to its tax", l.lineKey);

    if (tax.supplyType === 'INTRA' && l.igst !== 0n) fail(SaleTaxConsistencyCode.SUPPLY_TYPE_MISMATCH, 'an intra-state record carries IGST', l.lineKey);
    if (tax.supplyType === 'INTER' && (l.cgst !== 0n || l.sgst !== 0n)) fail(SaleTaxConsistencyCode.SUPPLY_TYPE_MISMATCH, 'an inter-state record carries CGST / SGST', l.lineKey);

    // Only the vehicle line may sit below its unit amount — by the discount / exchange taken before tax.
    const below = l.unitAmount * BigInt(l.quantity) - l.grossAmount;
    if (l.componentType === 'VEHICLE') offVehicle += below;
    else if (below !== 0n) fail(SaleTaxConsistencyCode.LINE_NOT_RECONCILED, 'a line total does not equal its quantity × unit amount', l.lineKey);

    sum.gross += l.grossAmount;
    sum.taxable += l.taxableAmount;
    sum.cgst += l.cgst;
    sum.sgst += l.sgst;
    sum.igst += l.igst;
    sum.tax += l.taxTotal;
    sum.roundOff += l.roundOff;
  }
  if (offVehicle !== adjustments.beforeTax) fail(SaleTaxConsistencyCode.ADJUSTMENT_NOT_RECONCILED, 'the discount / exchange stored as reducing the vehicle value does not match the vehicle line');

  const t = tax.totals;
  if (sum.gross !== t.totalGross || sum.taxable !== t.totalTaxable || sum.cgst !== t.totalCGST || sum.sgst !== t.totalSGST || sum.igst !== t.totalIGST || sum.tax !== t.totalTax || sum.roundOff !== t.totalRoundOff) {
    fail(SaleTaxConsistencyCode.TOTALS_NOT_RECONCILED, 'the stored totals are not the sum of the stored lines');
  }
  if (tax.documentTotal < 0n || t.totalGross - adjustments.afterTax !== tax.documentTotal) {
    fail(SaleTaxConsistencyCode.DOCUMENT_TOTAL_NOT_RECONCILED, 'the stored document total does not match the stored lines and adjustments');
  }
  return adjustments;
}
