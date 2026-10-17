import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Role } from '@azad/shared';
import { PrismaService } from '../src/prisma/prisma.service';
import { createE2eApp, E2E_HOOK_TIMEOUT } from './support/e2e-app';
import { createTestCompany, purgeTestCompany, TestCompany } from './support/e2e-company';

type Movement = { type: string; quantity: number; unitCost?: string; onHandAfter: number; reservedAfter: number; note: string | null; createdByName: string | null };

/**
 * Accessory opening stock and adjustments (accessory inventory, Group 4): opening stock sets the weighted-average
 * cost and is owner-only; adjustments are signed, need a reason, never touch the cost and never take stock below
 * what is reserved; every change lands in the stock ledger.
 */
describe('Accessory opening stock & adjustments (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let A: TestCompany;
  let B: TestCompany;
  const http = () => request(app.getHttpServer());
  let helmetId = '';

  const add = async (name: string): Promise<string> => (await http().post('/api/v1/accessories').set('Authorization', A.auth()).send({ name, sellPrice: 150000 }).expect(201)).body.id;
  const opening = (id: string, body: Record<string, unknown>, as = A.auth()) => http().post(`/api/v1/accessories/${id}/opening-stock`).set('Authorization', as).send(body);
  const adjust = (id: string, body: Record<string, unknown>, as = A.auth()) => http().post(`/api/v1/accessories/${id}/adjustments`).set('Authorization', as).send(body);

  beforeAll(async () => {
    app = await createE2eApp();
    prisma = app.get(PrismaService);
    A = await createTestCompany(app, 'AcsA', { roles: [Role.MANAGER, Role.SALES_EXECUTIVE] });
    B = await createTestCompany(app, 'AcsB');
    helmetId = await add('Helmet');
  }, E2E_HOOK_TIMEOUT);

  afterAll(async () => {
    await purgeTestCompany(prisma, A?.id);
    await purgeTestCompany(prisma, B?.id);
    await app.close();
  }, E2E_HOOK_TIMEOUT);

  it('opening stock sets on hand and the average cost, and is recorded in the ledger', async () => {
    const res = await opening(helmetId, { quantity: 10, unitCost: 90000, note: 'Counted on 1 Oct' }).expect(201);
    expect(res.body).toMatchObject({ onHand: 10, reserved: 0, available: 10, avgCost: '90000', openingAllowed: true });
    expect(res.body.movements[0]).toMatchObject({ type: 'OPENING', quantity: 10, unitCost: '90000', onHandAfter: 10, note: 'Counted on 1 Oct', createdByName: expect.any(String) });
  });

  it('a second opening lot averages the cost (10 × ₹900 + 5 × ₹1,200 → ₹1,000)', async () => {
    const res = await opening(helmetId, { quantity: 5, unitCost: 120000 }).expect(201);
    expect(res.body).toMatchObject({ onHand: 15, avgCost: '100000' });
    expect(res.body.movements[0]).toMatchObject({ type: 'OPENING', quantity: 5, note: 'Opening stock' });
  });

  it('only the owner enters opening stock (it sets the cost)', async () => {
    const res = await opening(helmetId, { quantity: 1, unitCost: 1 }, A.auth(Role.MANAGER)).expect(403);
    expect(res.body.message).toContain('only the owner');
    await opening(helmetId, { quantity: 1, unitCost: 1 }, A.auth(Role.SALES_EXECUTIVE)).expect(403);
  });

  it('refuses a zero or fractional quantity and a negative cost', async () => {
    await opening(helmetId, { quantity: 0, unitCost: 100 }).expect(400);
    await opening(helmetId, { quantity: 1.5, unitCost: 100 }).expect(400);
    await opening(helmetId, { quantity: 1, unitCost: -1 }).expect(400);
    await opening(helmetId, { quantity: 1 }).expect(400);
  });

  it('an adjustment needs a reason and a non-zero whole number', async () => {
    await adjust(helmetId, { delta: -2 }).expect(400);
    await adjust(helmetId, { delta: 0, reason: 'Recount' }).expect(400);
    await adjust(helmetId, { delta: 1.5, reason: 'Recount' }).expect(400);
  });

  it('a manager removes damaged pieces; the cost is unchanged and hidden from them', async () => {
    const res = await adjust(helmetId, { delta: -2, reason: 'Damaged in transit' }, A.auth(Role.MANAGER)).expect(201);
    expect(res.body).toMatchObject({ onHand: 13, available: 13, openingAllowed: false });
    expect(res.body).not.toHaveProperty('avgCost');
    expect(res.body.movements[0]).toMatchObject({ type: 'ADJUSTMENT', quantity: -2, onHandAfter: 13, note: 'Damaged in transit' });
    expect(res.body.movements[0]).not.toHaveProperty('unitCost');
    const owner = await http().get(`/api/v1/accessories/${helmetId}`).set('Authorization', A.auth()).expect(200);
    expect(owner.body.avgCost).toBe('100000');
    expect(owner.body.movements[0].unitCost).toBe('100000'); // removed at the average cost
    const log = await prisma.activityLog.findFirstOrThrow({ where: { entityType: 'Accessory', entityId: helmetId }, orderBy: { createdAt: 'desc' } });
    expect(log.summary).toBe('Adjusted stock of Helmet: -2 (on hand 13) — Damaged in transit');
  });

  it('adding found pieces keeps the average cost', async () => {
    const res = await adjust(helmetId, { delta: 3, reason: 'Found in store room' }).expect(201);
    expect(res.body).toMatchObject({ onHand: 16, avgCost: '100000' });
  });

  it('after any adjustment, opening stock is closed', async () => {
    const res = await opening(helmetId, { quantity: 1, unitCost: 100 }).expect(409);
    expect(res.body.message).toContain('use an adjustment instead');
  });

  it('stock cannot go below zero, nor below what is reserved for bookings', async () => {
    const res = await adjust(helmetId, { delta: -17, reason: 'Write off' }).expect(409);
    expect(res.body.message).toBe('Only 16 of Helmet are in stock');
    await prisma.accessory.update({ where: { id: helmetId }, data: { reserved: 4 } });
    const reserved = await adjust(helmetId, { delta: -13, reason: 'Write off' }).expect(409);
    expect(reserved.body.message).toBe('Only 12 of Helmet can be removed — 4 more are reserved for bookings');
    const ok = await adjust(helmetId, { delta: -12, reason: 'Write off' }).expect(201);
    expect(ok.body).toMatchObject({ onHand: 4, reserved: 4, available: 0 });
    expect(ok.body.movements[0]).toMatchObject({ reservedAfter: 4 });
    await prisma.accessory.update({ where: { id: helmetId }, data: { reserved: 0 } });
  });

  it('concurrent adjustments apply one at a time (no lost update, never below zero)', async () => {
    const id = await add('Mirror');
    await opening(id, { quantity: 5, unitCost: 10000 }).expect(201);
    const results = await Promise.all(Array.from({ length: 8 }, () => adjust(id, { delta: -1, reason: 'Concurrent test' })));
    expect(results.filter((r) => r.status === 201)).toHaveLength(5);
    expect(results.filter((r) => r.status === 409)).toHaveLength(3);
    const after = await http().get(`/api/v1/accessories/${id}`).set('Authorization', A.auth()).expect(200);
    expect(after.body.onHand).toBe(0);
    expect(after.body.movements.filter((m: Movement) => m.type === 'ADJUSTMENT').map((m: Movement) => m.onHandAfter).sort()).toEqual([0, 1, 2, 3, 4]);
  });

  it('sales staff cannot change stock', async () => {
    await adjust(helmetId, { delta: 1, reason: 'Recount' }, A.auth(Role.SALES_EXECUTIVE)).expect(403);
  });

  it("another company's accessory is not found", async () => {
    await adjust(helmetId, { delta: 1, reason: 'Recount' }, B.auth()).expect(404);
    await opening(helmetId, { quantity: 1, unitCost: 1 }, B.auth()).expect(404);
  });
});
