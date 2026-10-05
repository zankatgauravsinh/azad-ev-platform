import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { businessDateOf, noonOf } from '../src/common/utils/business-date';

function binaryParser(res: request.Response, callback: (err: Error | null, body: unknown) => void): void {
  const stream = res as unknown as NodeJS.ReadableStream;
  const chunks: Buffer[] = [];
  stream.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
  stream.on('end', () => callback(null, Buffer.concat(chunks)));
}

/**
 * Stage D2 — delivery date capture, through both real entry points:
 *   POST /bookings/:id/deliver        (Booking page,   bookings.update)
 *   POST /deliveries/:id/complete     (Delivery module, delivery.manage)
 *
 * Everything runs in THROWAWAY companies created here and hard-deleted afterwards; the seeded company
 * is never read or changed.
 */
describe('Delivery date (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const stamp = Date.now().toString().slice(-8);
  const http = () => request(app.getHttpServer());
  let serial = 0;

  interface Co { id: string; token: string; modelId: string; customerId: string; timeZone: string }
  const A = {} as Co; // Asia/Kolkata — the default
  const K = {} as Co; // Pacific/Kiritimati (UTC+14) — the first place a day starts
  const P = {} as Co; // Pacific/Pago_Pago (UTC−11) — among the last; always a calendar day behind K
  const auth = (token: string): string => `Bearer ${token}`;

  const setupCompany = async (co: Co, label: string, timeZone: string): Promise<void> => {
    co.timeZone = timeZone;
    co.id = (await prisma.company.create({ data: { name: `DlvDate ${label} ${stamp}`, slug: `dlvdate-${label}-${stamp}` } })).id;
    await prisma.branch.create({ data: { companyId: co.id, name: 'HQ', isPrimary: true } });
    const email = `dlvdate.${label}.${stamp}@e2e.test`;
    await prisma.user.create({ data: { companyId: co.id, name: `Owner ${label}`, email, role: 'OWNER', passwordHash: await bcrypt.hash('Test@12345', 12) } });
    // Booking codes and invoice numbers are unique across ALL companies, so each company gets its own prefixes.
    await prisma.companySetting.create({ data: { companyId: co.id, timezone: timeZone, bookingPrefix: `D${label}${stamp}-BK`, invoicePrefix: `D${label}${stamp}-INV`, receiptPrefix: `D${label}${stamp}-RC` } });
    await prisma.invoiceSetting.create({ data: { companyId: co.id } });
    co.token = (await http().post('/api/v1/auth/login').send({ email, password: 'Test@12345' }).expect(200)).body.accessToken;
    co.modelId = (await prisma.scooterModel.create({ data: { companyId: co.id, name: `Dlv Model ${label} ${stamp}`, brand: 'TESTBRAND' } })).id;
    co.customerId = (await http().post('/api/v1/customers').set('Authorization', auth(co.token)).send({ name: `Cust ${label}`, phone: `7${stamp}${serial++}` }).expect(201)).body.id;
  };

  /** A user in company A whose custom role grants exactly `keys`. */
  const limitedUser = async (label: string, keys: string[]): Promise<string> => {
    const role = await prisma.appRole.create({ data: { companyId: A.id, name: `Dlv ${label} ${stamp}`, isSystem: false } });
    for (const key of keys) {
      const permission = await prisma.permission.findUniqueOrThrow({ where: { key } });
      await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
    }
    const email = `dlvdate.${label}.${stamp}@e2e.test`;
    await prisma.user.create({ data: { companyId: A.id, name: `User ${label}`, email, role: 'SALES_EXECUTIVE', roleId: role.id, passwordHash: await bcrypt.hash('Test@12345', 12) } });
    return (await http().post('/api/v1/auth/login').send({ email, password: 'Test@12345' }).expect(200)).body.accessToken;
  };

  /** A booking that has been invoiced and is ready to hand over. */
  const invoicedBooking = async (co: Co): Promise<string> => {
    const n = serial++;
    const unit = await http()
      .post('/api/v1/inventory/units')
      .set('Authorization', auth(co.token))
      .send({ modelId: co.modelId, variant: `V-${stamp}`, colour: `C${n}`, vin: `DDV${stamp}${n}`, motorNumber: `DDM${stamp}${n}`, batteryNumber: `DDB${stamp}${n}` })
      .expect(201);
    const booking = await http().post('/api/v1/bookings').set('Authorization', auth(co.token)).send({ customerId: co.customerId, unitId: unit.body.id, exShowroom: 1_000_000 }).expect(201);
    await http().post(`/api/v1/bookings/${booking.body.id}/invoice`).set('Authorization', auth(co.token)).expect(201);
    return booking.body.id;
  };

  const viaBooking = (token: string, bookingId: string, body: Record<string, unknown> = {}) => http().post(`/api/v1/bookings/${bookingId}/deliver`).set('Authorization', auth(token)).send(body);
  const viaDelivery = (token: string, bookingId: string, body: Record<string, unknown> = {}) => http().post(`/api/v1/deliveries/${bookingId}/complete`).set('Authorization', auth(token)).send(body);
  const ENTRY_POINTS = [['Booking → Deliver', viaBooking], ['Delivery module', viaDelivery]] as const;

  const stored = async (bookingId: string) => {
    const booking = await prisma.booking.findFirstOrThrow({ where: { id: bookingId }, include: { unit: { select: { status: true } }, sale: { include: { delivery: true } } } });
    return { actualDelivery: booking.actualDelivery, deliveredAt: booking.sale?.delivery?.deliveredAt ?? null, unitStatus: booking.unit.status, saleStatus: booking.sale?.status ?? null, invoicedAt: booking.sale?.invoicedAt ?? null, invoiceNumber: booking.sale?.invoiceNumber ?? null };
  };
  const expectNotDelivered = async (bookingId: string): Promise<void> => {
    expect(await stored(bookingId)).toMatchObject({ actualDelivery: null, deliveredAt: null, unitStatus: 'BOOKED', saleStatus: 'INVOICED' });
  };

  const today = (co: Co): string => businessDateOf(new Date(), co.timeZone);
  const shift = (date: string, days: number): string => new Date(Date.parse(`${date}T00:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
    prisma = app.get(PrismaService);
    await setupCompany(A, 'a', 'Asia/Kolkata');
    await setupCompany(K, 'k', 'Pacific/Kiritimati');
    await setupCompany(P, 'p', 'Pacific/Pago_Pago');
  }, 60000);

  afterAll(async () => {
    // Hard-delete this suite's own rows (raw SQL: several models are soft-delete aware). Order follows the foreign keys.
    for (const id of [A.id, K.id, P.id].filter(Boolean)) {
      for (const sql of [
        'DELETE FROM "Sale" WHERE "companyId" = $1', // cascades Delivery + checklist
        'DELETE FROM "Booking" WHERE "companyId" = $1',
        'DELETE FROM "CustomerTimelineEntry" WHERE "companyId" = $1',
        'DELETE FROM "Notification" WHERE "companyId" = $1',
        'DELETE FROM "ActivityLog" WHERE "companyId" = $1',
        'DELETE FROM "Customer" WHERE "companyId" = $1',
        'DELETE FROM "InventoryEvent" e USING "InventoryUnit" u WHERE e."unitId" = u.id AND u."companyId" = $1',
        'DELETE FROM "InventoryUnit" WHERE "companyId" = $1',
        'DELETE FROM "ScooterVariant" WHERE "companyId" = $1',
        'DELETE FROM "ScooterModel" WHERE "companyId" = $1',
        'DELETE FROM "InvoiceSetting" WHERE "companyId" = $1',
        'DELETE FROM "CompanySetting" WHERE "companyId" = $1',
        'DELETE FROM "User" WHERE "companyId" = $1',
        'DELETE FROM "AppRole" WHERE "companyId" = $1', // cascades its RolePermission rows
        'DELETE FROM "Branch" WHERE "companyId" = $1',
        'DELETE FROM "Company" WHERE id = $1',
      ]) {
        await prisma.$executeRawUnsafe(sql, id);
      }
    }
    await app.close();
  });

  // ───────────────────────── Both entry points, one behaviour ─────────────────────────
  describe.each(ENTRY_POINTS)('%s', (_name, deliver) => {
    it('a past date is accepted and stored as noon of that date in the company time zone', async () => {
      const id = await invoicedBooking(A);
      const date = shift(today(A), -3);
      await deliver(A.token, id, { actualDelivery: date }).expect(201);
      const expected = noonOf(date, 'Asia/Kolkata');
      expect(expected.toISOString()).toBe(`${date}T06:30:00.000Z`);
      expect(await stored(id)).toMatchObject({ actualDelivery: expected, deliveredAt: expected, unitStatus: 'DELIVERED', saleStatus: 'DELIVERED' });
    });

    it('today is accepted and keeps the real handover time', async () => {
      const id = await invoicedBooking(A);
      const before = Date.now();
      await deliver(A.token, id, { actualDelivery: today(A) }).expect(201);
      const row = await stored(id);
      expect(row.actualDelivery).toEqual(row.deliveredAt);
      expect(row.actualDelivery!.getTime()).toBeGreaterThanOrEqual(before - 1000);
      expect(row.actualDelivery!.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
      expect(businessDateOf(row.actualDelivery!, 'Asia/Kolkata')).toBe(today(A));
    });

    it('a future date is rejected and nothing is recorded', async () => {
      const id = await invoicedBooking(A);
      for (const date of [shift(today(A), 1), shift(today(A), 30)]) {
        const res = await deliver(A.token, id, { actualDelivery: date }).expect(400);
        expect(res.body.message).toBe('Delivery date cannot be in the future');
      }
      await expectNotDelivered(id);
      // The same booking can then be delivered with a valid date.
      await deliver(A.token, id, { actualDelivery: today(A) }).expect(201);
      expect((await stored(id)).unitStatus).toBe('DELIVERED');
    });

    it('a date that is not a real date is rejected', async () => {
      const id = await invoicedBooking(A);
      for (const bad of ['2026-02-30', 'not-a-date', '']) await deliver(A.token, id, { actualDelivery: bad }).expect(400);
      await expectNotDelivered(id);
    });

    it('compatibility: a client that sends no date (or null) still delivers "now"', async () => {
      for (const body of [{}, { actualDelivery: null }]) {
        const id = await invoicedBooking(A);
        const before = Date.now();
        await deliver(A.token, id, body).expect(201);
        const row = await stored(id);
        expect(row.actualDelivery).toEqual(row.deliveredAt);
        expect(row.actualDelivery!.getTime()).toBeGreaterThanOrEqual(before - 1000);
        expect(row.actualDelivery!.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
      }
    });

    it('compatibility: a timestamp from an older client is stored as sent; a future one is rejected', async () => {
      const id = await invoicedBooking(A);
      await deliver(A.token, id, { actualDelivery: new Date(Date.now() + 2 * 86_400_000).toISOString() }).expect(400);
      await expectNotDelivered(id);
      const sent = new Date(Date.now() - 5 * 86_400_000 - 12_345);
      await deliver(A.token, id, { actualDelivery: sent.toISOString() }).expect(201);
      expect(await stored(id)).toMatchObject({ actualDelivery: sent, deliveredAt: sent });
    });

    it('does not touch the invoice: number and invoice date are unchanged by a back-dated delivery', async () => {
      const id = await invoicedBooking(A);
      const before = await stored(id);
      await deliver(A.token, id, { actualDelivery: shift(today(A), -10) }).expect(201);
      const after = await stored(id);
      expect(after.invoicedAt).toEqual(before.invoicedAt);
      expect(after.invoiceNumber).toBe(before.invoiceNumber);
      expect(await prisma.taxSnapshot.count({ where: { companyId: A.id } })).toBe(0);
    });

    it("another company cannot deliver this company's booking", async () => {
      const id = await invoicedBooking(A);
      await deliver(K.token, id, { actualDelivery: shift(today(A), -1) }).expect(404);
      await expectNotDelivered(id);
    });
  });

  it('both entry points store the same instant for the same date', async () => {
    const date = shift(today(A), -7);
    const first = await invoicedBooking(A);
    const second = await invoicedBooking(A);
    await viaBooking(A.token, first, { actualDelivery: date }).expect(201);
    await viaDelivery(A.token, second, { actualDelivery: date }).expect(201);
    const [a, b] = [await stored(first), await stored(second)];
    expect(a.actualDelivery).toEqual(b.actualDelivery);
    expect(a.deliveredAt).toEqual(b.deliveredAt);
    expect(a.actualDelivery).toEqual(a.deliveredAt);
  });

  it('there is no limit on how far back a delivery may be dated', async () => {
    const id = await invoicedBooking(A);
    await viaDelivery(A.token, id, { actualDelivery: '2015-06-15' }).expect(201);
    expect((await stored(id)).actualDelivery!.toISOString()).toBe('2015-06-15T06:30:00.000Z');
  });

  // ───────────────────────── What the client gets back ─────────────────────────
  it('the delivery detail, the booking and the delivery note all carry the chosen date', async () => {
    const id = await invoicedBooking(A);
    const date = shift(today(A), -2);
    const expected = noonOf(date, 'Asia/Kolkata').toISOString();
    const done = await viaDelivery(A.token, id, { actualDelivery: date, notes: 'Handed over', checklist: { keys: true } }).expect(201);
    expect(done.body.booking).toMatchObject({ status: 'DELIVERED', actualDelivery: expected });
    expect(done.body.delivery).toMatchObject({ deliveredAt: expected, notes: 'Handed over' });
    expect(done.body.delivery.checklist.keys).toBe(true);

    const booking = await http().get(`/api/v1/bookings/${id}`).set('Authorization', auth(A.token)).expect(200);
    expect(booking.body.actualDelivery).toBe(expected);
    const list = await http().get(`/api/v1/deliveries?status=DELIVERED&q=${done.body.booking.vin}`).set('Authorization', auth(A.token)).expect(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).toMatchObject({ bookingId: id, actualDelivery: expected });

    const note = await http().get(`/api/v1/deliveries/${id}/note.pdf`).set('Authorization', auth(A.token)).buffer().parse(binaryParser).expect(200);
    expect(note.headers['content-type']).toContain('application/pdf');
    expect((note.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');

    // A delivered vehicle cannot be delivered again with a different date.
    await viaDelivery(A.token, id, { actualDelivery: shift(date, -1) }).expect(400);
    expect((await stored(id)).actualDelivery!.toISOString()).toBe(expected);
  });

  // ───────────────────────── "Today" is the company's today ─────────────────────────
  describe('company time zone', () => {
    it('the same calendar date is "today" for one company and "the future" for another', async () => {
      // Kiritimati is 25 hours ahead of Pago Pago, so its today is always a later date than Pago Pago's.
      const date = today(K);
      expect(date > today(P)).toBe(true);

      const inK = await invoicedBooking(K);
      await viaDelivery(K.token, inK, { actualDelivery: date }).expect(201);
      expect(businessDateOf((await stored(inK)).actualDelivery!, 'Pacific/Kiritimati')).toBe(date);

      const inP = await invoicedBooking(P);
      await viaDelivery(P.token, inP, { actualDelivery: date }).expect(400);
      await viaBooking(P.token, inP, { actualDelivery: date }).expect(400);
      await expectNotDelivered(inP);
      await viaBooking(P.token, inP, { actualDelivery: today(P) }).expect(201);
    });

    it('a past date is anchored at noon in the company time zone, whatever the server time zone', async () => {
      const kDate = shift(today(K), -4);
      const inK = await invoicedBooking(K);
      await viaBooking(K.token, inK, { actualDelivery: kDate }).expect(201);
      const k = (await stored(inK)).actualDelivery!;
      expect(k).toEqual(noonOf(kDate, 'Pacific/Kiritimati'));
      expect(k.toISOString()).toBe(`${shift(kDate, -1)}T22:00:00.000Z`);
      expect(businessDateOf(k, 'Pacific/Kiritimati')).toBe(kDate);

      const pDate = shift(today(P), -4);
      const inP = await invoicedBooking(P);
      await viaDelivery(P.token, inP, { actualDelivery: pDate }).expect(201);
      const p = (await stored(inP)).actualDelivery!;
      expect(p.toISOString()).toBe(`${pDate}T23:00:00.000Z`);
      expect(businessDateOf(p, 'Pacific/Pago_Pago')).toBe(pDate);
    });
  });

  // ───────────────────────── Permissions are unchanged ─────────────────────────
  describe('permissions', () => {
    it('Delivery module completion needs delivery.manage', async () => {
      const viewer = await limitedUser('dview', ['delivery.view']);
      const manager = await limitedUser('dmanage', ['delivery.view', 'delivery.manage']);
      const id = await invoicedBooking(A);
      const date = shift(today(A), -1);
      await viaDelivery(viewer, id, { actualDelivery: date }).expect(403);
      await viaBooking(viewer, id, { actualDelivery: date }).expect(403); // no bookings.update either
      await expectNotDelivered(id);
      await viaDelivery(manager, id, { actualDelivery: date }).expect(201);
      expect((await stored(id)).actualDelivery).toEqual(noonOf(date, 'Asia/Kolkata'));
    });

    it('Booking → Deliver keeps its existing permission, bookings.update', async () => {
      const viewer = await limitedUser('bview', ['bookings.view']);
      const editor = await limitedUser('bupdate', ['bookings.view', 'bookings.update']);
      const id = await invoicedBooking(A);
      const date = shift(today(A), -1);
      await viaBooking(viewer, id, { actualDelivery: date }).expect(403);
      await viaDelivery(editor, id, { actualDelivery: date }).expect(403); // bookings.update is not delivery.manage
      await expectNotDelivered(id);
      await viaBooking(editor, id, { actualDelivery: date }).expect(201);
      expect((await stored(id)).actualDelivery).toEqual(noonOf(date, 'Asia/Kolkata'));
    });

    it('an unauthenticated request is refused', async () => {
      const id = await invoicedBooking(A);
      await http().post(`/api/v1/bookings/${id}/deliver`).send({ actualDelivery: today(A) }).expect(401);
      await http().post(`/api/v1/deliveries/${id}/complete`).send({ actualDelivery: today(A) }).expect(401);
      await expectNotDelivered(id);
    });
  });
});
