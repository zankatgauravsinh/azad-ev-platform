import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import type { AccessorySaleDetailDto } from '@azad/shared';
import { FONT_BODY, FONT_BOLD, GOLD, NAVY, drawBrandHeader, useBrandFonts, type PdfBrand } from '../../common/pdf/brand';
import { formatInrExact } from '../../common/utils/money';
import { rupeesInWords } from '../../common/utils/amount-in-words';

type Doc = PDFKit.PDFDocument;
const LINE = '#C9D2DC';
const LABEL = '#5B6B7C';
const SHADE = '#F3F6F9';

export interface AccessoryInvoiceInput {
  sale: AccessorySaleDetailDto;
  customer: { name: string; phone: string; address: string | null; village: string | null; city: string | null; district: string | null; state: string | null; pin: string | null; gstin: string | null } | null;
  dealer: { gstin: string | null; state: string | null; stateCode: string | null };
  timeZone: string;
}

const inr = (paise: string | bigint): string => formatInrExact(BigInt(paise));
const pct = (bp: number): string => `${(bp / 100).toFixed(bp % 100 === 0 ? 0 : 2)}%`;

/**
 * The accessory counter-sale invoice: TAX INVOICE when it carries GST (prices include GST; each line's GST is shown
 * and the total splits into CGST + SGST or IGST), otherwise a plain INVOICE. A cancelled invoice is stamped CANCELLED.
 */
@Injectable()
export class AccessoryInvoicePdfService {
  render(input: AccessoryInvoiceInput, brand: PdfBrand): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 36, bufferPages: true });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      try {
        useBrandFonts(doc);
        new Painter(doc, input, brand).paint();
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
    private readonly input: AccessoryInvoiceInput,
    private readonly brand: PdfBrand,
  ) {
    this.left = doc.page.margins.left;
    this.width = doc.page.width - doc.page.margins.right - this.left;
  }

  private get s(): AccessorySaleDetailDto {
    return this.input.sale;
  }

  private date(iso: string): string {
    return new Date(iso).toLocaleDateString('en-IN', { timeZone: this.input.timeZone, day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  paint(): void {
    const gst = this.s.gstApplied;
    drawBrandHeader(this.doc, { ...this.brand, gstin: null }, { docType: gst ? 'TAX INVOICE' : 'INVOICE', infoLines: [`No: ${this.s.invoiceNumber}`, `Date: ${this.date(this.s.invoiceDate)}`], badge: this.s.status === 'CANCELLED' ? 'CANCELLED' : null });
    this.y = this.doc.y - 4;
    const d = this.input.dealer;
    const dealerBits = [gst && d.gstin ? `GSTIN: ${d.gstin}` : null, d.state ? `State: ${d.state}${d.stateCode ? ` (${d.stateCode})` : ''}` : null].filter(Boolean);
    if (dealerBits.length) {
      this.text(dealerBits.join('   ·   '), this.left, this.y, this.width, { font: FONT_BOLD, size: 8, color: NAVY, align: 'center' });
      this.y += 16;
    }
    this.parties();
    this.items();
    this.totals();
    this.payments();
    this.signatures();
    if (this.s.status === 'CANCELLED') this.cancelledStamp();
  }

  // ── Bill to (left) + invoice details (right) ──
  private parties(): void {
    const top = this.y;
    const rightW = 200;
    const leftW = this.width - rightW;
    this.title('BILL TO', this.left, top, leftW);
    this.title('INVOICE', this.left + leftW, top, rightW);
    const c = this.input.customer;
    const address = c ? [c.address, c.village, c.city, c.district, c.state, c.pin].filter((x) => x && x.trim()).join(', ') : '';
    const custRows: [string, string][] = [
      ['Name', c?.name ?? this.s.customer.name],
      ['Phone', c?.phone ?? this.s.customer.phone],
      ...(address ? ([['Address', address]] as [string, string][]) : []),
      ...(c?.gstin ? ([['GSTIN', c.gstin]] as [string, string][]) : []),
    ];
    const refRows: [string, string][] = [
      ['Invoice No.', this.s.invoiceNumber],
      ['Date', this.date(this.s.invoiceDate)],
      ...(this.s.booking ? ([['Booking', this.s.booking.code]] as [string, string][]) : []),
      ...(this.s.gstApplied ? ([['Supply', this.s.supplyType === 'INTER' ? 'Inter-state (IGST)' : 'Within state (CGST + SGST)']] as [string, string][]) : []),
    ];
    const leftEnd = this.rows(custRows, this.left + 6, top + 21, leftW - 12, 52);
    const rightEnd = this.rows(refRows, this.left + leftW + 6, top + 21, rightW - 12, 62);
    const bottom = Math.max(leftEnd, rightEnd) + 4;
    this.box(this.left, top, leftW, bottom - top);
    this.box(this.left + leftW, top, rightW, bottom - top);
    this.y = bottom + 10;
  }

  // ── Line items ──
  private items(): void {
    const gst = this.s.gstApplied;
    const cols = gst
      ? [{ h: '#', w: 0.05 }, { h: 'Item', w: 0.33 }, { h: 'HSN', w: 0.1 }, { h: 'Qty', w: 0.06, r: true }, { h: 'Rate', w: 0.12, r: true }, { h: 'GST', w: 0.08, r: true }, { h: 'GST amt', w: 0.12, r: true }, { h: 'Amount', w: 0.14, r: true }]
      : [{ h: '#', w: 0.06 }, { h: 'Item', w: 0.52 }, { h: 'Qty', w: 0.1, r: true }, { h: 'Rate', w: 0.16, r: true }, { h: 'Amount', w: 0.16, r: true }];
    const widths = cols.map((c) => c.w * this.width);
    const xs = widths.map((_, i) => this.left + widths.slice(0, i).reduce((a, b) => a + b, 0));
    this.doc.rect(this.left, this.y, this.width, 18).fill(NAVY);
    cols.forEach((c, i) => this.text(c.h, xs[i]! + 4, this.y + 5, widths[i]! - 8, { font: FONT_BOLD, size: 8, color: '#FFFFFF', align: c.r ? 'right' : 'left' }));
    this.y += 18;
    this.s.items.forEach((it, idx) => {
      const name = it.sku ? `${it.name}\n${it.sku}` : it.name;
      const cells = gst
        ? [String(idx + 1), name, it.hsnCode ?? '—', String(it.qty), inr(it.unitPrice), pct(it.gstRateBp), inr(it.gstAmount), inr(it.lineTotal)]
        : [String(idx + 1), name, String(it.qty), inr(it.unitPrice), inr(it.lineTotal)];
      this.doc.font(FONT_BODY).fontSize(8.5);
      const h = Math.max(16, ...cells.map((cell, i) => this.doc.heightOfString(cell, { width: widths[i]! - 8 }))) + 6;
      if (idx % 2 === 1) this.doc.rect(this.left, this.y, this.width, h).fill(SHADE);
      cells.forEach((cell, i) => this.text(cell, xs[i]! + 4, this.y + 4, widths[i]! - 8, { size: 8.5, font: i === 1 ? FONT_BOLD : FONT_BODY, align: cols[i]!.r ? 'right' : 'left' }));
      this.y += h;
    });
    this.doc.moveTo(this.left, this.y).lineTo(this.left + this.width, this.y).strokeColor(LINE).lineWidth(0.8).stroke();
    this.y += 8;
  }

  // ── Totals (right) + amount in words (left) ──
  private totals(): void {
    const boxW = 230;
    const x = this.left + this.width - boxW;
    const rows: [string, string, boolean?][] = [];
    if (this.s.gstApplied) {
      rows.push(['Taxable value', inr(this.s.subtotal)]);
      if (this.s.supplyType === 'INTER') rows.push(['IGST', inr(this.s.igst)]);
      else rows.push(['CGST', inr(this.s.cgst)], ['SGST', inr(this.s.sgst)]);
    }
    rows.push(['Total', inr(this.s.total), true]);
    if (this.s.status !== 'CANCELLED') {
      rows.push(['Paid', inr(this.s.paid)], ['Balance due', inr(this.s.balance), true]);
    } else if (this.s.refunded !== '0') {
      rows.push(['Refunded', inr(this.s.refunded)]);
    }
    let ry = this.y;
    for (const [label, value, bold] of rows) {
      this.text(label, x, ry, boxW * 0.55, { font: bold ? FONT_BOLD : FONT_BODY, size: 9 });
      this.text(value, x + boxW * 0.4, ry, boxW * 0.6, { font: bold ? FONT_BOLD : FONT_BODY, size: 9, align: 'right' });
      ry += 15;
    }
    const wordsW = this.width - boxW - 16;
    this.text('Amount in words', this.left, this.y, wordsW, { size: 7.5, color: LABEL });
    this.text(rupeesInWords(BigInt(this.s.total)).toUpperCase(), this.left, this.y + 11, wordsW, { font: FONT_BOLD, size: 8.5, color: NAVY });
    if (this.s.gstApplied) this.text('Prices include GST.', this.left, this.doc.y + 4, wordsW, { size: 7.5, color: LABEL });
    if (this.s.notes) this.text(`Note: ${this.s.notes}`, this.left, this.doc.y + 4, wordsW, { size: 8 });
    this.y = Math.max(ry, this.doc.y) + 10;
  }

  private payments(): void {
    if (!this.s.payments.length) return;
    this.text('PAYMENTS RECEIVED', this.left, this.y, this.width, { font: FONT_BOLD, size: 8, color: GOLD });
    this.y += 13;
    for (const p of this.s.payments) {
      this.text(`${this.date(p.paidAt)} · ${p.receiptNumber ?? 'Receipt'} · ${p.mode.replace('_', ' ')}${p.reference ? ` (${p.reference})` : ''}`, this.left, this.y, this.width * 0.7, { size: 8 });
      this.text(inr(p.amount), this.left + this.width * 0.7, this.y, this.width * 0.3, { size: 8, align: 'right' });
      this.y += 12;
    }
    this.y += 6;
  }

  private signatures(): void {
    const base = this.doc.page.height - this.doc.page.margins.bottom;
    const terms = this.brand.terms?.trim();
    const sigY = Math.max(this.y + 90, base - 60);
    if (terms) {
      this.text('TERMS & CONDITIONS', this.left, this.y, this.width, { font: FONT_BOLD, size: 7.5, color: LABEL });
      this.text(terms, this.left, this.y + 11, this.width * 0.6, { size: 7, color: '#444444' });
    }
    const colW = this.width / 2;
    this.text(`For, ${this.brand.name}`, this.left + colW, sigY - 60, colW, { font: FONT_BOLD, size: 8.5, color: NAVY, align: 'right' });
    this.doc.moveTo(this.left, sigY).lineTo(this.left + colW - 30, sigY).strokeColor('#888888').lineWidth(0.6).stroke();
    this.doc.moveTo(this.left + colW + 30, sigY).lineTo(this.left + this.width, sigY).strokeColor('#888888').lineWidth(0.6).stroke();
    this.text('Customer Signature', this.left, sigY + 4, colW - 30, { font: FONT_BOLD, size: 8 });
    this.text('Authorised Signatory', this.left + colW + 30, sigY + 4, colW - 30, { font: FONT_BOLD, size: 8, align: 'right' });
    this.text(this.brand.tagline, this.left, sigY + 24, this.width, { font: FONT_BOLD, size: 7, color: GOLD, align: 'center' });
  }

  private cancelledStamp(): void {
    this.doc.save();
    this.doc.rotate(-30, { origin: [this.doc.page.width / 2, this.doc.page.height / 2] });
    this.doc.font(FONT_BOLD).fontSize(72).fillColor('#B23A48').opacity(0.12).text('CANCELLED', 0, this.doc.page.height / 2 - 40, { width: this.doc.page.width, align: 'center', lineBreak: false });
    this.doc.restore();
    this.doc.opacity(1);
  }

  // ── Helpers ──
  private rows(rows: [string, string][], x: number, y: number, width: number, labelW: number): number {
    let cy = y;
    for (const [label, value] of rows) {
      this.text(label, x, cy, labelW, { size: 7.5, color: LABEL });
      this.doc.font(FONT_BODY).fontSize(8.5);
      const h = Math.max(11, this.doc.heightOfString(value, { width: width - labelW }));
      this.doc.fillColor('#000000').text(value, x + labelW, cy - 0.5, { width: width - labelW });
      cy += h + 3;
    }
    return cy;
  }

  private title(title: string, x: number, y: number, width: number): void {
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
