import { BRAND_LOGO } from '../../common/pdf/brand-logo';
import type { PdfBrand } from '../../common/pdf/brand';
import { readPdfText, type PdfText, type PdfTextItem } from '../../../test/support/pdf-text';
import { CLASS, everyComponent, identity, taxDocument, vehicleOnly, type FixtureLine } from '../../../test/support/gst-invoice-fixture';
import { buildGstInvoiceDocument, type GstInvoiceDocument } from './gst-invoice-document';
import { GstInvoicePdfService } from './gst-invoice-pdf.service';

/**
 * Real PDFs, read back as text. Assertions are on what a reader sees — the words and figures and where
 * they sit — never on the PDF's bytes.
 */
const brand = (over: Partial<PdfBrand> = {}): PdfBrand => ({
  logo: BRAND_LOGO as unknown as Buffer, name: 'AZAD EV POINT', dealerName: 'Authorised test dealer', addressLines: ['12 Test Road', 'Una, Gujarat'],
  phones: '0123456789', email: null, website: null,
  gstin: 'CURRENT-SETTING-GSTIN', // what the company's CURRENT setting would print — must never appear
  tagline: 'POWERING TOMORROW', terms: 'Test terms line one.\nTest terms line two.', ...over,
});
const service = new GstInvoicePdfService();
const render = async (doc: GstInvoiceDocument, b: PdfBrand = brand()): Promise<PdfText> => {
  const buffer = await service.render(doc, b);
  expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
  return readPdfText(buffer);
};
const count = (text: PdfText, s: string): number => text.strings.filter((x) => x === s).length;

const PAGE_HEIGHT = 841.89;
const CONTENT_BOTTOM = PAGE_HEIGHT - 40 - 58; // margin + footer zone
const FOOTER = ['Thank you for choosing AZAD EV POINT', 'POWERING TOMORROW', 'Computer-generated document'];
const isFooter = (i: PdfTextItem): boolean => i.y > PAGE_HEIGHT - 40 - 50 && (FOOTER.includes(i.text) || /^Page \d+ of \d+$/.test(i.text));

/** No two pieces of text may sit on top of each other. */
function expectNoOverlap(text: PdfText): void {
  const box = (i: PdfTextItem) => ({ l: i.x + 0.5, r: i.x + i.width - 0.5, t: i.y - i.height * 0.75, b: i.y - 0.5 });
  for (let page = 1; page <= text.pageCount; page += 1) {
    const items = text.items.filter((i) => i.page === page);
    for (let a = 0; a < items.length; a += 1) {
      for (let b = a + 1; b < items.length; b += 1) {
        const A = box(items[a]!);
        const B = box(items[b]!);
        const overlaps = A.l < B.r && B.l < A.r && A.t < B.b && B.t < A.b;
        if (overlaps) throw new Error(`page ${page}: "${items[a]!.text}" overlaps "${items[b]!.text}"`);
      }
    }
  }
}

/** Every piece of content sits above the footer zone, and the footer sits in it. */
function expectWithinPage(text: PdfText): void {
  for (const i of text.items) {
    if (isFooter(i)) continue;
    expect([i.page, i.text, i.y]).toEqual([i.page, i.text, expect.any(Number)]);
    expect(i.y).toBeLessThanOrEqual(CONTENT_BOTTOM + 1);
    expect(i.x).toBeGreaterThanOrEqual(40 - 0.5);
    expect(i.x + i.width).toBeLessThanOrEqual(595.28 - 40 + 1);
  }
  for (let page = 1; page <= text.pageCount; page += 1) {
    expect(text.onPage(page)).toEqual(expect.arrayContaining([...FOOTER, `Page ${page} of ${text.pageCount}`]));
  }
}

describe('GstInvoicePdfService', () => {
  it('Case A — INTRA taxable sale: every figure is the stored one, GST never added on top', async () => {
    const text = await render(buildGstInvoiceDocument(vehicleOnly(), identity()));
    expect(text.pageCount).toBe(1);
    expect(text.strings).toEqual(expect.arrayContaining([
      'TAX INVOICE', 'No: TEST-INV0007', 'Date: 1/7/2026',
      'GSTIN: TEST-GSTIN-SUPPLIER', 'State code: 24', 'Legal name: Azad Enterprise',
      'Place of supply: State code 24', 'Supply type: Intra-state',
      'VX Pro', 'Colour: Red', 'VIN: TESTVIN0001', 'Motor No.: TESTMOTOR1', 'Battery No.: TESTBATT1',
      'Asha Patel', '9876543210', '4 Lake View', 'Una, Gujarat, 362560',
      'TESTBRAND VX Pro (Red)', 'HSN: TEST-VEH', '10,000.00', '9,523.81', '5.00%', '238.10',
      'CGST (₹)', 'SGST (₹)', 'Taxable value', '₹9,523.81', 'CGST', '₹238.10', 'SGST', 'Round-off', '-₹0.01', 'Grand total', '₹10,000.00',
      'SUMMARY BY GST RATE / TREATMENT', '476.19', 'TERMS & CONDITIONS', 'Test terms line one.', 'Test terms line two.',
    ]));
    expect(count(text, '238.10')).toBe(4); // CGST + SGST on the line and in the summary
    expect(text.all).not.toContain('IGST');
    expect(text.all).not.toContain('10,500');
    expect(text.all).not.toContain('CURRENT-SETTING-GSTIN'); // the letterhead GSTIN is the stored one
    expect(count(text, 'GSTIN: TEST-GSTIN-SUPPLIER')).toBe(2); // letterhead + supplier block
    expectNoOverlap(text);
    expectWithinPage(text);
  });

  it('Case B — INTER taxable sale: IGST only', async () => {
    const text = await render(buildGstInvoiceDocument(vehicleOnly({ supplyType: 'INTER' }), identity()));
    expect(text.strings).toEqual(expect.arrayContaining(['Place of supply: State code 27', 'Supply type: Inter-state', 'IGST (₹)', '9,523.81', '5.00%', '476.19', 'IGST', '₹476.19', '₹0.00', 'Grand total', '₹10,000.00']));
    expect(text.all).not.toContain('CGST');
    expect(text.all).not.toContain('SGST');
    expectNoOverlap(text);
  });

  it('Case C — taxable, exempt, nil-rated and non-taxable lines together', async () => {
    const text = await render(buildGstInvoiceDocument(everyComponent(), identity()));
    expect(text.strings).toEqual(expect.arrayContaining([
      'RTO', 'Non-taxable', '850.00', 'Insurance', 'Exempt', '420.00', 'Registration', 'Nil rated', '150.00',
      'Value before GST (taxable lines and', 'lines without GST)', '₹12,843.81', '₹368.10', 'Grand total', '₹13,580.00',
    ]));
    expect(text.all).not.toContain('0.00%');
    expect(text.all).not.toContain('Non-taxable%');
    // Lines without GST show dashes, not zeros, in the tax columns.
    expect(count(text, "-")).toBe(6 + 9); // 3 lines × 2 tax cells + 3 summary rows × 3 cells
    expectNoOverlap(text);
  });

  it('Case D — several GST rates, one row each, in stored order, with a rate-wise summary', async () => {
    const text = await render(buildGstInvoiceDocument(everyComponent(), identity()));
    const rates = text.items.filter((i) => /^\d+\.\d\d%$/.test(i.text)).map((i) => i.text);
    expect(rates).toEqual(['5.00%', '5.00%', '18.00%', '12.00%', '5.00%', '18.00%', '12.00%']); // 4 line rows, then 3 summary rows
    expect(text.strings).toEqual(expect.arrayContaining(['HSN: TEST-ACC5', 'HSN: TEST-ACC18', 'SAC: TEST-WTY', '9,923.81', '248.10', '496.19', '1,180.00', '90.00', '560.00', '30.00']));
    const rowOrder = text.items.filter((i) => ['TESTBRAND VX Pro (Red)', 'Test helmet', 'Test charger', 'Extended warranty', 'RTO', 'Insurance', 'Registration'].includes(i.text)).map((i) => i.text);
    expect(rowOrder).toEqual(['TESTBRAND VX Pro (Red)', 'Test helmet', 'Test charger', 'Extended warranty', 'RTO', 'Insurance', 'Registration']);
  });

  it('discount and exchange rows read as stored, under the vehicle line or in the totals', async () => {
    const pre = await render(buildGstInvoiceDocument(taxDocument({
      lines: [{ key: 'vehicle', componentType: 'VEHICLE', description: 'TESTBRAND VX Pro (Red)', classification: CLASS.vehicle, unitAmount: 1_250_000n, amount: 1_000_000n }],
      discount: { amount: 50_000n, treatment: 'REDUCES_VEHICLE_TAXABLE_VALUE' }, exchange: { amount: 200_000n, treatment: 'REDUCES_VEHICLE_TAXABLE_VALUE' },
    }), identity()));
    expect(pre.strings).toEqual(expect.arrayContaining(['12,500.00', '− 500.00', '− 2,000.00', '9,523.81', '₹10,000.00']));
    // The notes wrap inside the description column; read across the wrap they are intact.
    expect(pre.all).toContain('Discount — reduces vehicle taxable value');
    expect(pre.all).toContain('Exchange adjustment — reduces vehicle taxable value');
    expectNoOverlap(pre);

    const post = await render(buildGstInvoiceDocument(vehicleOnly({ discount: { amount: 50_000n, treatment: 'AFTER_TAX_ADJUSTMENT' }, exchange: { amount: 200_000n, treatment: 'AFTER_TAX_ADJUSTMENT' } }), identity()));
    expect(post.strings).toEqual(expect.arrayContaining(['Total', '₹10,000.00', '− ₹500.00', '− ₹2,000.00', 'Grand total', '₹7,500.00']));
    expect(post.all).toContain('Discount (after-tax adjustment)');
    expect(post.all).toContain('Exchange adjustment (after-tax adjustment)');
    expectNoOverlap(post);
  });

  it('Case E — many long lines, a long address and long terms flow over several pages without loss', async () => {
    const accessories: FixtureLine[] = Array.from({ length: 70 }, (_, i) => ({
      key: `accessory:r${i}`, componentType: 'ACCESSORY', classification: i % 2 ? CLASS.accessory18 : CLASS.accessory5,
      description: `Test accessory number ${i + 1} with a deliberately long descriptive name that wraps across several lines in the description column`,
      unitAmount: 11_800n + BigInt(i) * 100n, quantity: (i % 3) + 1,
    }));
    const tax = taxDocument({
      lines: [{ key: 'vehicle', componentType: 'VEHICLE', description: 'TESTBRAND VX Pro (Red)', classification: CLASS.vehicle, unitAmount: 1_000_000n }, ...accessories, { key: 'rto', componentType: 'RTO', description: 'RTO', classification: CLASS.rto, unitAmount: 85_000n }],
    });
    const longTerms = Array.from({ length: 40 }, (_, i) => `Term ${i + 1}: ${'this condition is repeated to make the paragraph long enough to wrap '.repeat(3)}`).join('\n');
    const text = await render(
      buildGstInvoiceDocument(tax, identity({ customer: { name: 'A Customer With A Very Long Name Indeed', phone: '9876543210', address: 'Flat 12, Block C, Some Very Long Housing Society Name, Behind The Old Market Road, Near The Bus Stand', city: 'Una', state: 'Gujarat', pin: '362560' } })),
      brand({ terms: longTerms }),
    );

    expect(text.pageCount).toBeGreaterThanOrEqual(3);
    // Every line is present exactly once, in order, and nothing is truncated.
    for (let i = 0; i < 70; i += 1) expect(count(text, `Test accessory number ${i + 1} with a deliberately long descriptive name that wraps across several lines in the description column`)).toBe(0);
    const starts = text.items.filter((i) => /^Test accessory number \d+ with/.test(i.text)).map((i) => Number(/number (\d+)/.exec(i.text)![1]));
    expect(starts).toEqual(Array.from({ length: 70 }, (_, i) => i + 1));
    expect(text.all).toContain('wraps across several lines in the description column');
    expect(text.all).toContain('Near The Bus Stand');
    expect(text.all).toContain('Term 40:');
    // The table header repeats on every page that carries rows; later pages carry the running head.
    const pagesWithRows = new Set(text.items.filter((i) => /^Test accessory number/.test(i.text)).map((i) => i.page));
    for (const page of pagesWithRows) expect(text.onPage(page)).toContain('Description');
    for (let page = 2; page <= text.pageCount; page += 1) expect(text.onPage(page).some((s) => s.includes('continued'))).toBe(true);
    // Totals stay together: the grand total and the taxable-value row are on the same page.
    const grand = text.items.find((i) => i.text === 'Grand total')!;
    const value = text.items.find((i) => i.text.startsWith('Value before GST (taxable'))!;
    expect(grand.page).toBe(value.page);
    expect(text.onPage(grand.page)).toContain(buildGstInvoiceDocument(tax, identity()).grandTotal);
    expectNoOverlap(text);
    expectWithinPage(text);
  });

  it('a single page carries the footer and "Page 1 of 1"', async () => {
    const text = await render(buildGstInvoiceDocument(vehicleOnly(), identity()), brand({ terms: null }));
    expect(text.pageCount).toBe(1);
    expect(text.strings).toContain('Page 1 of 1');
    expect(text.all).not.toContain('TERMS');
    expectWithinPage(text);
  });
});
