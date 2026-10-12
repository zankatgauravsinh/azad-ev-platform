import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AxiosError, type AxiosResponse } from 'axios';
import type { ModelRef, VariantOption } from './api';
import { buildCsvTemplate, CSV_COLUMNS, csvCell, describeCsvFailure, isSha256, readFileBytes } from './csv-import';

const h = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('@/lib/api-client', () => ({ apiClient: { post: h.post } }));

const axiosError = (status: number, data: object = {}): AxiosError => new AxiosError('x', String(status), undefined, undefined, { status, data } as AxiosResponse);
const model = (id: string, brand: string, name: string): ModelRef => ({ id, brand, name });
const variant = (id: string, m: ModelRef, name: string, colour: string, isActive = true): VariantOption =>
  ({ id, name, colour, hexColour: null, exShowroomPrice: '0', model: m, isActive });

describe('CSV template', () => {
  it('has every supported column, Brand first and Location included', () => {
    expect(CSV_COLUMNS.map((c) => c.header)).toEqual([
      'Brand', 'Model', 'Variant', 'Colour', 'VIN', 'Motor Number', 'Battery Number',
      'Purchase Date', 'Purchase Cost', 'Selling Price', 'Supplier', 'Location', 'Status',
    ]);
  });

  it('is built from the active catalogue only — one row per active variant of an active model, numbers left blank', () => {
    const solo = model('m1', 'GAMMA', 'Solo');
    const quoted = model('m2', 'Delta, Inc', 'Max "X"');
    const retired = model('m3', 'GAMMA', 'Old'); // not in the active model list
    const csv = buildCsvTemplate([solo, quoted], [
      variant('v1', solo, 'Pro', 'Teal'),
      variant('v2', solo, 'Lite', 'Blue', false),
      variant('v3', quoted, 'Base', 'Red'),
      variant('v4', retired, 'Pro', 'Red'),
    ]);
    expect(csv.split('\r\n')).toEqual([
      'Brand,Model,Variant,Colour,VIN,Motor Number,Battery Number,Purchase Date,Purchase Cost,Selling Price,Supplier,Location,Status',
      '"Delta, Inc","Max ""X""",Base,Red,,,,,,,,,',
      'GAMMA,Solo,Pro,Teal,,,,,,,,,',
      '',
    ]);
    expect(csv).not.toContain('VX1');
  });

  it('an empty catalogue gives the header only', () => {
    expect(buildCsvTemplate([], [])).toBe(`${CSV_COLUMNS.map((c) => c.header).join(',')}\r\n`);
  });

  it('documents dates (day first), blank status = AVAILABLE only, and the existing active catalogue', () => {
    const help = (header: string) => CSV_COLUMNS.find((c) => c.header === header)!.help;
    expect(help('Purchase Date')).toContain('YYYY-MM-DD, D/M/YYYY or DD/MM/YYYY');
    expect(help('Purchase Date')).toContain('day first: 3/12/2026 is 3 December 2026');
    expect(help('Status')).toContain('Leave blank or write AVAILABLE');
    expect(help('Model')).toContain('Must already exist and be active');
    expect(help('Variant')).toContain('Must already exist and be active');
    expect(help('Selling Price')).toContain("Blank takes the variant's list price; 0 is kept as 0");
    expect(CSV_COLUMNS.filter((c) => c.required).map((c) => c.header)).toEqual(['Model', 'Variant', 'Colour', 'VIN', 'Motor Number', 'Battery Number']);
  });

  it('csvCell quotes only when needed', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('line\nbreak')).toBe('"line\nbreak"');
  });
});

describe('describeCsvFailure', () => {
  it('import: no answer, a gateway error or a server error → UNKNOWN (never success, never a confirmed failure)', () => {
    expect(describeCsvFailure(new AxiosError('Network Error', 'ERR_NETWORK'), true)).toEqual({ kind: 'unknown', message: 'The connection failed before the server answered.' });
    expect(describeCsvFailure(axiosError(502), true)).toEqual({ kind: 'unknown', message: 'The server did not answer in time (HTTP 502).' });
    expect(describeCsvFailure(axiosError(504), true).kind).toBe('unknown');
    expect(describeCsvFailure(axiosError(500, { message: 'Internal server error' }), true).kind).toBe('unknown');
    expect(describeCsvFailure(new Error('boom'), true).kind).toBe('unknown');
  });

  it('import: 409 → conflict with the server message; 503 → deadline', () => {
    expect(describeCsvFailure(axiosError(409, { message: 'Inventory changed while importing — nothing was imported. Try again.' }), true))
      .toEqual({ kind: 'conflict', message: 'Inventory changed while importing — nothing was imported. Try again.' });
    expect(describeCsvFailure(axiosError(503, { message: 'The import could not finish in time' }), true).kind).toBe('deadline');
  });

  it('definite failures: authentication, permission, size, row count / malformed file', () => {
    expect(describeCsvFailure(axiosError(401), true)).toEqual({ kind: 'failed', message: 'Your session has expired — sign in again, then choose the file again.' });
    expect(describeCsvFailure(axiosError(403), false)).toEqual({ kind: 'failed', message: 'You do not have permission to import scooters.' });
    expect(describeCsvFailure(axiosError(413), false)).toEqual({ kind: 'failed', message: 'The file is larger than 2 MB — split it into smaller files.' });
    const rows = 'The file has 2001 rows; at most 2000 can be imported at once — split it into smaller files.';
    expect(describeCsvFailure(axiosError(400, { message: rows }), false)).toEqual({ kind: 'failed', message: rows });
    expect(describeCsvFailure(axiosError(400, { message: 'Could not read the CSV file: the problem is at line 4.' }), true).message).toBe('Could not read the CSV file: the problem is at line 4.');
  });

  it('preview (nothing can have been written): a missing answer is a plain failure to retry', () => {
    expect(describeCsvFailure(new AxiosError('Network Error', 'ERR_NETWORK'), false)).toEqual({
      kind: 'failed', message: 'The connection failed before the server answered. Nothing was imported — choose the file again to retry the preview.',
    });
    expect(describeCsvFailure(axiosError(503), false).kind).toBe('failed');
  });
});

describe('helpers', () => {
  it('isSha256 accepts only a 64-hex digest', () => {
    expect(isSha256('a'.repeat(64))).toBe(true);
    expect(isSha256('A'.repeat(64))).toBe(true);
    for (const bad of ['', 'a'.repeat(63), 'g'.repeat(64), undefined, null]) expect(isSha256(bad)).toBe(false);
  });

  it('readFileBytes returns the exact bytes', async () => {
    const bytes = await readFileBytes(new File(['Model,VIN\r\nSolo,V1\r\n'], 'a.csv'));
    expect(new TextDecoder().decode(bytes)).toBe('Model,VIN\r\nSolo,V1\r\n');
  });
});

describe('inventoryApi CSV calls', () => {
  beforeEach(() => h.post.mockReset().mockResolvedValue({ data: {} }));
  const sent = (): FormData => h.post.mock.calls[0]![1] as FormData;

  it('preview posts the file to the preview endpoint', async () => {
    const { inventoryApi } = await import('./api');
    const file = new File(['x'], 'a.csv');
    await inventoryApi.previewCsv(file);
    expect(h.post).toHaveBeenCalledWith('/inventory/units/import/preview', expect.any(FormData));
    expect(sent().get('file')).toBeInstanceOf(File);
    expect(sent().has('expectedSha256')).toBe(false);
  });

  it('import sends expectedSha256 when given — and never an empty value', async () => {
    const { inventoryApi } = await import('./api');
    await inventoryApi.importCsv(new File(['x'], 'a.csv'), 'f'.repeat(64));
    expect(h.post).toHaveBeenCalledWith('/inventory/units/import', expect.any(FormData));
    expect(sent().get('expectedSha256')).toBe('f'.repeat(64));
    for (const missing of ['', undefined]) {
      h.post.mockClear();
      await inventoryApi.importCsv(new File(['x'], 'a.csv'), missing);
      expect(sent().has('expectedSha256')).toBe(false);
    }
  });
});
