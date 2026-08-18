import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import type { AmcPlanDetailDto, FreeServiceDto, WarrantyCoverageLine, WarrantyRecordDto } from '@azad/shared';
import { formatInr } from '../../common/utils/money';
import { drawBrandHeader, drawBrandFooter, useBrandFonts, NAVY, TEAL, GOLD, FONT_BODY, FONT_BOLD, type PdfBrand } from '../../common/pdf/brand';

export interface CertificateInput {
  brand: PdfBrand;
  warranty: WarrantyRecordDto;
  coverage: WarrantyCoverageLine[];
  freeServices: FreeServiceDto[];
}

export interface AmcAgreementInput {
  brand: PdfBrand;
  amc: AmcPlanDetailDto;
}

const d = (iso: string): string => new Date(iso).toLocaleDateString('en-IN');

@Injectable()
export class WarrantyPdfService {
  certificate(input: CertificateInput): Promise<Buffer> {
    return this.build((doc, left, right) => {
      const w = input.warranty;
      drawBrandHeader(doc, input.brand, {
        docType: 'WARRANTY CERTIFICATE',
        infoLines: [`No: ${w.warrantyNumber}`, `Issued: ${d(w.startDate)}`],
        badge: w.status === 'ACTIVE' ? 'UNDER WARRANTY' : w.status,
      });

      this.grid(doc, left, right, [
        ['Customer', w.customerName],
        ['VIN', w.vin],
        ['Model', `${w.model} ${w.variant}`],
        ['Motor No.', w.motorNumber ?? '—'],
        ['Battery No.', w.batteryNumber ?? '—'],
        ['Invoice', w.invoiceNumber ?? '—'],
        ['Purchase Date', d(w.purchaseDate)],
        ['Warranty Period', `${w.periodMonths} months`],
        ['Valid From', d(w.startDate)],
        ['Valid Until', d(w.endDate)],
      ]);

      this.sectionTitle(doc, left, 'Coverage');
      this.table(doc, left, right, ['Component', 'Status', 'Remarks'], [0.42, 0.18, 0.4], input.coverage.map((c) => [c.label, c.covered ? 'Covered' : 'Excluded', c.remarks ?? '—']), (row) => (row[1] === 'Covered' ? TEAL : '#B23A48'));

      if (input.freeServices.length) {
        this.sectionTitle(doc, left, 'Free Services');
        this.table(doc, left, right, ['#', 'Due Date', 'Status', 'Completed'], [0.1, 0.3, 0.3, 0.3], input.freeServices.map((f) => [String(f.serviceNumber), d(f.dueDate), f.status, f.completedDate ? d(f.completedDate) : '—']));
      }

      if (input.brand.terms) {
        this.sectionTitle(doc, left, 'Terms & Conditions');
        doc.fillColor('#444').font(FONT_BODY).fontSize(7.5).text(input.brand.terms, left, doc.y, { width: right - left, align: 'left' });
      }
      drawBrandFooter(doc, input.brand);
    });
  }

  amcAgreement(input: AmcAgreementInput): Promise<Buffer> {
    return this.build((doc, left, right) => {
      const a = input.amc;
      drawBrandHeader(doc, input.brand, {
        docType: 'AMC AGREEMENT',
        infoLines: [`No: ${a.amcNumber}`, `Plan: ${a.planType}`],
        badge: a.status,
      });

      this.grid(doc, left, right, [
        ['Customer', a.customerName],
        ['VIN', a.vin],
        ['Model', a.model],
        ['Plan', a.planType],
        ['Valid From', d(a.startDate)],
        ['Valid Until', d(a.endDate)],
        ['Visits Included', String(a.visitsIncluded)],
        ['Visits Used', String(a.visitsUsed)],
        ['Visits Remaining', String(a.visitsRemaining)],
        ['Contract Value', formatInr(BigInt(a.price))],
      ]);

      if (a.visits.length) {
        this.sectionTitle(doc, left, 'Service Visits');
        this.table(doc, left, right, ['#', 'Date', 'Work Done', 'Covered'], [0.08, 0.22, 0.5, 0.2], a.visits.map((v) => [String(v.visitNumber), d(v.visitDate), v.workDone, v.coveredUnderAmc ? 'Yes' : 'No']));
      }

      if (input.brand.terms) {
        this.sectionTitle(doc, left, 'Terms & Conditions');
        doc.fillColor('#444').font(FONT_BODY).fontSize(7.5).text(input.brand.terms, left, doc.y, { width: right - left });
      }
      drawBrandFooter(doc, input.brand);
    });
  }

  // ── Drawing helpers ────────────────────────────────────
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
      const rowH = 26;
      for (let c = 0; c < 2 && i + c < rows.length; c += 1) {
        const pair = rows[i + c];
        if (!pair) continue;
        const [label, value] = pair;
        const x = left + c * (colW + colGap);
        doc.fillColor('#888').font(FONT_BODY).fontSize(7).text(label.toUpperCase(), x, y, { width: colW, characterSpacing: 0.5 });
        doc.fillColor(NAVY).font(FONT_BOLD).fontSize(10).text(value, x, y + 9, { width: colW, lineBreak: false, ellipsis: true });
      }
      y += rowH;
    }
    doc.y = y + 4;
  }

  private sectionTitle(doc: PDFKit.PDFDocument, left: number, title: string): void {
    if (doc.y > doc.page.height - 140) doc.addPage();
    doc.moveDown(0.4);
    doc.fillColor(GOLD).font(FONT_BOLD).fontSize(10).text(title.toUpperCase(), left, doc.y, { characterSpacing: 1 });
    doc.moveTo(left, doc.y + 2).lineTo(left + 60, doc.y + 2).strokeColor(GOLD).lineWidth(1.5).stroke();
    doc.moveDown(0.6);
  }

  private table(doc: PDFKit.PDFDocument, left: number, right: number, headers: string[], weights: number[], rows: string[][], valueColor?: (row: string[]) => string): void {
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
      const cellHeights = row.map((cell, i) => doc.heightOfString(cell, { width: cw(i) - 8 }));
      const rowH = Math.max(16, ...cellHeights) + 6;
      if (y + rowH > doc.page.height - 90) {
        doc.addPage();
        y = doc.page.margins.top;
      }
      if (ri % 2 === 1) doc.rect(left, y, width, rowH).fill('#F4F6F8');
      row.forEach((cell, i) => {
        const color = i === 1 && valueColor ? valueColor(row) : '#222';
        doc.fillColor(color).font(i === 0 ? FONT_BOLD : FONT_BODY).text(cell, x(i) + 4, y + 4, { width: cw(i) - 8 });
      });
      y += rowH;
    });
    doc.y = y + 6;
  }
}
