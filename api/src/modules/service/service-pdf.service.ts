import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { formatInr } from '../../common/utils/money';
import { drawBrandHeader, drawBrandFooter, useBrandFonts, NAVY, FONT_BODY, FONT_BOLD, type PdfBrand } from '../../common/pdf/brand';

export type ServiceDocType = 'JOB CARD' | 'ESTIMATE' | 'SERVICE BILL' | 'INSPECTION REPORT';

export interface ServicePdfInput {
  docType: ServiceDocType;
  brand: PdfBrand;
  job: {
    code: string;
    date: Date;
    type: string;
    priority: string;
    status: string;
    odometerKm: number | null;
    underWarranty: boolean;
    technician: string | null;
    customer: { name: string; phone: string };
    vehicle: { model: string; variant: string; colour: string; vin: string };
    complaints: { description: string; priority: string }[];
    inspection: { item: string; result: string; notes: string | null }[];
    parts: { name: string; qty: number; unitPrice: bigint; lineTotal: bigint }[];
    labour: { description: string; cost: bigint }[];
    partsTotal: bigint;
    labourTotal: bigint;
    discount: bigint;
    taxAmount: bigint;
    /** The bill's GST as stored (rate known): printed as CGST + SGST or IGST with the SAC / HSN codes. */
    gst?: { rateBp: number; cgst: bigint; sgst: bigint; igst: bigint; labourSacCode: string | null; partsHsnCode: string | null; supplierGstin: string | null; buyerGstin: string | null };
    total: bigint;
    paid: bigint;
    balance: bigint;
  };
}

@Injectable()
export class ServicePdfService {
  render(input: ServicePdfInput): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 48 });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      useBrandFonts(doc);

      const left = doc.page.margins.left;
      const right = doc.page.width - doc.page.margins.right;
      const { job } = input;

      drawBrandHeader(doc, input.brand, {
        docType: input.docType === 'ESTIMATE' ? 'SERVICE ESTIMATE' : input.docType,
        infoLines: [
          `No: ${job.code}`,
          `Date: ${job.date.toLocaleDateString('en-IN')}`,
          `Type: ${job.type}`,
        ],
        badge: job.underWarranty ? 'UNDER WARRANTY' : null,
      });

      // Customer + vehicle
      const colY = doc.y;
      doc.fillColor(NAVY).fontSize(10).font(FONT_BOLD).text('Customer', left, colY);
      doc.fillColor('#000').font(FONT_BODY).fontSize(10).text(job.customer.name).text(job.customer.phone);
      doc.fillColor(NAVY).font(FONT_BOLD).text('Vehicle', left + 280, colY);
      doc.fillColor('#000').font(FONT_BODY)
        .text(`${job.vehicle.model} ${job.vehicle.variant}`, left + 280)
        .text(`Colour: ${job.vehicle.colour}`, left + 280)
        .text(`VIN: ${job.vehicle.vin}`, left + 280)
        .text(`Odometer: ${job.odometerKm ?? '—'} km`, left + 280);
      doc.moveDown(1);
      doc.fillColor('#555').fontSize(9).text(`Priority: ${job.priority}   Status: ${job.status}   Technician: ${job.technician ?? 'Unassigned'}`, left);
      doc.moveDown(1);

      // Complaints
      doc.fillColor(NAVY).font(FONT_BOLD).fontSize(11).text('Complaints', left);
      doc.font(FONT_BODY).fontSize(10).fillColor('#000');
      job.complaints.forEach((c, i) => doc.text(`${i + 1}. ${c.description}  [${c.priority}]`, left));
      doc.moveDown(1);

      if (input.docType === 'INSPECTION REPORT') {
        this.table(doc, left, right, ['Checklist item', 'Result', 'Notes'], job.inspection.map((i) => [i.item, i.result, i.notes ?? '']));
      } else {
        // Parts + labour + totals for JOB CARD / ESTIMATE / SERVICE BILL
        if (job.parts.length) {
          doc.fillColor(NAVY).font(FONT_BOLD).fontSize(11).text('Spare Parts', left);
          this.moneyTable(doc, left, right, ['Part', 'Qty', 'Rate', 'Amount'], job.parts.map((p) => [p.name, String(p.qty), formatInr(p.unitPrice), formatInr(p.lineTotal)]));
        }
        if (job.labour.length) {
          doc.moveDown(0.5).fillColor(NAVY).font(FONT_BOLD).fontSize(11).text('Labour', left);
          this.moneyTable(doc, left, right, ['Description', '', '', 'Amount'], job.labour.map((l) => [l.description, '', '', formatInr(l.cost)]));
        }
        doc.moveDown(1);
        const ly = doc.y;
        const lines: [string, bigint][] = [
          ['Parts total', job.partsTotal],
          ['Labour total', job.labourTotal],
          ['Discount', -job.discount],
          ...gstRows(job),
        ];
        doc.font(FONT_BODY).fontSize(10).fillColor('#000');
        let y = ly;
        for (const [label, amount] of lines) {
          doc.text(label, right - 240, y, { width: 120, align: 'left' });
          doc.text(`${amount < 0n ? '− ' : ''}${formatInr(amount < 0n ? -amount : amount)}`, right - 120, y, { width: 120, align: 'right' });
          y += 16;
        }
        doc.rect(right - 240, y + 2, 240, 22).fill('#EDEFF2');
        doc.fillColor(NAVY).font(FONT_BOLD).fontSize(12).text('Total', right - 232, y + 8);
        doc.text(formatInr(job.total), right - 120, y + 8, { width: 112, align: 'right' });
        y += 30;
        const codes = job.gst && [job.gst.labourSacCode && `SAC ${job.gst.labourSacCode} (labour)`, job.gst.partsHsnCode && `HSN ${job.gst.partsHsnCode} (parts)`, job.gst.supplierGstin && `Our GSTIN ${job.gst.supplierGstin}`, job.gst.buyerGstin && `Customer GSTIN ${job.gst.buyerGstin}`].filter(Boolean).join(' · ');
        if (codes) {
          doc.fillColor('#555').font(FONT_BODY).fontSize(8).text(codes, left, y, { width: right - left });
          y = doc.y + 6;
        }
        if (input.docType === 'SERVICE BILL') {
          doc.fillColor('#000').font(FONT_BODY).fontSize(10)
            .text(`Paid: ${formatInr(job.paid)}`, right - 240, y)
            .text(`Balance: ${formatInr(job.balance)}`, right - 240, y + 14);
        }
      }

      drawBrandFooter(doc, input.brand);
      doc.end();
    });
  }

  private table(doc: PDFKit.PDFDocument, left: number, right: number, headers: string[], rows: string[][]): void {
    const rowH = 20;
    let y = doc.y;
    const cols = [left + 8, left + 200, left + 320];
    doc.rect(left, y, right - left, rowH).fill(NAVY);
    doc.fillColor('#fff').fontSize(10).font(FONT_BOLD);
    headers.forEach((h, i) => doc.text(h, cols[i]!, y + 5));
    y += rowH;
    doc.font(FONT_BODY).fontSize(10);
    for (const row of rows) {
      doc.fillColor('#000');
      row.forEach((c, i) => doc.text(c, cols[i]!, y + 5, { width: i === 2 ? right - cols[2]! - 8 : 180 }));
      y += rowH;
      doc.moveTo(left, y).lineTo(right, y).strokeColor('#eee').stroke();
    }
    doc.y = y + 6;
  }

  private moneyTable(doc: PDFKit.PDFDocument, left: number, right: number, headers: string[], rows: string[][]): void {
    const rowH = 18;
    let y = doc.y + 2;
    doc.rect(left, y, right - left, rowH).fill(NAVY);
    doc.fillColor('#fff').fontSize(9).font(FONT_BOLD);
    doc.text(headers[0]!, left + 8, y + 5);
    doc.text(headers[1]!, right - 240, y + 5, { width: 40, align: 'right' });
    doc.text(headers[2]!, right - 190, y + 5, { width: 80, align: 'right' });
    doc.text(headers[3]!, right - 108, y + 5, { width: 100, align: 'right' });
    y += rowH;
    doc.font(FONT_BODY).fontSize(9).fillColor('#000');
    for (const row of rows) {
      doc.fillColor('#000').text(row[0]!, left + 8, y + 4, { width: right - 250 - left });
      doc.text(row[1]!, right - 240, y + 4, { width: 40, align: 'right' });
      doc.text(row[2]!, right - 190, y + 4, { width: 80, align: 'right' });
      doc.text(row[3]!, right - 108, y + 4, { width: 100, align: 'right' });
      y += rowH;
      doc.moveTo(left, y).lineTo(right, y).strokeColor('#eee').stroke();
    }
    doc.y = y + 4;
  }
}

/** "CGST 9%" + "SGST 9%" (or "IGST 18%") when the bill's rate is stored; a single "GST" row for an older bill. */
function gstRows(job: ServicePdfInput['job']): [string, bigint][] {
  const g = job.gst;
  if (!g) return [['GST', job.taxAmount]];
  const pct = (bp: number): string => `${(bp / 100).toFixed(2).replace(/\.?0+$/, '')}%`;
  return g.igst > 0n ? [[`IGST ${pct(g.rateBp)}`, g.igst]] : [[`CGST ${pct(g.rateBp / 2)}`, g.cgst], [`SGST ${pct(g.rateBp / 2)}`, g.sgst]];
}
