import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import {
  PURCHASE_ORDER_STATUS_LABEL,
  type CashBookDto,
  type ExpenseDto,
  type IncomeDto,
  type PurchaseOrderDetailDto,
  type VendorLedgerDto,
  type VendorPaymentDto,
  type VendorStatementDto,
} from '@azad/shared';
import { formatInrExact } from '../../common/utils/money';
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
        ['Total purchases', formatInrExact(BigInt(v.totalPurchases))],
        ['Outstanding', formatInrExact(BigInt(v.outstanding))],
      ]);
      this.sectionTitle(doc, left, 'Transactions');
      let running = 0n;
      this.table(doc, left, right, ['Date', 'Expense', 'Category', 'Amount', 'Running'], [0.16, 0.18, 0.28, 0.19, 0.19], ledger.rows.map((r) => {
        running += BigInt(r.amount);
        return [d(r.date), r.expenseNumber, r.category, formatInrExact(BigInt(r.amount)), formatInrExact(running)];
      }));
      drawBrandFooter(doc, brand);
    });
  }

  /** What was paid to a vendor, and which bills it settled (the rest is an advance). */
  vendorPaymentVoucher(brand: PdfBrand, p: VendorPaymentDto): Promise<Buffer> {
    return this.build((doc, left, right) => {
      drawBrandHeader(doc, brand, { docType: 'PAYMENT VOUCHER', infoLines: [`No: ${p.paymentNumber}`, `Date: ${d(p.paidAt)}`], badge: p.status === 'CANCELLED' ? 'CANCELLED' : undefined });
      this.grid(doc, left, right, [
        ['Paid to', p.vendorName],
        ['Paid by', p.method.replace(/_/g, ' ')],
        ['Reference', p.reference ?? '—'],
        ['Against order', p.poNumber ?? '—'],
      ]);
      if (p.notes) doc.moveDown(0.4).fillColor('#555').font(FONT_BODY).fontSize(9).text(p.notes, left, doc.y, { width: right - left });
      if (p.allocations.length) {
        this.sectionTitle(doc, left, 'Bills settled');
        this.table(doc, left, right, ['Bill', 'Details', 'Applied on', 'Amount'], [0.22, 0.44, 0.15, 0.19], p.allocations.map((a) => [a.billNumber, a.description, d(a.appliedAt), formatInrExact(BigInt(a.amount))]));
      }
      const lines: [string, string][] = [['Applied to bills', p.applied]];
      if (BigInt(p.unapplied) > 0n) lines.push(['Advance', p.unapplied]);
      lines.push(['Total', p.amount]);
      this.amountBox(doc, left, right, lines);
      if (p.status === 'CANCELLED') doc.moveDown(0.4).fillColor('#B91C1C').font(FONT_BOLD).fontSize(9).text(`Cancelled${p.cancelReason ? ` — ${p.cancelReason}` : ''}`, left, doc.y);
      this.signatures(doc, left, right, ['Prepared by', 'Received by (vendor)']);
      drawBrandFooter(doc, brand);
    });
  }

  /** A vendor's account for a period: opening balance, bills and payments with the running balance, closing. */
  vendorStatement(brand: PdfBrand, st: VendorStatementDto): Promise<Buffer> {
    return this.build((doc, left, right) => {
      const period = `${st.from ? d(st.from) : 'Beginning'} – ${d(st.to)}`;
      drawBrandHeader(doc, brand, { docType: 'VENDOR STATEMENT', infoLines: [`Vendor: ${st.vendor.vendorNumber}`, st.vendor.name, period] });
      this.grid(doc, left, right, [
        ['GSTIN', st.vendor.gstNumber ?? '—'],
        ['Address', st.vendor.address ?? '—'],
        ['Opening balance', formatInrExact(BigInt(st.opening))],
        ['Closing balance', formatInrExact(BigInt(st.closing))],
      ]);
      this.sectionTitle(doc, left, 'Account');
      const money = (v: string): string => (BigInt(v) === 0n ? '' : formatInrExact(BigInt(v)));
      this.table(doc, left, right, ['Date', 'Number', 'Particulars', 'Billed', 'Paid', 'Balance'], [0.11, 0.15, 0.32, 0.14, 0.14, 0.14], [
        ['', '', 'Opening balance', '', '', formatInrExact(BigInt(st.opening))],
        ...st.rows.map((r) => [d(r.date), r.number, r.description, money(r.billed), money(r.paid), formatInrExact(BigInt(r.balance))]),
      ]);
      this.amountBox(doc, left, right, [
        ['Billed in period', st.totalBilled],
        ['Paid in period', st.totalPaid],
        ['Closing balance', st.closing],
      ]);
      doc.fillColor('#666').font(FONT_BODY).fontSize(8).text(
        `Balance = owed to the vendor (a negative balance is an advance with the vendor).${st.costHidden ? ' Scooter and accessory purchase bills are not shown (purchase cost).' : ''}`,
        left,
        doc.y,
        { width: right - left },
      );
      drawBrandFooter(doc, brand);
    });
  }

  /** The order sent to the vendor: lines with price before GST, GST and total; PI reference and expected date. */
  purchaseOrder(brand: PdfBrand, po: PurchaseOrderDetailDto, vendor: { name: string; gstNumber: string | null; address: string | null; mobile: string | null }): Promise<Buffer> {
    return this.build((doc, left, right) => {
      drawBrandHeader(doc, brand, { docType: 'PURCHASE ORDER', infoLines: [`No: ${po.poNumber}`, `Date: ${d(po.orderDate)}`], badge: po.status === 'DRAFT' || po.status === 'CANCELLED' ? PURCHASE_ORDER_STATUS_LABEL[po.status].toUpperCase() : undefined });
      this.grid(doc, left, right, [
        ['Vendor', vendor.name],
        ['Vendor GSTIN', vendor.gstNumber ?? '—'],
        ['Vendor address', vendor.address ?? '—'],
        ['Vendor phone', vendor.mobile ?? '—'],
        ['Proforma invoice', po.piNumber ? `${po.piNumber}${po.piDate ? ` · ${d(po.piDate)}` : ''}` : '—'],
        ['Expected by', po.expectedDate ? d(po.expectedDate) : '—'],
      ]);
      this.sectionTitle(doc, left, 'Items');
      this.table(doc, left, right, ['#', 'Item', 'Qty', 'Rate', 'GST', 'Amount'], [0.06, 0.4, 0.08, 0.16, 0.14, 0.16], po.lines.map((l, i) => [
        String(i + 1),
        l.description,
        String(l.quantity),
        formatInrExact(BigInt(l.unitCost)),
        `${(l.gstRateBp / 100).toFixed(l.gstRateBp % 100 ? 2 : 0)}% · ${formatInrExact(BigInt(l.gstAmount))}`,
        formatInrExact(BigInt(l.lineTotal)),
      ]));
      this.amountBox(doc, left, right, [
        ['Before GST', po.subtotal],
        ['GST', po.gstAmount],
        ['Total', po.total],
      ]);
      if (po.notes) {
        this.sectionTitle(doc, left, 'Notes');
        doc.fillColor('#333').font(FONT_BODY).fontSize(9).text(po.notes, left, doc.y, { width: right - left });
      }
      this.signatures(doc, left, right, ['Authorised signatory']);
      drawBrandFooter(doc, brand);
    });
  }

  cashBook(brand: PdfBrand, cb: CashBookDto): Promise<Buffer> {
    return this.build((doc, left, right) => {
      drawBrandHeader(doc, brand, { docType: 'CASH BOOK', infoLines: [`Date: ${d(cb.date)}`] });
      this.grid(doc, left, right, [
        ['Opening', formatInrExact(BigInt(cb.opening))],
        ['Cash in', formatInrExact(BigInt(cb.cashIn))],
        ['Cash out', formatInrExact(BigInt(cb.cashOut))],
        ['Closing', formatInrExact(BigInt(cb.closing))],
      ]);
      this.sectionTitle(doc, left, 'Entries');
      this.table(doc, left, right, ['Time', 'Particulars', 'In', 'Out'], [0.16, 0.5, 0.17, 0.17], cb.rows.map((r) => [
        new Date(r.at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
        r.label,
        BigInt(r.inAmount) > 0n ? formatInrExact(BigInt(r.inAmount)) : '—',
        BigInt(r.outAmount) > 0n ? formatInrExact(BigInt(r.outAmount)) : '—',
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
      const bold = label === 'Total' || label === 'Closing balance';
      doc.fillColor(bold ? NAVY : '#555').font(bold ? FONT_BOLD : FONT_BODY).fontSize(bold ? 12 : 10);
      doc.text(label, x, y, { width: 100 });
      doc.text(formatInrExact(BigInt(amount)), x + 100, y, { width: boxW - 100, align: 'right' });
      y += bold ? 20 : 16;
    }
    doc.y = y + 4;
  }

  private signatures(doc: PDFKit.PDFDocument, left: number, right: number, labels: string[]): void {
    if (doc.y > doc.page.height - 160) doc.addPage();
    const y = doc.y + 46;
    const w = (right - left) / labels.length;
    labels.forEach((label, i) => {
      const x = left + i * w + (labels.length === 1 ? w - 180 : 0);
      doc.moveTo(x, y).lineTo(x + 160, y).strokeColor('#999').lineWidth(0.5).stroke();
      doc.fillColor('#555').font(FONT_BODY).fontSize(8).text(label, x, y + 4, { width: 160, align: 'center' });
    });
    doc.y = y + 20;
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
