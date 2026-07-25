import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { formatInr } from '../../common/utils/money';

export interface PdfLine {
  label: string;
  amount: bigint | number;
  negative?: boolean;
}

export interface SalesDocInput {
  docType: 'QUOTATION' | 'INVOICE';
  number: string;
  date: Date;
  validUntil?: Date | null;
  company: { businessName: string; legalName: string; address?: string | null; city: string; phone?: string | null; gstin?: string | null };
  customer: { name: string; phone: string; address?: string | null; city?: string | null };
  vehicle: { model: string; variant: string; colour: string; vin?: string | null };
  lines: PdfLine[];
  total: bigint | number;
  finance?: { company: string; loanAmount: bigint | number; downPayment: bigint | number; emi: bigint | number; tenureMonths: number } | null;
  terms?: string | null;
  footer?: string | null;
}

const NAVY = '#0B2545';
const TEAL = '#00B8A9';

@Injectable()
export class SalesPdfService {
  render(input: SalesDocInput): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 48 });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const left = doc.page.margins.left;
      const right = doc.page.width - doc.page.margins.right;

      // Header
      doc.fillColor(NAVY).fontSize(20).font('Helvetica-Bold').text(input.company.businessName, left, 48);
      doc.fillColor('#555').fontSize(9).font('Helvetica').text(input.company.legalName);
      if (input.company.address) doc.text(input.company.address);
      doc.text(input.company.city);
      if (input.company.phone) doc.text(`Phone: ${input.company.phone}`);
      if (input.company.gstin) doc.text(`GSTIN: ${input.company.gstin}`);

      doc.fillColor(TEAL).fontSize(16).font('Helvetica-Bold').text(input.docType, left, 48, { align: 'right' });
      doc.fillColor('#000').fontSize(10).font('Helvetica').text(`No: ${input.number}`, { align: 'right' });
      doc.text(`Date: ${input.date.toLocaleDateString('en-IN')}`, { align: 'right' });
      if (input.validUntil) doc.text(`Valid until: ${input.validUntil.toLocaleDateString('en-IN')}`, { align: 'right' });

      doc.moveDown(2);
      doc.moveTo(left, doc.y).lineTo(right, doc.y).strokeColor('#ddd').stroke();
      doc.moveDown(1);

      // Customer + vehicle
      const colY = doc.y;
      doc.fillColor(NAVY).fontSize(10).font('Helvetica-Bold').text('Bill To', left, colY);
      doc.fillColor('#000').font('Helvetica').fontSize(10);
      doc.text(input.customer.name);
      doc.text(input.customer.phone);
      if (input.customer.address) doc.text(input.customer.address);
      if (input.customer.city) doc.text(input.customer.city);

      doc.fillColor(NAVY).font('Helvetica-Bold').text('Vehicle', left + 280, colY);
      doc.fillColor('#000').font('Helvetica');
      doc.text(`${input.vehicle.model} ${input.vehicle.variant}`, left + 280);
      doc.text(`Colour: ${input.vehicle.colour}`, left + 280);
      if (input.vehicle.vin) doc.text(`VIN: ${input.vehicle.vin}`, left + 280);

      doc.moveDown(2);

      // Price breakup
      const rowH = 20;
      let y = doc.y;
      doc.rect(left, y, right - left, rowH).fill(NAVY);
      doc.fillColor('#fff').fontSize(10).font('Helvetica-Bold');
      doc.text('Description', left + 8, y + 5);
      doc.text('Amount', right - 108, y + 5, { width: 100, align: 'right' });
      y += rowH;

      doc.font('Helvetica').fontSize(10);
      for (const line of input.lines) {
        doc.fillColor('#000').text(line.label, left + 8, y + 5);
        const amount = `${line.negative ? '− ' : ''}${formatInr(line.amount)}`;
        doc.text(amount, right - 108, y + 5, { width: 100, align: 'right' });
        y += rowH;
        doc.moveTo(left, y).lineTo(right, y).strokeColor('#eee').stroke();
      }

      doc.rect(left, y, right - left, rowH + 4).fill('#EDEFF2');
      doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(11);
      doc.text('On-road Total', left + 8, y + 6);
      doc.text(formatInr(input.total), right - 128, y + 6, { width: 120, align: 'right' });
      y += rowH + 14;

      if (input.finance) {
        doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(10).text('Finance estimate', left, y);
        y += 16;
        doc.fillColor('#000').font('Helvetica').fontSize(9);
        doc.text(
          `${input.finance.company} · Loan ${formatInr(input.finance.loanAmount)} · Down ${formatInr(input.finance.downPayment)} · EMI ${formatInr(input.finance.emi)} × ${input.finance.tenureMonths} months`,
          left,
          y,
        );
        y += 20;
      }

      if (input.terms) {
        doc.moveDown(1);
        doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(9).text('Terms & Conditions', left, y + 10);
        doc.fillColor('#555').font('Helvetica').fontSize(8).text(input.terms, left, doc.y + 2, { width: right - left });
      }
      if (input.footer) {
        doc.fillColor(TEAL).fontSize(9).font('Helvetica-Oblique').text(input.footer, left, doc.page.height - 80, { width: right - left, align: 'center' });
      }

      doc.end();
    });
  }
}
