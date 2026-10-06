import type { GstInvoiceIdentity } from '../../src/modules/sales/gst-invoice-document';
import type { SaleTaxDocument, SaleTaxDocumentLine } from '../../src/modules/tax/sale-tax-document';
import { computeDocument } from '../../src/modules/tax/tax-math';
import { PricingMode, type ResolvedTaxLine, type SupplyType } from '../../src/modules/tax/tax.types';

/**
 * Test-only builders for the GST invoice. Every classification, code and rate here is a PLACEHOLDER —
 * not a real HSN/SAC value, approved GST rate or CA-confirmed treatment.
 */

export interface FixtureClassification {
  name: string;
  codeType: 'HSN' | 'SAC';
  code: string | null;
  treatment: SaleTaxDocumentLine['treatment'];
  ratePercent: string | null;
}
export const CLASS = {
  vehicle: { name: 'Test vehicle class', codeType: 'HSN', code: 'TEST-VEH', treatment: 'TAXABLE', ratePercent: '5.00' },
  accessory5: { name: 'Test accessory 5', codeType: 'HSN', code: 'TEST-ACC5', treatment: 'TAXABLE', ratePercent: '5.00' },
  accessory18: { name: 'Test accessory 18', codeType: 'HSN', code: 'TEST-ACC18', treatment: 'TAXABLE', ratePercent: '18.00' },
  warranty: { name: 'Test warranty service', codeType: 'SAC', code: 'TEST-WTY', treatment: 'TAXABLE', ratePercent: '12.00' },
  rto: { name: 'Test RTO', codeType: 'SAC', code: null, treatment: 'NON_TAXABLE', ratePercent: null },
  insurance: { name: 'Test insurance', codeType: 'SAC', code: null, treatment: 'EXEMPT', ratePercent: null },
  registration: { name: 'Test registration', codeType: 'SAC', code: null, treatment: 'NIL_RATED', ratePercent: null },
} satisfies Record<string, FixtureClassification>;

export interface FixtureLine {
  key: string;
  componentType: SaleTaxDocumentLine['componentType'];
  description: string;
  classification: FixtureClassification;
  unitAmount: bigint;
  quantity?: number;
  /** The GST-inclusive amount handed to the math (defaults to unitAmount × quantity). */
  amount?: bigint;
  sourceId?: string | null;
}

export interface FixtureOptions {
  supplyType?: SupplyType;
  lines: FixtureLine[];
  discount?: SaleTaxDocument['discount'];
  exchange?: SaleTaxDocument['exchange'];
  invoiceNumber?: string | null;
  invoicedAt?: Date | null;
  supplierGstin?: string;
  supplierStateCode?: string;
  placeOfSupplyStateCode?: string;
  engineVersion?: string;
}

/**
 * A SaleTaxDocument whose figures are genuine engine output (the pure math of Stage B) assembled the way
 * Stage C stores them — so the builder is tested against exactly what a real snapshot holds.
 */
export function taxDocument(opts: FixtureOptions): SaleTaxDocument {
  const supplyType = opts.supplyType ?? 'INTRA';
  const discount = opts.discount ?? { amount: 0n, treatment: null };
  const exchange = opts.exchange ?? { amount: 0n, treatment: null };
  const resolved: ResolvedTaxLine[] = opts.lines.map((l) => ({
    key: l.key,
    classificationId: `cls-${l.classification.name}`,
    classificationName: l.classification.name,
    codeType: l.classification.codeType,
    code: l.classification.code,
    treatment: l.classification.treatment,
    ratePercent: l.classification.ratePercent,
    amount: l.amount ?? l.unitAmount * BigInt(l.quantity ?? 1),
    pricingMode: PricingMode.INCLUSIVE,
  }));
  const result = computeDocument(resolved, { supplyType, asOf: '2026-07-01' });
  const afterTax = (discount.treatment === 'AFTER_TAX_ADJUSTMENT' ? discount.amount : 0n) + (exchange.treatment === 'AFTER_TAX_ADJUSTMENT' ? exchange.amount : 0n);
  return {
    saleId: 'sale-1',
    bookingId: 'booking-1',
    invoiceNumber: opts.invoiceNumber === undefined ? 'TEST-INV0007' : opts.invoiceNumber,
    invoicedAt: opts.invoicedAt === undefined ? new Date('2026-06-30T19:00:00.000Z') : opts.invoicedAt, // 1 July 00:30 in India
    snapshotId: 'snap-1',
    recordedAt: new Date('2026-06-30T19:00:01.000Z'),
    engineVersion: opts.engineVersion ?? result.engineVersion,
    taxPoint: result.asOf,
    supplyType,
    supplierGstin: opts.supplierGstin ?? 'TEST-GSTIN-SUPPLIER',
    supplierStateCode: opts.supplierStateCode ?? '24',
    placeOfSupplyStateCode: opts.placeOfSupplyStateCode ?? (supplyType === 'INTRA' ? '24' : '27'),
    discount,
    exchange,
    totals: result.totals,
    documentTotal: result.totals.totalGross - afterTax,
    lines: result.lines.map((r, i) => {
      const l = opts.lines[i]!;
      return {
        position: i + 1,
        lineKey: l.key,
        componentType: l.componentType,
        description: l.description,
        sourceId: l.sourceId ?? null,
        quantity: l.quantity ?? 1,
        unitAmount: l.unitAmount,
        classificationId: r.classificationId,
        classificationName: r.classificationName,
        codeType: r.codeType,
        code: r.code,
        treatment: r.treatment,
        ratePercent: r.ratePercent,
        pricingMode: r.pricingMode,
        grossAmount: r.grossAmount,
        taxableAmount: r.taxableAmount,
        cgst: r.cgst,
        sgst: r.sgst,
        igst: r.igst,
        taxTotal: r.taxTotal,
        roundOff: r.roundOff,
      };
    }),
  };
}

/** The ₹10,000 vehicle at a placeholder 5% — the worked example of the specification. */
export const vehicleOnly = (over: Partial<FixtureOptions> = {}): SaleTaxDocument =>
  taxDocument({ lines: [{ key: 'vehicle', componentType: 'VEHICLE', description: 'TESTBRAND VX Pro (Red)', classification: CLASS.vehicle, unitAmount: 1_000_000n, sourceId: 'unit-1' }], ...over });

/** Every component Stage C can produce, with mixed rates and treatments. */
export const everyComponent = (over: Partial<FixtureOptions> = {}): SaleTaxDocument =>
  taxDocument({
    lines: [
      { key: 'vehicle', componentType: 'VEHICLE', description: 'TESTBRAND VX Pro (Red)', classification: CLASS.vehicle, unitAmount: 1_000_000n, sourceId: 'unit-1' },
      { key: 'accessory:r1', componentType: 'ACCESSORY', description: 'Test helmet', classification: CLASS.accessory5, unitAmount: 21_000n, quantity: 2, sourceId: 'acc-1' },
      { key: 'accessory:r2', componentType: 'ACCESSORY', description: 'Test charger', classification: CLASS.accessory18, unitAmount: 118_000n, sourceId: 'acc-2' },
      { key: 'extended-warranty', componentType: 'EXTENDED_WARRANTY', description: 'Extended warranty', classification: CLASS.warranty, unitAmount: 56_000n },
      { key: 'rto', componentType: 'RTO', description: 'RTO', classification: CLASS.rto, unitAmount: 85_000n },
      { key: 'insurance', componentType: 'INSURANCE', description: 'Insurance', classification: CLASS.insurance, unitAmount: 42_000n },
      { key: 'registration', componentType: 'REGISTRATION', description: 'Registration', classification: CLASS.registration, unitAmount: 15_000n },
    ],
    ...over,
  });

export const identity = (over: Partial<GstInvoiceIdentity> = {}): GstInvoiceIdentity => ({
  supplier: { name: 'AZAD EV POINT', legalName: 'Azad Enterprise', addressLines: ['12 Test Road', 'Una, Gujarat'] },
  customer: { name: 'Asha Patel', phone: '9876543210', address: '4 Lake View', city: 'Una', state: 'Gujarat', pin: '362560' },
  vehicle: { model: 'VX', variant: 'Pro', colour: 'Red', vin: 'TESTVIN0001', motorNumber: 'TESTMOTOR1', batteryNumber: 'TESTBATT1' },
  timeZone: 'Asia/Kolkata',
  ...over,
});
