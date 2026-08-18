import { ExportService } from './export.service';
import type { PdfBrandService } from '../common/pdf/pdf-brand.service';

describe('ExportService.toCsv', () => {
  const service = new ExportService({} as PdfBrandService); // CSV path never touches the brand

  it('writes a UTF-8 BOM, header row and data rows', () => {
    const csv = service.toCsv({ title: 'Test', columns: [{ header: 'A' }, { header: 'B' }], rows: [['x', 1], ['y', 2]] }).toString('utf8');
    expect(csv.charCodeAt(0)).toBe(0xfeff); // BOM
    const lines = csv.slice(1).split('\r\n');
    expect(lines[0]).toBe('A,B');
    expect(lines[1]).toBe('x,1');
    expect(lines[2]).toBe('y,2');
  });

  it('escapes commas, quotes and newlines', () => {
    const csv = service.toCsv({
      title: 'Test',
      columns: [{ header: 'Name' }, { header: 'Note' }],
      rows: [['Doe, John', 'has "quotes"'], ['Line', 'a\nb']],
    }).toString('utf8');
    expect(csv).toContain('"Doe, John","has ""quotes"""');
    expect(csv).toContain('"a\nb"');
  });
});
