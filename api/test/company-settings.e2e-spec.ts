import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createE2eApp, E2E_HOOK_TIMEOUT } from './support/e2e-app';
import { createTestCompany, purgeTestCompany, TestCompany } from './support/e2e-company';

describe('Company settings (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ownerToken: string;
  let managerToken: string;
  let salesToken: string;
  let co: TestCompany;
  const stamp = Date.now().toString().slice(-8);
  const http = () => request(app.getHttpServer());
  const bearer = (t: string): string => `Bearer ${t}`;

  beforeAll(async () => {
    app = await createE2eApp();
    prisma = app.get(PrismaService);

    // A throwaway company (its own settings row), never the seeded company's settings.
    co = await createTestCompany(app, 'Set', { roles: ['MANAGER', 'SALES_EXECUTIVE'] });
    ownerToken = co.user().token;
    managerToken = co.user('MANAGER').token;
    salesToken = co.user('SALES_EXECUTIVE').token;
  }, E2E_HOOK_TIMEOUT);

  afterAll(async () => {
    await purgeTestCompany(prisma, co?.id);
    await app.close();
  }, E2E_HOOK_TIMEOUT);

  it('rejects unauthenticated access', async () => {
    await http().get('/api/v1/settings/company').expect(401);
  });

  describe('authorization', () => {
    it('Owner and Manager can read; Sales is denied', async () => {
      await http().get('/api/v1/settings/company').set('Authorization', bearer(ownerToken)).expect(200);
      await http().get('/api/v1/settings/company').set('Authorization', bearer(managerToken)).expect(200);
      await http().get('/api/v1/settings/company').set('Authorization', bearer(salesToken)).expect(403);
    });

    it('Only Owner can update (Manager read-only, Sales denied)', async () => {
      await http().patch('/api/v1/settings/company').set('Authorization', bearer(ownerToken)).send({ language: 'en' }).expect(200);
      await http().patch('/api/v1/settings/company').set('Authorization', bearer(managerToken)).send({ language: 'en' }).expect(403);
      await http().patch('/api/v1/settings/company').set('Authorization', bearer(salesToken)).send({ language: 'en' }).expect(403);
    });
  });

  describe('validation', () => {
    const patch = (body: object) => http().patch('/api/v1/settings/company').set('Authorization', bearer(ownerToken)).send(body);
    it('rejects a bad hex colour', async () => { await patch({ primaryColor: 'navy' }).expect(400); });
    it('rejects GST enabled without a number', async () => { await patch({ gstEnabled: true, gstNumber: '' }).expect(400); });
    it('rejects an unsupported currency', async () => { await patch({ currency: 'XYZ' }).expect(400); });
    it('rejects an out-of-range tax percentage', async () => { await patch({ taxPercentage: 200 }).expect(400); });
    it('accepts a valid update and persists it', async () => {
      await patch({ serviceReminderDays: 45, secondaryColor: '#00B8A9' }).expect(200);
      const res = await http().get('/api/v1/settings/company').set('Authorization', bearer(ownerToken)).expect(200);
      expect(res.body.serviceReminderDays).toBe(45);
    });
  });

  it('is the single source of truth for document prefixes (booking code uses the setting)', async () => {
    await http().patch('/api/v1/settings/company').set('Authorization', bearer(ownerToken)).send({ bookingPrefix: `T${stamp}` }).expect(200);

    const unit = await http().post('/api/v1/inventory/units').set('Authorization', bearer(ownerToken))
      .send({ modelId: co.modelId, variant: `Set-${stamp}`, colour: 'Blue', vin: `SET${stamp}`, motorNumber: `SM${stamp}`, batteryNumber: `SB${stamp}` }).expect(201);
    const customer = await http().post('/api/v1/customers').set('Authorization', bearer(ownerToken)).send({ name: 'Set Cust', phone: `95${stamp}` }).expect(201);
    const booking = await http().post('/api/v1/bookings').set('Authorization', bearer(ownerToken))
      .send({ customerId: customer.body.id, unitId: unit.body.id, exShowroom: 10000000 }).expect(201);

    expect(booking.body.code.startsWith(`T${stamp}`)).toBe(true);
    // The booking, customer and unit belong to the throwaway company; purgeTestCompany removes them.
  });

  it('saves and returns the RTO invoice, warranty, AMC, claim, return, credit note and refund prefixes', async () => {
    const prefixes = { rtoInvoicePrefix: 'RTI/', warrantyPrefix: 'WAR-', amcPrefix: 'AM', claimPrefix: 'CL', returnPrefix: 'SR', creditNotePrefix: 'CRN', refundPrefix: 'RFD' };
    const saved = await http().patch('/api/v1/settings/company').set('Authorization', bearer(ownerToken)).send(prefixes).expect(200);
    expect(saved.body).toMatchObject(prefixes);
    expect((await http().get('/api/v1/settings/company').set('Authorization', bearer(ownerToken)).expect(200)).body).toMatchObject(prefixes);
    await http().patch('/api/v1/settings/company').set('Authorization', bearer(ownerToken)).send({ rtoInvoicePrefix: 'RTO 1' }).expect(400);
    await http().patch('/api/v1/settings/company').set('Authorization', bearer(ownerToken)).send({ refundPrefix: '' }).expect(400);
  });
});
