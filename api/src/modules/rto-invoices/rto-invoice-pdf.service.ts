import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { FONT_BODY, FONT_BOLD, GOLD, NAVY, drawBrandHeader, useBrandFonts, type PdfBrand } from '../../common/pdf/brand';
import type { Row, RtoInvoiceDocument } from './rto-invoice-document';

type Doc = PDFKit.PDFDocument;
const MARGIN = 36;
const LINE = '#C9D2DC';
const LABEL = '#5B6B7C';
const SHADE = '#F3F6F9';

/**
 * Prints an RTO invoice (see buildRtoInvoiceDocument) on one A4 page, after the dealer's reference vehicle
 * invoice: letterhead · dealer GSTIN / state / PAN · customer + invoice references · vehicle description ·
 * terms beside the amount box · grand total in figures and words · discount note · three signature lines.
 */
@Injectable()
export class RtoInvoicePdfService {
  render(d: RtoInvoiceDocument, brand: PdfBrand): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: MARGIN, bufferPages: true });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      try {
        useBrandFonts(doc);
        new Painter(doc, d, brand).paint();
        doc.end();
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  }
}

class Painter {
  private readonly left: number;
  private readonly width: number;
  private y = 0;

  constructor(
    private readonly doc: Doc,
    private readonly d: RtoInvoiceDocument,
    private readonly brand: PdfBrand,
  ) {
    this.left = doc.page.margins.left;
    this.width = doc.page.width - doc.page.margins.right - this.left;
  }

  paint(): void {
    // The GSTIN goes on the dealer line below, with the state and PAN.
    drawBrandHeader(this.doc, { ...this.brand, gstin: null }, { docType: this.d.title, infoLines: [`No: ${this.d.invoiceNumber}`, `Date: ${this.d.invoiceDate}`] });
    this.y = this.doc.y - 4;
    this.text(this.d.dealerLine, this.left, this.y, this.width, { font: FONT_BOLD, size: 8, color: NAVY, align: 'center' });
    this.y += 16;

    this.partiesBox();
    this.vehicleBox();
    this.termsAndAmounts();
    this.signatures();
  }

  // ── Customer (left) + invoice references (right) ────────
  private partiesBox(): void {
    const top = this.y;
    const refW = 190;
    const custW = this.width - refW;
    this.sectionTitle('CUSTOMER', this.left, top, custW);
    this.sectionTitle('INVOICE', this.left + custW, top, refW);
    const bodyTop = top + 16;
    // Customer rows in two columns so twelve fields stay compact.
    const half = Math.ceil(this.d.customer.length / 2);
    const colW = custW / 2;
    const leftEnd = this.rows(this.d.customer.slice(0, half), this.left + 6, bodyTop + 5, colW - 10, 62);
    const rightEnd = this.rows(this.d.customer.slice(half), this.left + colW + 4, bodyTop + 5, colW - 10, 62);
    const refEnd = this.rows(this.d.references, this.left + custW + 6, bodyTop + 5, refW - 12, 78);
    const bottom = Math.max(leftEnd, rightEnd, refEnd) + 5;
    this.box(this.left, top, custW, bottom - top);
    this.box(this.left + custW, top, refW, bottom - top);
    this.y = bottom + 10;
  }

  // ── Vehicle description ─────────────────────────────────
  private vehicleBox(): void {
    const top = this.y;
    this.sectionTitle('VEHICLE DESCRIPTION', this.left, top, this.width);
    const colW = this.width / 3;
    const per = Math.ceil(this.d.vehicle.length / 3);
    let end = top;
    for (let i = 0; i < 3; i++) {
      end = Math.max(end, this.rows(this.d.vehicle.slice(i * per, (i + 1) * per), this.left + 6 + i * colW, top + 21, colW - 12, 62, true));
    }
    const bottom = end + 5;
    this.box(this.left, top, this.width, bottom - top);
    this.y = bottom + 10;
  }

  // ── Terms (left) + amount box (right), then the grand total band ──
  private termsAndAmounts(): void {
    const top = this.y;
    const amountW = 220;
    const termsW = this.width - amountW;

    this.sectionTitle('TERMS & CONDITIONS', this.left, top, termsW);
    this.sectionTitle('AMOUNT (INR)', this.left + termsW, top, amountW);
    let ty = top + 21;
    const terms = this.brand.terms?.trim() ? this.brand.terms.trim().split(/\r?\n/).filter((l) => l.trim()) : ['Goods once sold will not be taken back.'];
    for (const t of terms) {
      this.doc.font(FONT_BODY).fontSize(7).fillColor('#444444');
      const h = this.doc.heightOfString(t, { width: termsW - 12 });
      this.doc.text(t, this.left + 6, ty, { width: termsW - 12 });
      ty += h + 2;
    }

    let ay = top + 21;
    const ax = this.left + termsW + 8;
    const aw = amountW - 16;
    this.d.amounts.forEach((row, i) => {
      const last = i === this.d.amounts.length - 1;
      if (last) {
        this.doc.moveTo(ax, ay - 2).lineTo(ax + aw, ay - 2).strokeColor(LINE).lineWidth(0.6).stroke();
        ay += 2;
      }
      this.text(row.label, ax, ay, aw * 0.6, { font: last ? FONT_BOLD : FONT_BODY, size: 8.5 });
      this.text(row.value, ax + aw * 0.4, ay, aw * 0.6, { font: last ? FONT_BOLD : FONT_BODY, size: 8.5, align: 'right' });
      ay += 14;
    });
    this.text(this.d.supplyLabel, ax, ay + 2, aw, { size: 7, color: LABEL });
    ay += 14;

    const bottom = Math.max(ty, ay) + 6;
    this.box(this.left, top, termsW, bottom - top);
    this.box(this.left + termsW, top, amountW, bottom - top);

    // Grand total band: words on the left (the band grows when they wrap), figure on the right.
    const words = this.d.amountInWords.toUpperCase();
    this.doc.font(FONT_BOLD).fontSize(7.5);
    const wordsH = this.doc.heightOfString(words, { width: termsW - 12 });
    const bandH = Math.max(24, wordsH + 14);
    this.doc.rect(this.left, bottom, this.width, bandH).fillAndStroke(SHADE, LINE);
    this.text(words, this.left + 6, bottom + (bandH - wordsH) / 2, termsW - 12, { font: FONT_BOLD, size: 7.5, color: NAVY });
    this.text('GRAND TOTAL', this.left + termsW + 8, bottom + bandH / 2 - 5, 90, { font: FONT_BOLD, size: 9, color: NAVY });
    this.text(this.d.grandTotal, this.left + termsW + 8, bottom + bandH / 2 - 6, amountW - 16, { font: FONT_BOLD, size: 10, color: NAVY, align: 'right' });
    this.y = bottom + bandH + 6;

    if (this.d.discountNote) {
      this.text(`NOTE: ${this.d.discountNote}`, this.left, this.y, this.width, { font: FONT_BOLD, size: 8 });
      this.y += 14;
    }
  }

  // ── Signatures + jurisdiction, anchored to the bottom of the page ──
  private signatures(): void {
    const base = this.doc.page.height - this.doc.page.margins.bottom;
    const sigY = Math.max(this.y + 46, base - 70);
    const colW = this.width / 3;
    this.text(`For, ${this.d.dealerName}`, this.left + colW * 2, sigY - 40, colW, { font: FONT_BOLD, size: 8.5, color: NAVY, align: 'right' });
    this.text(this.d.preparedBy, this.left + colW, sigY - 12, colW, { size: 8, align: 'center', color: LABEL });
    const labels = ['Customer Signature', 'Prepared By', 'Authorised Signatory'];
    labels.forEach((label, i) => {
      const x = this.left + colW * i + 10;
      const w = colW - 20;
      this.doc.moveTo(x, sigY).lineTo(x + w, sigY).strokeColor('#888888').lineWidth(0.6).stroke();
      this.text(label, x, sigY + 4, w, { font: FONT_BOLD, size: 8, align: i === 0 ? 'left' : i === 1 ? 'center' : 'right' });
    });
    const footY = sigY + 26;
    this.doc.moveTo(this.left, footY).lineTo(this.left + this.width, footY).strokeColor('#EEEEEE').lineWidth(1).stroke();
    if (this.d.jurisdiction) this.text(this.d.jurisdiction, this.left, footY + 6, this.width / 2, { size: 7.5, color: LABEL });
    this.text('Computer-generated document', this.left + this.width / 2, footY + 6, this.width / 2, { size: 7, color: '#999999', align: 'right' });
    this.text(this.brand.tagline, this.left, footY + 6, this.width, { font: FONT_BOLD, size: 7, color: GOLD, align: 'center' });
  }

  // ── Helpers ─────────────────────────────────────────────
  /** Label / value rows; returns the y below the last row. */
  private rows(rows: Row[], x: number, y: number, width: number, labelW: number, mono = false): number {
    let cy = y;
    for (const r of rows) {
      this.text(r.label, x, cy, labelW, { size: 7.5, color: LABEL });
      this.doc.font(mono ? FONT_BOLD : FONT_BODY).fontSize(8.5);
      const h = Math.max(11, this.doc.heightOfString(r.value, { width: width - labelW }));
      this.doc.fillColor('#000000').text(r.value, x + labelW, cy - 0.5, { width: width - labelW });
      cy += h + 3;
    }
    return cy;
  }

  private sectionTitle(title: string, x: number, y: number, width: number): void {
    this.doc.rect(x, y, width, 15).fill(NAVY);
    this.text(title, x + 6, y + 4, width - 12, { font: FONT_BOLD, size: 7.5, color: '#FFFFFF' });
  }

  private box(x: number, y: number, w: number, h: number): void {
    this.doc.rect(x, y, w, h).strokeColor(LINE).lineWidth(0.8).stroke();
  }

  private text(value: string, x: number, y: number, width: number, o: { font?: string; size?: number; color?: string; align?: 'left' | 'right' | 'center' } = {}): void {
    this.doc.font(o.font ?? FONT_BODY).fontSize(o.size ?? 8).fillColor(o.color ?? '#000000').text(value, x, y, { width, align: o.align ?? 'left', lineBreak: true });
  }
}
