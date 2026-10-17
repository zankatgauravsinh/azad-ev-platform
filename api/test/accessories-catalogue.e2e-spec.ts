import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Role } from '@azad/shared';
import { PrismaService } from '../src/prisma/prisma.service';
import { createE2eApp, E2E_HOOK_TIMEOUT } from './support/e2e-app';
import { createTestCompany, purgeTestCompany, TestCompany } from './support/e2e-company';

/**
 * Accessory catalogue (accessory inventory, Group 2): add / edit / deactivate, stock read-only, the average
 * cost visible only with inventory.cost, SKU and name unique within a company, tenant isolation.
 */
describe('Accessory catalogue (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let A: TestCompany;
  let B: TestCompany;
  const http = () => request(app.getHttpServer());
  let helmetId = '';

  beforeAll(async () => {
    app = await createE2eApp();
    prisma = app.get(PrismaService);
    A = await createTestCompany(app, 'AccA', { roles: [Role.MANAGER, Role.SALES_EXECUTIVE, Role.TECHNICIAN] });
    B = await createTestCompany(app, 'AccB');
  }, E2E_HOOK_TIMEOUT);

  afterAll(async () => {
    await purgeTestCompany(prisma, A?.id);
    await purgeTestCompany(prisma, B?.id);
    await app.close();
  }, E2E_HOOK_TIMEOUT);

  it('adds an accessory: trimmed, SKU upper-cased, no stock, cost untouched', async () => {
    const res = await http().post('/api/v1/accessories').set('Authorization', A.auth(Role.MANAGER)).send({ name: '  Helmet  ', sku: ' hel-01 ', category: 'Safety', sellPrice: 150000, minStock: 2 }).expect(201);
    helmetId = res.body.id;
    expect(res.body).toMatchObject({ name: 'Helmet', sku: 'HEL-01', category: 'Safety', sellPrice: '150000', onHand: 0, reserved: 0, available: 0, minStock: 2, lowStock: true, isActive: true });
    // Stock and cost are never set from the catalogue.
    const sneaky = await http().post('/api/v1/accessories').set('Authorization', A.auth()).send({ name: 'Mat', sellPrice: 50000, onHand: 50, avgCost: 1000 }).expect(201);
    expect(sneaky.body).toMatchObject({ onHand: 0, avgCost: '0' });
  });

  it('refuses a blank name, a negative price or low-stock level', async () => {
    await http().post('/api/v1/accessories').set('Authorization', A.auth()).send({ name: '   ', sellPrice: 100 }).expect(400);
    await http().post('/api/v1/accessories').set('Authorization', A.auth()).send({ name: 'X', sellPrice: -1 }).expect(400);
    await http().post('/api/v1/accessories').set('Authorization', A.auth()).send({ name: 'X', minStock: -2 }).expect(400);
  });

  it('names and SKUs are unique within the company (names ignoring case)', async () => {
    const byName = await http().post('/api/v1/accessories').set('Authorization', A.auth()).send({ name: 'HELMET', sellPrice: 1 }).expect(409);
    expect(byName.body.message).toContain('"Helmet" already exists');
    const bySku = await http().post('/api/v1/accessories').set('Authorization', A.auth()).send({ name: 'Visor', sku: 'HEL-01', sellPrice: 1 }).expect(409);
    expect(bySku.body.message).toContain('SKU HEL-01');
    // Another company may use the same name and SKU.
    await http().post('/api/v1/accessories').set('Authorization', B.auth()).send({ name: 'Helmet', sku: 'HEL-01', sellPrice: 1 }).expect(201);
  });

  it('edits catalogue details and records what changed; stock fields are ignored', async () => {
    const res = await http().patch(`/api/v1/accessories/${helmetId}`).set('Authorization', A.auth()).send({ name: 'Helmet (ISI)', sellPrice: 175000, category: '', sku: '', minStock: 0, onHand: 9 }).expect(200);
    expect(res.body).toMatchObject({ name: 'Helmet (ISI)', sellPrice: '175000', category: null, sku: null, minStock: 0, onHand: 0 });
    const log = await prisma.activityLog.findFirstOrThrow({ where: { entityType: 'Accessory', entityId: helmetId, action: 'UPDATE' }, orderBy: { createdAt: 'desc' } });
    expect(log.summary).toContain('name Helmet → Helmet (ISI)');
    expect(log.summary).toContain('price ₹1,500.00 → ₹1,750.00');
    await http().patch(`/api/v1/accessories/${helmetId}`).set('Authorization', A.auth()).send({}).expect(400);
    await http().patch(`/api/v1/accessories/${helmetId}`).set('Authorization', A.auth()).send({ name: 'mat' }).expect(409);
  });

  it('lists with search, category and low-stock filters; categories in use', async () => {
    await http().post('/api/v1/accessories').set('Authorization', A.auth()).send({ name: 'Seat cover', category: 'Comfort', sellPrice: 80000 }).expect(201);
    const all = await http().get('/api/v1/accessories').set('Authorization', A.auth()).expect(200);
    expect(all.body.map((a: { name: string }) => a.name)).toEqual(['Helmet (ISI)', 'Mat', 'Seat cover']);
    const search = await http().get('/api/v1/accessories?q=seat').set('Authorization', A.auth()).expect(200);
    expect(search.body.map((a: { name: string }) => a.name)).toEqual(['Seat cover']);
    const comfort = await http().get('/api/v1/accessories?category=comfort').set('Authorization', A.auth()).expect(200);
    expect(comfort.body).toHaveLength(1);
    // Nothing in stock yet, so everything is low.
    const low = await http().get('/api/v1/accessories?lowStock=true').set('Authorization', A.auth()).expect(200);
    expect(low.body).toHaveLength(3);
    const categories = await http().get('/api/v1/accessories/categories').set('Authorization', A.auth()).expect(200);
    expect(categories.body).toEqual(['Comfort']);
  });

  it('deactivating hides an accessory from the pickers; it can be activated again', async () => {
    const mat = (await http().get('/api/v1/accessories?q=mat').set('Authorization', A.auth()).expect(200)).body[0];
    await http().post(`/api/v1/accessories/${mat.id}/deactivate`).set('Authorization', A.auth()).expect(201);
    const active = await http().get('/api/v1/accessories').set('Authorization', A.auth()).expect(200);
    expect(active.body.some((a: { id: string }) => a.id === mat.id)).toBe(false);
    const inactive = await http().get('/api/v1/accessories?status=inactive').set('Authorization', A.auth()).expect(200);
    expect(inactive.body.map((a: { id: string }) => a.id)).toEqual([mat.id]);
    // An inactive name is still taken.
    const clash = await http().post('/api/v1/accessories').set('Authorization', A.auth()).send({ name: 'Mat', sellPrice: 1 }).expect(409);
    expect(clash.body.message).toContain('inactive — activate it instead');
    const back = await http().post(`/api/v1/accessories/${mat.id}/activate`).set('Authorization', A.auth()).expect(201);
    expect(back.body.isActive).toBe(true);
  });

  it('an accessory with pieces reserved for bookings cannot be deactivated', async () => {
    await prisma.accessory.update({ where: { id: helmetId }, data: { onHand: 5, reserved: 2 } });
    const res = await http().post(`/api/v1/accessories/${helmetId}/deactivate`).set('Authorization', A.auth()).expect(409);
    expect(res.body.message).toContain('2 of Helmet (ISI) are reserved');
    const one = await http().get(`/api/v1/accessories/${helmetId}`).set('Authorization', A.auth()).expect(200);
    expect(one.body).toMatchObject({ onHand: 5, reserved: 2, available: 3, isActive: true, movements: [] });
    await prisma.accessory.update({ where: { id: helmetId }, data: { onHand: 0, reserved: 0 } });
  });

  it('the average cost is shown only to users with inventory.cost (the owner)', async () => {
    await prisma.accessory.update({ where: { id: helmetId }, data: { avgCost: 99000n } });
    await prisma.accessoryStockMovement.create({ data: { companyId: A.id, accessoryId: helmetId, type: 'OPENING', quantity: 1, unitCost: 99000n, onHandAfter: 1, reservedAfter: 0 } });
    const owner = await http().get(`/api/v1/accessories/${helmetId}`).set('Authorization', A.auth()).expect(200);
    expect(owner.body.avgCost).toBe('99000');
    expect(owner.body.movements[0].unitCost).toBe('99000');
    const manager = await http().get(`/api/v1/accessories/${helmetId}`).set('Authorization', A.auth(Role.MANAGER)).expect(200);
    expect(manager.body).not.toHaveProperty('avgCost');
    expect(manager.body.movements[0]).not.toHaveProperty('unitCost');
    const list = await http().get('/api/v1/accessories').set('Authorization', A.auth(Role.SALES_EXECUTIVE)).expect(200);
    expect(list.body.every((a: object) => !('avgCost' in a))).toBe(true);
  });

  it('permissions: sales may view but not manage; a technician cannot see the catalogue', async () => {
    await http().get('/api/v1/accessories').set('Authorization', A.auth(Role.SALES_EXECUTIVE)).expect(200);
    await http().post('/api/v1/accessories').set('Authorization', A.auth(Role.SALES_EXECUTIVE)).send({ name: 'Lock', sellPrice: 1 }).expect(403);
    await http().patch(`/api/v1/accessories/${helmetId}`).set('Authorization', A.auth(Role.SALES_EXECUTIVE)).send({ sellPrice: 1 }).expect(403);
    await http().post(`/api/v1/accessories/${helmetId}/deactivate`).set('Authorization', A.auth(Role.SALES_EXECUTIVE)).expect(403);
    await http().get('/api/v1/accessories').set('Authorization', A.auth(Role.TECHNICIAN)).expect(403);
  });

  it("another company's accessory is not found", async () => {
    await http().get(`/api/v1/accessories/${helmetId}`).set('Authorization', B.auth()).expect(404);
    await http().patch(`/api/v1/accessories/${helmetId}`).set('Authorization', B.auth()).send({ sellPrice: 1 }).expect(404);
    await http().post(`/api/v1/accessories/${helmetId}/deactivate`).set('Authorization', B.auth()).expect(404);
    const list = await http().get('/api/v1/accessories').set('Authorization', B.auth()).expect(200);
    expect(list.body.map((a: { name: string }) => a.name)).toEqual(['Helmet']);
  });
});
