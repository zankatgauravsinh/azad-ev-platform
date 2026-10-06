import { CLASS, everyComponent, identity, taxDocument, vehicleOnly } from '../../../test/support/gst-invoice-fixture';
import type { SaleTaxDocument } from '../tax/sale-tax-document';
import { GstInvoiceDocumentError, GstInvoiceErrorCode, buildGstInvoiceDocument } from './gst-invoice-document';

/**
 * The builder COPIES stored figures. Several tests below feed it stored values that a recalculating
 * builder would "correct" (a rate that does not match the figures, round-offs, deliberately odd but
 * self-consistent totals) and expect them printed exactly as stored.
 */
const build = (tax: SaleTaxDocument | null, over: Parameters<typeof identity>[0] = {}) => buildGstInvoiceDocument(tax, identity(over));
const failsWith = (fn: () => unknown, code: GstInvoiceErrorCode): void => {
  let caught: unknown;
  try { fn(); } catch (e) { caught = e; }
  expect(caught).toBeInstanceOf(GstInvoiceDocumentError);
  expect((caught as GstInvoiceDocumentError).code).toBe(code);
};
const line = (tax: SaleTaxDocument, key: string) => tax.lines.find((l) => l.lineKey === key)!;
const vehicleLine = { key: 'vehicle', componentType: 'VEHICLE' as const, description: 'TESTBRAND VX Pro (Red)', classification: CLASS.vehicle, unitAmount: 1_050_000n, amount: 1_000_000n, sourceId: 'unit-1' };

describe('buildGstInvoiceDocument — the ₹10,000 example', () => {
  it('prints the GST extracted from the stored inclusive amount; the total stays ₹10,000', () => {
    const doc = build(vehicleOnly());
    expect(doc.title).toBe('TAX INVOICE');
    expect(doc.lines).toHaveLength(1);
    expect(doc.lines[0]).toMatchObject({ position: 1, description: 'TESTBRAND VX Pro (Red)', code: 'HSN: TEST-VEH', treatment: 'TAXABLE', rateLabel: '5.00%', quantity: '1', unitAmount: '10,000.00', value: '9,523.81', cgst: '238.10', sgst: '238.10', igst: '0.00', lineTotal: '10,000.00', adjustments: [] });
    expect(doc.taxColumns).toEqual(['CGST', 'SGST']);
    expect(doc.totals).toEqual([
      { key: 'value', label: 'Taxable value', amount: '₹9,523.81' },
      { key: 'cgst', label: 'CGST', amount: '₹238.10' },
      { key: 'sgst', label: 'SGST', amount: '₹238.10' },
      { key: 'roundOff', label: 'Round-off', amount: '-₹0.01' },
    ]);
    expect(doc.grandTotal).toBe('₹10,000.00'); // never ₹10,500
    expect(doc.summary).toEqual([{ label: '5.00%', lineCount: 1, value: '9,523.81', cgst: '238.10', sgst: '238.10', igst: '0.00', tax: '476.19' }]);
  });

  it('is plain data — serialisable, no bigint, nothing from PDFKit or Prisma', () => {
    const doc = build(everyComponent());
    expect(() => JSON.stringify(doc)).not.toThrow();
    expect(JSON.parse(JSON.stringify(doc))).toEqual(doc);
  });
});

describe('supply type', () => {
  it('INTRA: CGST + SGST columns and totals, no IGST row', () => {
    const doc = build(vehicleOnly({ supplyType: 'INTRA' }));
    expect(doc.supply).toEqual({ placeOfSupplyStateCode: '24', supplyType: 'INTRA', supplyTypeLabel: 'Intra-state' });
    expect(doc.totals.map((t) => t.key)).toEqual(['value', 'cgst', 'sgst', 'roundOff']);
  });

  it('INTER: IGST column and total, stored amounts, no CGST/SGST rows', () => {
    const doc = build(vehicleOnly({ supplyType: 'INTER' }));
    expect(doc.supply).toEqual({ placeOfSupplyStateCode: '27', supplyType: 'INTER', supplyTypeLabel: 'Inter-state' });
    expect(doc.taxColumns).toEqual(['IGST']);
    expect(doc.lines[0]).toMatchObject({ value: '9,523.81', cgst: '0.00', sgst: '0.00', igst: '476.19', lineTotal: '10,000.00' });
    expect(doc.totals).toEqual([
      { key: 'value', label: 'Taxable value', amount: '₹9,523.81' },
      { key: 'igst', label: 'IGST', amount: '₹476.19' },
      { key: 'roundOff', label: 'Round-off', amount: '₹0.00' },
    ]);
    expect(doc.grandTotal).toBe('₹10,000.00');
  });

  it('follows the stored supply type, not the state codes', () => {
    // Stored as INTER although both codes are 24: the builder prints what is stored and infers nothing.
    const doc = build(vehicleOnly({ supplyType: 'INTER', placeOfSupplyStateCode: '24' }));
    expect(doc.taxColumns).toEqual(['IGST']);
    expect(doc.supply.supplyTypeLabel).toBe('Inter-state');
  });
});

describe('treatments', () => {
  const mixed = everyComponent();

  it.each([
    ['rto', 'Non-taxable', '850.00'],
    ['insurance', 'Exempt', '420.00'],
    ['registration', 'Nil rated', '150.00'],
  ])('%s line: treatment in words, no rate, dashes for tax, value = line total', (key, label, value) => {
    const doc = build(mixed);
    const l = doc.lines.find((x) => x.description === line(mixed, key).description)!;
    expect(l).toMatchObject({ rateLabel: label, code: null, cgst: '-', sgst: '-', igst: '-', value, lineTotal: value });
    expect(l.rateLabel).not.toMatch(/%/);
  });

  it('labels the value total so lines without GST are not presented as the taxable base', () => {
    expect(build(mixed).totals[0]).toEqual({ key: 'value', label: 'Value before GST (taxable lines and lines without GST)', amount: '₹12,843.81' });
    expect(build(vehicleOnly()).totals[0]!.label).toBe('Taxable value');
  });

  it('summarises stored line figures per rate / treatment, in order of first appearance, sums only', () => {
    expect(build(mixed).summary).toEqual([
      { label: '5.00%', lineCount: 2, value: '9,923.81', cgst: '248.10', sgst: '248.10', igst: '0.00', tax: '496.19' },
      { label: '18.00%', lineCount: 1, value: '1,000.00', cgst: '90.00', sgst: '90.00', igst: '0.00', tax: '180.00' },
      { label: '12.00%', lineCount: 1, value: '500.00', cgst: '30.00', sgst: '30.00', igst: '0.00', tax: '60.00' },
      { label: 'Non-taxable', lineCount: 1, value: '850.00', cgst: '-', sgst: '-', igst: '-', tax: '-' },
      { label: 'Exempt', lineCount: 1, value: '420.00', cgst: '-', sgst: '-', igst: '-', tax: '-' },
      { label: 'Nil rated', lineCount: 1, value: '150.00', cgst: '-', sgst: '-', igst: '-', tax: '-' },
    ]);
  });
});

describe('mixed rates and line order', () => {
  it('one row per stored line at its own rate, in stored position order — never regrouped', () => {
    const doc = build(everyComponent());
    expect(doc.lines.map((l) => [l.position, l.rateLabel, l.code])).toEqual([
      [1, '5.00%', 'HSN: TEST-VEH'],
      [2, '5.00%', 'HSN: TEST-ACC5'],
      [3, '18.00%', 'HSN: TEST-ACC18'],
      [4, '12.00%', 'SAC: TEST-WTY'],
      [5, 'Non-taxable', null],
      [6, 'Exempt', null],
      [7, 'Nil rated', null],
    ]);
    expect(doc.lines[1]).toMatchObject({ quantity: '2', unitAmount: '210.00', lineTotal: '420.00', value: '400.00', cgst: '10.00', sgst: '10.00' });
    expect(doc.grandTotal).toBe('₹13,580.00');
  });

  it('refuses lines that are not in position order or share a position', () => {
    const tax = everyComponent();
    failsWith(() => build({ ...tax, lines: [...tax.lines].reverse() }), GstInvoiceErrorCode.LINE_ORDER_INVALID);
    failsWith(() => build({ ...tax, lines: tax.lines.map((l, i) => ({ ...l, position: i < 2 ? 1 : l.position })) }), GstInvoiceErrorCode.LINE_ORDER_INVALID);
  });
});

describe('discount and exchange', () => {
  it('discount that reduces the vehicle taxable value: shown under the vehicle line, figures as stored', () => {
    const doc = build(taxDocument({ lines: [vehicleLine], discount: { amount: 50_000n, treatment: 'REDUCES_VEHICLE_TAXABLE_VALUE' } }));
    expect(doc.lines[0]).toMatchObject({ unitAmount: '10,500.00', value: '9,523.81', lineTotal: '10,000.00', adjustments: [{ label: 'Discount', note: 'reduces vehicle taxable value', amount: '− 500.00' }] });
    expect(doc.totals.map((t) => t.key)).toEqual(['value', 'cgst', 'sgst', 'roundOff']);
    expect(doc.grandTotal).toBe('₹10,000.00');
  });

  it('discount as an after-tax adjustment: lines untouched, shown between the total of lines and the grand total', () => {
    const doc = build(vehicleOnly({ discount: { amount: 50_000n, treatment: 'AFTER_TAX_ADJUSTMENT' } }));
    expect(doc.lines[0]).toMatchObject({ unitAmount: '10,000.00', value: '9,523.81', lineTotal: '10,000.00', adjustments: [] });
    expect(doc.totals.slice(-2)).toEqual([
      { key: 'linesTotal', label: 'Total', amount: '₹10,000.00' },
      { key: 'discount', label: 'Discount (after-tax adjustment)', amount: '− ₹500.00' },
    ]);
    expect(doc.grandTotal).toBe('₹9,500.00');
  });

  it('exchange that reduces the vehicle taxable value', () => {
    const doc = build(taxDocument({ lines: [{ ...vehicleLine, unitAmount: 1_200_000n }], exchange: { amount: 200_000n, treatment: 'REDUCES_VEHICLE_TAXABLE_VALUE' } }));
    expect(doc.lines[0]).toMatchObject({ unitAmount: '12,000.00', lineTotal: '10,000.00', adjustments: [{ label: 'Exchange adjustment', note: 'reduces vehicle taxable value', amount: '− 2,000.00' }] });
    expect(doc.grandTotal).toBe('₹10,000.00');
  });

  it('exchange as an after-tax adjustment', () => {
    const doc = build(vehicleOnly({ exchange: { amount: 200_000n, treatment: 'AFTER_TAX_ADJUSTMENT' } }));
    expect(doc.totals.slice(-2)).toEqual([
      { key: 'linesTotal', label: 'Total', amount: '₹10,000.00' },
      { key: 'exchange', label: 'Exchange adjustment (after-tax adjustment)', amount: '− ₹2,000.00' },
    ]);
    expect(doc.grandTotal).toBe('₹8,000.00');
  });

  it('both before tax: both rows under the vehicle line; both after tax: both rows in the totals; mixed: one each', () => {
    const both = build(taxDocument({ lines: [{ ...vehicleLine, unitAmount: 1_250_000n }], discount: { amount: 50_000n, treatment: 'REDUCES_VEHICLE_TAXABLE_VALUE' }, exchange: { amount: 200_000n, treatment: 'REDUCES_VEHICLE_TAXABLE_VALUE' } }));
    expect(both.lines[0]!.adjustments.map((a) => a.amount)).toEqual(['− 500.00', '− 2,000.00']);
    expect(both.grandTotal).toBe('₹10,000.00');

    const after = build(vehicleOnly({ discount: { amount: 50_000n, treatment: 'AFTER_TAX_ADJUSTMENT' }, exchange: { amount: 200_000n, treatment: 'AFTER_TAX_ADJUSTMENT' } }));
    expect(after.totals.slice(-3).map((t) => t.key)).toEqual(['linesTotal', 'discount', 'exchange']);
    expect(after.grandTotal).toBe('₹7,500.00');

    const mixed = build(taxDocument({ lines: [vehicleLine], discount: { amount: 50_000n, treatment: 'REDUCES_VEHICLE_TAXABLE_VALUE' }, exchange: { amount: 200_000n, treatment: 'AFTER_TAX_ADJUSTMENT' } }));
    expect(mixed.lines[0]!.adjustments).toHaveLength(1);
    expect(mixed.totals.slice(-1)[0]!.key).toBe('exchange');
    expect(mixed.grandTotal).toBe('₹8,000.00');
  });
});

describe('no recalculation', () => {
  it('prints a stored rate that does not match the stored figures rather than recomputing either', () => {
    // Figures extracted at a placeholder 12%, but the stored rate says 5.00%. Internally consistent, so
    // it is accepted — and printed exactly as stored. A recalculating builder would show 9,523.81.
    const tax = taxDocument({ lines: [{ ...vehicleLine, unitAmount: 1_000_000n, amount: 1_000_000n, classification: { ...CLASS.vehicle, ratePercent: '12.00' } }] });
    tax.lines[0]!.ratePercent = '5.00';
    const doc = build(tax);
    expect(doc.lines[0]).toMatchObject({ rateLabel: '5.00%', value: '8,928.57', cgst: '535.71', sgst: '535.71', lineTotal: '10,000.00' });
    expect(doc.totals).toEqual(expect.arrayContaining([{ key: 'roundOff', label: 'Round-off', amount: '₹0.01' }]));
    expect(doc.summary[0]).toMatchObject({ label: '5.00%', value: '8,928.57' });
  });

  it('prints the stored document total even when it differs from the lines by a stored after-tax adjustment', () => {
    const tax = vehicleOnly({ discount: { amount: 1n, treatment: 'AFTER_TAX_ADJUSTMENT' } });
    expect(build(tax).grandTotal).toBe('₹9,999.99');
  });
});

describe('consistency validation — refuses, never fixes', () => {
  const tamper = (mutate: (tax: SaleTaxDocument) => void, base: () => SaleTaxDocument = everyComponent): SaleTaxDocument => {
    const tax = base();
    mutate(tax);
    return tax;
  };

  it('missing snapshot → NO_TAX_SNAPSHOT (a sale without a snapshot has no GST invoice)', () => {
    failsWith(() => build(null), GstInvoiceErrorCode.NO_TAX_SNAPSHOT);
    failsWith(() => buildGstInvoiceDocument(undefined, identity()), GstInvoiceErrorCode.NO_TAX_SNAPSHOT);
  });

  it('unsupported engine version → refused, nothing recalculated', () => {
    failsWith(() => build(vehicleOnly({ engineVersion: '2' })), GstInvoiceErrorCode.UNSUPPORTED_ENGINE_VERSION);
    failsWith(() => build(vehicleOnly({ engineVersion: '' })), GstInvoiceErrorCode.UNSUPPORTED_ENGINE_VERSION);
  });

  it('missing invoice identity', () => {
    failsWith(() => build(vehicleOnly({ invoiceNumber: null })), GstInvoiceErrorCode.INVOICE_IDENTITY_MISSING);
    failsWith(() => build(vehicleOnly({ invoicedAt: null })), GstInvoiceErrorCode.INVOICE_IDENTITY_MISSING);
  });

  it('supply details', () => {
    failsWith(() => build(vehicleOnly({ supplierGstin: '  ' })), GstInvoiceErrorCode.SUPPLY_DETAILS_INVALID);
    failsWith(() => build(vehicleOnly({ supplierStateCode: 'GJ' })), GstInvoiceErrorCode.SUPPLY_DETAILS_INVALID);
    failsWith(() => build(vehicleOnly({ placeOfSupplyStateCode: '2' })), GstInvoiceErrorCode.SUPPLY_DETAILS_INVALID);
    failsWith(() => build(tamper((t) => { (t as { supplyType: string }).supplyType = 'UNION'; })), GstInvoiceErrorCode.SUPPLY_DETAILS_INVALID);
  });

  it('no lines', () => {
    failsWith(() => build(tamper((t) => { t.lines = []; t.totals = { ...t.totals, totalGross: 0n }; })), GstInvoiceErrorCode.NO_LINES);
  });

  it('line fields by treatment', () => {
    failsWith(() => build(tamper((t) => { line(t, 'vehicle').ratePercent = null; })), GstInvoiceErrorCode.LINE_FIELDS_INVALID);
    failsWith(() => build(tamper((t) => { line(t, 'vehicle').code = null; })), GstInvoiceErrorCode.LINE_FIELDS_INVALID);
    failsWith(() => build(tamper((t) => { line(t, 'rto').ratePercent = '0.00'; })), GstInvoiceErrorCode.LINE_FIELDS_INVALID);
    failsWith(() => build(tamper((t) => { const l = line(t, 'insurance'); l.cgst = 1n; l.taxTotal = 1n; })), GstInvoiceErrorCode.LINE_FIELDS_INVALID);
    failsWith(() => build(tamper((t) => { line(t, 'vehicle').quantity = 0; })), GstInvoiceErrorCode.LINE_FIELDS_INVALID);
    failsWith(() => build(tamper((t) => { line(t, 'vehicle').unitAmount = -1n; })), GstInvoiceErrorCode.LINE_FIELDS_INVALID);
    failsWith(() => build(tamper((t) => { (line(t, 'vehicle') as { treatment: string }).treatment = 'ZERO_RATED'; })), GstInvoiceErrorCode.LINE_FIELDS_INVALID);
  });

  it('line arithmetic as stored', () => {
    failsWith(() => build(tamper((t) => { line(t, 'vehicle').taxableAmount += 1n; })), GstInvoiceErrorCode.LINE_NOT_RECONCILED);
    failsWith(() => build(tamper((t) => { const l = line(t, 'vehicle'); l.cgst += 1n; l.sgst -= 1n; l.cgst += 1n; })), GstInvoiceErrorCode.LINE_NOT_RECONCILED);
    failsWith(() => build(tamper((t) => { line(t, 'accessory:r1').unitAmount = 20_000n; })), GstInvoiceErrorCode.LINE_NOT_RECONCILED);
  });

  it('supply type against the stored tax heads', () => {
    failsWith(() => build(tamper((t) => { const l = line(t, 'vehicle'); l.igst = l.cgst + l.sgst + l.roundOff; l.cgst = 0n; l.sgst = 0n; l.roundOff = 0n; }, () => vehicleOnly({ supplyType: 'INTRA' }))), GstInvoiceErrorCode.SUPPLY_TYPE_MISMATCH);
    failsWith(() => build(tamper((t) => { const l = line(t, 'vehicle'); l.cgst = l.igst; l.igst = 0n; }, () => vehicleOnly({ supplyType: 'INTER' }))), GstInvoiceErrorCode.SUPPLY_TYPE_MISMATCH);
  });

  it('totals must be the sum of the lines; the document total must match lines and adjustments', () => {
    failsWith(() => build(tamper((t) => { t.totals = { ...t.totals, totalCGST: t.totals.totalCGST + 1n }; })), GstInvoiceErrorCode.TOTALS_NOT_RECONCILED);
    failsWith(() => build(tamper((t) => { t.documentTotal += 1n; })), GstInvoiceErrorCode.DOCUMENT_TOTAL_NOT_RECONCILED);
    failsWith(() => build(tamper((t) => { t.documentTotal = -1n; })), GstInvoiceErrorCode.DOCUMENT_TOTAL_NOT_RECONCILED);
  });

  it('adjustments: amount without treatment, treatment without amount, negative, or not matching the vehicle line', () => {
    failsWith(() => build(vehicleOnly({ discount: { amount: 100n, treatment: null } })), GstInvoiceErrorCode.ADJUSTMENT_INVALID);
    failsWith(() => build(vehicleOnly({ exchange: { amount: 0n, treatment: 'AFTER_TAX_ADJUSTMENT' } })), GstInvoiceErrorCode.ADJUSTMENT_INVALID);
    failsWith(() => build(vehicleOnly({ discount: { amount: -5n, treatment: 'AFTER_TAX_ADJUSTMENT' } })), GstInvoiceErrorCode.ADJUSTMENT_INVALID);
    // Says "reduces vehicle taxable value" but the vehicle line was not reduced.
    failsWith(() => build(vehicleOnly({ discount: { amount: 50_000n, treatment: 'REDUCES_VEHICLE_TAXABLE_VALUE' } })), GstInvoiceErrorCode.ADJUSTMENT_NOT_RECONCILED);
    // The vehicle line is reduced but no adjustment explains it.
    failsWith(() => build(taxDocument({ lines: [vehicleLine] })), GstInvoiceErrorCode.ADJUSTMENT_NOT_RECONCILED);
  });

  it('a refused document is never partially produced', () => {
    const tax = everyComponent();
    tax.documentTotal += 1n;
    expect(() => build(tax)).toThrow(GstInvoiceDocumentError);
    expect(tax.documentTotal).toBe(1_358_001n); // input untouched: nothing was "fixed"
  });
});

describe('identity — live values, printed as given', () => {
  it('invoice date is the company calendar date of the invoice instant', () => {
    expect(build(vehicleOnly()).invoiceDate).toBe('1/7/2026'); // 19:00 UTC on 30 June = 1 July in India
    expect(build(vehicleOnly(), { timeZone: 'UTC' }).invoiceDate).toBe('30/6/2026');
  });

  it('supplier: letterhead name, legal name only when it differs, address, snapshot GSTIN and state code', () => {
    expect(build(vehicleOnly()).supplier).toEqual({ name: 'AZAD EV POINT', legalName: 'Azad Enterprise', addressLines: ['12 Test Road', 'Una, Gujarat'], gstin: 'TEST-GSTIN-SUPPLIER', stateCode: '24' });
    expect(build(vehicleOnly(), { supplier: { name: 'Same Co', legalName: 'Same Co', addressLines: [] } }).supplier).toMatchObject({ legalName: null, addressLines: [] });
    expect(build(vehicleOnly(), { supplier: { name: 'Same Co', legalName: '  ', addressLines: [' '] } }).supplier).toMatchObject({ legalName: null, addressLines: [] });
  });

  it('customer and vehicle', () => {
    const doc = build(vehicleOnly());
    expect(doc.customer).toEqual({ name: 'Asha Patel', phone: '9876543210', addressLines: ['4 Lake View', 'Una, Gujarat, 362560'] });
    expect(doc.vehicle).toEqual({ model: 'VX', variant: 'Pro', colour: 'Red', vin: 'TESTVIN0001', motorNumber: 'TESTMOTOR1', batteryNumber: 'TESTBATT1' });
    const sparse = build(vehicleOnly(), { customer: { name: 'B', phone: '', address: null, city: null, state: null, pin: null } });
    expect(sparse.customer).toEqual({ name: 'B', phone: null, addressLines: [] });
  });
});
