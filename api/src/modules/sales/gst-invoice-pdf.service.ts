import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { drawBrandHeader, drawBrandFooter, useBrandFonts, NAVY, FONT_BODY, FONT_BOLD, type PdfBrand } from '../../common/pdf/brand';
import type { GstInvoiceDocument, GstInvoiceLine, GstTaxColumn } from './gst-invoice-document';

/**
 * Draws a GST tax invoice (Stage D3.2). It only DRAWS: every word and figure is already in the
 * GstInvoiceDocument. This file has no database access, reads no settings and does no arithmetic on
 * money — it cannot change, add up or re-derive a tax amount.
 *
 * The letterhead GSTIN is the one stored with the sale (document.supplier.gstin), never the company's
 * current setting: the renderer overrides whatever the brand carries.
 *
 * Layout is flowed, not fixed: rows are measured before they are drawn, a row never splits across
 * pages, the table header repeats on every page, the totals stay together, and each page gets the
 * footer and a page number. The existing non-GST invoice (SalesPdfService) is untouched.
 */

type Doc = PDFKit.PDFDocument;
type Align = 'left' | 'right' | 'center';
interface Column { key: string; header: string; width: number; align: Align }

const MARGIN = 40;
/** Space kept free above the bottom margin for the footer drawn on every page. */
const FOOTER_ZONE = 58;
const TEXT = '#111111';
const MUTED = '#666666';
const RULE = '#E3E6EA';

const TAX_KEY: Record<GstTaxColumn, 'cgst' | 'sgst' | 'igst'> = { CGST: 'cgst', SGST: 'sgst', IGST: 'igst' };

/** Item-table columns. The description column takes whatever width the tax columns leave. */
function itemColumns(taxColumns: GstTaxColumn[], tableWidth: number): Column[] {
  const fixed: Column[] = [
    { key: 'qty', header: 'Qty', width: 24, align: 'right' },
    { key: 'unitAmount', header: 'Unit amount (₹)', width: 62, align: 'right' },
    { key: 'value', header: 'Value before GST (₹)', width: 62, align: 'right' },
    { key: 'rate', header: 'GST rate', width: 48, align: 'right' },
    ...taxColumns.map((t): Column => ({ key: TAX_KEY[t], header: `${t} (₹)`, width: 50, align: 'right' })),
    { key: 'lineTotal', header: 'Total (₹)', width: 62, align: 'right' },
  ];
  const position: Column = { key: 'position', header: '#', width: 16, align: 'left' };
  const used = position.width + fixed.reduce((t, c) => t + c.width, 0);
  return [position, { key: 'description', header: 'Description', width: tableWidth - used, align: 'left' }, ...fixed];
}

@Injectable()
export class GstInvoicePdfService {
  render(document: GstInvoiceDocument, brand: PdfBrand): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: MARGIN, bufferPages: true });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      try {
        useBrandFonts(doc);
        // The GSTIN of an issued invoice is the stored one — never the company's current setting.
        const letterhead: PdfBrand = { ...brand, gstin: document.supplier.gstin };
        new Painter(doc, document, letterhead).paint();
        doc.end();
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  }
}

class Painter {
  private readonly left: number;
  private readonly right: number;
  private readonly width: number;
  private y = 0;

  constructor(
    private readonly doc: Doc,
    private readonly d: GstInvoiceDocument,
    private readonly brand: PdfBrand,
  ) {
    this.left = doc.page.margins.left;
    this.right = doc.page.width - doc.page.margins.right;
    this.width = this.right - this.left;
  }

  paint(): void {
    drawBrandHeader(this.doc, this.brand, { docType: this.d.title, infoLines: [`No: ${this.d.invoiceNumber}`, `Date: ${this.d.invoiceDate}`] });
    this.y = this.doc.y;

    const s = this.d.supplier;
    const c = this.d.customer;
    this.twoBlocks(
      { title: 'Supplier', lines: [{ text: s.name, bold: true }, ...(s.legalName ? [{ text: `Legal name: ${s.legalName}` }] : []), ...s.addressLines.map((text) => ({ text })), { text: `GSTIN: ${s.gstin}` }, { text: `State code: ${s.stateCode}` }] },
      { title: 'Bill To', lines: [{ text: c.name, bold: true }, ...(c.phone ? [{ text: c.phone }] : []), ...c.addressLines.map((text) => ({ text }))] },
    );
    const v = this.d.vehicle;
    this.twoBlocks(
      { title: 'Supply', lines: [{ text: `Place of supply: State code ${this.d.supply.placeOfSupplyStateCode}` }, { text: `Supply type: ${this.d.supply.supplyTypeLabel}` }] },
      { title: 'Vehicle', lines: [{ text: `${v.model} ${v.variant}`, bold: true }, { text: `Colour: ${v.colour}` }, { text: `VIN: ${v.vin}` }, { text: `Motor No.: ${v.motorNumber ?? '—'}` }, { text: `Battery No.: ${v.batteryNumber ?? '—'}` }] },
    );

    this.items();
    this.totals();
    this.summary();
    this.terms();
    this.footers();
  }

  // ── Page flow ──────────────────────────────────────────
  private get limit(): number {
    return this.doc.page.height - this.doc.page.margins.bottom - FOOTER_ZONE;
  }
  private get top(): number {
    return this.doc.page.margins.top + 22;
  }

  /** Starts a new page with a one-line running head. */
  private newPage(): void {
    this.doc.addPage();
    this.doc.font(FONT_BOLD).fontSize(8).fillColor(NAVY).text(`${this.d.title}  ·  ${this.d.invoiceNumber}  ·  continued`, this.left, this.doc.page.margins.top, { width: this.width, lineBreak: false });
    this.doc.moveTo(this.left, this.doc.page.margins.top + 14).lineTo(this.right, this.doc.page.margins.top + 14).strokeColor(RULE).lineWidth(1).stroke();
    this.y = this.top;
  }

  /** Makes sure `height` fits on the current page; returns true when a new page was started. */
  private ensure(height: number): boolean {
    if (this.y + height <= this.limit || this.y <= this.top) return false;
    this.newPage();
    return true;
  }

  // ── Text helpers (measure first, then draw — nothing relies on PDFKit's own page breaks) ──
  private measure(text: string, width: number, font: string, size: number): number {
    return this.doc.font(font).fontSize(size).heightOfString(text, { width });
  }

  private draw(text: string, x: number, y: number, width: number, opts: { font?: string; size?: number; color?: string; align?: Align } = {}): void {
    this.doc.font(opts.font ?? FONT_BODY).fontSize(opts.size ?? 8).fillColor(opts.color ?? TEXT).text(text, x, y, { width, align: opts.align ?? 'left' });
  }

  /** One line that must not wrap (a figure): shrinks the type until it fits its cell. */
  private fit(text: string, x: number, y: number, width: number, opts: { font?: string; size?: number; color?: string; align?: Align } = {}): void {
    const font = opts.font ?? FONT_BODY;
    let size = opts.size ?? 8;
    this.doc.font(font);
    while (size > 4 && this.doc.fontSize(size).widthOfString(text) > width) size -= 0.25;
    this.doc.fillColor(opts.color ?? TEXT).text(text, x, y, { width, align: opts.align ?? 'left', lineBreak: false });
  }

  // ── Blocks ─────────────────────────────────────────────
  private twoBlocks(a: Block, b: Block): void {
    const gap = 20;
    const colW = (this.width - gap) / 2;
    const height = Math.max(this.blockHeight(a, colW), this.blockHeight(b, colW));
    this.ensure(height + 8);
    this.block(a, this.left, colW);
    this.block(b, this.left + colW + gap, colW);
    this.y += height + 8;
  }

  private blockHeight(block: Block, width: number): number {
    return 13 + block.lines.reduce((t, l) => t + this.measure(l.text, width, l.bold ? FONT_BOLD : FONT_BODY, 8.5) + 1, 0);
  }

  private block(block: Block, x: number, width: number): void {
    this.draw(block.title.toUpperCase(), x, this.y, width, { font: FONT_BOLD, size: 7.5, color: NAVY });
    let y = this.y + 13;
    for (const l of block.lines) {
      const font = l.bold ? FONT_BOLD : FONT_BODY;
      this.draw(l.text, x, y, width, { font, size: 8.5 });
      y += this.measure(l.text, width, font, 8.5) + 1;
    }
  }

  // ── Items ──────────────────────────────────────────────
  private tableHeader(columns: Column[]): void {
    const pad = 3;
    const height = Math.max(...columns.map((c) => this.measure(c.header, c.width - pad * 2, FONT_BOLD, 7))) + 8;
    this.doc.rect(this.left, this.y, this.width, height).fill(NAVY);
    let x = this.left;
    for (const c of columns) {
      this.draw(c.header, x + pad, this.y + 4, c.width - pad * 2, { font: FONT_BOLD, size: 7, color: '#FFFFFF', align: c.align });
      x += c.width;
    }
    this.y += height;
  }

  private items(): void {
    const columns = itemColumns(this.d.taxColumns, this.width);
    const pad = 3;
    const description = columns.find((c) => c.key === 'description')!;
    const textW = description.width - pad * 2;

    this.ensure(60);
    this.tableHeader(columns);

    for (const line of this.d.lines) {
      const descH = this.measure(line.description, textW, FONT_BODY, 7.5);
      const codeH = line.code ? this.measure(line.code, textW, FONT_BODY, 6.5) + 1 : 0;
      const adjH = line.adjustments.map((a) => this.measure(`${a.label} — ${a.note}`, textW, FONT_BODY, 7) + 3);
      const rowH = descH + codeH + adjH.reduce((t, h) => t + h, 0) + 9;

      // A row (with its adjustment rows) never splits; the header repeats on the new page.
      if (this.ensure(rowH)) this.tableHeader(columns);

      const y0 = this.y + 4;
      const cells: Record<string, string> = { position: String(line.position), qty: line.quantity, unitAmount: line.unitAmount, value: line.value, rate: line.rateLabel, cgst: line.cgst, sgst: line.sgst, igst: line.igst, lineTotal: line.lineTotal };
      let x = this.left;
      for (const c of columns) {
        if (c.key === 'description') this.description(line, x + pad, y0, textW);
        else this.fit(cells[c.key] ?? '', x + pad, y0, c.width - pad * 2, { size: 7.5, align: c.align });
        x += c.width;
      }

      // Deductions already reflected in this line's stored value — shown, not applied again.
      let ay = y0 + descH + codeH + 3;
      const unit = columns.find((c) => c.key === 'unitAmount')!;
      const unitX = this.left + columns.slice(0, columns.indexOf(unit)).reduce((t, c) => t + c.width, 0);
      line.adjustments.forEach((a, i) => {
        this.draw(`${a.label} — ${a.note}`, this.left + columns[0]!.width + pad, ay, textW, { size: 7, color: MUTED });
        this.fit(a.amount, unitX + pad, ay, unit.width - pad * 2, { size: 7, color: MUTED, align: 'right' });
        ay += adjH[i]!;
      });

      this.y += rowH;
      this.doc.moveTo(this.left, this.y).lineTo(this.right, this.y).strokeColor(RULE).lineWidth(0.6).stroke();
    }
    this.y += 10;
  }

  private description(line: GstInvoiceLine, x: number, y: number, width: number): void {
    this.draw(line.description, x, y, width, { size: 7.5 });
    if (line.code) this.draw(line.code, x, y + this.measure(line.description, width, FONT_BODY, 7.5) + 1, width, { size: 6.5, color: MUTED });
  }

  // ── Totals (kept together) ─────────────────────────────
  private totals(): void {
    const boxW = 290;
    const amountW = 100;
    const labelW = boxW - amountW - 16;
    const x = this.right - boxW;
    const rows = this.d.totals.map((r) => ({ ...r, height: this.measure(r.label, labelW, FONT_BODY, 8.5) + 5 }));
    const grandH = 24;
    this.ensure(rows.reduce((t, r) => t + r.height, 0) + grandH + 6);

    for (const r of rows) {
      this.draw(r.label, x + 8, this.y + 3, labelW, { size: 8.5 });
      this.fit(r.amount, this.right - amountW - 8, this.y + 3, amountW, { size: 8.5, align: 'right' });
      this.y += r.height;
    }
    this.doc.rect(x, this.y + 2, boxW, grandH - 4).fill('#EDEFF2');
    this.draw('Grand total', x + 8, this.y + 7, labelW, { font: FONT_BOLD, size: 10, color: NAVY });
    this.fit(this.d.grandTotal, this.right - amountW - 8, this.y + 7, amountW, { font: FONT_BOLD, size: 10, color: NAVY, align: 'right' });
    this.y += grandH + 8;
  }

  // ── Summary by rate / treatment (kept together) ────────
  private summary(): void {
    if (this.d.summary.length === 0) return;
    const taxCols = this.d.taxColumns.map((t): Column => ({ key: TAX_KEY[t], header: `${t} (₹)`, width: 70, align: 'right' }));
    const columns: Column[] = [
      { key: 'label', header: 'GST rate / treatment', width: 110, align: 'left' },
      { key: 'lineCount', header: 'Lines', width: 36, align: 'right' },
      { key: 'value', header: 'Value before GST (₹)', width: 90, align: 'right' },
      ...taxCols,
      { key: 'tax', header: 'GST (₹)', width: 70, align: 'right' },
    ];
    const rowH = 13;
    this.ensure(16 + 18 + this.d.summary.length * rowH + 8);

    this.draw('SUMMARY BY GST RATE / TREATMENT', this.left, this.y, this.width, { font: FONT_BOLD, size: 7.5, color: NAVY });
    this.y += 14;
    let x = this.left;
    for (const c of columns) {
      this.fit(c.header, x + 3, this.y, c.width - 6, { font: FONT_BOLD, size: 7, color: MUTED, align: c.align });
      x += c.width;
    }
    this.y += 12;
    this.doc.moveTo(this.left, this.y).lineTo(x, this.y).strokeColor(RULE).lineWidth(0.6).stroke();
    for (const row of this.d.summary) {
      const cells: Record<string, string> = { label: row.label, lineCount: String(row.lineCount), value: row.value, cgst: row.cgst, sgst: row.sgst, igst: row.igst, tax: row.tax };
      let cx = this.left;
      for (const c of columns) {
        this.fit(cells[c.key] ?? '', cx + 3, this.y + 4, c.width - 6, { size: 7.5, align: c.align });
        cx += c.width;
      }
      this.y += rowH;
    }
    this.y += 10;
  }

  // ── Terms: flowed line by line, so long text continues on the next page instead of being cut ──
  private terms(): void {
    const terms = this.brand.terms?.trim();
    if (!terms) return;
    const size = 7.5;
    this.doc.font(FONT_BODY).fontSize(size);
    const lineH = this.doc.currentLineHeight() + 1.5;
    this.ensure(14 + lineH * 2);
    this.draw('TERMS & CONDITIONS', this.left, this.y, this.width, { font: FONT_BOLD, size: 7.5, color: NAVY });
    this.y += 13;
    for (const line of this.wrap(terms, this.width, size)) {
      this.ensure(lineH);
      if (line) this.doc.font(FONT_BODY).fontSize(size).fillColor('#555555').text(line, this.left, this.y, { width: this.width, lineBreak: false });
      this.y += lineH;
    }
  }

  /** Breaks text into lines that fit `width` (paragraph breaks kept as empty lines). */
  private wrap(text: string, width: number, size: number): string[] {
    this.doc.font(FONT_BODY).fontSize(size);
    const lines: string[] = [];
    for (const paragraph of text.split(/\r?\n/)) {
      let current = '';
      for (const word of paragraph.split(/\s+/).filter(Boolean)) {
        const candidate = current ? `${current} ${word}` : word;
        if (current && this.doc.widthOfString(candidate) > width) {
          lines.push(current);
          current = word;
        } else {
          current = candidate;
        }
      }
      lines.push(current);
    }
    return lines;
  }

  // ── Footer + page number on every page ─────────────────
  private footers(): void {
    const range = this.doc.bufferedPageRange();
    for (let i = 0; i < range.count; i += 1) {
      this.doc.switchToPage(range.start + i);
      drawBrandFooter(this.doc, this.brand);
      const base = this.doc.page.height - this.doc.page.margins.bottom;
      this.doc.font(FONT_BODY).fontSize(7).fillColor('#999999').text(`Page ${i + 1} of ${range.count}`, this.left, base - 13, { width: this.width, align: 'right', lineBreak: false });
    }
  }
}

interface Block {
  title: string;
  lines: { text: string; bold?: boolean }[];
}
