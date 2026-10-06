import { formatInrExact } from '../../common/utils/money';
import type { SaleTaxDocument, SaleTaxDocumentLine } from '../tax/sale-tax-document';

/**
 * The GST tax invoice as a plain, serializable document — exactly what the PDF prints, already worded
 * and formatted. Pure: no PDFKit, no Prisma, no Nest, no database, and NO TAX CALCULATION.
 *
 *   TaxSnapshot → SaleTaxSnapshotReader → SaleTaxDocument → buildGstInvoiceDocument() → GST invoice PDF
 *
 * TWO KINDS OF DATA, deliberately kept apart:
 *
 *  1. Tax and supply data — IMMUTABLE. Every figure, rate, HSN/SAC code, treatment, the supplier GSTIN,
 *     the state codes, the supply type, the discount / exchange amounts and the line order come from the
 *     sale's stored snapshot (`tax`). They are copied and formatted, never recomputed and never looked
 *     up from current configuration, so an invoice re-printed years later carries the same tax.
 *
 *  2. Identity — LIVE, for now. The customer's name and address, the company's names and address and
 *     the vehicle's model / VIN / motor / battery numbers are read from the current records (`identity`).
 *     Editing them changes what a re-printed invoice shows. Freezing them is a separate, undecided step.
 *
 * The stored figures are CHECKED for internal consistency before anything is printed (see assert*).
 * A snapshot that does not add up is refused — it is never corrected, rounded or "fixed" here.
 *
 * Wording is neutral and provisional ("Discount", "Exchange adjustment", the treatment names): the
 * legally preferred labels are a CA decision and can be revised without touching any figure.
 */

/** Snapshot engine versions whose stored figures this document knows how to present. */
export const SUPPORTED_TAX_ENGINE_VERSIONS: readonly string[] = ['1'];

export const GstInvoiceErrorCode = {
  NO_TAX_SNAPSHOT: 'NO_TAX_SNAPSHOT',
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
export type GstInvoiceErrorCode = (typeof GstInvoiceErrorCode)[keyof typeof GstInvoiceErrorCode];

/** The stored GST record cannot be presented as an invoice. Nothing was changed; nothing is printed. */
export class GstInvoiceDocumentError extends Error {
  constructor(
    readonly code: GstInvoiceErrorCode,
    message: string,
    readonly lineKey?: string,
  ) {
    super(message);
    this.name = 'GstInvoiceDocumentError';
  }
}

// ── Input: live identity ───────────────────────────────────
export interface GstInvoiceIdentity {
  supplier: {
    /** The trading name on the letterhead (CompanySetting.businessName). */
    name: string;
    /** CompanySetting.legalName — printed under the same label the Settings screen uses; not a tax claim. */
    legalName: string | null;
    addressLines: string[];
  };
  customer: { name: string; phone: string | null; address: string | null; city: string | null; state: string | null; pin: string | null };
  vehicle: { model: string; variant: string; colour: string; vin: string; motorNumber: string | null; batteryNumber: string | null };
  /** The company's time zone — only for printing the invoice date as the company's calendar date. */
  timeZone: string;
}

// ── Output: the document ───────────────────────────────────
export type GstTaxColumn = 'CGST' | 'SGST' | 'IGST';

export interface GstInvoiceAdjustment {
  /** 'Discount' | 'Exchange adjustment' — neutral, provisional wording. */
  label: string;
  /** The stored treatment, in words. */
  note: string;
  /** The stored amount, shown as a deduction. */
  amount: string;
}

export interface GstInvoiceLine {
  position: number;
  description: string;
  /** 'HSN: 8711' / 'SAC: 9987', or null when the line carries no code. */
  code: string | null;
  treatment: SaleTaxDocumentLine['treatment'];
  /** The stored combined rate ('5.00%') for a taxable line; otherwise the treatment in words. */
  rateLabel: string;
  quantity: string;
  unitAmount: string;
  /** The stored value of the line before GST (the taxable value, for a taxable line). */
  value: string;
  /** Stored tax amounts; '-' on a line that carries no GST. */
  cgst: string;
  sgst: string;
  igst: string;
  /** The stored GST-inclusive amount of the line. */
  lineTotal: string;
  /** Deductions already reflected in this line's stored value (a discount / exchange applied before tax). */
  adjustments: GstInvoiceAdjustment[];
}

export interface GstInvoiceTotalRow {
  key: 'value' | 'cgst' | 'sgst' | 'igst' | 'roundOff' | 'linesTotal' | 'discount' | 'exchange';
  label: string;
  amount: string;
}

export interface GstInvoiceSummaryRow {
  /** The stored combined rate, or the treatment in words. */
  label: string;
  lineCount: number;
  value: string;
  cgst: string;
  sgst: string;
  igst: string;
  tax: string;
}

export interface GstInvoiceDocument {
  title: 'TAX INVOICE';
  invoiceNumber: string;
  /** The invoice date as the company's calendar date. */
  invoiceDate: string;
  supplier: { name: string; legalName: string | null; addressLines: string[]; gstin: string; stateCode: string };
  customer: { name: string; phone: string | null; addressLines: string[] };
  supply: { placeOfSupplyStateCode: string; supplyType: SaleTaxDocument['supplyType']; supplyTypeLabel: string };
  vehicle: { model: string; variant: string; colour: string; vin: string; motorNumber: string | null; batteryNumber: string | null };
  /** The tax columns this invoice carries — decided by the stored supply type alone. */
  taxColumns: GstTaxColumn[];
  /** In stored position order — never regrouped or re-sorted. */
  lines: GstInvoiceLine[];
  /** The rows above the grand total, in print order. */
  totals: GstInvoiceTotalRow[];
  /** The stored document total — equal to the sale total the customer agreed. */
  grandTotal: string;
  /** Stored line figures added up per rate / treatment. Sums only — no rate is applied here. */
  summary: GstInvoiceSummaryRow[];
}

// ── Wording (provisional — see the file comment) ───────────
const TREATMENT_LABEL: Record<SaleTaxDocumentLine['treatment'], string> = {
  TAXABLE: 'Taxable',
  EXEMPT: 'Exempt',
  NIL_RATED: 'Nil rated',
  NON_TAXABLE: 'Non-taxable',
};
const ADJUSTMENT_NOTE = {
  REDUCES_VEHICLE_TAXABLE_VALUE: 'reduces vehicle taxable value',
  AFTER_TAX_ADJUSTMENT: 'after-tax adjustment',
} as const;
const SUPPLY_TYPE_LABEL: Record<SaleTaxDocument['supplyType'], string> = { INTRA: 'Intra-state', INTER: 'Inter-state' };
export const NO_TAX_MARK = '-';

// ── Formatting (presentation only) ─────────────────────────
const plain = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Paise as a plain two-decimal figure ('9,523.81') for table cells. */
export const formatPaiseAmount = (paise: bigint): string => plain.format(Number(paise) / 100);
const deduction = (formatted: string): string => `− ${formatted}`;

const STATE_CODE = /^\d{2}$/;

function fail(code: GstInvoiceErrorCode, message: string, lineKey?: string): never {
  throw new GstInvoiceDocumentError(code, message, lineKey);
}

/** Amounts that reduce only what is payable, and amounts already taken off the vehicle's value. */
function splitAdjustments(tax: SaleTaxDocument): { beforeTax: bigint; afterTax: bigint } {
  let beforeTax = 0n;
  let afterTax = 0n;
  for (const [name, adj] of [['discount', tax.discount], ['exchange', tax.exchange]] as const) {
    if (adj.amount < 0n) fail(GstInvoiceErrorCode.ADJUSTMENT_INVALID, `the stored ${name} amount is negative`);
    if (adj.amount === 0n) {
      if (adj.treatment !== null) fail(GstInvoiceErrorCode.ADJUSTMENT_INVALID, `a ${name} treatment is stored without a ${name} amount`);
      continue;
    }
    if (adj.treatment === 'REDUCES_VEHICLE_TAXABLE_VALUE') beforeTax += adj.amount;
    else if (adj.treatment === 'AFTER_TAX_ADJUSTMENT') afterTax += adj.amount;
    else fail(GstInvoiceErrorCode.ADJUSTMENT_INVALID, `a ${name} amount is stored without its treatment`);
  }
  return { beforeTax, afterTax };
}

/**
 * Checks that the stored record is complete and adds up, using only the relationships the snapshot was
 * written with. It reads; it never changes a value. Any failure refuses the whole document.
 */
function assertConsistent(tax: SaleTaxDocument): { beforeTax: bigint; afterTax: bigint } {
  if (!SUPPORTED_TAX_ENGINE_VERSIONS.includes(tax.engineVersion)) {
    fail(GstInvoiceErrorCode.UNSUPPORTED_ENGINE_VERSION, `the GST record was written by tax engine version "${tax.engineVersion}", which this invoice does not know how to present`);
  }
  if (!tax.invoiceNumber || !tax.invoicedAt) fail(GstInvoiceErrorCode.INVOICE_IDENTITY_MISSING, 'the sale has no invoice number or invoice date');
  if (!tax.supplierGstin.trim()) fail(GstInvoiceErrorCode.SUPPLY_DETAILS_INVALID, 'the stored supplier GSTIN is empty');
  if (!STATE_CODE.test(tax.supplierStateCode) || !STATE_CODE.test(tax.placeOfSupplyStateCode)) fail(GstInvoiceErrorCode.SUPPLY_DETAILS_INVALID, 'a stored state code is not two digits');
  if (tax.supplyType !== 'INTRA' && tax.supplyType !== 'INTER') fail(GstInvoiceErrorCode.SUPPLY_DETAILS_INVALID, 'the stored supply type is not recognised');
  if (tax.lines.length === 0) fail(GstInvoiceErrorCode.NO_LINES, 'the GST record has no lines');

  const { beforeTax, afterTax } = splitAdjustments(tax);

  const positions = new Set<number>();
  const keys = new Set<string>();
  const sum = { gross: 0n, taxable: 0n, cgst: 0n, sgst: 0n, igst: 0n, tax: 0n, roundOff: 0n };
  let offVehicle = 0n;
  let previous = 0;
  for (const l of tax.lines) {
    if (!Number.isInteger(l.position) || l.position < 1 || positions.has(l.position) || keys.has(l.lineKey)) fail(GstInvoiceErrorCode.LINE_ORDER_INVALID, 'line positions are not unique', l.lineKey);
    if (l.position < previous) fail(GstInvoiceErrorCode.LINE_ORDER_INVALID, 'lines are not in position order', l.lineKey);
    previous = l.position;
    positions.add(l.position);
    keys.add(l.lineKey);

    if (!Number.isInteger(l.quantity) || l.quantity < 1) fail(GstInvoiceErrorCode.LINE_FIELDS_INVALID, 'a line quantity is not a positive whole number', l.lineKey);
    if (l.unitAmount < 0n || l.grossAmount < 0n || l.taxableAmount < 0n || l.taxTotal < 0n || l.cgst < 0n || l.sgst < 0n || l.igst < 0n) fail(GstInvoiceErrorCode.LINE_FIELDS_INVALID, 'a line carries a negative amount', l.lineKey);

    if (l.treatment === 'TAXABLE') {
      if (l.ratePercent === null) fail(GstInvoiceErrorCode.LINE_FIELDS_INVALID, 'a taxable line has no stored rate', l.lineKey);
      if (!l.code?.trim()) fail(GstInvoiceErrorCode.LINE_FIELDS_INVALID, 'a taxable line has no stored HSN / SAC code', l.lineKey);
    } else if (l.treatment === 'EXEMPT' || l.treatment === 'NIL_RATED' || l.treatment === 'NON_TAXABLE') {
      if (l.ratePercent !== null) fail(GstInvoiceErrorCode.LINE_FIELDS_INVALID, 'a line that carries no GST has a stored rate', l.lineKey);
      if (l.taxTotal !== 0n || l.cgst !== 0n || l.sgst !== 0n || l.igst !== 0n || l.roundOff !== 0n) fail(GstInvoiceErrorCode.LINE_FIELDS_INVALID, 'a line that carries no GST has a stored tax amount', l.lineKey);
    } else {
      fail(GstInvoiceErrorCode.LINE_FIELDS_INVALID, 'a line has an unrecognised treatment', l.lineKey);
    }

    // The snapshot's own definitions: value + tax = line total; the tax heads + round-off = tax.
    if (l.taxableAmount + l.taxTotal !== l.grossAmount) fail(GstInvoiceErrorCode.LINE_NOT_RECONCILED, 'a line value and its tax do not add up to the line total', l.lineKey);
    if (l.cgst + l.sgst + l.igst + l.roundOff !== l.taxTotal) fail(GstInvoiceErrorCode.LINE_NOT_RECONCILED, 'a line\'s CGST / SGST / IGST and round-off do not add up to its tax', l.lineKey);

    if (tax.supplyType === 'INTRA' && l.igst !== 0n) fail(GstInvoiceErrorCode.SUPPLY_TYPE_MISMATCH, 'an intra-state invoice carries IGST', l.lineKey);
    if (tax.supplyType === 'INTER' && (l.cgst !== 0n || l.sgst !== 0n)) fail(GstInvoiceErrorCode.SUPPLY_TYPE_MISMATCH, 'an inter-state invoice carries CGST / SGST', l.lineKey);

    // Only the vehicle line may sit below its unit amount — by the discount / exchange taken before tax.
    const below = l.unitAmount * BigInt(l.quantity) - l.grossAmount;
    if (l.componentType === 'VEHICLE') offVehicle += below;
    else if (below !== 0n) fail(GstInvoiceErrorCode.LINE_NOT_RECONCILED, 'a line total does not equal its quantity × unit amount', l.lineKey);

    sum.gross += l.grossAmount;
    sum.taxable += l.taxableAmount;
    sum.cgst += l.cgst;
    sum.sgst += l.sgst;
    sum.igst += l.igst;
    sum.tax += l.taxTotal;
    sum.roundOff += l.roundOff;
  }
  if (offVehicle !== beforeTax) fail(GstInvoiceErrorCode.ADJUSTMENT_NOT_RECONCILED, 'the discount / exchange stored as reducing the vehicle value does not match the vehicle line');

  const t = tax.totals;
  if (sum.gross !== t.totalGross || sum.taxable !== t.totalTaxable || sum.cgst !== t.totalCGST || sum.sgst !== t.totalSGST || sum.igst !== t.totalIGST || sum.tax !== t.totalTax || sum.roundOff !== t.totalRoundOff) {
    fail(GstInvoiceErrorCode.TOTALS_NOT_RECONCILED, 'the stored totals are not the sum of the stored lines');
  }
  if (tax.documentTotal < 0n || t.totalGross - afterTax !== tax.documentTotal) {
    fail(GstInvoiceErrorCode.DOCUMENT_TOTAL_NOT_RECONCILED, 'the stored document total does not match the stored lines and adjustments');
  }
  return { beforeTax, afterTax };
}

function adjustmentsWith(tax: SaleTaxDocument, treatment: keyof typeof ADJUSTMENT_NOTE, format: (paise: bigint) => string): (GstInvoiceAdjustment & { key: 'discount' | 'exchange' })[] {
  const rows: (GstInvoiceAdjustment & { key: 'discount' | 'exchange' })[] = [];
  if (tax.discount.amount > 0n && tax.discount.treatment === treatment) rows.push({ key: 'discount', label: 'Discount', note: ADJUSTMENT_NOTE[treatment], amount: deduction(format(tax.discount.amount)) });
  if (tax.exchange.amount > 0n && tax.exchange.treatment === treatment) rows.push({ key: 'exchange', label: 'Exchange adjustment', note: ADJUSTMENT_NOTE[treatment], amount: deduction(format(tax.exchange.amount)) });
  return rows;
}

const taxCell = (line: SaleTaxDocumentLine, amount: bigint): string => (line.treatment === 'TAXABLE' ? formatPaiseAmount(amount) : NO_TAX_MARK);
const rateLabel = (treatment: SaleTaxDocumentLine['treatment'], ratePercent: string | null): string => (treatment === 'TAXABLE' ? `${ratePercent}%` : TREATMENT_LABEL[treatment]);

/** Adds up stored line figures per (treatment, rate), in order of first appearance. Sums only. */
function summarise(lines: readonly SaleTaxDocumentLine[]): GstInvoiceSummaryRow[] {
  const groups = new Map<string, { line: SaleTaxDocumentLine; count: number; value: bigint; cgst: bigint; sgst: bigint; igst: bigint; tax: bigint }>();
  for (const l of lines) {
    const key = `${l.treatment}|${l.ratePercent ?? ''}`;
    const g = groups.get(key) ?? { line: l, count: 0, value: 0n, cgst: 0n, sgst: 0n, igst: 0n, tax: 0n };
    g.count += 1;
    g.value += l.taxableAmount;
    g.cgst += l.cgst;
    g.sgst += l.sgst;
    g.igst += l.igst;
    g.tax += l.taxTotal;
    groups.set(key, g);
  }
  return [...groups.values()].map((g) => ({
    label: rateLabel(g.line.treatment, g.line.ratePercent),
    lineCount: g.count,
    value: formatPaiseAmount(g.value),
    cgst: taxCell(g.line, g.cgst),
    sgst: taxCell(g.line, g.sgst),
    igst: taxCell(g.line, g.igst),
    tax: taxCell(g.line, g.tax),
  }));
}

/**
 * Builds the GST tax invoice of a sale from its stored snapshot. Only a sale WITH a snapshot has one:
 * passing none is refused — such a sale keeps the existing (non-GST) invoice.
 *
 * @throws GstInvoiceDocumentError when there is no snapshot or the stored record does not add up.
 */
export function buildGstInvoiceDocument(tax: SaleTaxDocument | null | undefined, identity: GstInvoiceIdentity): GstInvoiceDocument {
  if (!tax) fail(GstInvoiceErrorCode.NO_TAX_SNAPSHOT, 'the sale has no GST snapshot — it has no GST invoice');
  const { afterTax } = assertConsistent(tax);

  const intra = tax.supplyType === 'INTRA';
  const beforeTaxAdjustments = adjustmentsWith(tax, 'REDUCES_VEHICLE_TAXABLE_VALUE', formatPaiseAmount).map(({ label, note, amount }) => ({ label, note, amount }));
  const vehicleLine = tax.lines.find((l) => l.componentType === 'VEHICLE');

  const lines: GstInvoiceLine[] = tax.lines.map((l) => ({
    position: l.position,
    description: l.description,
    code: l.code?.trim() ? `${l.codeType}: ${l.code.trim()}` : null,
    treatment: l.treatment,
    rateLabel: rateLabel(l.treatment, l.ratePercent),
    quantity: String(l.quantity),
    unitAmount: formatPaiseAmount(l.unitAmount),
    value: formatPaiseAmount(l.taxableAmount),
    cgst: taxCell(l, l.cgst),
    sgst: taxCell(l, l.sgst),
    igst: taxCell(l, l.igst),
    lineTotal: formatPaiseAmount(l.grossAmount),
    adjustments: l === vehicleLine ? beforeTaxAdjustments : [],
  }));

  // A bare "Taxable value" would overstate the GST base when some lines carry no GST.
  const allTaxable = tax.lines.every((l) => l.treatment === 'TAXABLE');
  const totals: GstInvoiceTotalRow[] = [{ key: 'value', label: allTaxable ? 'Taxable value' : 'Value before GST (taxable lines and lines without GST)', amount: formatInrExact(tax.totals.totalTaxable) }];
  if (intra) {
    totals.push({ key: 'cgst', label: 'CGST', amount: formatInrExact(tax.totals.totalCGST) });
    totals.push({ key: 'sgst', label: 'SGST', amount: formatInrExact(tax.totals.totalSGST) });
  } else {
    totals.push({ key: 'igst', label: 'IGST', amount: formatInrExact(tax.totals.totalIGST) });
  }
  totals.push({ key: 'roundOff', label: 'Round-off', amount: formatInrExact(tax.totals.totalRoundOff) });
  if (afterTax > 0n) {
    totals.push({ key: 'linesTotal', label: 'Total', amount: formatInrExact(tax.totals.totalGross) });
    for (const a of adjustmentsWith(tax, 'AFTER_TAX_ADJUSTMENT', formatInrExact)) totals.push({ key: a.key, label: `${a.label} (${a.note})`, amount: a.amount });
  }

  const c = identity.customer;
  const cityLine = [c.city, c.state, c.pin].map((v) => v?.trim()).filter(Boolean).join(', ');
  const legalName = identity.supplier.legalName?.trim() || null;

  return {
    title: 'TAX INVOICE',
    invoiceNumber: tax.invoiceNumber!,
    invoiceDate: tax.invoicedAt!.toLocaleDateString('en-IN', { timeZone: identity.timeZone }),
    supplier: {
      name: identity.supplier.name,
      legalName: legalName && legalName !== identity.supplier.name.trim() ? legalName : null,
      addressLines: identity.supplier.addressLines.filter((l) => l.trim()),
      gstin: tax.supplierGstin,
      stateCode: tax.supplierStateCode,
    },
    customer: { name: c.name, phone: c.phone?.trim() || null, addressLines: [c.address?.trim() ?? '', cityLine].filter(Boolean) },
    supply: { placeOfSupplyStateCode: tax.placeOfSupplyStateCode, supplyType: tax.supplyType, supplyTypeLabel: SUPPLY_TYPE_LABEL[tax.supplyType] },
    vehicle: { ...identity.vehicle },
    taxColumns: intra ? ['CGST', 'SGST'] : ['IGST'],
    lines,
    totals,
    grandTotal: formatInrExact(tax.documentTotal),
    summary: summarise(tax.lines),
  };
}
