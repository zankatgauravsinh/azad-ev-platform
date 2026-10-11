import { readCsvRows, type Catalogue } from './csv-import';
import { buildCsvPreview, identifierCandidates, type ExistingIdentifiers } from './csv-preview';

const header = (h: string): string => {
  const key = h.toLowerCase().replace(/[\s_-]+/g, '');
  const map: Record<string, string> = { motornumber: 'motorNumber', batterynumber: 'batteryNumber', purchasedate: 'purchaseDate', purchasecost: 'purchaseCost', sellingprice: 'sellingPrice' };
  return map[key] ?? key;
};
const HEAD = 'Brand,Model,Variant,Colour,VIN,Motor Number,Battery Number,Purchase Date,Purchase Cost,Selling Price,Status';
const m = (id: string, brand: string, name: string, isActive = true) => ({ id, brand, name, isActive });
const v = (id: string, modelId: string, name: string, colour: string, isActive = true, price = 12_500_000n) => ({ id, modelId, name, colour, isActive, exShowroomPrice: price });
const catalogue: Catalogue = {
  models: [m('solo', 'GAMMA', 'Solo'), m('vx-a', 'ALPHA', 'VX'), m('vx-b', 'BETA', 'VX'), m('old', 'GAMMA', 'Old', false)],
  variants: [v('pro', 'solo', 'Pro', 'Teal'), v('lite', 'solo', 'Lite', 'Blue', false), v('vxa', 'vx-a', 'Pro', 'Red'), v('vxb', 'vx-b', 'Pro', 'Red'), v('oldv', 'old', 'Pro', 'Red')],
};
const none = (): ExistingIdentifiers => ({ vin: new Set(), motorNumber: new Set(), batteryNumber: new Set() });
const preview = (lines: string[], existing = none()) =>
  buildCsvPreview(readCsvRows(Buffer.from([HEAD, ...lines].join('\n')), header), catalogue, existing, 2000, new Date('2026-10-11T00:00:00.000Z'));

describe('buildCsvPreview', () => {
  it('a valid row: what the import would create, with the price source', () => {
    const p = preview([',solo,PRO,teal,vin1,m1,b1,1/6/2026,1000,,', 'GAMMA,Solo,Pro,Teal,vin2,m2,b2,,,0,AVAILABLE']);
    expect(p.summary).toEqual({ total: 2, valid: 2, invalid: 0, duplicate: 0 });
    expect(p.rows[0]).toEqual({
      row: 2, status: 'VALID', vin: 'VIN1', issues: [],
      unit: { modelId: 'solo', variantId: 'pro', brand: 'GAMMA', model: 'Solo', variant: 'Pro', colour: 'Teal', status: 'AVAILABLE', sellingPrice: '12500000', sellingPriceSource: 'LIST_PRICE', purchaseCost: '100000', purchaseDate: '2026-06-01' },
    });
    expect(p.rows[1]!.unit).toMatchObject({ sellingPrice: '0', sellingPriceSource: 'FILE', purchaseCost: '0', purchaseDate: null });
    expect(p).toMatchObject({ checkedAt: '2026-10-11T00:00:00.000Z', maxRows: 2000 });
  });

  it('lists every problem of a row, each with a code and a field', () => {
    const p = preview([',Old,Pro,Red,v1,,b3,31/2/2026,-5,abc,BOOKED']);
    expect(p.rows[0]!.status).toBe('INVALID');
    expect(p.rows[0]!.unit).toBeNull();
    expect(p.rows[0]!.issues.map((i) => [i.code, i.field])).toEqual([
      ['INVALID_VALUE', 'vin'], ['INVALID_VALUE', 'motorNumber'], ['INVALID_VALUE', 'purchaseCost'], ['INVALID_VALUE', 'sellingPrice'],
      ['STATUS_NOT_ALLOWED', 'status'], ['INVALID_DATE', 'purchaseDate'], ['MODEL_INACTIVE', 'model'],
    ]);
    expect(p.rows[0]!.issues.find((i) => i.field === 'vin')!.message).toBe('VIN is too short');
  });

  it.each([
    [',Nope,Pro,Teal', 'MODEL_NOT_FOUND', 'model'],
    [',VX,Pro,Red', 'MODEL_AMBIGUOUS', 'model'],
    [',Solo,Pro,Pink', 'VARIANT_NOT_FOUND', 'variant'],
    [',Solo,Lite,Blue', 'VARIANT_INACTIVE', 'variant'],
  ])('catalogue: %s → %s', (names, code, field) => {
    const p = preview([`${names},vinx,mx,bx,,,,`]);
    expect(p.rows[0]!.issues).toEqual([expect.objectContaining({ code, field })]);
  });

  it('a Brand resolves a model name used by several brands', () => {
    expect(preview(['beta,vx,pro,red,vin1,m1,b1,,,,']).rows[0]!.unit).toMatchObject({ variantId: 'vxb', brand: 'BETA' });
  });

  it('identifiers repeated in the file make EVERY row involved invalid, naming the other lines; otherwise-valid rows included', () => {
    const p = preview([
      ',Solo,Pro,Teal,VIN1,m1,b1,,,,',
      ',Solo,Pro,Teal, vin1 ,m2,b2,,,,', // same VIN once normalised
      ',Solo,Pro,Teal,vin3,M1,b3,,,,', // same motor as line 2
      ',Solo,Pro,Teal,vin4,m4,b4,,,,',
      ',Nope,Pro,Teal,vin5,m5,B4,,,,', // invalid anyway; still a battery clash with line 5
    ]);
    expect(p.rows.map((r) => r.status)).toEqual(['INVALID', 'INVALID', 'INVALID', 'INVALID', 'INVALID']);
    expect(p.rows[0]!.issues).toEqual([
      { code: 'DUPLICATE_IN_FILE', field: 'vin', message: 'VIN "VIN1" also appears on line 3 of this file — each scooter must be listed once.' },
      { code: 'DUPLICATE_IN_FILE', field: 'motorNumber', message: 'Motor number "M1" also appears on line 4 of this file — each scooter must be listed once.' },
    ]);
    expect(p.rows[3]!.issues.map((i) => i.code)).toEqual(['DUPLICATE_IN_FILE']); // line 5: battery B4 with line 6
    expect(p.rows[4]!.issues.map((i) => i.code)).toEqual(['MODEL_NOT_FOUND', 'DUPLICATE_IN_FILE']); // line 6
    expect(p.summary).toEqual({ total: 5, valid: 0, invalid: 5, duplicate: 5 });
  });

  it('identifiers already in use are reported without saying where', () => {
    const existing = none();
    existing.vin.add('VIN1');
    existing.batteryNumber.add('B2');
    const p = preview([',Solo,Pro,Teal,vin1,m1,b1,,,,', ',Solo,Pro,Teal,vin2,m2,b2,,,,', ',Solo,Pro,Teal,vin3,m3,b3,,,,'], existing);
    expect(p.rows[0]!.issues).toEqual([{ code: 'ALREADY_EXISTS', field: 'vin', message: 'A scooter with VIN "VIN1" already exists.' }]);
    expect(p.rows[1]!.issues).toEqual([{ code: 'ALREADY_EXISTS', field: 'batteryNumber', message: 'Battery number "B2" already exists on another scooter.' }]);
    expect(p.summary).toEqual({ total: 3, valid: 1, invalid: 2, duplicate: 2 });
  });

  it('rows carry their source line (blank lines and multi-line cells counted)', () => {
    const p = buildCsvPreview(readCsvRows(Buffer.from(`${HEAD}\r\n,Solo,Pro,Teal,v100,m100,b100,,,,\r\n\r\n,"Nope\r\nX",Pro,Teal,v200,m200,b200,,,,\r\n,Solo,Pro,Teal,v300,m300,b300,,,,\r\n`), header), catalogue, none(), 2000, new Date());
    expect(p.rows.map((r) => [r.row, r.status])).toEqual([[2, 'VALID'], [4, 'INVALID'], [6, 'VALID']]);
  });

  it('identifierCandidates collects the normalised values to look up once', () => {
    const rows = readCsvRows(Buffer.from(`${HEAD}\n,Solo,Pro,Teal, vin1 ,m1,,,,,\n,Solo,Pro,Teal,VIN1,m2,b2,,,,\n`), header);
    expect(identifierCandidates(rows)).toEqual({ vin: ['VIN1'], motorNumber: ['M1', 'M2'], batteryNumber: ['B2'] });
  });
});
