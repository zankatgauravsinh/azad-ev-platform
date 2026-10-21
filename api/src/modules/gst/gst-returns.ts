import { B2CL_THRESHOLD_PAISE, gstPlaceOfSupply, type GstDocumentKind, type GstSection, type GstSeries } from '@azad/shared';

/*
 * GST returns from normalised documents — pure functions, no database. Money in paise (bigint). The rules
 * (sections, HSN digits, set-off order) are those of the project skill `.claude/skills/gst-india`.
 */

export interface Heads { taxable: bigint; igst: bigint; cgst: bigint; sgst: bigint }
export const ZERO: Heads = { taxable: 0n, igst: 0n, cgst: 0n, sgst: 0n };
export const addHeads = (a: Heads, b: Heads, sign: 1n | -1n = 1n): Heads => ({
  taxable: a.taxable + sign * b.taxable, igst: a.igst + sign * b.igst, cgst: a.cgst + sign * b.cgst, sgst: a.sgst + sign * b.sgst,
});
export const taxOf = (h: Heads): bigint => h.igst + h.cgst + h.sgst;

export interface GstLine extends Heads {
  code: string | null;
  codeType: 'HSN' | 'SAC' | null;
  description: string;
  uqc: string;
  quantity: number;
  ratePercent: number | null;
  treatment: 'TAXABLE' | 'EXEMPT' | 'NIL_RATED';
}

export interface GstDoc {
  id: string;
  kind: GstDocumentKind;
  series: GstSeries;
  number: string;
  date: string;
  buyerName: string;
  buyerGstin: string | null;
  placeOfSupply: string | null;
  supplyType: 'INTRA' | 'INTER';
  value: bigint;
  cancelled: boolean;
  original: { number: string; date: string } | null;
  link: { type: 'booking' | 'accessorySale' | 'serviceJob' | 'return'; id: string };
  lines: GstLine[];
}

/** The taxable heads of a document — its TAXABLE lines (nil / exempt lines go to Table 8). */
export function docHeads(doc: GstDoc): Heads {
  return doc.lines.filter((l) => l.treatment === 'TAXABLE').reduce<Heads>((s, l) => addHeads(s, l), ZERO);
}

/**
 * Where a document is reported in GSTR-1. A registered buyer (GSTIN) → B2B / CDNR. An unregistered buyer:
 * an inter-state invoice above ₹1,00,000 → B2CL (and its credit note → CDNUR), everything else is summarised
 * in B2CS — credit notes and later cancellations reduce B2CS. An invoice cancelled in its own month is not
 * reported (only counted as cancelled in Table 13); a B2B one cancelled later needs a credit note (null).
 */
export function sectionOf(doc: GstDoc): GstSection | 'B2CS_REDUCTION' | null {
  const large = doc.supplyType === 'INTER' && doc.value > B2CL_THRESHOLD_PAISE;
  if (doc.kind === 'INVOICE') return doc.cancelled ? null : doc.buyerGstin ? 'B2B' : large ? 'B2CL' : 'B2CS';
  if (doc.kind === 'CREDIT_NOTE') return doc.buyerGstin ? 'CDNR' : large ? 'CDNUR' : 'B2CS_REDUCTION';
  return doc.buyerGstin ? null : 'B2CS_REDUCTION';
}

/** Per-rate rows of one document (the GSTR-1 tables report invoice × rate). */
function byRate(doc: GstDoc): { ratePercent: number; heads: Heads }[] {
  const m = new Map<number, Heads>();
  for (const l of doc.lines) {
    if (l.treatment !== 'TAXABLE' || l.ratePercent === null) continue;
    m.set(l.ratePercent, addHeads(m.get(l.ratePercent) ?? ZERO, l));
  }
  return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([ratePercent, heads]) => ({ ratePercent, heads }));
}

export interface InvoiceRow extends Heads { number: string; date: string; buyerGstin: string | null; buyerName: string; value: bigint; placeOfSupply: string; ratePercent: number }
export interface NoteRow extends InvoiceRow { noteType: 'C' | 'D'; original: { number: string; date: string } | null }
export interface B2csRow extends Heads { placeOfSupply: string; ratePercent: number }
export interface HsnRow extends Heads { code: string; description: string; uqc: string; quantity: number; ratePercent: number; totalValue: bigint }
export interface DocumentsIssuedRow { series: GstSeries; nature: string; from: string; to: string; total: number; cancelled: number }
export interface NilExemptRow { description: string; nil: bigint; exempt: bigint; nonGst: bigint }

export interface Gstr1 {
  b2b: InvoiceRow[];
  b2cl: InvoiceRow[];
  b2cs: B2csRow[];
  cdnr: NoteRow[];
  cdnur: NoteRow[];
  hsnB2b: HsnRow[];
  hsnB2c: HsnRow[];
  documents: DocumentsIssuedRow[];
  nilExempt: NilExemptRow[];
  totals: Heads;
}

const invoiceRows = (doc: GstDoc): InvoiceRow[] =>
  byRate(doc).map(({ ratePercent, heads }) => ({
    ...heads, number: doc.number, date: doc.date, buyerGstin: doc.buyerGstin, buyerName: doc.buyerName, value: doc.value,
    placeOfSupply: gstPlaceOfSupply(doc.placeOfSupply), ratePercent,
  }));

/** Natural order of document numbers: "INV0009" before "INV0010". */
export const compareNumbers = (a: string, b: string): number => a.localeCompare(b, 'en', { numeric: true });

const NATURE: Record<GstSeries, string> = {
  SCOOTER: 'Invoices for outward supply',
  ACCESSORY: 'Invoices for outward supply',
  SERVICE: 'Invoices for outward supply',
  CREDIT_NOTE: 'Credit Note',
};

/** The HSN / SAC as reported: 4 digits (turnover ≤ ₹5 crore) or 6 digits. */
export const reportedCode = (code: string, sixDigits: boolean): string => code.replace(/\D/g, '').slice(0, sixDigits ? 6 : 4);

export function buildGstr1(docs: GstDoc[], opts: { sixDigitHsn: boolean }): Gstr1 {
  const out: Gstr1 = { b2b: [], b2cl: [], b2cs: [], cdnr: [], cdnur: [], hsnB2b: [], hsnB2c: [], documents: [], nilExempt: [], totals: ZERO };
  const b2cs = new Map<string, B2csRow>();
  const hsn = { b2b: new Map<string, HsnRow>(), b2c: new Map<string, HsnRow>() };
  const nil = new Map<string, NilExemptRow>();

  for (const doc of docs) {
    const section = sectionOf(doc);
    if (section === null) continue;
    const sign: 1n | -1n = doc.kind === 'INVOICE' ? 1n : -1n;
    out.totals = addHeads(out.totals, docHeads(doc), sign);
    if (section === 'B2B') out.b2b.push(...invoiceRows(doc));
    else if (section === 'B2CL') out.b2cl.push(...invoiceRows(doc));
    else if (section === 'CDNR' || section === 'CDNUR') {
      const rows = invoiceRows(doc).map((r) => ({ ...r, noteType: 'C' as const, original: doc.original }));
      (section === 'CDNR' ? out.cdnr : out.cdnur).push(...rows);
    } else {
      for (const { ratePercent, heads } of byRate(doc)) {
        const pos = gstPlaceOfSupply(doc.placeOfSupply);
        const key = `${pos}|${ratePercent}`;
        const prev = b2cs.get(key) ?? { ...ZERO, placeOfSupply: pos, ratePercent };
        b2cs.set(key, { ...prev, ...addHeads(prev, heads, sign) });
      }
    }

    // HSN summary: registered buyers (B2B, CDNR) apart from the rest.
    const side = section === 'B2B' || section === 'CDNR' ? hsn.b2b : hsn.b2c;
    for (const l of doc.lines) {
      if (l.treatment !== 'TAXABLE' || l.ratePercent === null) continue;
      const code = l.code ? reportedCode(l.code, opts.sixDigitHsn) : '';
      const key = `${code}|${l.ratePercent}`;
      const prev = side.get(key) ?? { ...ZERO, code, description: l.description, uqc: l.uqc, quantity: 0, ratePercent: l.ratePercent, totalValue: 0n };
      const heads = addHeads(prev, l, sign);
      side.set(key, { ...prev, ...heads, quantity: prev.quantity + Number(sign) * l.quantity, totalValue: heads.taxable + taxOf(heads) });
    }

    // Table 8: nil-rated / exempt, by inter/intra × registered/unregistered.
    for (const l of doc.lines) {
      if (l.treatment === 'TAXABLE') continue;
      const description = `${doc.supplyType === 'INTER' ? 'Inter-State' : 'Intra-State'} supplies to ${doc.buyerGstin ? 'registered' : 'unregistered'} persons`;
      const prev = nil.get(description) ?? { description, nil: 0n, exempt: 0n, nonGst: 0n };
      if (l.treatment === 'NIL_RATED') prev.nil += sign * l.taxable;
      else prev.exempt += sign * l.taxable;
      nil.set(description, prev);
    }
  }

  // Table 13: every invoice and note issued, by series — cancelled ones included and counted.
  const series = new Map<GstSeries, GstDoc[]>();
  for (const doc of docs) if (doc.kind !== 'CANCELLATION') series.set(doc.series, [...(series.get(doc.series) ?? []), doc]);
  for (const [s, list] of series) {
    const numbers = list.map((d) => d.number).sort(compareNumbers);
    out.documents.push({ series: s, nature: NATURE[s], from: numbers[0]!, to: numbers[numbers.length - 1]!, total: numbers.length, cancelled: list.filter((d) => d.cancelled).length });
  }

  const byKey = <T>(m: Map<string, T>): T[] => [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v);
  out.b2cs = byKey(b2cs).filter((r) => r.taxable !== 0n || taxOf(r) !== 0n);
  out.hsnB2b = byKey(hsn.b2b);
  out.hsnB2c = byKey(hsn.b2c);
  out.nilExempt = byKey(nil);
  const order = (a: InvoiceRow, b: InvoiceRow): number => a.date.localeCompare(b.date) || compareNumbers(a.number, b.number) || a.ratePercent - b.ratePercent;
  for (const rows of [out.b2b, out.b2cl, out.cdnr, out.cdnur]) rows.sort(order);
  out.documents.sort((a, b) => Object.keys(NATURE).indexOf(a.series) - Object.keys(NATURE).indexOf(b.series));
  return out;
}

export interface Tax3 { igst: bigint; cgst: bigint; sgst: bigint }
export const tax3 = (h: Heads | Tax3): Tax3 => ({ igst: h.igst, cgst: h.cgst, sgst: h.sgst });

/**
 * GSTR-3B 6.1 set-off (CGST Act s.49(5), Rule 88A): IGST credit first against IGST, then CGST, then SGST;
 * CGST credit against CGST, then IGST; SGST credit against SGST, then IGST. CGST never pays SGST or the reverse.
 * Returns the credit used (by the head of the credit) and the cash still payable per head.
 */
export function setOff(liability: Tax3, credit: Tax3): { itcUsed: Tax3; cash: Tax3 } {
  const due = { igst: max0(liability.igst), cgst: max0(liability.cgst), sgst: max0(liability.sgst) };
  const left = { igst: max0(credit.igst), cgst: max0(credit.cgst), sgst: max0(credit.sgst) };
  const used = { igst: 0n, cgst: 0n, sgst: 0n };
  const apply = (from: keyof Tax3, to: keyof Tax3): void => {
    const u = left[from] < due[to] ? left[from] : due[to];
    left[from] -= u;
    due[to] -= u;
    used[from] += u;
  };
  apply('igst', 'igst');
  apply('igst', 'cgst');
  apply('igst', 'sgst');
  apply('cgst', 'cgst');
  apply('cgst', 'igst');
  apply('sgst', 'sgst');
  apply('sgst', 'igst');
  return { itcUsed: used, cash: due };
}
const max0 = (v: bigint): bigint => (v > 0n ? v : 0n);

/** The last date a credit note may reduce output tax for an invoice (s.34(2)): 30 November after its FY. */
export function creditNoteDeadline(invoiceDate: string): string {
  const [y, m] = invoiceDate.split('-').map(Number) as [number, number];
  const fyEnd = m >= 4 ? y + 1 : y;
  return `${fyEnd}-11-30`;
}
