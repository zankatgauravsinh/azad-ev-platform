import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { DELIVERY_CHECKLIST_ITEMS, type DeliveryDetailDto } from '@azad/shared';
import { formatInrExact } from '../../common/utils/money';
import { drawBrandHeader, drawBrandFooter, useBrandFonts, NAVY, TEAL, GOLD, FONT_BODY, FONT_BOLD, type PdfBrand } from '../../common/pdf/brand';

const LABELS: Record<string, string> = {
  keys: 'Keys', charged: 'Vehicle charged', charger: 'Charger', helmet: 'Helmet', accessoriesFitted: 'Accessories fitted',
  documents: 'KYC documents', invoice: 'Tax invoice', insurance: 'Insurance policy', rcBook: 'RC / registration', warrantyCard: 'Warranty card',
};
const d = (iso: string): string => new Date(iso).toLocaleDateString('en-IN');

@Injectable()
export class DeliveryPdfService {
  deliveryNote(brand: PdfBrand, detail: DeliveryDetailDto): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 48 });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      useBrandFonts(doc);
      const left = doc.page.margins.left;
      const right = doc.page.width - doc.page.margins.right;
      const b = detail.booking;

      drawBrandHeader(doc, brand, {
        docType: 'DELIVERY NOTE',
        infoLines: [`Booking: ${b.code}`, ...(b.invoiceNumber ? [`Invoice: ${b.invoiceNumber}`] : []), `Date: ${detail.delivery ? d(detail.delivery.deliveredAt) : d(new Date().toISOString())}`],
        badge: 'DELIVERED',
      });

      this.grid(doc, left, right, [
        ['Customer', b.customerName],
        ['Phone', b.customerPhone],
        ['Address', [b.address, b.city].filter(Boolean).join(', ') || '—'],
        ['Vehicle', `${b.model} ${b.variant}`],
        ['VIN', b.vin],
        ['Motor No.', b.motorNumber ?? '—'],
        ['Battery No.', b.batteryNumber ?? '—'],
        ['Delivered by', detail.delivery?.deliveredBy ?? '—'],
        ['Sales executive', b.salesExecutive ?? '—'],
      ]);

      this.section(doc, left, 'Handover checklist');
      const items = DELIVERY_CHECKLIST_ITEMS.filter((k) => detail.delivery?.checklist[k]);
      doc.font(FONT_BODY).fontSize(9.5).fillColor('#222');
      if (items.length === 0) doc.text('—', left, doc.y);
      const colW = (right - left) / 2;
      let y = doc.y;
      items.forEach((k, i) => {
        const x = left + (i % 2) * colW;
        if (i % 2 === 0 && i > 0) y += 16;
        doc.fillColor(TEAL).font(FONT_BOLD).text('✓', x, y, { continued: true }).fillColor('#222').font(FONT_BODY).text(`  ${LABELS[k] ?? k}`);
      });
      doc.y = y + 22;

      // Payment summary — shows the outstanding balance so a partial-payment delivery is accurate.
      const balance = BigInt(b.balance);
      this.section(doc, left, 'Payment summary');
      this.grid(doc, left, right, [
        ['Invoice total', formatInrExact(BigInt(b.total))],
        ['Amount paid', formatInrExact(BigInt(b.paid))],
        ['Balance outstanding', formatInrExact(balance)],
        ['Status', balance > 0n ? 'Balance outstanding — to be collected' : 'Paid in full'],
      ]);

      if (detail.delivery?.notes) {
        this.section(doc, left, 'Notes');
        doc.font(FONT_BODY).fontSize(9.5).fillColor('#444').text(detail.delivery.notes, left, doc.y, { width: right - left });
      }

      // Signature line
      doc.moveDown(3);
      const sigY = Math.max(doc.y, doc.page.height - 170);
      doc.moveTo(left, sigY).lineTo(left + 200, sigY).strokeColor('#999').lineWidth(0.7).stroke();
      doc.fillColor('#666').font(FONT_BODY).fontSize(8).text('Customer signature', left, sigY + 4);
      doc.moveTo(right - 200, sigY).lineTo(right, sigY).stroke();
      doc.text('For ' + brand.name, right - 200, sigY + 4, { width: 200, align: 'right' });

      doc.fillColor(GOLD).font(FONT_BOLD).fontSize(8).text('Vehicle received in good condition with all documents and accessories listed above.', left, sigY + 26, { width: right - left, align: 'center' });
      void NAVY;
      drawBrandFooter(doc, brand);
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

  private section(doc: PDFKit.PDFDocument, left: number, title: string): void {
    doc.moveDown(0.4);
    doc.fillColor(GOLD).font(FONT_BOLD).fontSize(10).text(title.toUpperCase(), left, doc.y, { characterSpacing: 1 });
    doc.moveDown(0.6);
  }
}
