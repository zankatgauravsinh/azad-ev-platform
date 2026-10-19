import { readCsvRows, type Catalogue } from './csv-import';
import { buildCsvPreview, identifierCandidates, validateCsvFile, type ExistingIdentifiers } from './csv-preview';

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
const none = (): ExistingIdentifiers => ({ vin: new Map(), motorNumber: new Map(), batteryNumber: new Map() });
const SHA = 'a'.repeat(64);
const preview = (lines: string[], existing = none()) =>
  buildCsvPreview(readCsvRows(Buffer.from([HEAD, ...lines].join('\n')), header), catalogue, existing, 2000, new Date('2026-10-11T00:00:00.000Z'), SHA);

describe('buildCsvPreview', () => {
  it('a valid row: what the import would create, with the price source', () => {
    const p = preview([',solo,PRO,teal,vin1,m1,b1,1/6/2026,1000,,', 'GAMMA,Solo,Pro,Teal,vin2,m2,b2,,,0,AVAILABLE']);
    expect(p.summary).toEqual({ total: 2, valid: 2, invalid: 0, duplicate: 0 });
    expect(p.rows[0]).toEqual({
      row: 2, status: 'VALID', vin: 'VIN1', issues: [],
      unit: { modelId: 'solo', variantId: 'pro', brand: 'GAMMA', model: 'Solo', variant: 'Pro', colour: 'Teal', status: 'AVAILABLE', sellingPrice: '12500000', sellingPriceSource: 'LIST_PRICE', purchaseCost: '100000', purchaseDate: '2026-06-01', vendorName: null },
    });
    expect(p.rows[1]!.unit).toMatchObject({ sellingPrice: '0', sellingPriceSource: 'FILE', purchaseCost: '0', purchaseDate: null });
    expect(p).toMatchObject({ checkedAt: '2026-10-11T00:00:00.000Z', maxRows: 2000, fileSha256: SHA });
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

  describe('Supplier → vendor', () => {
    const SUPPLIER_HEAD = `${HEAD},Supplier`;
    const vendors: Catalogue = {
      ...catalogue,
      vendors: [
        { id: 'v-comptech', vendorNumber: 'VND0001', name: 'COMPTECH' },
        { id: 'v-a', vendorNumber: 'VND0002', name: 'Twin Motors' },
        { id: 'v-b', vendorNumber: 'VND0003', name: 'twin motors ' },
      ],
      defaultVendorId: 'v-comptech',
    };
    const run = (supplier: string, cat: Catalogue = vendors) =>
      validateCsvFile(readCsvRows(Buffer.from([SUPPLIER_HEAD, `,Solo,Pro,Teal,vin1,m1,b1,,,,,${supplier}`].join('\n')), header), cat, none(), 2000, new Date('2026-10-11T00:00:00.000Z'), SHA);

    it('a vendor named (any case, extra spaces) or by its vendor number is linked; the supplier text becomes its name', () => {
      expect(run('  comptech ').units[0]).toMatchObject({ vendorId: 'v-comptech', supplier: 'COMPTECH' });
      expect(run('vnd0003').units[0]).toMatchObject({ vendorId: 'v-b', supplier: 'twin motors ' });
      expect(run('  comptech ').preview.rows[0]!.unit).toMatchObject({ vendorName: 'COMPTECH' });
    });

    it('blank → the default scooter vendor (none set → no vendor)', () => {
      expect(run('').units[0]).toMatchObject({ vendorId: 'v-comptech', supplier: 'COMPTECH' });
      expect(run('', { ...vendors, defaultVendorId: null }).units[0]).toMatchObject({ vendorId: null, supplier: null });
    });

    it('an unknown vendor, or a name two vendors share, is a row error on Supplier', () => {
      expect(run('Depot').preview.rows[0]!.issues).toEqual([expect.objectContaining({ code: 'VENDOR_NOT_FOUND', field: 'supplier' })]);
      const twin = run('Twin Motors').preview.rows[0]!.issues;
      expect(twin).toEqual([expect.objectContaining({ code: 'VENDOR_AMBIGUOUS', field: 'supplier' })]);
      expect(twin[0]!.message).toContain('VND0002, VND0003');
    });
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

  it('identifiers already in use: own inventory (deleted included) named as such; registered elsewhere → generic "not available"', () => {
    const existing = none();
    existing.vin.set('VIN1', { own: true, deleted: false });
    existing.motorNumber.set('M3', { own: true, deleted: true });
    existing.batteryNumber.set('B2', { own: false, deleted: false });
    const p = preview([',Solo,Pro,Teal,vin1,m1,b1,,,,', ',Solo,Pro,Teal,vin2,m2,b2,,,,', ',Solo,Pro,Teal,vin3,m3,b3,,,,', ',Solo,Pro,Teal,vin4,m4,b4,,,,'], existing);
    expect(p.rows[0]!.issues).toEqual([{ code: 'ALREADY_EXISTS', field: 'vin', message: 'VIN "VIN1" is already used by a scooter in your inventory.' }]);
    expect(p.rows[1]!.issues).toEqual([{ code: 'IDENTIFIER_UNAVAILABLE', field: 'batteryNumber', message: 'Battery number "B2" is not available — it is already registered and cannot be used.' }]);
    expect(p.rows[2]!.issues).toEqual([{ code: 'ALREADY_EXISTS', field: 'motorNumber', message: 'Motor number "M3" is already used by a deleted scooter in your inventory.' }]);
    expect(p.summary).toEqual({ total: 4, valid: 1, invalid: 3, duplicate: 3 });
  });

  it('validateCsvFile returns exactly what the import writes for each valid row', () => {
    const { preview: p, units } = validateCsvFile(readCsvRows(Buffer.from([HEAD, ',Solo,Pro,Teal, vin1 ,m1,b1,1/6/2026,1000,,', 'beta,VX,Pro,Red,vin2,m2,b2,,,500,'].join('\n')), header), catalogue, none(), 2000, new Date(), SHA);
    expect(p.summary.invalid).toBe(0);
    expect(units).toEqual([
      { line: 2, variantId: 'pro', vin: 'VIN1', motorNumber: 'M1', batteryNumber: 'B1', sellingPrice: 12_500_000n, purchaseCost: 100_000n, purchaseDate: new Date('2026-06-01T00:00:00.000Z'), supplier: null, vendorId: null, location: null },
      { line: 3, variantId: 'vxb', vin: 'VIN2', motorNumber: 'M2', batteryNumber: 'B2', sellingPrice: 50_000n, purchaseCost: 0n, purchaseDate: null, supplier: null, vendorId: null, location: null },
    ]);
  });

  it('rows carry their source line (blank lines and multi-line cells counted)', () => {
    const p = buildCsvPreview(readCsvRows(Buffer.from(`${HEAD}\r\n,Solo,Pro,Teal,v100,m100,b100,,,,\r\n\r\n,"Nope\r\nX",Pro,Teal,v200,m200,b200,,,,\r\n,Solo,Pro,Teal,v300,m300,b300,,,,\r\n`), header), catalogue, none(), 2000, new Date(), SHA);
    expect(p.rows.map((r) => [r.row, r.status])).toEqual([[2, 'VALID'], [4, 'INVALID'], [6, 'VALID']]);
  });

  it('identifierCandidates collects the normalised values to look up once', () => {
    const rows = readCsvRows(Buffer.from(`${HEAD}\n,Solo,Pro,Teal, vin1 ,m1,,,,,\n,Solo,Pro,Teal,VIN1,m2,b2,,,,\n`), header);
    expect(identifierCandidates(rows)).toEqual({ vin: ['VIN1'], motorNumber: ['M1', 'M2'], batteryNumber: ['B2'] });
  });

  it('a purchase date after today is refused (today itself is fine)', () => {
    const rows = readCsvRows(Buffer.from([HEAD, ',Solo,Pro,Teal,vin1,m1,b1,12/10/2026,,,', ',Solo,Pro,Teal,vin2,m2,b2,2026-10-11,,,'].join('\n')), header);
    const p = buildCsvPreview(rows, catalogue, none(), 2000, new Date('2026-10-11T00:00:00.000Z'), SHA, '2026-10-11');
    expect(p.rows[0]!.issues).toEqual([{ code: 'INVALID_DATE', field: 'purchaseDate', message: 'Purchase date 12/10/2026 is in the future.' }]);
    expect(p.rows[1]!.status).toBe('VALID');
  });
});
