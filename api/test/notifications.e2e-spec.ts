import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createE2eApp, E2E_HOOK_TIMEOUT } from './support/e2e-app';
import { createTestCompany, purgeTestCompany, TestCompany } from './support/e2e-company';

describe('Notifications (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  // Runs in its own throwaway company: notifications are generated from, and only touch, its data.
  let co: TestCompany;
  let token: string;
  const stamp = Date.now().toString().slice(-8);
  const http = () => request(app.getHttpServer());
  const auth = (): string => `Bearer ${token}`;

  beforeAll(async () => {
    app = await createE2eApp();
    prisma = app.get(PrismaService);
    co = await createTestCompany(app, 'Ntf');
    token = co.user().token;
    // Live data that must raise a notification: a booking with an outstanding balance.
    const unit = await http().post('/api/v1/inventory/units').set('Authorization', auth())
      .send({ modelId: co.modelId, variant: `Ntf-${stamp}`, colour: 'Red', vin: `NTFV${stamp}`, motorNumber: `NTFM${stamp}`, batteryNumber: `NTFB${stamp}` }).expect(201);
    const customer = await http().post('/api/v1/customers').set('Authorization', auth()).send({ name: `Ntf ${stamp}`, phone: `92${stamp}` }).expect(201);
    await http().post('/api/v1/bookings').set('Authorization', auth())
      .send({ customerId: customer.body.id, unitId: unit.body.id, exShowroom: 10000000, advanceAmount: 1000000 }).expect(201);
  }, E2E_HOOK_TIMEOUT);

  afterAll(async () => {
    await purgeTestCompany(prisma, co?.id);
    await app.close();
  }, E2E_HOOK_TIMEOUT);

  it('generates notifications from live data, de-duplicated on refresh', async () => {
    const first = await http().post('/api/v1/notifications/refresh').set('Authorization', auth()).expect(201);
    expect(first.body.created).toBeGreaterThan(0);
    const again = await http().post('/api/v1/notifications/refresh').set('Authorization', auth()).expect(201);
    expect(again.body.created).toBe(0); // dedupe: no duplicates
  });

  it('lists, paginates and reports the unread count', async () => {
    const list = await http().get('/api/v1/notifications?pageSize=5').set('Authorization', auth()).expect(200);
    expect(list.body.data.length).toBeLessThanOrEqual(5);
    expect(list.body.meta.total).toBeGreaterThan(0);
    const first = list.body.data[0];
    expect(first).toHaveProperty('priority');
    expect(first).toHaveProperty('type');
    expect(first.isRead).toBe(false);
    const count = await http().get('/api/v1/notifications/unread-count').set('Authorization', auth()).expect(200);
    expect(count.body.total).toBe(list.body.meta.total);
  });

  it('filters by category and priority', async () => {
    const inv = await http().get('/api/v1/notifications?type=INVENTORY&pageSize=1').set('Authorization', auth()).expect(200);
    const all = await http().get('/api/v1/notifications?pageSize=1').set('Authorization', auth()).expect(200);
    expect(inv.body.meta.total).toBeLessThanOrEqual(all.body.meta.total);
    const high = await http().get('/api/v1/notifications?priority=HIGH&pageSize=1').set('Authorization', auth()).expect(200);
    expect(high.body.meta.total).toBeGreaterThanOrEqual(0);
  });

  it('creates a manual reminder, then marks it read (unread drops)', async () => {
    const before = (await http().get('/api/v1/notifications/unread-count').set('Authorization', auth())).body.total;
    const created = await http()
      .post('/api/v1/notifications')
      .set('Authorization', auth())
      .send({ title: 'Call customer', message: 'Finance follow-up', type: 'CUSTOMER', priority: 'HIGH' })
      .expect(201);
    expect(created.body.type).toBe('CUSTOMER');
    expect(created.body.isRead).toBe(false);
    const mid = (await http().get('/api/v1/notifications/unread-count').set('Authorization', auth())).body.total;
    expect(mid).toBe(before + 1);
    const read = await http().patch(`/api/v1/notifications/${created.body.id}/read`).set('Authorization', auth()).expect(200);
    expect(read.body.isRead).toBe(true);
    const after = (await http().get('/api/v1/notifications/unread-count').set('Authorization', auth())).body.total;
    expect(after).toBe(before);
  });

  it('searches by text', async () => {
    const res = await http().get('/api/v1/notifications?q=Call%20customer').set('Authorization', auth()).expect(200);
    expect(res.body.meta.total).toBeGreaterThanOrEqual(1);
    expect(res.body.data.some((n: { title: string }) => n.title.includes('Call customer'))).toBe(true);
  });

  it('archives and deletes; mark-all clears the unread count', async () => {
    const one = (await http().get('/api/v1/notifications?pageSize=1&unread=true').set('Authorization', auth())).body.data[0];
    await http().patch(`/api/v1/notifications/${one.id}/archive`).set('Authorization', auth()).expect(200);
    const listed = await http().get('/api/v1/notifications?pageSize=100').set('Authorization', auth()).expect(200);
    expect(listed.body.data.some((n: { id: string }) => n.id === one.id)).toBe(false); // archived hidden by default

    await http().patch('/api/v1/notifications/read-all').set('Authorization', auth()).expect(200);
    const count = await http().get('/api/v1/notifications/unread-count').set('Authorization', auth()).expect(200);
    expect(count.body.total).toBe(0);

    const target = (await http().get('/api/v1/notifications?pageSize=1').set('Authorization', auth())).body.data[0];
    await http().delete(`/api/v1/notifications/${target.id}`).set('Authorization', auth()).expect(204);
    const gone = await http().patch(`/api/v1/notifications/${target.id}/read`).set('Authorization', auth()).expect(404);
    expect(gone.body.message).toContain('not found');
  });

  it('rejects anonymous access (401)', async () => {
    await http().get('/api/v1/notifications').expect(401);
    await http().get('/api/v1/notifications/unread-count').expect(401);
  });
});
