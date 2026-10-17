import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Role } from '@azad/shared';
import { PrismaService } from '../src/prisma/prisma.service';
import { createE2eApp, E2E_HOOK_TIMEOUT } from './support/e2e-app';
import { createTestCompany, purgeTestCompany, TestCompany } from './support/e2e-company';

/** Collect a binary response body into a Buffer. */
function binaryParser(res: request.Response, callback: (err: Error | null, body: unknown) => void): void {
  const stream = res as unknown as NodeJS.ReadableStream;
  const chunks: Buffer[] = [];
  stream.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
  stream.on('end', () => callback(null, Buffer.concat(chunks)));
}

type Line = { item: string; label: string; covered: boolean; months?: number | null; validUntil?: string | null };

/**
 * Component warranty months: entered on the scooter, issued as the warranty card on delivery (starting on the
 * delivery date), and afterwards changed only by the owner — which regenerates the card under the same number.
 */
describe('Warranty component months (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let co: TestCompany;
  let customerId = '';
  let serial = 0;
  const stamp = Date.now().toString().slice(-8);
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createE2eApp();
    prisma = app.get(PrismaService);
    co = await createTestCompany(app, 'WtyMo', { roles: [Role.MANAGER] });
    const customer = await http().post('/api/v1/customers').set('Authorization', co.auth()).send({ name: 'Months Customer', phone: `96${stamp}` }).expect(201);
    customerId = customer.body.id;
  }, E2E_HOOK_TIMEOUT);

  afterAll(async () => {
    await purgeTestCompany(prisma, co?.id);
    await app.close();
  }, E2E_HOOK_TIMEOUT);

  const addUnit = (extra: Record<string, unknown> = {}, as: string = co.auth()) => {
    const n = serial++;
    return http()
      .post('/api/v1/inventory/units')
      .set('Authorization', as)
      .send({ modelId: co.modelId, variant: `WM-${stamp}`, colour: `C${n}`, vin: `WMV${stamp}${n}`, motorNumber: `WMM${stamp}${n}`, batteryNumber: `WMB${stamp}${n}`, ...extra });
  };

  /** Books, invoices and delivers the unit `daysAgo` days back; returns the booking's delivery date. */
  const deliver = async (unitId: string, daysAgo = 5): Promise<Date> => {
    const booking = await http().post('/api/v1/bookings').set('Authorization', co.auth()).send({ customerId, unitId, exShowroom: 1_000_000 }).expect(201);
    await http().post(`/api/v1/bookings/${booking.body.id}/invoice`).set('Authorization', co.auth()).expect(201);
    await prisma.$executeRaw`UPDATE "Booking" SET "createdAt" = ${new Date(Date.now() - 60 * 86_400_000)}::timestamptz AT TIME ZONE 'UTC' WHERE id = ${booking.body.id}`;
    const day = new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);
    await http().post(`/api/v1/bookings/${booking.body.id}/deliver`).set('Authorization', co.auth()).send({ actualDelivery: day }).expect(201);
    const row = await prisma.booking.findFirstOrThrow({ where: { id: booking.body.id }, select: { actualDelivery: true } });
    return row.actualDelivery as Date;
  };

  const warrantyOf = async (unitId: string) => {
    const w = await prisma.warranty.findFirstOrThrow({ where: { unitId, status: { not: 'CANCELLED' } }, select: { id: true } });
    return (await http().get(`/api/v1/warranties/${w.id}`).set('Authorization', co.auth()).expect(200)).body;
  };
  const line = (coverage: Line[], item: string): Line | undefined => coverage.find((c) => c.item === item);

  describe('a scooter with component months', () => {
    let unitId = '';
    let warrantyId = '';
    let warrantyNumber = '';
    let deliveredAt: Date;

    it('stores the months entered with the scooter (any inventory user, here the manager)', async () => {
      const res = await addUnit(
        { motorWarrantyMonths: 36, batteryWarrantyMonths: '60', controllerWarrantyMonths: 12, chargerWarrantyMonths: 0, warrantyExtras: [{ name: ' Hub bearings ', months: '18' }], controllerNumber: 'ctl-1', chargerNumber: 'chg-1' },
        co.auth(Role.MANAGER),
      ).expect(201);
      unitId = res.body.id;
      const detail = await http().get(`/api/v1/inventory/units/${unitId}`).set('Authorization', co.auth()).expect(200);
      expect(detail.body).toMatchObject({ motorWarrantyMonths: 36, batteryWarrantyMonths: 60, controllerWarrantyMonths: 12, chargerWarrantyMonths: 0, warrantyExtras: [{ name: 'Hub bearings', months: 18 }] });
    });

    it('refuses months that are not whole numbers between 0 and 240', async () => {
      await addUnit({ motorWarrantyMonths: 241 }).expect(400);
      await addUnit({ batteryWarrantyMonths: 1.5 }).expect(400);
      await addUnit({ chargerWarrantyMonths: -1 }).expect(400);
    });

    it('refuses an extra item without a name, without months, or named twice', async () => {
      await addUnit({ warrantyExtras: [{ name: '  ', months: 12 }] }).expect(400);
      await addUnit({ warrantyExtras: [{ name: 'Mirror', months: 0 }] }).expect(400);
      await addUnit({ warrantyExtras: [{ name: 'Mirror', months: 6 }, { name: 'mirror', months: 12 }] }).expect(400);
    });

    it('the months can still be changed before delivery', async () => {
      await http().patch(`/api/v1/inventory/units/${unitId}`).set('Authorization', co.auth(Role.MANAGER)).send({ controllerWarrantyMonths: 18 }).expect(200);
      const detail = await http().get(`/api/v1/inventory/units/${unitId}`).set('Authorization', co.auth()).expect(200);
      expect(detail.body.controllerWarrantyMonths).toBe(18);
    });

    it('delivery issues the warranty card from them, starting on the delivery date', async () => {
      deliveredAt = await deliver(unitId);
      const body = await warrantyOf(unitId);
      warrantyId = body.warranty.id;
      warrantyNumber = body.warranty.warrantyNumber;
      expect(new Date(body.warranty.startDate)).toEqual(deliveredAt);
      expect(body.warranty.controllerNumber).toBe('CTL-1');
      expect(body.warranty.chargerNumber).toBe('CHG-1');
      const coverage = body.coverage as Line[];
      expect(line(coverage, 'MOTOR')).toMatchObject({ covered: true, months: 36 });
      expect(line(coverage, 'BATTERY')).toMatchObject({ covered: true, months: 60 });
      expect(line(coverage, 'CONTROLLER')).toMatchObject({ covered: true, months: 18 });
      expect(line(coverage, 'CHARGER')).toMatchObject({ covered: false, months: null, validUntil: null });
      // Only the four components and the extra item typed in — no other standard lines.
      expect(coverage.map((c) => c.item)).toEqual(['MOTOR', 'BATTERY', 'CONTROLLER', 'CHARGER', 'CUSTOM']);
      expect(line(coverage, 'CUSTOM')).toMatchObject({ label: 'Hub bearings', covered: true, months: 18 });
      // Battery: 60 months from delivery; the warranty runs as long as its longest component.
      const until = new Date(deliveredAt);
      until.setMonth(until.getMonth() + 60);
      expect(new Date(line(coverage, 'BATTERY')?.validUntil as string).toISOString().slice(0, 10)).toBe(until.toISOString().slice(0, 10));
      expect(body.warranty.periodMonths).toBe(60);
      expect(body.warranty.endDate.slice(0, 10)).toBe(until.toISOString().slice(0, 10));
    });

    it('prints the card', async () => {
      const pdf = await http().get(`/api/v1/warranties/${warrantyId}/certificate.pdf`).set('Authorization', co.auth()).buffer().parse(binaryParser).expect(200);
      expect(pdf.headers['content-type']).toContain('application/pdf');
      expect((pdf.body as Buffer).length).toBeGreaterThan(1000);
    });

    it('once the card exists the scooter months are locked, even for the owner (they change from the warranty)', async () => {
      const res = await http().patch(`/api/v1/inventory/units/${unitId}`).set('Authorization', co.auth()).send({ motorWarrantyMonths: 48 }).expect(409);
      expect(res.body.message).toMatch(/warranty card/);
      await http().patch(`/api/v1/inventory/units/${unitId}`).set('Authorization', co.auth()).send({ warrantyExtras: [] }).expect(409);
      // Sending the same value back (an ordinary save of the form) is not a change.
      await http().patch(`/api/v1/inventory/units/${unitId}`).set('Authorization', co.auth()).send({ motorWarrantyMonths: 36, notes: 'checked' }).expect(200);
    });

    it('only the owner changes the months or the coverage', async () => {
      const months = { MOTOR: 48, BATTERY: 60, CONTROLLER: 24, CHARGER: 12 };
      await http().patch(`/api/v1/warranties/${warrantyId}/months`).set('Authorization', co.auth(Role.MANAGER)).send({ months }).expect(403);
      await http().patch(`/api/v1/warranties/${warrantyId}`).set('Authorization', co.auth(Role.MANAGER)).send({ coverage: [{ item: 'MOTOR', covered: false }] }).expect(403);
      // Notes stay open to anyone with warranty.update.
      await http().patch(`/api/v1/warranties/${warrantyId}`).set('Authorization', co.auth(Role.MANAGER)).send({ dealerNotes: 'Customer informed' }).expect(200);
    });

    it('the owner changes the months and regenerates the card under the same number', async () => {
      const res = await http()
        .patch(`/api/v1/warranties/${warrantyId}/months`)
        .set('Authorization', co.auth())
        .send({ months: { MOTOR: 48, BATTERY: 60, CONTROLLER: 24, CHARGER: 12 }, extras: [{ name: 'Hub bearings', months: 24 }, { name: 'Side mirror', months: 6 }], reason: 'Manufacturer extended motor cover' })
        .expect(200);
      expect(res.body.warranty.warrantyNumber).toBe(warrantyNumber);
      expect(new Date(res.body.warranty.startDate)).toEqual(deliveredAt);
      const coverage = res.body.coverage as Line[];
      expect(line(coverage, 'MOTOR')?.months).toBe(48);
      expect(line(coverage, 'CHARGER')).toMatchObject({ covered: true, months: 12 });
      expect(coverage.filter((c) => c.item === 'CUSTOM').map((c) => [c.label, c.months])).toEqual([['Hub bearings', 24], ['Side mirror', 6]]);
      expect(res.body.warranty.periodMonths).toBe(60);

      const unit = await http().get(`/api/v1/inventory/units/${unitId}`).set('Authorization', co.auth()).expect(200);
      expect(unit.body).toMatchObject({ motorWarrantyMonths: 48, batteryWarrantyMonths: 60, controllerWarrantyMonths: 24, chargerWarrantyMonths: 12, warrantyExtras: [{ name: 'Hub bearings', months: 24 }, { name: 'Side mirror', months: 6 }] });
      const log = await prisma.activityLog.findFirstOrThrow({ where: { entityType: 'Warranty', entityId: warrantyId }, orderBy: { createdAt: 'desc' } });
      expect(log.summary).toContain('Motor 36 → 48');
      expect(log.summary).toContain('Charger 0 → 12');
      expect(log.summary).toContain('extra items Hub bearings 18 → Hub bearings 24, Side mirror 6');
      expect(log.summary).toContain('Manufacturer extended motor cover');

      const pdf = await http().get(`/api/v1/warranties/${warrantyId}/certificate.pdf`).set('Authorization', co.auth()).buffer().parse(binaryParser).expect(200);
      expect((pdf.body as Buffer).length).toBeGreaterThan(1000);
    });

    it('shortening every line moves the expiry with it; extras not sent are kept', async () => {
      const res = await http().patch(`/api/v1/warranties/${warrantyId}/months`).set('Authorization', co.auth()).send({ months: { MOTOR: 24, BATTERY: 18, CONTROLLER: 12, CHARGER: 12 } }).expect(200);
      expect(res.body.warranty.periodMonths).toBe(24);
      expect((res.body.coverage as Line[]).filter((c) => c.item === 'CUSTOM').map((c) => c.label)).toEqual(['Hub bearings', 'Side mirror']);
      // Removing every extra item.
      const cleared = await http().patch(`/api/v1/warranties/${warrantyId}/months`).set('Authorization', co.auth()).send({ months: { MOTOR: 24, BATTERY: 18, CONTROLLER: 12, CHARGER: 12 }, extras: [] }).expect(200);
      expect((cleared.body.coverage as Line[]).map((c) => c.item)).toEqual(['MOTOR', 'BATTERY', 'CONTROLLER', 'CHARGER']);
      expect(cleared.body.warranty.periodMonths).toBe(24);
    });

    it('refuses no change, and a card that covers nothing', async () => {
      await http().patch(`/api/v1/warranties/${warrantyId}/months`).set('Authorization', co.auth()).send({ months: { MOTOR: 24, BATTERY: 18, CONTROLLER: 12, CHARGER: 12 } }).expect(400);
      await http().patch(`/api/v1/warranties/${warrantyId}/months`).set('Authorization', co.auth()).send({ months: { MOTOR: 0, BATTERY: 0, CONTROLLER: 0, CHARGER: 0 } }).expect(400);
      await http().patch(`/api/v1/warranties/${warrantyId}/months`).set('Authorization', co.auth()).send({ months: { MOTOR: 24 } }).expect(400);
    });
  });

  it('a scooter without months gets the company default for every component', async () => {
    const unit = await addUnit().expect(201);
    expect(unit.body.motorWarrantyMonths).toBeNull();
    await deliver(unit.body.id, 2);
    const body = await warrantyOf(unit.body.id);
    expect((body.coverage as Line[]).map((c) => [c.item, c.covered, c.months])).toEqual([['MOTOR', true, 36], ['BATTERY', true, 36], ['CONTROLLER', true, 36], ['CHARGER', true, 36]]);
    expect(body.warranty.periodMonths).toBe(36);
  });

  it('a cancelled warranty cannot be re-dated', async () => {
    const unit = await addUnit({ motorWarrantyMonths: 24 }).expect(201);
    await deliver(unit.body.id, 1);
    const body = await warrantyOf(unit.body.id);
    await http().post(`/api/v1/warranties/${body.warranty.id}/cancel`).set('Authorization', co.auth()).expect(201);
    await http().patch(`/api/v1/warranties/${body.warranty.id}/months`).set('Authorization', co.auth()).send({ months: { MOTOR: 36, BATTERY: 36, CONTROLLER: 36, CHARGER: 36 } }).expect(409);
  });
});
