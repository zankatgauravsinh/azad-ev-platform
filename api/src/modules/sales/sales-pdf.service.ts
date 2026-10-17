import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { formatInrExact } from '../../common/utils/money';
import { drawBrandHeader, drawBrandFooter, useBrandFonts, NAVY, FONT_BODY, FONT_BOLD, type PdfBrand } from '../../common/pdf/brand';

export interface PdfLine {
  label: string;
  amount: bigint | number;
  negative?: boolean;
}

export interface SalesDocInput {
  docType: 'QUOTATION' | 'INVOICE' | 'BOOKING';
  number: string;
  date: Date;
  validUntil?: Date | null;
  brand: PdfBrand;
  customer: { name: string; phone: string; address?: string | null; city?: string | null };
  vehicle: { model: string; variant: string; colour: string; vin?: string | null };
  lines: PdfLine[];
  total: bigint | number;
  finance?: { company: string; loanAmount: bigint | number; downPayment: bigint | number; emi: bigint | number; tenureMonths: number } | null;
  /** Booking confirmation: what has been paid, the balance and the expected delivery. */
  payments?: { rows: { date: Date; receipt: string | null; mode: string; amount: bigint }[]; paid: bigint; balance: bigint; expectedDelivery: Date | null } | null;
}

@Injectable()
export class SalesPdfService {
  render(input: SalesDocInput): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 48 });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      useBrandFonts(doc);

      const left = doc.page.margins.left;
      const right = doc.page.width - doc.page.margins.right;

      drawBrandHeader(doc, input.brand, {
        docType: input.docType === 'INVOICE' ? 'TAX INVOICE' : input.docType === 'BOOKING' ? 'BOOKING CONFIRMATION' : input.docType,
        infoLines: [
          `No: ${input.number}`,
          `Date: ${input.date.toLocaleDateString('en-IN')}`,
          ...(input.validUntil ? [`Valid until: ${input.validUntil.toLocaleDateString('en-IN')}`] : []),
        ],
      });

      // Customer + vehicle
      const colY = doc.y;
      doc.fillColor(NAVY).fontSize(10).font(FONT_BOLD).text('Bill To', left, colY);
      doc.fillColor('#000').font(FONT_BODY).fontSize(10);
      doc.text(input.customer.name);
      doc.text(input.customer.phone);
      if (input.customer.address) doc.text(input.customer.address);
      if (input.customer.city) doc.text(input.customer.city);

      doc.fillColor(NAVY).font(FONT_BOLD).text('Vehicle', left + 280, colY);
      doc.fillColor('#000').font(FONT_BODY);
      doc.text(`${input.vehicle.model} ${input.vehicle.variant}`, left + 280);
      doc.text(`Colour: ${input.vehicle.colour}`, left + 280);
      if (input.vehicle.vin) doc.text(`VIN: ${input.vehicle.vin}`, left + 280);

      doc.moveDown(2);

      // Price breakup
      const rowH = 20;
      let y = doc.y;
      doc.rect(left, y, right - left, rowH).fill(NAVY);
      doc.fillColor('#fff').fontSize(10).font(FONT_BOLD);
      doc.text('Description', left + 8, y + 5);
      doc.text('Amount', right - 108, y + 5, { width: 100, align: 'right' });
      y += rowH;

      doc.font(FONT_BODY).fontSize(10);
      for (const line of input.lines) {
        doc.fillColor('#000').text(line.label, left + 8, y + 5);
        const amount = `${line.negative ? '− ' : ''}${formatInrExact(line.amount)}`;
        doc.text(amount, right - 108, y + 5, { width: 100, align: 'right' });
        y += rowH;
        doc.moveTo(left, y).lineTo(right, y).strokeColor('#eee').stroke();
      }

      doc.rect(left, y, right - left, rowH + 4).fill('#EDEFF2');
      doc.fillColor(NAVY).font(FONT_BOLD).fontSize(11);
      doc.text('On-road Total', left + 8, y + 6);
      doc.text(formatInrExact(input.total), right - 128, y + 6, { width: 120, align: 'right' });
      y += rowH + 14;

      if (input.payments) {
        const p = input.payments;
        doc.fillColor(NAVY).font(FONT_BOLD).fontSize(10).text('Payments received', left, y);
        y += 16;
        doc.font(FONT_BODY).fontSize(9).fillColor('#000');
        if (!p.rows.length) {
          doc.fillColor('#555').text('No payment yet', left + 8, y);
          y += 14;
        }
        for (const r of p.rows) {
          doc.fillColor('#000').text(`${r.date.toLocaleDateString('en-IN')} · ${r.receipt ?? 'Receipt'} · ${r.mode.replace('_', ' ')}`, left + 8, y);
          doc.text(formatInrExact(r.amount), right - 108, y, { width: 100, align: 'right' });
          y += 14;
        }
        y += 4;
        doc.font(FONT_BOLD).fontSize(10).fillColor(NAVY);
        doc.text('Paid', left + 8, y);
        doc.text(formatInrExact(p.paid), right - 128, y, { width: 120, align: 'right' });
        y += 16;
        doc.text('Balance due', left + 8, y);
        doc.text(formatInrExact(p.balance), right - 128, y, { width: 120, align: 'right' });
        y += 18;
        if (p.expectedDelivery) {
          doc.font(FONT_BODY).fontSize(9).fillColor('#000').text(`Expected delivery: ${p.expectedDelivery.toLocaleDateString('en-IN')}`, left, y);
          y += 16;
        }
        y += 6;
      }

      if (input.finance) {
        doc.fillColor(NAVY).font(FONT_BOLD).fontSize(10).text('Finance estimate', left, y);
        y += 16;
        doc.fillColor('#000').font(FONT_BODY).fontSize(9);
        doc.text(
          `${input.finance.company} · Loan ${formatInrExact(input.finance.loanAmount)} · Down ${formatInrExact(input.finance.downPayment)} · EMI ${formatInrExact(input.finance.emi)} × ${input.finance.tenureMonths} months`,
          left,
          y,
        );
        y += 20;
      }

      if (input.brand.terms) {
        doc.moveDown(1);
        doc.fillColor(NAVY).font(FONT_BOLD).fontSize(9).text('Terms & Conditions', left, y + 10);
        doc.fillColor('#555').font(FONT_BODY).fontSize(8).text(input.brand.terms, left, doc.y + 2, { width: right - left });
      }
      drawBrandFooter(doc, input.brand);
      doc.end();
    });
  }
}
