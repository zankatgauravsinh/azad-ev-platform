import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { PdfBrandService } from '../common/pdf/pdf-brand.service';
import { drawBrandHeader, drawBrandFooter, useBrandFonts, NAVY, FONT_BODY, FONT_BOLD } from '../common/pdf/brand';

export interface ExportColumn {
  header: string;
  /** Column width hint (Excel chars / PDF fraction handled internally). */
  width?: number;
}

export interface ExportData {
  title: string;
  columns: ExportColumn[];
  rows: (string | number)[][];
  /** Optional subtitle lines shown under the document type in the PDF header. */
  meta?: string[];
}

/**
 * Reusable tabular exporters. Produces real .xlsx (ExcelJS), branded .pdf (PDFKit
 * with the shared AZAD EV letterhead + Unicode font) and .csv buffers.
 */
@Injectable()
export class ExportService {
  constructor(private readonly brand: PdfBrandService) {}

  async toExcel(data: ExportData): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'AZAD EV POINT';
    workbook.created = new Date();
    const sheet = workbook.addWorksheet(data.title.slice(0, 31));

    sheet.columns = data.columns.map((c) => ({ header: c.header, width: c.width ?? 18 }));

    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B2545' } }; // Azad Navy
    headerRow.alignment = { vertical: 'middle' };

    data.rows.forEach((row) => sheet.addRow(row));
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: data.columns.length } };

    const arrayBuffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(arrayBuffer);
  }

  toCsv(data: ExportData): Buffer {
    const esc = (v: string | number): string => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [data.columns.map((c) => esc(c.header)).join(','), ...data.rows.map((r) => r.map(esc).join(','))];
    // Prepend a UTF-8 BOM so Excel opens ₹ and other non-ASCII correctly.
    return Buffer.from(`\uFEFF${lines.join('\r\n')}`, 'utf8');
  }

  async toPdf(data: ExportData): Promise<Buffer> {
    const brand = await this.brand.resolve();
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36 });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      useBrandFonts(doc);

      drawBrandHeader(doc, brand, {
        docType: data.title.toUpperCase(),
        infoLines: [`Generated: ${new Date().toLocaleString('en-IN')}`, ...(data.meta ?? [])],
      });

      const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const totalWeight = data.columns.reduce((sum, c) => sum + (c.width ?? 1), 0);
      const colWidths = data.columns.map((c) => ((c.width ?? 1) / totalWeight) * pageWidth);
      const startX = doc.page.margins.left;

      const drawRow = (cells: (string | number)[], y: number, bold: boolean): number => {
        let rowHeight = 0;
        doc.fontSize(8).font(bold ? FONT_BOLD : FONT_BODY);
        cells.forEach((cell, i) => {
          const w = colWidths[i] ?? 60;
          rowHeight = Math.max(rowHeight, doc.heightOfString(String(cell), { width: w - 6 }));
        });
        let x = startX;
        cells.forEach((cell, i) => {
          const w = colWidths[i] ?? 60;
          if (bold) {
            doc.rect(x, y - 2, w, rowHeight + 4).fill(NAVY);
            doc.fillColor('#FFFFFF');
          } else {
            doc.fillColor('#1C1C1E');
          }
          doc.text(String(cell), x + 3, y, { width: w - 6 });
          x += w;
        });
        return rowHeight + 6;
      };

      let y = doc.y + 2;
      y += drawRow(
        data.columns.map((c) => c.header),
        y,
        true,
      );
      for (const row of data.rows) {
        if (y > doc.page.height - doc.page.margins.bottom - 24) {
          doc.addPage();
          y = doc.page.margins.top;
        }
        y += drawRow(row, y, false);
      }

      drawBrandFooter(doc, brand);
      doc.end();
    });
  }
}
