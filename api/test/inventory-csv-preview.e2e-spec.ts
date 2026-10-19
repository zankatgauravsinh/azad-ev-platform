import { createHash } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { CSV_IMPORT_MAX_BYTES, CSV_IMPORT_MAX_ROWS, type CsvImportPreview, type CsvImportResult } from '@azad/shared';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createE2eApp, E2E_HOOK_TIMEOUT } from './support/e2e-app';
import { createTestCompany, purgeTestCompany, TestCompany } from './support/e2e-company';

/**
 * M4D.2 — CSV import preview (dry run). Every row is validated exactly as the import does, plus
 * identifiers repeated in the file or already in use; nothing is written. The preview carries the file's
 * SHA-256, which the M4D.3 import accepts as `expectedSha256` (the import always re-validates).
 *
 * Runs in throwaway companies (see support/e2e-company), hard-deleted afterwards.
 */
describe('Inventory CSV import preview (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let A: TestCompany;
  let B: TestCompany;
  const stamp = Date.now().toString().slice(-8);
  let serial = 0;
  const http = () => request(app.getHttpServer());
  const id = (): string => `${stamp}${(serial++).toString().padStart(3, '0')}`;
  const cat = { solo: '', pro: '', lite: '', old: '', exclusive: '' };
  const LIST_PRICE = 12_500_000;
  const HEAD = 'Brand,Model,Variant,Colour,VIN,Motor Number,Battery Number,Purchase Date,Purchase Cost,Selling Price,Status';

  const preview = (csv: string, co: TestCompany = A) =>
    http().post('/api/v1/inventory/units/import/preview').set('Authorization', co.auth()).attach('file', Buffer.from(csv, 'utf8'), { filename: 'units.csv', contentType: 'text/csv' });
  const importCsv = (csv: string, expectedSha256: string, co: TestCompany = A) =>
    http().post('/api/v1/inventory/units/import').set('Authorization', co.auth()).attach('file', Buffer.from(csv, 'utf8'), { filename: 'units.csv', contentType: 'text/csv' }).field('expectedSha256', expectedSha256);
  const sha = (csv: string): string => createHash('sha256').update(Buffer.from(csv, 'utf8')).digest('hex');
  type Over = Partial<Record<'brand' | 'model' | 'variant' | 'colour' | 'vin' | 'motor' | 'battery' | 'date' | 'cost' | 'price' | 'status', string>>;
  const row = (over: Over = {}) => {
    const n = id();
    const r = { brand: '', model: 'Solo', variant: 'Pro', colour: 'Teal', vin: `PRV${n}`, motor: `PRM${n}`, battery: `PRB${n}`, date: '', cost: '', price: '', status: '', ...over };
    return { ...r, line: [r.brand, r.model, r.variant, r.colour, r.vin, r.motor, r.battery, r.date, r.cost, r.price, r.status].join(',') };
  };
  const body = (res: request.Response): CsvImportPreview => res.body as CsvImportPreview;

  /** Everything a preview could conceivably write, across the whole system. */
  const snapshot = async () => ({
    units: await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "InventoryUnit"`.then((r) => Number(r[0]!.n)),
    events: await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "InventoryEvent"`.then((r) => Number(r[0]!.n)),
    activity: await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "ActivityLog" WHERE "companyId" IN (${A.id}, ${B.id})`.then((r) => Number(r[0]!.n)),
    models: await prisma.scooterModel.findMany({ where: { companyId: { in: [A.id, B.id] } }, orderBy: { id: 'asc' } }),
    variants: await prisma.scooterVariant.findMany({ where: { companyId: { in: [A.id, B.id] } }, orderBy: { id: 'asc' } }),
  });

  beforeAll(async () => {
    app = await createE2eApp();
    prisma = app.get(PrismaService);
    A = await createTestCompany(app, 'Prv', { roles: ['TECHNICIAN'] });
    B = await createTestCompany(app, 'PrvB');
    const post = (url: string, b: object, co: TestCompany = A) => http().post(url).set('Authorization', co.auth()).send(b);
    cat.solo = (await post('/api/v1/inventory/models', { brand: 'GAMMA', name: 'Solo' }).expect(201)).body.id;
    cat.pro = (await post(`/api/v1/inventory/models/${cat.solo}/variants`, { name: 'Pro', colour: 'Teal', exShowroomPrice: LIST_PRICE }).expect(201)).body.id;
    cat.lite = (await post(`/api/v1/inventory/models/${cat.solo}/variants`, { name: 'Lite', colour: 'Blue', exShowroomPrice: 1 }).expect(201)).body.id;
    await http().patch(`/api/v1/inventory/variants/${cat.lite}/active`).set('Authorization', A.auth()).send({ isActive: false }).expect(200);
    cat.old = (await post('/api/v1/inventory/models', { brand: 'GAMMA', name: 'Old' }).expect(201)).body.id;
    await post(`/api/v1/inventory/models/${cat.old}/variants`, { name: 'Pro', colour: 'Red', exShowroomPrice: 1 }).expect(201);
    await http().patch(`/api/v1/inventory/models/${cat.old}/active`).set('Authorization', A.auth()).send({ isActive: false }).expect(200);
    for (const brand of ['ALPHA', 'BETA'] as const) { // legacy data the catalogue API now refuses: one name, two brands
      const model = await prisma.scooterModel.create({ data: { companyId: A.id, brand, name: 'VX' } });
      await prisma.scooterVariant.create({ data: { companyId: A.id, modelId: model.id, name: 'Pro', colour: 'Red', exShowroomPrice: 7_000_000n } });
    }
    cat.exclusive = (await post('/api/v1/inventory/models', { brand: 'OMEGA', name: 'Exclusive' }, B).expect(201)).body.id;
    await post(`/api/v1/inventory/models/${cat.exclusive}/variants`, { name: 'Pro', colour: 'Red', exShowroomPrice: 5_000_000 }, B).expect(201);
  }, 60_000);

  afterAll(async () => {
    await purgeTestCompany(prisma, A?.id);
    await purgeTestCompany(prisma, B?.id);
    await app.close();
  }, E2E_HOOK_TIMEOUT);

  it('a mixed file: every row checked with the import rules, every problem listed — and nothing at all is written', async () => {
    const before = await snapshot();
    const rows = [
      row({ model: '  solo ', variant: 'PRO', colour: 'teal', date: '1/6/2026', cost: '110000' }), // valid, list price
      row({ price: '0', date: '2026-06-02', status: 'available' }), // valid, explicit zero
      row({ model: 'Nope' }),
      row({ model: 'Old', variant: 'Pro', colour: 'Red' }),
      row({ variant: 'Lite', colour: 'Blue' }),
      row({ model: 'VX', variant: 'Pro', colour: 'Red' }),
      row({ brand: 'beta', model: 'vx', variant: 'pro', colour: 'red' }), // valid with Brand
      row({ status: 'DELIVERED', date: '31/2/2026', price: '"1,25,000"' }), // quoted, as a spreadsheet writes it
    ];
    const csv = [HEAD, ...rows.map((r) => r.line)].join('\n');
    const p = body(await preview(csv).expect(200));
    expect(p.summary).toEqual({ total: 8, valid: 3, invalid: 5, duplicate: 0 });
    expect(p.maxRows).toBe(CSV_IMPORT_MAX_ROWS);
    expect(p.fileSha256).toBe(sha(csv));
    expect(p.rows.map((r) => r.status)).toEqual(['VALID', 'VALID', 'INVALID', 'INVALID', 'INVALID', 'INVALID', 'VALID', 'INVALID']);
    expect(p.rows[0]).toEqual({
      row: 2, status: 'VALID', vin: rows[0]!.vin.toUpperCase(), issues: [],
      unit: { modelId: cat.solo, variantId: cat.pro, brand: 'GAMMA', model: 'Solo', variant: 'Pro', colour: 'Teal', status: 'AVAILABLE', sellingPrice: String(LIST_PRICE), sellingPriceSource: 'LIST_PRICE', purchaseCost: '11000000', purchaseDate: '2026-06-01', vendorName: null },
    });
    expect(p.rows[1]!.unit).toMatchObject({ sellingPrice: '0', sellingPriceSource: 'FILE', purchaseDate: '2026-06-02' });
    expect(p.rows[6]!.unit).toMatchObject({ brand: 'BETA', model: 'VX', sellingPrice: '7000000' });
    expect(p.rows.slice(2, 6).map((r) => r.issues.map((i) => i.code))).toEqual([['MODEL_NOT_FOUND'], ['MODEL_INACTIVE'], ['VARIANT_INACTIVE'], ['MODEL_AMBIGUOUS']]);
    expect(p.rows[5]!.issues[0]!.message).toBe('Model "VX" matches more than one model (ALPHA VX, BETA VX) — add a Brand column to choose one.');
    expect(p.rows[7]!.issues.map((i) => [i.code, i.field])).toEqual([['INVALID_VALUE', 'sellingPrice'], ['STATUS_NOT_ALLOWED', 'status'], ['INVALID_DATE', 'purchaseDate']]);
    expect(p.rows.map((r) => Object.keys(r).sort())).toEqual(p.rows.map(() => ['issues', 'row', 'status', 'unit', 'vin'])); // no other vehicle data
    expect(await snapshot()).toEqual(before);
  });

  it("identifiers repeated in the file invalidate every row involved; ones already in use are flagged — own inventory (deleted included) as such, another company's only as unavailable", async () => {
    const mine = (await http().post('/api/v1/inventory/units').set('Authorization', A.auth()).send({ variantId: cat.pro, vin: `MINEV${stamp}`, motorNumber: `MINEM${stamp}`, batteryNumber: `MINEB${stamp}` }).expect(201)).body;
    const gone = (await http().post('/api/v1/inventory/units').set('Authorization', A.auth()).send({ variantId: cat.pro, vin: `GONEV${stamp}`, motorNumber: `GONEM${stamp}`, batteryNumber: `GONEB${stamp}` }).expect(201)).body;
    await http().delete(`/api/v1/inventory/units/${gone.id}`).set('Authorization', A.auth()).expect(204);
    const bVariant = (await http().get(`/api/v1/inventory/variants?modelId=${cat.exclusive}`).set('Authorization', B.auth()).expect(200)).body[0].id;
    await http().post('/api/v1/inventory/units').set('Authorization', B.auth()).send({ variantId: bVariant, vin: `THEIRV${stamp}`, motorNumber: `THEIRM${stamp}`, batteryNumber: `THEIRB${stamp}` }).expect(201);
    const before = await snapshot();
    const twinA = row({ vin: `TWIN${stamp}` });
    const twinB = row({ vin: ` twin${stamp} ` });
    const rows = [twinA, twinB, row({ vin: mine.vin }), row({ motor: `GONEM${stamp}` }), row({ battery: `THEIRB${stamp}` }), row()];
    const p = body(await preview([HEAD, ...rows.map((r) => r.line)].join('\n')).expect(200));
    expect(p.summary).toEqual({ total: 6, valid: 1, invalid: 5, duplicate: 5 });
    expect(p.rows[0]!.issues).toEqual([{ code: 'DUPLICATE_IN_FILE', field: 'vin', message: `VIN "TWIN${stamp}" also appears on line 3 of this file — each scooter must be listed once.` }]);
    expect(p.rows[1]!.issues).toEqual([{ code: 'DUPLICATE_IN_FILE', field: 'vin', message: `VIN "TWIN${stamp}" also appears on line 2 of this file — each scooter must be listed once.` }]);
    expect(p.rows[2]!.issues).toEqual([{ code: 'ALREADY_EXISTS', field: 'vin', message: `VIN "${mine.vin}" is already used by a scooter in your inventory.` }]);
    expect(p.rows[3]!.issues).toEqual([{ code: 'ALREADY_EXISTS', field: 'motorNumber', message: `Motor number "GONEM${stamp}" is already used by a deleted scooter in your inventory.` }]);
    expect(p.rows[4]!.issues).toEqual([{ code: 'IDENTIFIER_UNAVAILABLE', field: 'batteryNumber', message: `Battery number "THEIRB${stamp}" is not available — it is already registered and cannot be used.` }]);
    const text = JSON.stringify(p);
    for (const secret of [B.id, B.tag, bVariant, 'OMEGA', 'Exclusive', `THEIRV${stamp}`, `THEIRM${stamp}`, mine.id, gone.id]) expect(text).not.toContain(secret);
    expect(await snapshot()).toEqual(before);
  });

  it('tenant isolation: each company previews against its own catalogue only', async () => {
    const theirs = row({ model: 'Exclusive', variant: 'Pro', colour: 'Red' });
    expect(body(await preview([HEAD, theirs.line].join('\n')).expect(200)).rows[0]!.issues.map((i) => i.code)).toEqual(['MODEL_NOT_FOUND']);
    const p = body(await preview([HEAD, row().line, row({ model: 'Exclusive', variant: 'Pro', colour: 'Red' }).line].join('\n'), B).expect(200));
    expect(p.rows.map((r) => r.status)).toEqual(['INVALID', 'VALID']); // Solo is A's
    expect(p.rows[1]!.unit).toMatchObject({ modelId: cat.exclusive, brand: 'OMEGA' });
  });

  it('row numbers are the source lines — blank lines, a multi-line cell and CRLF line endings included', async () => {
    const csv = `${HEAD}\r\n${row().line}\r\n\r\n,"Solo\r\nX",Pro,Teal,PRVX${id()},PRMX${id()},PRBX${id()},,,,\r\n\r\n${row().line}\r\n`;
    expect(body(await preview(csv).expect(200)).rows.map((r) => [r.row, r.status])).toEqual([[2, 'VALID'], [4, 'INVALID'], [7, 'VALID']]);
  });

  it('limits: more rows than allowed, an oversized file, no file and an unreadable file are refused safely — and write nothing', async () => {
    const before = await snapshot();
    const tooMany = [HEAD, ...Array.from({ length: CSV_IMPORT_MAX_ROWS + 1 }, (_, i) => `,Solo,Pro,Teal,LIMV${stamp}${i},LIMM${stamp}${i},LIMB${stamp}${i},,,,`)].join('\n');
    expect((await preview(tooMany).expect(400)).body.message).toBe(`The file has ${CSV_IMPORT_MAX_ROWS + 1} rows; at most ${CSV_IMPORT_MAX_ROWS} can be imported at once — split it into smaller files.`);
    const huge = `${HEAD}\n${row().line}\n`.padEnd(CSV_IMPORT_MAX_BYTES + 1, ' ');
    await preview(huge).expect(413);
    await http().post('/api/v1/inventory/units/import/preview').set('Authorization', A.auth()).expect(400);
    const unreadable = await preview(`${HEAD}\n${row().line}\n,Solo,"open quote,Teal\n`).expect(400);
    expect(unreadable.body.message).toMatch(/^Could not read the CSV file: the problem is at line \d+/);
    expect(JSON.stringify(unreadable.body)).not.toMatch(/prisma|CsvError|stack/i);
    expect(await snapshot()).toEqual(before);
  });

  it('permission and authentication: inventory.create is required', async () => {
    await http().post('/api/v1/inventory/units/import/preview').set('Authorization', A.auth('TECHNICIAN')).attach('file', Buffer.from(`${HEAD}\n${row().line}`), 'units.csv').expect(403);
    await http().post('/api/v1/inventory/units/import/preview').attach('file', Buffer.from(HEAD), 'units.csv').expect(401);
  });

  it('a preview never imports; the import of a previewed file agrees with it — refused as a whole, or created in full', async () => {
    const twin = `KEEP${stamp}`;
    const other = row();
    const refused = [HEAD, row({ vin: twin }).line, other.line, row({ vin: twin }).line].join('\n');
    const p = body(await preview(refused).expect(200));
    expect(p.rows.map((r) => r.status)).toEqual(['INVALID', 'VALID', 'INVALID']); // the preview refuses both twins
    expect(await prisma.inventoryUnit.count({ where: { vin: { in: [twin, other.vin.toUpperCase()] } } })).toBe(0);
    const res = (await importCsv(refused, p.fileSha256).expect(200)).body as CsvImportResult;
    expect(res).toMatchObject({ status: 'REJECTED', created: 0, failed: 2, errors: [{ row: 2 }, { row: 4 }] });
    expect(res.preview!.rows.map((r) => r.issues)).toEqual(p.rows.map((r) => r.issues));
    expect(await prisma.inventoryUnit.count({ where: { vin: { in: [twin, other.vin.toUpperCase()] } } })).toBe(0); // all or nothing
    const fixed = [HEAD, row({ vin: twin }).line, other.line].join('\n');
    const q = body(await preview(fixed).expect(200));
    expect(q.summary.valid).toBe(2);
    expect((await importCsv(fixed, q.fileSha256).expect(200)).body).toMatchObject({ status: 'IMPORTED', created: 2 });
  });
});
