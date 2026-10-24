import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { UTC_NOW, utcTimestamp } from '../src/prisma/sql-time';
import { createE2eApp, E2E_HOOK_TIMEOUT } from './support/e2e-app';
import { createTestCompany, purgeTestCompany, TestCompany } from './support/e2e-company';
import { e2eDatabaseUrl } from './support/protected-data';

/**
 * Raw SQL must not depend on the Postgres session time zone. The DateTime columns are timestamp WITHOUT time zone
 * holding UTC, while Prisma binds a Date in $queryRaw as timestamptz — compared bare, Postgres reads the column in
 * the session zone and the range shifts (the local dev database runs Asia/Kolkata: a sale invoiced at 05:28Z fell
 * outside [00:00Z, 23:59Z]).
 *
 * This suite runs every connection in Pacific/Kiritimati (UTC+14) and uses fixed instants either side of a day, so
 * the outcome does not depend on the hour the suite runs: a bare comparison would read each column 14h earlier,
 * dropping a record at 02:00Z on the day and pulling in one at 05:00Z the next day.
 */
const SESSION_ZONE = 'Pacific/Kiritimati';
const DAY_FROM = '2025-01-15';
const DAY_TO = '2025-01-15T23:59:59.999Z';
const at = (iso: string): Date => new Date(iso);

describe('Raw SQL is independent of the session time zone (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let A: TestCompany;
  const originalUrl = process.env.DATABASE_URL;
  const http = () => request(app.getHttpServer());
  const get = (url: string) => http().get(`/api/v1${url}`).set('Authorization', A.auth());
  const post = (url: string, body: object) => http().post(`/api/v1${url}`).set('Authorization', A.auth()).send(body);
  const stamp = Date.now().toString().slice(-7);
  let serial = 0;

  let customerId = '';
  let returns = 0;

  /** A scooter of this company sold (invoiced) through the API, its invoice then moved to `invoicedAt`. */
  const soldScooter = async (purchasePrice: number, transportCharge: number, exShowroom: number, invoicedAt: Date) => {
    const k = `${stamp}${serial++}`;
    const unit = (await post('/inventory/units', { modelId: A.modelId, variant: `TZ${stamp}`, colour: 'Blue', vin: `TZV${k}`, motorNumber: `TZM${k}`, batteryNumber: `TZB${k}`, purchasePrice, transportCharge }).expect(201)).body;
    const booking = (await post('/bookings', { customerId, unitId: unit.id, exShowroom }).expect(201)).body;
    await post(`/bookings/${booking.id}/invoice`, {}).expect(201);
    const sale = await prisma.sale.findFirstOrThrow({ where: { bookingId: booking.id, companyId: A.id } });
    await prisma.sale.update({ where: { id: sale.id }, data: { invoicedAt } });
    return { unitId: unit.id as string, sale };
  };

  /** A completed return putting the scooter back in stock (its cost comes off cost of sales), completed at `completedAt`. */
  const completedReturn = async (s: Awaited<ReturnType<typeof soldScooter>>, completedAt: Date) => {
    await prisma.vehicleReturn.create({
      data: {
        companyId: A.id, returnNumber: `TZRET${stamp}${returns++}`, saleId: s.sale.id, bookingId: s.sale.bookingId!, unitId: s.unitId,
        customerId, reason: 'session time zone e2e', requestedById: A.user().id, status: 'COMPLETED', disposition: 'AVAILABLE', completedAt,
      },
    });
  };

  beforeAll(async () => {
    const url = new URL(e2eDatabaseUrl());
    url.searchParams.set('options', `-c TimeZone=${SESSION_ZONE}`);
    process.env.DATABASE_URL = url.toString();
    app = await createE2eApp();
    prisma = app.get(PrismaService);
    A = await createTestCompany(app, 'Tz');
    customerId = (await post('/customers', { name: 'Zone Buyer', phone: `92${stamp}1` }).expect(201)).body.id;
  }, E2E_HOOK_TIMEOUT);

  afterAll(async () => {
    await purgeTestCompany(prisma, A?.id);
    await app?.close();
    if (originalUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalUrl;
  }, E2E_HOOK_TIMEOUT);

  it('the app really runs in a far-off session time zone, where a bare Date comparison is wrong', async () => {
    const [row] = await prisma.$queryRaw<{ zone: string; bare: boolean; utc: boolean }[]>`
      SELECT current_setting('TimeZone') AS zone,
             ('2025-01-15 02:00:00'::timestamp >= ${at('2025-01-15T00:00:00Z')}) AS bare,
             ('2025-01-15 02:00:00'::timestamp >= ${utcTimestamp(at('2025-01-15T00:00:00Z'))}) AS utc`;
    expect(row).toEqual({ zone: SESSION_ZONE, bare: false, utc: true });
  });

  it('UTC_NOW is the current instant in UTC, and utcTimestamp round-trips an instant', async () => {
    const instant = at('2025-01-15T02:03:04.567Z');
    const row = (await prisma.$queryRaw<{ now: Date; same: boolean }[]>`
      SELECT ${UTC_NOW} AS now, (${utcTimestamp(instant)} = '2025-01-15 02:03:04.567'::timestamp) AS same`)[0]!;
    expect(Math.abs(row.now.getTime() - Date.now())).toBeLessThan(60_000);
    expect(row.same).toBe(true);
  });

  it('P&L counts scooter, return and accessory cost of sales inside the day only', async () => {
    await soldScooter(1_000_000, 50_000, 13_000_000, at('2025-01-15T02:00:00Z'));
    const nextDay = await soldScooter(3_000_000, 0, 14_000_000, at('2025-01-16T05:00:00Z'));
    const lastYear = await soldScooter(200_000, 0, 12_000_000, at('2024-06-01T06:00:00Z'));
    await completedReturn(lastYear, at('2025-01-15T03:00:00Z')); // in the day: −2,000
    await completedReturn(nextDay, at('2025-01-16T06:00:00Z')); // the next day: not counted

    const helmet = (await post('/accessories', { name: `TZ Helmet ${stamp}`, sellPrice: 50_000 }).expect(201)).body.id;
    await post(`/accessories/${helmet}/opening-stock`, { quantity: 10, unitCost: 30_000 }).expect(201);
    const inDaySale = (await post('/accessory-sales', { customerId, items: [{ accessoryId: helmet, qty: 2, unitPrice: 50_000 }] }).expect(201)).body;
    const nextDaySale = (await post('/accessory-sales', { customerId, items: [{ accessoryId: helmet, qty: 5, unitPrice: 50_000 }] }).expect(201)).body;
    await prisma.accessorySale.update({ where: { id: inDaySale.id }, data: { invoiceDate: at('2025-01-15T01:00:00Z') } });
    await prisma.accessorySale.update({ where: { id: nextDaySale.id }, data: { invoiceDate: at('2025-01-16T04:00:00Z') } });

    const pnl = (await get(`/finance/pnl?from=${DAY_FROM}&to=${DAY_TO}`).expect(200)).body as { income: { label: string; amount: string }[]; expenses: { label: string; amount: string }[] };
    const line = (lines: { label: string; amount: string }[], label: string) => lines.find((l) => l.label === label)?.amount ?? '0';
    expect(line(pnl.expenses, 'Scooter cost of sales')).toBe('850000'); // 10,000 + 500 transport − 2,000 back in stock
    expect(line(pnl.expenses, 'Accessory cost of sales')).toBe('60000'); // 2 × 300
    expect(line(pnl.income, 'Accessory sales')).toBe('100000'); // the ORM side agrees: only the in-day invoice
  });

  it('sales report splits by model only the scooters invoiced inside the range', async () => {
    const report = (await get(`/reports/sales?from=${DAY_FROM}&to=${DAY_TO}`).expect(200)).body as { modelSales: { name: string; amount: string; count: number }[] };
    expect(report.modelSales).toHaveLength(1);
    expect(report.modelSales[0]!.count).toBe(1); // the 02:00Z sale; not the next day's 05:00Z one
    const inDay = await prisma.sale.findFirstOrThrow({ where: { companyId: A.id, invoicedAt: { gte: at(`${DAY_FROM}T00:00:00Z`), lte: at(DAY_TO) } } });
    expect(report.modelSales[0]!.amount).toBe(String(inDay.total));
  });
});
