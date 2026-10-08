import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createE2eApp, E2E_HOOK_TIMEOUT } from './support/e2e-app';
import { createTestCompany, purgeTestCompany, TestCompany } from './support/e2e-company';

describe('Dashboard & search (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  // The suite runs in its own throwaway company, so every figure it checks is this company's alone.
  let co: TestCompany;
  const stamp = Date.now().toString().slice(-8);
  const auth = (): string => co.auth();
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createE2eApp();
    prisma = app.get(PrismaService);
    co = await createTestCompany(app, 'Dash');

    // Seed a known scenario: customer + unit + booking + advance payment
    const unit = await http().post('/api/v1/inventory/units').set('Authorization', auth())
      .send({ modelId: co.modelId, variant: `Dash-${stamp}`, colour: 'Grey', vin: `DASH${stamp}`, motorNumber: `DM${stamp}`, batteryNumber: `DB${stamp}`, sellingPrice: 11800000 }).expect(201);
    const customer = await http().post('/api/v1/customers').set('Authorization', auth())
      .send({ name: `Dash ${stamp}`, phone: `96${stamp}`, leadStatus: 'NEGOTIATION' }).expect(201);
    await http().post('/api/v1/bookings').set('Authorization', auth())
      .send({ customerId: customer.body.id, unitId: unit.body.id, exShowroom: 10500000, rto: 850000, advanceAmount: 500000 }).expect(201);
  }, E2E_HOOK_TIMEOUT);

  afterAll(async () => {
    await purgeTestCompany(prisma, co?.id);
    await app.close();
  }, E2E_HOOK_TIMEOUT);

  it('returns the full dashboard payload', async () => {
    const res = await http().get('/api/v1/dashboard/summary').set('Authorization', auth()).expect(200);
    const b = res.body;
    expect(b.todaysWork).toBeDefined();
    expect(b.businessOverview).toBeDefined();
    expect(Array.isArray(b.recentActivity)).toBe(true);
    expect(b.reminders).toBeDefined();
    expect(b.charts).toBeDefined();
  });

  it('matches database totals for inventory and active customers', async () => {
    const res = await http().get('/api/v1/dashboard/summary').set('Authorization', auth()).expect(200);
    const companyId = co.id;
    const [available, booked, delivered, activeCustomers] = await Promise.all([
      prisma.inventoryUnit.count({ where: { companyId, status: 'AVAILABLE' } }),
      prisma.inventoryUnit.count({ where: { companyId, status: 'BOOKED' } }),
      prisma.inventoryUnit.count({ where: { companyId, status: 'DELIVERED' } }),
      prisma.customer.count({ where: { companyId, leadStatus: { not: 'LOST' } } }),
    ]);
    // The seeded scenario: one unit, booked, for one active customer.
    expect([available, booked, delivered, activeCustomers]).toEqual([0, 1, 0, 1]);
    expect(res.body.businessOverview.availableInventory).toBe(available);
    expect(res.body.businessOverview.bookedInventory).toBe(booked);
    expect(res.body.businessOverview.deliveredVehicles).toBe(delivered);
    expect(res.body.businessOverview.activeCustomers).toBe(activeCustomers);
  });

  it("counts today's collections against the payment table", async () => {
    const res = await http().get('/api/v1/dashboard/summary').set('Authorization', auth()).expect(200);
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const agg = await prisma.payment.aggregate({ where: { companyId: co.id, paidAt: { gte: start } }, _sum: { amount: true } });
    expect(agg._sum.amount).toBe(500000n); // the advance
    expect(res.body.businessOverview.todayCollections).toBe((agg._sum.amount ?? 0n).toString());
    expect(res.body.todaysWork.pendingPayments.count).toBe(1);
  });

  it('produces three charts with six monthly points each', async () => {
    const res = await http().get('/api/v1/dashboard/summary').set('Authorization', auth()).expect(200);
    expect(res.body.charts.monthlySales).toHaveLength(6);
    expect(res.body.charts.monthlyCollections).toHaveLength(6);
    expect(Array.isArray(res.body.charts.leadConversion)).toBe(true);
  });

  it('orders recent activity newest-first', async () => {
    const res = await http().get('/api/v1/dashboard/summary').set('Authorization', auth()).expect(200);
    const times = res.body.recentActivity.map((a: { occurredAt: string }) => new Date(a.occurredAt).getTime());
    const sorted = [...times].sort((x, y) => y - x);
    expect(times).toEqual(sorted);
  });

  it('generates reminders from real data (pending balance)', async () => {
    const res = await http().get('/api/v1/dashboard/summary').set('Authorization', auth()).expect(200);
    expect(res.body.reminders.pendingBalance).toHaveLength(1);
  });

  it('global search finds the customer by name and phone, and the unit by VIN', async () => {
    const byName = await http().get(`/api/v1/search?q=Dash ${stamp}`).set('Authorization', auth()).expect(200);
    expect(byName.body.customers.some((c: { phone: string }) => c.phone === `96${stamp}`)).toBe(true);
    const byVin = await http().get(`/api/v1/search?q=DASH${stamp}`).set('Authorization', auth()).expect(200);
    expect(byVin.body.units.some((u: { vin: string }) => u.vin === `DASH${stamp}`)).toBe(true);
  });
});
