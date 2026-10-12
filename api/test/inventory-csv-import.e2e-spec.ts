import { createHash } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { CSV_IMPORT_MAX_BYTES, CSV_IMPORT_MAX_ROWS, type CsvImportPreview, type CsvImportResult } from '@azad/shared';
import request from 'supertest';
import { ActivityLogService } from '../src/activity-log/activity-log.service';
import { InventoryRepository } from '../src/modules/inventory/inventory.repository';
import { PrismaService } from '../src/prisma/prisma.service';
import { createE2eApp, E2E_HOOK_TIMEOUT } from './support/e2e-app';
import { createTestCompany, purgeTestCompany, TestCompany } from './support/e2e-company';

/**
 * M4D.1 rules + M4D.3 ALL-OR-NOTHING import. The whole file is re-validated inside one transaction and
 * either every row is created (units, their history events, one audit entry) or nothing is. The import
 * never creates or changes catalogue entries and never updates existing units.
 *
 * Runs in throwaway companies (see support/e2e-company), hard-deleted afterwards.
 */
describe('Inventory CSV import — all or nothing (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let A: TestCompany;
  let B: TestCompany;
  let customerA = '';
  const stamp = Date.now().toString().slice(-8);
  let serial = 0;
  const http = () => request(app.getHttpServer());
  const id = (): string => `${stamp}${(serial++).toString().padStart(4, '0')}`;
  const cat = { solo: '', pro: '', maxX: '', lite: '', vxBetaPro: '', exclusivePro: '' };
  const LIST_PRICE = 12_500_000n;
  const HEAD = 'Brand,Model,Variant,Colour,VIN,Motor Number,Battery Number,Purchase Date,Purchase Cost,Selling Price,Supplier,Location,Status';

  const sha = (csv: string): string => createHash('sha256').update(Buffer.from(csv, 'utf8')).digest('hex');
  const post = (path: string, csv: string, co: TestCompany, fields: Record<string, string>) => {
    let req = http().post(`/api/v1/inventory/units/${path}`).set('Authorization', co.auth()).attach('file', Buffer.from(csv, 'utf8'), { filename: 'units.csv', contentType: 'text/csv' });
    for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
    return req;
  };
  const importCsv = (csv: string, co: TestCompany = A, fields: Record<string, string> = {}) => post('import', csv, co, fields);
  const preview = (csv: string, co: TestCompany = A) => post('import/preview', csv, co, {});
  type Over = Partial<Record<'brand' | 'model' | 'variant' | 'colour' | 'vin' | 'motor' | 'battery' | 'date' | 'cost' | 'price' | 'supplier' | 'location' | 'status', string>>;
  /** A row with fresh identifiers; override any column. */
  const row = (over: Over = {}) => {
    const n = id();
    const r = { brand: '', model: 'Solo', variant: 'Pro', colour: 'Teal', vin: `IMV${n}`, motor: `IMM${n}`, battery: `IMB${n}`, date: '', cost: '', price: '', supplier: '', location: '', status: '', ...over };
    return { vin: r.vin.trim().toUpperCase(), line: [r.brand, r.model, r.variant, r.colour, r.vin, r.motor, r.battery, r.date, r.cost, r.price, r.supplier, r.location, r.status].join(',') };
  };
  const csvOf = (...rows: { line: string }[]): string => [HEAD, ...rows.map((r) => r.line)].join('\n');
  const unitByVin = (vin: string) => prisma.inventoryUnit.findUnique({ where: { vin: vin.toUpperCase() } });
  const unitsWithVins = (vins: string[]) => prisma.inventoryUnit.count({ where: { vin: { in: vins.map((v) => v.toUpperCase()) } } });
  const count = async (table: 'InventoryUnit' | 'InventoryEvent' | 'ActivityLog'): Promise<number> =>
    Number((await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "${table}" WHERE "companyId" IN ($1, $2)`, A.id, B.id))[0]!.n);
  /** Everything an import could write, for both companies (raw SQL: deleted rows included). */
  const snapshot = async () => ({
    units: await count('InventoryUnit'),
    events: await count('InventoryEvent'),
    activity: await count('ActivityLog'),
    models: await prisma.scooterModel.findMany({ where: { companyId: { in: [A.id, B.id] } }, orderBy: { id: 'asc' } }),
    variants: await prisma.scooterVariant.findMany({ where: { companyId: { in: [A.id, B.id] } }, orderBy: { id: 'asc' } }),
  });
  const result = (res: request.Response): CsvImportResult => res.body as CsvImportResult;
  const addScooter = (co: TestCompany, body: object) => http().post('/api/v1/inventory/units').set('Authorization', co.auth()).send(body).expect(201).then((r) => r.body);
  const setActive = (variantId: string, isActive: boolean) => http().patch(`/api/v1/inventory/variants/${variantId}/active`).set('Authorization', A.auth()).send({ isActive });

  beforeAll(async () => {
    app = await createE2eApp();
    prisma = app.get(PrismaService);
    A = await createTestCompany(app, 'Imp', { roles: ['TECHNICIAN'] });
    B = await createTestCompany(app, 'ImpB');
    const send = (url: string, body: object, co: TestCompany = A) => http().post(url).set('Authorization', co.auth()).send(body);
    cat.solo = (await send('/api/v1/inventory/models', { brand: 'GAMMA', name: 'Solo' }).expect(201)).body.id;
    cat.pro = (await send(`/api/v1/inventory/models/${cat.solo}/variants`, { name: 'Pro', colour: 'Teal', exShowroomPrice: Number(LIST_PRICE) }).expect(201)).body.id;
    cat.maxX = (await send(`/api/v1/inventory/models/${cat.solo}/variants`, { name: 'Max X', colour: 'Red', exShowroomPrice: 9_900_000 }).expect(201)).body.id;
    cat.lite = (await send(`/api/v1/inventory/models/${cat.solo}/variants`, { name: 'Lite', colour: 'Blue', exShowroomPrice: 1 }).expect(201)).body.id;
    await setActive(cat.lite, false).expect(200);
    const old = (await send('/api/v1/inventory/models', { brand: 'GAMMA', name: 'Old' }).expect(201)).body.id;
    await send(`/api/v1/inventory/models/${old}/variants`, { name: 'Pro', colour: 'Red', exShowroomPrice: 1 }).expect(201);
    await http().patch(`/api/v1/inventory/models/${old}/active`).set('Authorization', A.auth()).send({ isActive: false }).expect(200);
    for (const brand of ['ALPHA', 'BETA'] as const) { // legacy data the catalogue API now refuses: one model name, two brands
      const model = await prisma.scooterModel.create({ data: { companyId: A.id, brand, name: 'VX' } });
      const variant = await prisma.scooterVariant.create({ data: { companyId: A.id, modelId: model.id, name: 'Pro', colour: 'Red', exShowroomPrice: brand === 'ALPHA' ? 7_000_000n : 8_000_000n } });
      if (brand === 'BETA') cat.vxBetaPro = variant.id;
    }
    const exclusive = (await send('/api/v1/inventory/models', { brand: 'OMEGA', name: 'Exclusive' }, B).expect(201)).body.id;
    cat.exclusivePro = (await send(`/api/v1/inventory/models/${exclusive}/variants`, { name: 'Pro', colour: 'Red', exShowroomPrice: 5_000_000 }, B).expect(201)).body.id;
    customerA = (await send('/api/v1/customers', { name: `Imp ${stamp}`, phone: `8${stamp}7` }).expect(201)).body.id;
  }, 60_000);

  afterAll(async () => {
    await purgeTestCompany(prisma, A?.id);
    await purgeTestCompany(prisma, B?.id);
    await app.close();
  }, E2E_HOOK_TIMEOUT);

  afterEach(() => jest.restoreAllMocks());

  it('a valid file imports every row — matching, list / explicit prices, dates — with its events and ONE audit entry; the catalogue is untouched', async () => {
    const before = await snapshot();
    const rows = [
      row({ model: '  solo ', variant: 'PRO', colour: 'teal', date: '1/6/2026', cost: '110000', supplier: 'Depot', location: 'Bay 1' }), // blank price
      row({ model: 'SOLO', variant: 'max   x', colour: ' RED ', date: '2026-06-02', price: '0', status: 'available' }), // explicit zero
      row({ brand: ' beta ', model: 'vx', variant: 'pro', colour: 'red', price: '130000.50', status: 'AVAILABLE' }),
    ];
    const csv = csvOf(...rows);
    const res = result(await importCsv(csv, A, { expectedSha256: sha(csv) }).expect(200));
    expect(res).toEqual({ status: 'IMPORTED', created: 3, failed: 0, errors: [], fileSha256: sha(csv), preview: null });
    expect(await unitByVin(rows[0]!.vin)).toMatchObject({ companyId: A.id, variantId: cat.pro, status: 'AVAILABLE', sellingPrice: LIST_PRICE, purchaseCost: 11_000_000n, supplier: 'Depot', location: 'Bay 1', purchaseDate: new Date('2026-06-01T00:00:00.000Z') });
    expect(await unitByVin(rows[1]!.vin)).toMatchObject({ variantId: cat.maxX, sellingPrice: 0n, purchaseDate: new Date('2026-06-02T00:00:00.000Z') });
    expect(await unitByVin(rows[2]!.vin)).toMatchObject({ variantId: cat.vxBetaPro, sellingPrice: 13_000_050n, purchaseDate: null });
    const after = await snapshot();
    expect([after.units - before.units, after.events - before.events, after.activity - before.activity]).toEqual([3, 3, 1]);
    expect(after.models).toEqual(before.models);
    expect(after.variants).toEqual(before.variants);
    const unit = await unitByVin(rows[0]!.vin);
    expect(await prisma.inventoryEvent.findMany({ where: { unitId: unit!.id }, select: { fromStatus: true, toStatus: true, note: true } })).toEqual([{ fromStatus: null, toStatus: 'AVAILABLE', note: 'Imported via CSV' }]);
    const audit = await prisma.activityLog.findFirstOrThrow({ where: { companyId: A.id, summary: 'CSV import: 3 scooters added' } });
    expect(audit.metadata).toEqual({ created: 3, fileSha256: sha(csv) });
  });

  it('one invalid row (unknown / inactive / ambiguous catalogue, status, date, value) → NOTHING imported; REJECTED with the full validation', async () => {
    const before = await snapshot();
    const good = [row(), row({ variant: 'Max X', colour: 'Red' })];
    const bads: [Over, string][] = [
      [{ model: 'Nope' }, 'MODEL_NOT_FOUND'],
      [{ variant: 'Pro', colour: 'Pink' }, 'VARIANT_NOT_FOUND'],
      [{ variant: 'Lite', colour: 'Blue' }, 'VARIANT_INACTIVE'],
      [{ model: 'Old', variant: 'Pro', colour: 'Red' }, 'MODEL_INACTIVE'],
      [{ model: 'VX', variant: 'Pro', colour: 'Red' }, 'MODEL_AMBIGUOUS'],
      [{ status: 'DELIVERED' }, 'STATUS_NOT_ALLOWED'],
      [{ date: '31/2/2026' }, 'INVALID_DATE'],
      [{ price: '1.25.000' }, 'INVALID_VALUE'],
    ];
    for (const [over, code] of bads) {
      const res = result(await importCsv(csvOf(good[0]!, row(over), good[1]!)).expect(200));
      expect(res).toMatchObject({ status: 'REJECTED', created: 0, failed: 1, errors: [{ row: 3 }] });
      expect(res.preview!.summary).toEqual({ total: 3, valid: 2, invalid: 1, duplicate: 0 });
      expect(res.preview!.rows[1]!.issues[0]!.code).toBe(code);
      expect(res.errors[0]!.message).toBe(res.preview!.rows[1]!.issues.map((i) => i.message).join(' '));
    }
    expect(await unitsWithVins(good.map((r) => r.vin))).toBe(0);
    expect(await snapshot()).toEqual(before);
  });

  it('row numbers in a rejection are the source lines (blank lines, a multi-line cell, CRLF)', async () => {
    const res = result(await importCsv(`${HEAD}\r\n${row().line}\r\n\r\n${row({ model: 'Nope', supplier: '"Depot\r\nNorth wing"' }).line}\r\n\r\n${row({ colour: 'Pink' }).line}\r\n`).expect(200));
    expect(res.errors.map((e) => e.row)).toEqual([4, 7]);
  });

  it('identifiers repeated in the file → nothing imported; every row involved is reported', async () => {
    const before = await snapshot();
    const a = row({ vin: `TWIN${stamp}` });
    const c = row();
    const b = row({ vin: ` twin${stamp} ` });
    const res = result(await importCsv(csvOf(a, c, b)).expect(200));
    expect(res).toMatchObject({ status: 'REJECTED', failed: 2 });
    expect(res.errors).toEqual([
      { row: 2, message: `VIN "TWIN${stamp}" also appears on line 4 of this file — each scooter must be listed once.` },
      { row: 4, message: `VIN "TWIN${stamp}" also appears on line 2 of this file — each scooter must be listed once.` },
    ]);
    expect(await unitsWithVins([a.vin, c.vin])).toBe(0);
    expect(await snapshot()).toEqual(before);
  });

  it("numbers already used — own inventory (deleted too) named as such; another company's generic — nothing imported, nothing of theirs revealed", async () => {
    const mine = await addScooter(A, { variantId: cat.pro, vin: `MINEV${stamp}`, motorNumber: `MINEM${stamp}`, batteryNumber: `MINEB${stamp}` });
    const gone = await addScooter(A, { variantId: cat.pro, vin: `GONEV${stamp}`, motorNumber: `GONEM${stamp}`, batteryNumber: `GONEB${stamp}` });
    await http().delete(`/api/v1/inventory/units/${gone.id}`).set('Authorization', A.auth()).expect(204);
    const theirs = await addScooter(B, { variantId: cat.exclusivePro, vin: `THEIRV${stamp}`, motorNumber: `THEIRM${stamp}`, batteryNumber: `THEIRB${stamp}`, supplier: 'Secret Supplier', location: 'Secret Yard' });
    const before = await snapshot();
    const ok = row();
    const res = result(await importCsv(csvOf(ok, row({ vin: ` minev${stamp}` }), row({ motor: `GONEM${stamp}` }), row({ battery: `theirb${stamp}` }), row({ vin: `THEIRV${stamp}` }))).expect(200));
    expect(res.status).toBe('REJECTED');
    expect(res.errors).toEqual([
      { row: 3, message: `VIN "MINEV${stamp}" is already used by a scooter in your inventory.` },
      { row: 4, message: `Motor number "GONEM${stamp}" is already used by a deleted scooter in your inventory.` },
      { row: 5, message: `Battery number "THEIRB${stamp}" is not available — it is already registered and cannot be used.` },
      { row: 6, message: `VIN "THEIRV${stamp}" is not available — it is already registered and cannot be used.` },
    ]);
    expect(res.preview!.rows.slice(1).map((r) => r.issues.map((i) => [i.code, i.field]))).toEqual([
      [['ALREADY_EXISTS', 'vin']], [['ALREADY_EXISTS', 'motorNumber']], [['IDENTIFIER_UNAVAILABLE', 'batteryNumber']], [['IDENTIFIER_UNAVAILABLE', 'vin']],
    ]);
    expect(res.preview!.summary.duplicate).toBe(4);
    const text = JSON.stringify(res);
    for (const secret of [B.id, B.tag, theirs.id, cat.exclusivePro, 'OMEGA', 'Exclusive', 'Secret', `THEIRM${stamp}`, mine.id, gone.id]) expect(text).not.toContain(secret);
    expect(await unitByVin(ok.vin)).toBeNull();
    expect(await snapshot()).toEqual(before);
  });

  it('a later row failing at insert (a number taken after validation) rolls back the earlier rows — nothing survives; the row is named', async () => {
    const repo = app.get(InventoryRepository);
    const real = repo.findUsedIdentifiers.bind(repo);
    const taken = await addScooter(A, { variantId: cat.pro, vin: `RACEV${stamp}`, motorNumber: `RACEM${stamp}`, batteryNumber: `RACEB${stamp}` });
    // Both in-transaction checks miss the taken number (as if another import committed in between) ...
    let calls = 0;
    jest.spyOn(repo, 'findUsedIdentifiers').mockImplementation(async (values, companyId, db) => {
      calls += 1;
      return calls <= 2 ? { vin: new Map(), motorNumber: new Map(), batteryNumber: new Map() } : real(values, companyId, db);
    });
    const before = await snapshot();
    const earlier = [row(), row(), row()];
    const res = result(await importCsv(csvOf(...earlier, row({ vin: taken.vin }))).expect(200));
    // ... so the insert hits the unique constraint: the whole transaction rolls back, then the re-check names the row.
    expect(res).toMatchObject({ status: 'REJECTED', created: 0, failed: 1, errors: [{ row: 5, message: `VIN "${taken.vin}" is already used by a scooter in your inventory.` }] });
    expect(calls).toBe(3);
    expect(JSON.stringify(res)).not.toMatch(/prisma|constraint|P2002|unique/i);
    expect(await unitsWithVins(earlier.map((r) => r.vin))).toBe(0);
    expect(await snapshot()).toEqual(before);
  });

  it('a failing history-event write, or a failing audit write, rolls back every unit (500, nothing survives, no internals)', async () => {
    const before = await snapshot();
    const first = [row(), row()];
    jest.spyOn(app.get(InventoryRepository), 'addEvents').mockRejectedValueOnce(new Error('simulated event failure'));
    const failedEvents = await importCsv(csvOf(...first)).expect(500);
    expect(failedEvents.body.message).toBe('Internal server error');
    expect(await unitsWithVins(first.map((r) => r.vin))).toBe(0);
    const second = [row(), row()];
    jest.spyOn(app.get(ActivityLogService), 'recordInTransaction').mockRejectedValueOnce(new Error('simulated audit failure'));
    await importCsv(csvOf(...second)).expect(500);
    expect(await unitsWithVins(second.map((r) => r.vin))).toBe(0);
    expect(await snapshot()).toEqual(before);
    // and with the failure gone, the same file imports in full
    expect(result(await importCsv(csvOf(...second)).expect(200)).created).toBe(2);
  });

  it('concurrent imports sharing a number: exactly one wins, the other imports nothing', async () => {
    for (let round = 0; round < 4; round += 1) {
      const shared = `SHARED${stamp}${round}`;
      const fileA = [row({ vin: shared }), row(), row()];
      const fileB = [row(), row(), row({ vin: shared })];
      const [ra, rb] = await Promise.all([importCsv(csvOf(...fileA)), importCsv(csvOf(...fileB))]);
      expect([ra.status, rb.status]).toEqual([200, 200]);
      expect([result(ra).status, result(rb).status].sort()).toEqual(['IMPORTED', 'REJECTED']);
      const loser = result(ra).status === 'REJECTED' ? result(ra) : result(rb);
      expect(loser.errors).toEqual([{ row: loser === result(ra) ? 2 : 4, message: `VIN "${shared}" is already used by a scooter in your inventory.` }]);
      expect(await unitsWithVins([shared])).toBe(1);
      const loserRows = loser === result(ra) ? fileA : fileB;
      expect(await unitsWithVins(loserRows.filter((r) => r.vin !== shared).map((r) => r.vin))).toBe(0);
    }
  });

  it('concurrent imports crossing two numbers in opposite order: never both, never a raw database error (deadlocks included)', async () => {
    for (let round = 0; round < 6; round += 1) {
      const vin = `XV${stamp}${round}`;
      const battery = `XB${stamp}${round}`;
      const fileA = [row({ vin }), ...Array.from({ length: 30 }, () => row()), row({ battery })];
      const fileB = [row({ battery }), ...Array.from({ length: 30 }, () => row()), row({ vin })];
      const [ra, rb] = await Promise.all([importCsv(csvOf(...fileA)), importCsv(csvOf(...fileB))]);
      for (const res of [ra, rb]) {
        expect([200, 409]).toContain(res.status);
        expect(JSON.stringify(res.body)).not.toMatch(/prisma|constraint|deadlock|P20\d\d|database/i);
        if (res.status === 409) expect(res.body.message).toBe('Inventory changed while importing — nothing was imported. Try again.');
      }
      const imported = [ra, rb].filter((r) => r.status === 200 && result(r).status === 'IMPORTED');
      expect(imported.length).toBeLessThanOrEqual(1);
      const total = await unitsWithVins([...fileA, ...fileB].map((r) => r.vin));
      expect(total).toBe(imported.length * 32); // the winner's rows only — the loser left nothing
    }
  }, 60_000); // Postgres takes ~1 s (deadlock_timeout) to break each deadlock

  it('stale preview: re-validated at import (catalogue changed → REJECTED); a different file than the one previewed → 409; nothing imported', async () => {
    const rows = [row({ variant: 'Max X', colour: 'Red' }), row()];
    const csv = csvOf(...rows);
    const p = (await preview(csv).expect(200)).body as CsvImportPreview;
    expect(p.summary.valid).toBe(2);
    expect(p.fileSha256).toBe(sha(csv));
    await setActive(cat.maxX, false).expect(200);
    try {
      const stale = result(await importCsv(csv, A, { expectedSha256: p.fileSha256.toUpperCase() }).expect(200));
      expect(stale).toMatchObject({ status: 'REJECTED', failed: 1, errors: [{ row: 2 }] });
      expect(stale.preview!.rows[0]!.issues[0]!.code).toBe('VARIANT_INACTIVE');
    } finally {
      await setActive(cat.maxX, true).expect(200);
    }
    const changed = csvOf(row(), row());
    expect((await importCsv(changed, A, { expectedSha256: p.fileSha256 }).expect(409)).body.message).toBe('This is not the file that was previewed — preview it again before importing.');
    expect((await importCsv(changed, A, { expectedSha256: 'not-a-hash' }).expect(400)).body.message).toBe('expectedSha256 must be the fileSha256 returned by the preview');
    expect(await unitsWithVins(rows.map((r) => r.vin))).toBe(0);
    // the previewed file, unchanged and still valid, imports with its hash
    expect(result(await importCsv(csv, A, { expectedSha256: p.fileSha256 }).expect(200))).toMatchObject({ status: 'IMPORTED', created: 2 });
  });

  it('limits and malformed files: rejected before anything is written', async () => {
    const before = await snapshot();
    const tooMany = [HEAD, ...Array.from({ length: CSV_IMPORT_MAX_ROWS + 1 }, (_, i) => `,Solo,Pro,Teal,LIMV${stamp}${i},LIMM${stamp}${i},LIMB${stamp}${i},,,,,,`)].join('\n');
    expect((await importCsv(tooMany).expect(400)).body.message).toBe(`The file has ${CSV_IMPORT_MAX_ROWS + 1} rows; at most ${CSV_IMPORT_MAX_ROWS} can be imported at once — split it into smaller files.`);
    await importCsv(`${csvOf(row())}\n`.padEnd(CSV_IMPORT_MAX_BYTES + 1, ' ')).expect(413);
    expect((await importCsv(HEAD).expect(400)).body.message).toBe('The file has no rows to import.');
    const malformed = await importCsv(`${csvOf(row(), row())}\n,Solo,"open quote,Teal\n`).expect(400);
    expect(malformed.body.message).toMatch(/^Could not read the CSV file/);
    expect((await importCsv(`${csvOf(row())}\n${row().line},extra\n`).expect(400)).body.message).toMatch(/^Could not read the CSV file/); // never guesses columns
    await http().post('/api/v1/inventory/units/import').set('Authorization', A.auth()).expect(400); // no file
    expect(await snapshot()).toEqual(before);
  });

  it('tenant isolation: each company imports against its own catalogue only', async () => {
    const before = await snapshot();
    expect(result(await importCsv(csvOf(row({ model: 'Exclusive', variant: 'Pro', colour: 'Red' }))).expect(200)).preview!.rows[0]!.issues[0]!.code).toBe('MODEL_NOT_FOUND');
    expect(result(await importCsv(csvOf(row()), B).expect(200)).preview!.rows[0]!.issues[0]!.code).toBe('MODEL_NOT_FOUND'); // Solo is A's
    const theirs = row({ model: 'Exclusive', variant: 'Pro', colour: 'Red' });
    expect(result(await importCsv(csvOf(theirs), B).expect(200)).status).toBe('IMPORTED');
    expect(await unitByVin(theirs.vin)).toMatchObject({ companyId: B.id, variantId: cat.exclusivePro });
    const after = await snapshot();
    expect(after.models).toEqual(before.models);
    expect(after.variants).toEqual(before.variants);
  });

  it('M4B.4 / M4B.5 intact: a committed vehicle cannot be re-imported or changed; an imported unit is an ordinary never-committed AVAILABLE unit', async () => {
    const unit = await addScooter(A, { variantId: cat.maxX, vin: `LOCKV${stamp}`, motorNumber: `LOCKM${stamp}`, batteryNumber: `LOCKB${stamp}` });
    const booking = await http().post('/api/v1/bookings').set('Authorization', A.auth()).send({ customerId: customerA, unitId: unit.id, exShowroom: 1_000_000 }).expect(201);
    await http().post(`/api/v1/bookings/${booking.body.id}/payments`).set('Authorization', A.auth()).send({ amount: Number(booking.body.paymentSummary.balance), mode: 'UPI' }).expect(201);
    await http().post(`/api/v1/bookings/${booking.body.id}/invoice`).set('Authorization', A.auth()).expect(201);
    await http().post(`/api/v1/bookings/${booking.body.id}/deliver`).set('Authorization', A.auth()).send({}).expect(201);
    const before = await prisma.inventoryUnit.findUniqueOrThrow({ where: { id: unit.id } });
    expect(result(await importCsv(csvOf(row({ vin: `lockv${stamp}`, location: 'Overwritten?' }))).expect(200)).status).toBe('REJECTED');
    expect(await prisma.inventoryUnit.findUniqueOrThrow({ where: { id: unit.id } })).toEqual(before);
    const fresh = row();
    expect(result(await importCsv(csvOf(fresh)).expect(200)).status).toBe('IMPORTED');
    const variants = (await http().get(`/api/v1/inventory/variants?modelId=${cat.solo}&status=all`).set('Authorization', A.auth()).expect(200)).body as { id: string; identityLocked: boolean }[];
    expect(variants.find((v) => v.id === cat.maxX)?.identityLocked).toBe(true);
    expect(variants.find((v) => v.id === cat.pro)?.identityLocked).toBe(false); // imports alone never lock a variant
    await http().patch(`/api/v1/inventory/variants/${cat.maxX}`).set('Authorization', A.auth()).send({ colour: 'Crimson' }).expect(409);
    const imported = await unitByVin(fresh.vin);
    expect((await http().get(`/api/v1/inventory/units/${imported!.id}`).set('Authorization', A.auth()).expect(200)).body.identity).toEqual({ committed: false, catalogueEditable: true, identificationEditable: true, correctionEligible: false });
  });

  it('an import racing catalogue edits (price, deactivate / reactivate) never deadlocks or fails with 5xx; it either imports all or nothing', async () => {
    for (let round = 0; round < 4; round += 1) {
      const rows = [row(), row({ variant: 'Max X', colour: 'Red' }), row()];
      const [imp, price, off] = await Promise.all([
        importCsv(csvOf(...rows)),
        http().patch(`/api/v1/inventory/variants/${cat.maxX}`).set('Authorization', A.auth()).send({ exShowroomPrice: 9_900_000 + round }),
        setActive(cat.maxX, false),
      ]);
      expect([imp.status, price.status, off.status]).toEqual([200, 200, 200]);
      expect(await unitsWithVins(rows.map((r) => r.vin))).toBe(result(imp).status === 'IMPORTED' ? 3 : 0);
      await setActive(cat.maxX, true).expect(200);
    }
  });

  it('Add Scooter is unchanged (it may still choose another status); the CSV path cannot', async () => {
    expect(await addScooter(A, { variantId: cat.pro, vin: `ADDV${stamp}`, motorNumber: `ADDM${stamp}`, batteryNumber: `ADDB${stamp}`, status: 'RESERVED' })).toMatchObject({ status: 'RESERVED' });
    expect(result(await importCsv(csvOf(row({ status: 'RESERVED' }))).expect(200)).status).toBe('REJECTED');
    const one = row();
    expect(result(await importCsv(csvOf(one)).expect(200))).toMatchObject({ status: 'IMPORTED', created: 1 });
    expect(await unitByVin(one.vin)).toMatchObject({ status: 'AVAILABLE', sellingPrice: LIST_PRICE });
  });

  it('permission and authentication: inventory.create is required', async () => {
    await http().post('/api/v1/inventory/units/import').set('Authorization', A.auth('TECHNICIAN')).attach('file', Buffer.from(csvOf(row())), 'units.csv').expect(403);
    await http().post('/api/v1/inventory/units/import').attach('file', Buffer.from(HEAD), 'units.csv').expect(401);
  });
});
