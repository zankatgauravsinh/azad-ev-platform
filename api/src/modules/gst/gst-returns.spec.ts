import { buildGstr1, creditNoteDeadline, reportedCode, sectionOf, setOff, type GstDoc, type GstLine } from './gst-returns';

const line = (over: Partial<GstLine> = {}): GstLine => ({
  code: '87116010', codeType: 'HSN', description: 'Electric scooter', uqc: 'NOS', quantity: 1, ratePercent: 5, treatment: 'TAXABLE',
  taxable: 10_000_000n, igst: 0n, cgst: 250_000n, sgst: 250_000n, ...over,
});
let n = 0;
const doc = (over: Partial<GstDoc> = {}): GstDoc => ({
  id: `d${n}`, kind: 'INVOICE', series: 'SCOOTER', number: `INV${String(++n).padStart(4, '0')}`, date: '2026-10-05', buyerName: 'Buyer', buyerGstin: null,
  placeOfSupply: '24', supplyType: 'INTRA', value: 10_500_000n, cancelled: false, original: null, link: { type: 'booking', id: 'b' }, lines: [line()], ...over,
});
const inter = (value: bigint): Partial<GstDoc> => ({ supplyType: 'INTER', placeOfSupply: '27', value, lines: [line({ cgst: 0n, sgst: 0n, igst: 500_000n })] });

describe('sectionOf', () => {
  it('registered buyer → B2B; large inter-state unregistered → B2CL; the rest → B2CS', () => {
    expect(sectionOf(doc({ buyerGstin: '24AAPFU0939F1Z1' }))).toBe('B2B');
    expect(sectionOf(doc(inter(10_000_001n)))).toBe('B2CL');
    expect(sectionOf(doc(inter(10_000_000n)))).toBe('B2CS'); // ₹1,00,000 exactly is not "above"
    expect(sectionOf(doc({ value: 50_000_000n }))).toBe('B2CS'); // intra-state never B2CL
  });
  it('credit notes: CDNR / CDNUR / reduce B2CS; own-month cancellations are not reported', () => {
    expect(sectionOf(doc({ kind: 'CREDIT_NOTE', buyerGstin: '24AAPFU0939F1Z1' }))).toBe('CDNR');
    expect(sectionOf(doc({ kind: 'CREDIT_NOTE', ...inter(20_000_000n) }))).toBe('CDNUR');
    expect(sectionOf(doc({ kind: 'CREDIT_NOTE' }))).toBe('B2CS_REDUCTION');
    expect(sectionOf(doc({ cancelled: true }))).toBeNull();
    expect(sectionOf(doc({ kind: 'CANCELLATION' }))).toBe('B2CS_REDUCTION');
    expect(sectionOf(doc({ kind: 'CANCELLATION', buyerGstin: '24AAPFU0939F1Z1' }))).toBeNull();
  });
});

describe('buildGstr1', () => {
  it('B2B rows per invoice × rate; B2CS by place of supply + rate, net of credit notes; totals net', () => {
    const b2b = doc({ buyerGstin: '24AAPFU0939F1Z1', lines: [line(), line({ code: '65061010', description: 'Helmet', ratePercent: 18, taxable: 100_000n, cgst: 9_000n, sgst: 9_000n })] });
    const b2c1 = doc();
    const b2c2 = doc();
    const cn = doc({ kind: 'CREDIT_NOTE', series: 'CREDIT_NOTE', number: 'CN0001', original: { number: b2c1.number, date: '2026-09-30' } });
    const g = buildGstr1([b2b, b2c1, b2c2, cn], { sixDigitHsn: false });
    expect(g.b2b.map((r) => [r.number, r.ratePercent, r.taxable])).toEqual([[b2b.number, 5, 10_000_000n], [b2b.number, 18, 100_000n]]);
    expect(g.b2cs).toEqual([expect.objectContaining({ placeOfSupply: '24-Gujarat', ratePercent: 5, taxable: 10_000_000n, cgst: 250_000n, sgst: 250_000n })]);
    expect(g.totals).toEqual({ taxable: 20_100_000n, igst: 0n, cgst: 509_000n, sgst: 509_000n });
  });

  it('HSN summary: 4 digits (or 6), registered and unregistered apart, quantities net of credit notes', () => {
    const g = buildGstr1([doc({ buyerGstin: '24AAPFU0939F1Z1' }), doc(), doc(), doc({ kind: 'CREDIT_NOTE', series: 'CREDIT_NOTE', number: 'CN1' })], { sixDigitHsn: false });
    expect(g.hsnB2b).toEqual([expect.objectContaining({ code: '8711', quantity: 1, taxable: 10_000_000n, totalValue: 10_500_000n })]);
    expect(g.hsnB2c).toEqual([expect.objectContaining({ code: '8711', quantity: 1, taxable: 10_000_000n })]);
    expect(reportedCode('87116010', true)).toBe('871160');
  });

  it('B2CL and CDNUR carry the invoice / note; nil-rated lines go to Table 8', () => {
    const big = doc(inter(12_000_000n));
    const note = doc({ kind: 'CREDIT_NOTE', series: 'CREDIT_NOTE', number: 'CN9', original: { number: big.number, date: big.date }, ...inter(12_000_000n) });
    const nil = doc({ lines: [line({ treatment: 'NIL_RATED', ratePercent: null, taxable: 50_000n, cgst: 0n, sgst: 0n })] });
    const g = buildGstr1([big, note, nil], { sixDigitHsn: false });
    expect(g.b2cl).toEqual([expect.objectContaining({ number: big.number, placeOfSupply: '27-Maharashtra', igst: 500_000n })]);
    expect(g.cdnur).toEqual([expect.objectContaining({ number: 'CN9', noteType: 'C', original: { number: big.number, date: big.date } })]);
    expect(g.nilExempt).toEqual([{ description: 'Intra-State supplies to unregistered persons', nil: 50_000n, exempt: 0n, nonGst: 0n }]);
  });

  it('Table 13: each series from / to, total and cancelled (numbers in natural order)', () => {
    const a = doc({ series: 'ACCESSORY', number: 'ACC0009' });
    const b = doc({ series: 'ACCESSORY', number: 'ACC0010', cancelled: true });
    const g = buildGstr1([b, a, doc({ series: 'ACCESSORY', kind: 'CANCELLATION', number: 'ACC0001' })], { sixDigitHsn: false });
    expect(g.documents).toEqual([{ series: 'ACCESSORY', nature: 'Invoices for outward supply', from: 'ACC0009', to: 'ACC0010', total: 2, cancelled: 1 }]);
    expect(g.b2cs).toEqual([]); // ACC0009 is cancelled out by the later cancellation; ACC0010 (own month) is not reported
  });
});

describe('setOff (s.49, Rule 88A)', () => {
  it('IGST credit pays IGST, then CGST, then SGST; CGST/SGST credit pay their own head, then IGST', () => {
    const r = setOff({ igst: 100n, cgst: 300n, sgst: 300n }, { igst: 250n, cgst: 100n, sgst: 400n });
    expect(r.itcUsed).toEqual({ igst: 250n, cgst: 100n, sgst: 300n });
    expect(r.cash).toEqual({ igst: 0n, cgst: 50n, sgst: 0n });
  });
  it('CGST credit never pays SGST', () => {
    expect(setOff({ igst: 0n, cgst: 0n, sgst: 100n }, { igst: 0n, cgst: 500n, sgst: 0n }).cash).toEqual({ igst: 0n, cgst: 0n, sgst: 100n });
  });
});

describe('creditNoteDeadline (s.34(2))', () => {
  it('is 30 November after the end of the invoice’s financial year', () => {
    expect(creditNoteDeadline('2026-03-31')).toBe('2026-11-30');
    expect(creditNoteDeadline('2026-04-01')).toBe('2027-11-30');
  });
});
