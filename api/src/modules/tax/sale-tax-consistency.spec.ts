import { CLASS, everyComponent, taxDocument, vehicleOnly } from '../../../test/support/gst-invoice-fixture';
import type { SaleTaxDocument } from './sale-tax-document';
import { SUPPORTED_TAX_ENGINE_VERSIONS, SaleTaxConsistencyCode, SaleTaxConsistencyError, assertSaleTaxDocumentConsistent } from './sale-tax-consistency';

/**
 * The shared validator behind the GST invoice and the GST credit note. The detailed per-check cases
 * live with the invoice builder (gst-invoice-document.spec.ts) and still run through this code; here
 * the contract itself is pinned: what it returns, what it throws, and that it never changes its input.
 */
const failsWith = (fn: () => unknown, code: SaleTaxConsistencyCode): void => {
  let caught: unknown;
  try { fn(); } catch (e) { caught = e; }
  expect(caught).toBeInstanceOf(SaleTaxConsistencyError);
  expect((caught as SaleTaxConsistencyError).code).toBe(code);
};
const vehicle = { key: 'vehicle', componentType: 'VEHICLE' as const, description: 'TESTBRAND VX Pro (Red)', classification: CLASS.vehicle, unitAmount: 1_050_000n, amount: 1_000_000n };

describe('assertSaleTaxDocumentConsistent', () => {
  it('accepts a genuine snapshot and returns the stored adjustments split by treatment', () => {
    expect(assertSaleTaxDocumentConsistent(vehicleOnly())).toEqual({ beforeTax: 0n, afterTax: 0n });
    expect(assertSaleTaxDocumentConsistent(everyComponent({ supplyType: 'INTER' }))).toEqual({ beforeTax: 0n, afterTax: 0n });
    expect(assertSaleTaxDocumentConsistent(taxDocument({ lines: [vehicle], discount: { amount: 50_000n, treatment: 'REDUCES_VEHICLE_TAXABLE_VALUE' }, exchange: { amount: 20_000n, treatment: 'AFTER_TAX_ADJUSTMENT' } }))).toEqual({ beforeTax: 50_000n, afterTax: 20_000n });
  });

  it('only engine version 1 is readable; anything else is refused before any other check', () => {
    expect(SUPPORTED_TAX_ENGINE_VERSIONS).toEqual(['1']);
    failsWith(() => assertSaleTaxDocumentConsistent(vehicleOnly({ engineVersion: '2' })), SaleTaxConsistencyCode.UNSUPPORTED_ENGINE_VERSION);
    failsWith(() => assertSaleTaxDocumentConsistent({ ...vehicleOnly({ engineVersion: '99' }), lines: [] }), SaleTaxConsistencyCode.UNSUPPORTED_ENGINE_VERSION);
  });

  it.each<[SaleTaxConsistencyCode, (t: SaleTaxDocument) => void]>([
    [SaleTaxConsistencyCode.INVOICE_IDENTITY_MISSING, (t) => { t.invoiceNumber = null; }],
    [SaleTaxConsistencyCode.SUPPLY_DETAILS_INVALID, (t) => { t.supplierStateCode = 'GJ'; }],
    [SaleTaxConsistencyCode.NO_LINES, (t) => { t.lines = []; t.totals = { ...t.totals, totalGross: 0n }; }],
    [SaleTaxConsistencyCode.LINE_ORDER_INVALID, (t) => { t.lines = [...t.lines].reverse(); }],
    [SaleTaxConsistencyCode.LINE_FIELDS_INVALID, (t) => { t.lines[0]!.ratePercent = null; }],
    [SaleTaxConsistencyCode.LINE_NOT_RECONCILED, (t) => { t.lines[0]!.taxableAmount += 1n; }],
    [SaleTaxConsistencyCode.SUPPLY_TYPE_MISMATCH, (t) => { const l = t.lines[0]!; l.igst = l.cgst + l.sgst + l.roundOff; l.cgst = 0n; l.sgst = 0n; l.roundOff = 0n; }],
    [SaleTaxConsistencyCode.TOTALS_NOT_RECONCILED, (t) => { t.totals = { ...t.totals, totalTax: t.totals.totalTax + 1n }; }],
    [SaleTaxConsistencyCode.ADJUSTMENT_INVALID, (t) => { t.discount = { amount: 1n, treatment: null }; }],
    [SaleTaxConsistencyCode.ADJUSTMENT_NOT_RECONCILED, (t) => { t.discount = { amount: 50_000n, treatment: 'REDUCES_VEHICLE_TAXABLE_VALUE' }; }],
    [SaleTaxConsistencyCode.DOCUMENT_TOTAL_NOT_RECONCILED, (t) => { t.documentTotal += 1n; }],
  ])('%s is detected', (code, mutate) => {
    const tax = everyComponent();
    mutate(tax);
    failsWith(() => assertSaleTaxDocumentConsistent(tax), code);
  });

  it('never alters the record it checks, whether it passes or fails', () => {
    const ok = everyComponent();
    const okCopy = JSON.parse(JSON.stringify(ok, (_k, v) => (typeof v === 'bigint' ? `${v}n` : v)));
    assertSaleTaxDocumentConsistent(ok);
    expect(JSON.parse(JSON.stringify(ok, (_k, v) => (typeof v === 'bigint' ? `${v}n` : v)))).toEqual(okCopy);

    const bad = everyComponent();
    bad.documentTotal += 1n;
    expect(() => assertSaleTaxDocumentConsistent(bad)).toThrow(SaleTaxConsistencyError);
    expect(bad.documentTotal).toBe(1_358_001n);
    expect(bad.totals.totalTax).toBe(everyComponent().totals.totalTax);
  });
});
