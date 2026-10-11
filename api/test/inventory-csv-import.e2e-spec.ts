import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createE2eApp, E2E_HOOK_TIMEOUT } from './support/e2e-app';
import { createTestCompany, purgeTestCompany, TestCompany } from './support/e2e-company';

/**
 * M4D.1 — strict CSV import. Rows must name an existing, active model and variant of the company (brand
 * optional, case / whitespace ignored, ambiguity refused); nothing is created in the catalogue; only
 * AVAILABLE units; blank selling price → the variant's list price; dates YYYY-MM-DD or D/M/YYYY (day first); errors
 * carry the source line; still one transaction per row (no whole-file atomicity yet).
 *
 * Runs in throwaway companies (see support/e2e-company), hard-deleted afterwards.
 */
describe('Inventory CSV import (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let A: TestCompany;
  let B: TestCompany;
  let customerA = '';
  const stamp = Date.now().toString().slice(-8);
  let serial = 0;
  const http = () => request(app.getHttpServer());
  const id = (): string => `${stamp}${(serial++).toString().padStart(3, '0')}`;

  // Company A's catalogue.
  const cat = { solo: '', pro: '', maxX: '', lite: '', old: '', vxAlpha: '', vxBeta: '', vxAlphaPro: '', vxBetaPro: '' };
  const LIST_PRICE = 12_500_000n;
  const HEAD = 'Brand,Model,Variant,Colour,VIN,Motor Number,Battery Number,Purchase Date,Purchase Cost,Selling Price,Supplier,Location,Status';

  const upload = (csv: string, co: TestCompany = A) =>
    http().post('/api/v1/inventory/units/import').set('Authorization', co.auth()).attach('file', Buffer.from(csv, 'utf8'), { filename: 'units.csv', contentType: 'text/csv' });
  /** A row with fresh identifiers; override any column. */
  const row = (over: Partial<Record<'brand' | 'model' | 'variant' | 'colour' | 'vin' | 'motor' | 'battery' | 'date' | 'cost' | 'price' | 'supplier' | 'location' | 'status', string>> = {}) => {
    const n = id();
    const r = { brand: '', model: 'Solo', variant: 'Pro', colour: 'Teal', vin: `CSVV${n}`, motor: `CSVM${n}`, battery: `CSVB${n}`, date: '', cost: '', price: '', supplier: '', location: '', status: '', ...over };
    return { vin: r.vin, line: [r.brand, r.model, r.variant, r.colour, r.vin, r.motor, r.battery, r.date, r.cost, r.price, r.supplier, r.location, r.status].join(',') };
  };
  const catalogueCounts = async (co: TestCompany = A) => ({
    models: await prisma.scooterModel.count({ where: { companyId: co.id } }),
    variants: await prisma.scooterVariant.count({ where: { companyId: co.id } }),
  });
  const unitByVin = (vin: string) => prisma.inventoryUnit.findUnique({ where: { vin: vin.toUpperCase() } });

  beforeAll(async () => {
    app = await createE2eApp();
    prisma = app.get(PrismaService);
    A = await createTestCompany(app, 'Csv', { roles: ['TECHNICIAN'] });
    B = await createTestCompany(app, 'CsvB');
    const post = (url: string, body: object, co: TestCompany = A) => http().post(url).set('Authorization', co.auth()).send(body);
    cat.solo = (await post('/api/v1/inventory/models', { brand: 'GAMMA', name: 'Solo' }).expect(201)).body.id;
    cat.pro = (await post(`/api/v1/inventory/models/${cat.solo}/variants`, { name: 'Pro', colour: 'Teal', exShowroomPrice: Number(LIST_PRICE) }).expect(201)).body.id;
    cat.maxX = (await post(`/api/v1/inventory/models/${cat.solo}/variants`, { name: 'Max X', colour: 'Red', exShowroomPrice: 9_900_000 }).expect(201)).body.id;
    cat.lite = (await post(`/api/v1/inventory/models/${cat.solo}/variants`, { name: 'Lite', colour: 'Blue', exShowroomPrice: 1 }).expect(201)).body.id;
    await http().patch(`/api/v1/inventory/variants/${cat.lite}/active`).set('Authorization', A.auth()).send({ isActive: false }).expect(200);
    cat.old = (await post('/api/v1/inventory/models', { brand: 'GAMMA', name: 'Old' }).expect(201)).body.id;
    await post(`/api/v1/inventory/models/${cat.old}/variants`, { name: 'Pro', colour: 'Red', exShowroomPrice: 1 }).expect(201);
    await http().patch(`/api/v1/inventory/models/${cat.old}/active`).set('Authorization', A.auth()).send({ isActive: false }).expect(200);
    // Legacy data the catalogue API would now refuse: the same model name under two brands.
    for (const brand of ['ALPHA', 'BETA'] as const) {
      const model = await prisma.scooterModel.create({ data: { companyId: A.id, brand, name: 'VX' } });
      const variant = await prisma.scooterVariant.create({ data: { companyId: A.id, modelId: model.id, name: 'Pro', colour: 'Red', exShowroomPrice: brand === 'ALPHA' ? 7_000_000n : 8_000_000n } });
      if (brand === 'ALPHA') { cat.vxAlpha = model.id; cat.vxAlphaPro = variant.id; } else { cat.vxBeta = model.id; cat.vxBetaPro = variant.id; }
    }
    // Company B has its own model, unknown to A.
    const exclusive = (await post('/api/v1/inventory/models', { brand: 'OMEGA', name: 'Exclusive' }, B).expect(201)).body.id;
    await post(`/api/v1/inventory/models/${exclusive}/variants`, { name: 'Pro', colour: 'Red', exShowroomPrice: 5_000_000 }, B).expect(201);
    customerA = (await post('/api/v1/customers', { name: `Csv ${stamp}`, phone: `9${stamp}5` }).expect(201)).body.id;
  }, 60_000);

  afterAll(async () => {
    await purgeTestCompany(prisma, A?.id);
    await purgeTestCompany(prisma, B?.id);
    await app.close();
  }, E2E_HOOK_TIMEOUT);

  it('imports rows matching existing active variants — case and whitespace ignored — with list-price, explicit-price and date rules; nothing is added to the catalogue', async () => {
    const before = await catalogueCounts();
    const r1 = row({ model: '  solo ', variant: 'PRO', colour: 'teal', date: '01/06/2026', cost: '110000', supplier: 'Depot', location: 'Bay 1' }); // blank price
    const r2 = row({ model: 'SOLO', variant: 'max   x', colour: ' RED ', date: '2026-06-02', price: '0', status: 'available' }); // explicit zero
    const r3 = row({ price: '130000.50', status: 'AVAILABLE' });
    const res = await upload([HEAD, r1.line, r2.line, r3.line].join('\n')).expect(200);
    expect(res.body).toEqual({ created: 3, failed: 0, errors: [] });
    expect(await unitByVin(r1.vin)).toMatchObject({ variantId: cat.pro, status: 'AVAILABLE', sellingPrice: LIST_PRICE, purchaseCost: 11_000_000n, supplier: 'Depot', location: 'Bay 1', purchaseDate: new Date('2026-06-01T00:00:00.000Z') });
    expect(await unitByVin(r2.vin)).toMatchObject({ variantId: cat.maxX, sellingPrice: 0n, purchaseDate: new Date('2026-06-02T00:00:00.000Z') });
    expect(await unitByVin(r3.vin)).toMatchObject({ variantId: cat.pro, sellingPrice: 13_000_050n, purchaseDate: null });
    expect(await catalogueCounts()).toEqual(before);
    // A unit price never changes the variant's list price.
    expect((await prisma.scooterVariant.findUniqueOrThrow({ where: { id: cat.pro } })).exShowroomPrice).toBe(LIST_PRICE);
    expect((await prisma.scooterVariant.findUniqueOrThrow({ where: { id: cat.maxX } })).exShowroomPrice).toBe(9_900_000n);
  });

  it('unknown models / variants and inactive models / variants are refused per row, with actionable messages; nothing is created', async () => {
    const before = await catalogueCounts();
    const rows = [row({ model: 'Nope' }), row({ variant: 'Pro', colour: 'Pink' }), row({ model: 'Old', variant: 'Pro', colour: 'Red' }), row({ variant: 'Lite', colour: 'Blue' })];
    const res = await upload([HEAD, ...rows.map((r) => r.line)].join('\n')).expect(200);
    expect(res.body.created).toBe(0);
    expect(res.body.errors).toEqual([
      { row: 2, message: 'Model "Nope" was not found — check the model name, or add it under Inventory → Models first.' },
      { row: 3, message: 'Variant "Pro / Pink" was not found for GAMMA Solo — available: Max X / Red, Pro / Teal. Add it under Inventory → Models first.' },
      { row: 4, message: 'Model GAMMA Old is inactive — activate it under Inventory → Models, or use an active model.' },
      { row: 5, message: 'Variant Lite / Blue of GAMMA Solo is inactive — activate it under Inventory → Models, or use an active variant.' },
    ]);
    for (const r of rows) expect(await unitByVin(r.vin)).toBeNull();
    expect(await catalogueCounts()).toEqual(before);
  });

  it('the same model name under two brands: refused without Brand, resolved with it', async () => {
    const ambiguous = row({ model: 'VX', variant: 'Pro', colour: 'Red' });
    const alpha = row({ brand: 'alpha', model: 'vx', variant: 'pro', colour: 'red' });
    const beta = row({ brand: ' BETA ', model: 'VX', variant: 'Pro', colour: 'Red' });
    const res = await upload([HEAD, ambiguous.line, alpha.line, beta.line].join('\n')).expect(200);
    expect(res.body.errors).toEqual([{ row: 2, message: 'Model "VX" matches more than one model (ALPHA VX, BETA VX) — add a Brand column to choose one.' }]);
    expect(await unitByVin(alpha.vin)).toMatchObject({ variantId: cat.vxAlphaPro, sellingPrice: 7_000_000n });
    expect(await unitByVin(beta.vin)).toMatchObject({ variantId: cat.vxBetaPro, sellingPrice: 8_000_000n });
    expect(await unitByVin(ambiguous.vin)).toBeNull();
  });

  it('only AVAILABLE (or blank) status is accepted', async () => {
    const statuses = ['RESERVED', 'BOOKED', 'DELIVERED', 'IN_SERVICE', 'RETURNED', 'SOLD'];
    const rows = statuses.map((status) => row({ status }));
    const res = await upload([HEAD, ...rows.map((r) => r.line)].join('\n')).expect(200);
    expect(res.body.created).toBe(0);
    expect(res.body.errors.map((e: { message: string }) => e.message)).toEqual([
      ...statuses.slice(0, 5).map((s) => `Status "${s}" cannot be imported — only AVAILABLE units can be added by CSV (leave Status blank or use AVAILABLE).`),
      'Unknown status "SOLD" — only AVAILABLE units can be added by CSV (leave Status blank or use AVAILABLE).',
    ]);
  });

  it('dates: YYYY-MM-DD and D/M/YYYY or DD/MM/YYYY (day first) only; impossible or other formats are refused', async () => {
    const good = [row({ date: '2024-02-29' }), row({ date: '29/02/2024' }), row({ date: '29/2/2024' })];
    const bad = ['1/6/26', '06-01-2026', '2026/06/01', '31/2/2026', 'June 1 2026'].map((date) => row({ date }));
    const res = await upload([HEAD, ...good.map((r) => r.line), ...bad.map((r) => r.line)].join('\n')).expect(200);
    expect(res.body.created).toBe(3);
    for (const r of good) expect((await unitByVin(r.vin))!.purchaseDate).toEqual(new Date('2024-02-29T00:00:00.000Z'));
    const dayFirst = row({ date: '3/12/2026' });
    await upload([HEAD, dayFirst.line].join('\n')).expect(200);
    expect((await unitByVin(dayFirst.vin))!.purchaseDate).toEqual(new Date('2026-12-03T00:00:00.000Z')); // 3 December, never 12 March
    expect(res.body.errors.map((e: { row: number }) => e.row)).toEqual([5, 6, 7, 8, 9]);
    expect(res.body.errors[3].message).toBe('Purchase date "31/2/2026" is not a real date — use YYYY-MM-DD or D/M/YYYY, day first (e.g. 2026-06-01, 1/6/2026 or 01/06/2026).');
    expect(res.body.errors[0].message).toContain('is not in a supported format');
  });

  it('row numbers are the source lines — blank lines, a multi-line cell and CRLF line endings included', async () => {
    const ok = row();
    const multi = row({ model: 'Nope', supplier: '"Depot\r\nNorth wing"' });
    const after = row({ variant: 'Pro', colour: 'Pink' });
    const csv = `${HEAD}\r\n${ok.line}\r\n\r\n${multi.line}\r\n\r\n${after.line}\r\n`;
    const res = await upload(csv).expect(200);
    expect(res.body.errors.map((e: { row: number }) => e.row)).toEqual([4, 7]);
  });

  it('duplicate VIN, motor and battery numbers — in the file or already stored — fail per row with the field named; no database text leaks', async () => {
    const existing = row();
    await upload([HEAD, existing.line].join('\n')).expect(200);
    const n = id();
    const rows = [
      row({ vin: existing.vin }),
      row({ motor: (await unitByVin(existing.vin))!.motorNumber }),
      row({ battery: (await unitByVin(existing.vin))!.batteryNumber }),
      row({ vin: `DUP${n}` }),
      row({ vin: `dup${n}` }), // same VIN once upper-cased, later in the same file
    ];
    const res = await upload([HEAD, ...rows.map((r) => r.line)].join('\n')).expect(200);
    expect(res.body.created).toBe(1);
    expect(res.body.errors).toEqual([
      { row: 2, message: `A scooter with VIN "${existing.vin}" already exists.` },
      { row: 3, message: expect.stringMatching(/^Motor number ".+" already exists on another scooter\.$/) },
      { row: 4, message: expect.stringMatching(/^Battery number ".+" already exists on another scooter\.$/) },
      { row: 6, message: `A scooter with VIN "DUP${n}" already exists.` },
    ]);
    expect(JSON.stringify(res.body)).not.toMatch(/prisma|constraint|P2002/i);
  });

  it('create-only: a row naming an existing (delivered, committed) vehicle cannot change it; catalogue identity locks are unaffected', async () => {
    const unit = (await http().post('/api/v1/inventory/units').set('Authorization', A.auth()).send({ variantId: cat.maxX, vin: `LOCKV${stamp}`, motorNumber: `LOCKM${stamp}`, batteryNumber: `LOCKB${stamp}` }).expect(201)).body;
    const booking = await http().post('/api/v1/bookings').set('Authorization', A.auth()).send({ customerId: customerA, unitId: unit.id, exShowroom: 1_000_000 }).expect(201);
    await http().post(`/api/v1/bookings/${booking.body.id}/payments`).set('Authorization', A.auth()).send({ amount: Number(booking.body.paymentSummary.balance), mode: 'UPI' }).expect(201);
    await http().post(`/api/v1/bookings/${booking.body.id}/invoice`).set('Authorization', A.auth()).expect(201);
    await http().post(`/api/v1/bookings/${booking.body.id}/deliver`).set('Authorization', A.auth()).send({}).expect(201);
    const before = await prisma.inventoryUnit.findUniqueOrThrow({ where: { id: unit.id } });
    const res = await upload([HEAD, row({ variant: 'Pro', colour: 'Teal', vin: `LOCKV${stamp}`, location: 'Overwritten?' }).line].join('\n')).expect(200);
    expect(res.body.created).toBe(0);
    expect(await prisma.inventoryUnit.findUniqueOrThrow({ where: { id: unit.id } })).toEqual(before);
    // Max X stays identity-locked (M4B.5) and Pro, which only got AVAILABLE units from imports, does not become locked.
    const variants = (await http().get(`/api/v1/inventory/variants?modelId=${cat.solo}&status=all`).set('Authorization', A.auth()).expect(200)).body as { id: string; identityLocked: boolean }[];
    expect(variants.find((v) => v.id === cat.maxX)?.identityLocked).toBe(true);
    expect(variants.find((v) => v.id === cat.pro)?.identityLocked).toBe(false);
    await http().patch(`/api/v1/inventory/variants/${cat.maxX}`).set('Authorization', A.auth()).send({ colour: 'Crimson' }).expect(409);
  });

  it("tenant isolation: each company resolves only its own catalogue", async () => {
    const theirs = row({ model: 'Exclusive', variant: 'Pro', colour: 'Red' });
    const resA = await upload([HEAD, theirs.line].join('\n')).expect(200);
    expect(resA.body.errors).toEqual([{ row: 2, message: 'Model "Exclusive" was not found — check the model name, or add it under Inventory → Models first.' }]);
    const ours = row();
    const beforeB = await catalogueCounts(B);
    const resB = await upload([HEAD, ours.line, theirs.line].join('\n'), B).expect(200);
    expect(resB.body.errors).toEqual([{ row: 2, message: 'Model "Solo" was not found — check the model name, or add it under Inventory → Models first.' }]);
    expect(resB.body.created).toBe(1);
    const imported = await unitByVin(theirs.vin);
    expect(imported?.companyId).toBe(B.id);
    expect(await catalogueCounts(B)).toEqual(beforeB);
  });

  it('a file that cannot be read is a 400 naming the line; permission and authentication are unchanged', async () => {
    const res = await upload(`${HEAD}\n${row().line}\nSolo,"open quote,Teal\n`).expect(400);
    expect(res.body.message).toMatch(/^Could not read the CSV file/);
    await http().post('/api/v1/inventory/units/import').set('Authorization', A.auth('TECHNICIAN')).attach('file', Buffer.from(`${HEAD}\n${row().line}`), 'units.csv').expect(403);
    await http().post('/api/v1/inventory/units/import').attach('file', Buffer.from(HEAD), 'units.csv').expect(401);
  });
});
