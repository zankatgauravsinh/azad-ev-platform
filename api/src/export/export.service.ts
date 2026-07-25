import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';

export interface ExportColumn {
  header: string;
  /** Column width hint (Excel chars / PDF fraction handled internally). */
  width?: number;
}

export interface ExportData {
  title: string;
  columns: ExportColumn[];
  rows: (string | number)[][];
}

/**
 * Reusable tabular exporters. Used by Inventory now and Reports later.
 * Produces real .xlsx (ExcelJS) and .pdf (PDFKit) buffers — no CSV-renamed files.
 */
@Injectable()
export class ExportService {
  async toExcel(data: ExportData): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'AZAD EV POINT';
    workbook.created = new Date();
    const sheet = workbook.addWorksheet(data.title.slice(0, 31));

    sheet.columns = data.columns.map((c) => ({
      header: c.header,
      width: c.width ?? 18,
    }));

    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF0B2545' }, // Azad Navy
    };
    headerRow.alignment = { vertical: 'middle' };

    data.rows.forEach((row) => sheet.addRow(row));
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: data.columns.length },
    };

    const arrayBuffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(arrayBuffer);
  }

  toPdf(data: ExportData): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36 });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // Header
      doc.fillColor('#0B2545').fontSize(18).text('AZAD EV POINT', { continued: false });
      doc.fillColor('#00B8A9').fontSize(12).text(data.title);
      doc.fillColor('#666').fontSize(8).text(`Generated ${new Date().toLocaleString('en-IN')}`);
      doc.moveDown(0.8);

      const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const totalWeight = data.columns.reduce((sum, c) => sum + (c.width ?? 1), 0);
      const colWidths = data.columns.map((c) => ((c.width ?? 1) / totalWeight) * pageWidth);
      const startX = doc.page.margins.left;

      const drawRow = (cells: (string | number)[], y: number, bold: boolean): number => {
        let rowHeight = 0;
        doc.fontSize(8).font(bold ? 'Helvetica-Bold' : 'Helvetica');
        let x = startX;
        cells.forEach((cell, i) => {
          const w = colWidths[i] ?? 60;
          const h = doc.heightOfString(String(cell), { width: w - 6 });
          rowHeight = Math.max(rowHeight, h);
          x += w;
        });
        x = startX;
        cells.forEach((cell, i) => {
          const w = colWidths[i] ?? 60;
          if (bold) {
            doc.rect(x, y - 2, w, rowHeight + 4).fill('#0B2545');
            doc.fillColor('#FFFFFF');
          } else {
            doc.fillColor('#1C1C1E');
          }
          doc.text(String(cell), x + 3, y, { width: w - 6 });
          x += w;
        });
        return rowHeight + 6;
      };

      let y = doc.y;
      y += drawRow(
        data.columns.map((c) => c.header),
        y,
        true,
      );
      for (const row of data.rows) {
        if (y > doc.page.height - doc.page.margins.bottom - 20) {
          doc.addPage();
          y = doc.page.margins.top;
        }
        y += drawRow(row, y, false);
      }

      doc.end();
    });
  }
}
