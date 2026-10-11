import { csvUnitRowSchema } from '@azad/shared';
import { ZodError } from 'zod';
import {
  CsvRowError,
  csvParseMessage,
  csvRowMessage,
  csvStatus,
  normaliseCatalogueText,
  parseCsvDate,
  readCsvRows,
  resolveCsvVariant,
  type Catalogue,
} from './csv-import';

const header = (h: string): string => h.toLowerCase().replace(/[\s_-]+/g, '');
const lines = (csv: string): string[] => readCsvRows(Buffer.from(csv, 'utf8'), header).map((r) => `${r.record.model}@${r.line}`);

describe('readCsvRows — source line numbers', () => {
  it('counts skipped blank lines and multi-line cells (LF)', () => {
    expect(lines('Model,Supplier\nA,s\n\nB,"two\nlines"\n\n\nC,s\nD,s\n')).toEqual(['A@2', 'B@4', 'C@8', 'D@9']);
  });

  it('handles CRLF, a UTF-8 byte-order mark, mixed endings and non-ASCII text', () => {
    expect(lines('﻿Model,Supplier\r\nA,s\r\n\r\nB,"x\r\ny\r\nz"\r\nC,s\r\n')).toEqual(['A@2', 'B@4', 'C@7']);
    expect(lines('Model,Supplier\nA,s\n\nB,"x\ny"\n\n\nC,s\r\nD,s\nE,"p\r\nq"')).toEqual(['A@2', 'B@4', 'C@8', 'D@9', 'E@10']);
    expect(lines('Model,Supplier\nA,Café é\n\nB,ok\n')).toEqual(['A@2', 'B@4']);
  });

  it('a malformed file throws, and the message names the line without internals', () => {
    let error: unknown;
    try { readCsvRows(Buffer.from('Model,Supplier\nA,"open\nB,x\n'), header); } catch (e) { error = e; }
    expect(error).toBeDefined();
    expect(csvParseMessage(error)).toMatch(/^Could not read the CSV file/);
    expect(csvParseMessage(new Error('x'))).toBe('Could not read the CSV file.');
  });
});

describe('parseCsvDate', () => {
  it.each([
    ['2026-06-01', '2026-06-01T00:00:00.000Z'],
    ['01/06/2026', '2026-06-01T00:00:00.000Z'], // DD/MM/YYYY, day first
    ['1/6/2026', '2026-06-01T00:00:00.000Z'], // D/M/YYYY
    ['1/06/2026', '2026-06-01T00:00:00.000Z'],
    ['01/6/2026', '2026-06-01T00:00:00.000Z'],
    ['13/06/2026', '2026-06-13T00:00:00.000Z'],
    ['3/12/2026', '2026-12-03T00:00:00.000Z'], // never month-first
    ['31/1/2026', '2026-01-31T00:00:00.000Z'],
    ['29/02/2024', '2024-02-29T00:00:00.000Z'],
    ['29/2/2024', '2024-02-29T00:00:00.000Z'],
    [' 2026-12-31 ', '2026-12-31T00:00:00.000Z'],
  ])('%s → %s (a calendar date at UTC midnight, never shifted)', (raw, iso) => {
    expect(parseCsvDate(raw).toISOString()).toBe(iso);
  });

  it.each(['01-06-2026', '1-6-2026', '2026/06/01', '06/01/26', '1/6/26', '001/06/2026', '1/006/2026', '2026-6-1', '1 June 2026', 'June 1, 2026', '2026-06-01T10:00', 'garbage', '01.06.2026', '1/6/2026 10:00'])('%s is refused (unsupported format)', (raw) => {
    expect(() => parseCsvDate(raw)).toThrow(/not in a supported format — use YYYY-MM-DD or D\/M\/YYYY, day first/);
  });

  it.each(['31/02/2026', '31/2/2026', '29/02/2025', '29/2/2025', '2026-13-01', '00/06/2026', '0/6/2026', '1/0/2026', '32/1/2026', '1/13/2026', '2026-04-31'])('%s is refused (not a real date)', (raw) => {
    expect(() => parseCsvDate(raw)).toThrow(/is not a real date/);
  });
});

describe('csvStatus', () => {
  it('blank or AVAILABLE (any case / spacing) → AVAILABLE', () => {
    for (const raw of [undefined, '', '  ', 'AVAILABLE', 'available', ' Available ']) expect(csvStatus(raw)).toBe('AVAILABLE');
  });

  it.each(['RESERVED', 'BOOKED', 'DELIVERED', 'IN_SERVICE', 'in service', 'RETURNED'])('%s is refused with a clear message', (raw) => {
    expect(() => csvStatus(raw)).toThrow(`Status "${raw}" cannot be imported — only AVAILABLE units can be added by CSV`);
  });

  it('an unknown status is refused as unknown', () => {
    expect(() => csvStatus('SOLD')).toThrow('Unknown status "SOLD" — only AVAILABLE units can be added by CSV');
  });
});

describe('resolveCsvVariant', () => {
  const m = (id: string, brand: string, name: string, isActive = true) => ({ id, brand, name, isActive });
  const v = (id: string, modelId: string, name: string, colour: string, isActive = true) => ({ id, modelId, name, colour, isActive, exShowroomPrice: 1_000n });
  const catalogue: Catalogue = {
    models: [m('solo', 'GAMMA', 'Solo'), m('vx-a', 'ALPHA', 'VX'), m('vx-b', 'BETA', 'VX'), m('old', 'GAMMA', 'Old', false), m('mx-on', 'DELTA', 'MX'), m('mx-off', 'EPSILON', 'MX', false), m('dup1', 'ZETA', 'Twin'), m('dup2', 'ZETA', 'twin')],
    variants: [
      v('pro-teal', 'solo', 'Pro', 'Teal'), v('max-red', 'solo', 'Max X', 'Red'), v('lite', 'solo', 'Lite', 'Blue', false),
      v('vxa-pro', 'vx-a', 'Pro', 'Red'), v('vxb-pro', 'vx-b', 'Pro', 'Red'), v('old-pro', 'old', 'Pro', 'Red'), v('mx-pro', 'mx-on', 'Pro', 'Red'),
      v('dupv1', 'solo', 'Duo', 'Black'), v('dupv2', 'solo', 'DUO', 'black'),
    ],
  };
  const resolve = (row: Partial<{ brand: string; model: string; variant: string; colour: string }>) => resolveCsvVariant(catalogue, { model: 'Solo', variant: 'Pro', colour: 'Teal', ...row });

  it('matches an existing active variant', () => {
    expect(resolve({}).id).toBe('pro-teal');
  });

  it('ignores case, outer whitespace and repeated inner whitespace', () => {
    expect(resolve({ model: '  solo ', variant: 'max   x', colour: 'RED' }).id).toBe('max-red');
    expect(normaliseCatalogueText('  Max \t  X ')).toBe('max x');
  });

  it('an unknown model or variant is a row error that lists what exists; nothing is created', () => {
    expect(() => resolve({ model: 'Nope' })).toThrow('Model "Nope" was not found — check the model name, or add it under Inventory → Models first.');
    expect(() => resolve({ variant: 'Pro', colour: 'Pink' })).toThrow('Variant "Pro / Pink" was not found for GAMMA Solo — available: Pro / Teal, Max X / Red, Duo / Black, DUO / black.');
  });

  it('an inactive model or variant is refused', () => {
    expect(() => resolve({ model: 'Old', variant: 'Pro', colour: 'Red' })).toThrow('Model GAMMA Old is inactive');
    expect(() => resolve({ variant: 'Lite', colour: 'Blue' })).toThrow('Variant Lite / Blue of GAMMA Solo is inactive');
  });

  it('the same model name under two brands: ambiguous without Brand, resolved with it', () => {
    expect(() => resolve({ model: 'VX', variant: 'Pro', colour: 'Red' })).toThrow('Model "VX" matches more than one model (ALPHA VX, BETA VX) — add a Brand column to choose one.');
    expect(resolve({ brand: 'beta', model: 'vx', variant: 'pro', colour: 'red' }).id).toBe('vxb-pro');
    expect(resolve({ brand: 'ALPHA', model: 'VX', variant: 'Pro', colour: 'Red' }).id).toBe('vxa-pro');
    expect(() => resolve({ brand: 'OMEGA', model: 'VX' })).toThrow('Model "OMEGA VX" was not found — check the brand and model name');
  });

  it('without Brand, exactly one ACTIVE model counts — an inactive namesake does not make it ambiguous', () => {
    expect(resolve({ model: 'MX', variant: 'Pro', colour: 'Red' }).id).toBe('mx-pro');
  });

  it('names that differ only in case are ambiguous once normalised, for models and variants', () => {
    expect(() => resolve({ brand: 'ZETA', model: 'TWIN' })).toThrow('matches more than one model (ZETA Twin, ZETA twin) — their names differ only in case or spacing');
    expect(() => resolve({ variant: 'duo', colour: 'BLACK' })).toThrow('matches more than one variant of GAMMA Solo (Duo / Black, DUO / black)');
  });
});

describe('csvRowMessage — safe messages', () => {
  const row = { vin: 'VIN1', motorNumber: 'MOT1', batteryNumber: 'BAT1' };
  const zod = (record: object): ZodError => {
    const r = csvUnitRowSchema.safeParse(record);
    if (r.success) throw new Error('expected a validation error');
    return r.error;
  };

  it('row errors pass through; validation issues are named in plain words', () => {
    expect(csvRowMessage(new CsvRowError('Fix this'), row)).toEqual({ message: 'Fix this', unexpected: false });
    expect(csvRowMessage(zod({ model: 'VX', variant: 'Pro', colour: 'Red', vin: 'V1234', motorNumber: 'M', batteryNumber: 'B', sellingPrice: '1,25,000' }), row).message)
      .toBe('Selling price must be a number in rupees (digits only — no commas or ₹)');
    expect(csvRowMessage(zod({ variant: 'Pro', colour: 'Red', vin: 'V1', motorNumber: 'M', batteryNumber: 'B', purchaseCost: '-5' }), row).message)
      .toBe('Model is required; VIN is too short; Purchase cost cannot be negative');
  });

  it('a duplicate identifier names the field and value (Postgres reports fields or the index name)', () => {
    const p2002 = (target: unknown) => Object.assign(new Error('Unique constraint failed'), { code: 'P2002', meta: { target } });
    expect(csvRowMessage(p2002(['vin']), row).message).toBe('A scooter with VIN "VIN1" already exists.');
    expect(csvRowMessage(p2002('InventoryUnit_motorNumber_key'), row).message).toBe('Motor number "MOT1" already exists on another scooter.');
    expect(csvRowMessage(p2002(['batteryNumber']), row).message).toBe('Battery number "BAT1" already exists on another scooter.');
  });

  it('anything unexpected gets a generic message and is flagged for the server log — no raw database text', () => {
    const result = csvRowMessage(new Error('Invalid `prisma.inventoryUnit.create()` invocation: secret detail'), row);
    expect(result.unexpected).toBe(true);
    expect(result.message).not.toContain('prisma');
    expect(result.message).toContain('unexpected error');
  });
});
