import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import type { CashBookDto, ExpenseDto, IncomeDto, VendorLedgerDto } from '@azad/shared';
import { formatInr } from '../../common/utils/money';
import { drawBrandHeader, drawBrandFooter, useBrandFonts, NAVY, GOLD, FONT_BODY, FONT_BOLD, type PdfBrand } from '../../common/pdf/brand';

const d = (iso: string): string => new Date(iso).toLocaleDateString('en-IN');

@Injectable()
export class FinancePdfService {
  /** Expense voucher (money out) or receipt voucher (money in), sharing one layout. */
  expenseVoucher(brand: PdfBrand, e: ExpenseDto): Promise<Buffer> {
    return this.build((doc, left, right) => {
      drawBrandHeader(doc, brand, { docType: e.paid ? 'PAYMENT VOUCHER' : 'EXPENSE VOUCHER', infoLines: [`No: ${e.expenseNumber}`, `Date: ${d(e.expenseDate)}`], badge: e.status });
      this.grid(doc, left, right, [
        ['Category', e.category],
        ['Vendor', e.vendorName ?? '—'],
        ['Payment', e.paymentMethod.replace(/_/g, ' ')],
        ['Reference', e.referenceNumber ?? '—'],
        ['Paid', e.paid ? 'Yes' : 'Pending'],
        ['Due', e.dueDate ? d(e.dueDate) : '—'],
      ]);
      if (e.description) {
        doc.moveDown(0.4).fillColor('#555').font(FONT_BODY).fontSize(9).text(e.description, left, doc.y, { width: right - left });
      }
      this.amountBox(doc, left, right, [
        ['Amount', e.amount],
        ['GST', e.gstAmount],
        ['Total', e.total],
      ]);
      drawBrandFooter(doc, brand);
    });
  }

  receiptVoucher(brand: PdfBrand, i: IncomeDto): Promise<Buffer> {
    return this.build((doc, left, right) => {
      drawBrandHeader(doc, brand, { docType: 'RECEIPT VOUCHER', infoLines: [`No: ${i.incomeNumber}`, `Date: ${d(i.incomeDate)}`] });
      this.grid(doc, left, right, [
        ['Source', i.source.replace(/_/g, ' ')],
        ['Customer', i.customerName ?? '—'],
        ['Payment', i.paymentMethod.replace(/_/g, ' ')],
        ['Reference', i.referenceNumber ?? '—'],
      ]);
      if (i.description) doc.moveDown(0.4).fillColor('#555').font(FONT_BODY).fontSize(9).text(i.description, left, doc.y, { width: right - left });
      this.amountBox(doc, left, right, [
        ['Amount', i.amount],
        ['GST', i.gstAmount],
        ['Total', i.total],
      ]);
      drawBrandFooter(doc, brand);
    });
  }

  vendorLedger(brand: PdfBrand, ledger: VendorLedgerDto): Promise<Buffer> {
    return this.build((doc, left, right) => {
      const v = ledger.vendor;
      drawBrandHeader(doc, brand, { docType: 'VENDOR LEDGER', infoLines: [`Vendor: ${v.vendorNumber}`, v.name], badge: v.status });
      this.grid(doc, left, right, [
        ['Mobile', v.mobile ?? '—'],
        ['GSTIN', v.gstNumber ?? '—'],
        ['Total purchases', formatInr(BigInt(v.totalPurchases))],
        ['Outstanding', formatInr(BigInt(v.outstanding))],
      ]);
      this.sectionTitle(doc, left, 'Transactions');
      let running = 0n;
      this.table(doc, left, right, ['Date', 'Expense', 'Category', 'Amount', 'Running'], [0.16, 0.18, 0.28, 0.19, 0.19], ledger.rows.map((r) => {
        running += BigInt(r.amount);
        return [d(r.date), r.expenseNumber, r.category, formatInr(BigInt(r.amount)), formatInr(running)];
      }));
      drawBrandFooter(doc, brand);
    });
  }

  cashBook(brand: PdfBrand, cb: CashBookDto): Promise<Buffer> {
    return this.build((doc, left, right) => {
      drawBrandHeader(doc, brand, { docType: 'CASH BOOK', infoLines: [`Date: ${d(cb.date)}`] });
      this.grid(doc, left, right, [
        ['Opening', formatInr(BigInt(cb.opening))],
        ['Cash in', formatInr(BigInt(cb.cashIn))],
        ['Cash out', formatInr(BigInt(cb.cashOut))],
        ['Closing', formatInr(BigInt(cb.closing))],
      ]);
      this.sectionTitle(doc, left, 'Entries');
      this.table(doc, left, right, ['Time', 'Particulars', 'In', 'Out'], [0.16, 0.5, 0.17, 0.17], cb.rows.map((r) => [
        new Date(r.at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
        r.label,
        BigInt(r.inAmount) > 0n ? formatInr(BigInt(r.inAmount)) : '—',
        BigInt(r.outAmount) > 0n ? formatInr(BigInt(r.outAmount)) : '—',
      ]));
      drawBrandFooter(doc, brand);
    });
  }

  // ── Drawing helpers (shared style with the warranty PDFs) ──
  private build(draw: (doc: PDFKit.PDFDocument, left: number, right: number) => void): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 48 });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      useBrandFonts(doc);
      draw(doc, doc.page.margins.left, doc.page.width - doc.page.margins.right);
      doc.end();
    });
  }

  private grid(doc: PDFKit.PDFDocument, left: number, right: number, rows: [string, string][]): void {
    const colGap = 16;
    const colW = (right - left - colGap) / 2;
    let y = doc.y + 6;
    for (let i = 0; i < rows.length; i += 2) {
      for (let c = 0; c < 2 && i + c < rows.length; c += 1) {
        const pair = rows[i + c];
        if (!pair) continue;
        const x = left + c * (colW + colGap);
        doc.fillColor('#888').font(FONT_BODY).fontSize(7).text(pair[0].toUpperCase(), x, y, { width: colW });
        doc.fillColor(NAVY).font(FONT_BOLD).fontSize(10).text(pair[1], x, y + 9, { width: colW, lineBreak: false, ellipsis: true });
      }
      y += 26;
    }
    doc.y = y + 4;
  }

  private amountBox(doc: PDFKit.PDFDocument, left: number, right: number, lines: [string, string][]): void {
    const boxW = 220;
    const x = right - boxW;
    let y = doc.y + 10;
    for (const [label, amount] of lines) {
      const bold = label === 'Total';
      doc.fillColor(bold ? NAVY : '#555').font(bold ? FONT_BOLD : FONT_BODY).fontSize(bold ? 12 : 10);
      doc.text(label, x, y, { width: 100 });
      doc.text(formatInr(BigInt(amount)), x + 100, y, { width: boxW - 100, align: 'right' });
      y += bold ? 20 : 16;
    }
    doc.y = y + 4;
  }

  private sectionTitle(doc: PDFKit.PDFDocument, left: number, title: string): void {
    if (doc.y > doc.page.height - 140) doc.addPage();
    doc.moveDown(0.4);
    doc.fillColor(GOLD).font(FONT_BOLD).fontSize(10).text(title.toUpperCase(), left, doc.y, { characterSpacing: 1 });
    doc.moveDown(0.6);
  }

  private table(doc: PDFKit.PDFDocument, left: number, right: number, headers: string[], weights: number[], rows: string[][]): void {
    const width = right - left;
    const cols = weights.map((wt) => wt * width);
    const cw = (i: number): number => cols[i] ?? 0;
    const x = (i: number): number => left + cols.slice(0, i).reduce((a, b) => a + b, 0);
    let y = doc.y;
    doc.rect(left, y, width, 18).fill(NAVY);
    doc.fillColor('#fff').font(FONT_BOLD).fontSize(8);
    headers.forEach((h, i) => doc.text(h, x(i) + 4, y + 5, { width: cw(i) - 8, lineBreak: false, ellipsis: true }));
    y += 18;
    doc.font(FONT_BODY).fontSize(8.5);
    rows.forEach((row, ri) => {
      const rowH = Math.max(16, ...row.map((cell, i) => doc.heightOfString(cell, { width: cw(i) - 8 }))) + 6;
      if (y + rowH > doc.page.height - 90) { doc.addPage(); y = doc.page.margins.top; }
      if (ri % 2 === 1) doc.rect(left, y, width, rowH).fill('#F4F6F8');
      row.forEach((cell, i) => {
        doc.fillColor('#222').font(i === 0 ? FONT_BOLD : FONT_BODY).text(cell, x(i) + 4, y + 4, { width: cw(i) - 8 });
      });
      y += rowH;
    });
    doc.y = y + 6;
  }
}
