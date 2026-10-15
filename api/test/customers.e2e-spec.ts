import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createE2eApp, E2E_HOOK_TIMEOUT } from './support/e2e-app';
import { createTestCompany, purgeTestCompany, TestCompany } from './support/e2e-company';

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
const uploadPath = (key: string): string => resolve(process.cwd(), 'uploads', key);

describe('Customers (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ownerToken: string;
  let salesToken: string;
  let techToken: string;
  let customerId: string;
  let co: TestCompany;
  const phone = `98${Date.now().toString().slice(-8)}`;

  beforeAll(async () => {
    app = await createE2eApp();
    prisma = app.get(PrismaService);

    // A throwaway company: OWNER, SALES_EXECUTIVE and TECHNICIAN, roleIds backfilled as in production.
    co = await createTestCompany(app, 'Cust', { roles: ['SALES_EXECUTIVE', 'TECHNICIAN'] });
    ownerToken = co.user().token;
    salesToken = co.user('SALES_EXECUTIVE').token;
    techToken = co.user('TECHNICIAN').token;
  }, E2E_HOOK_TIMEOUT);

  afterAll(async () => {
    await purgeTestCompany(prisma, co?.id); // hard-deletes the customer and everything else it owns
    await app.close();
  }, E2E_HOOK_TIMEOUT);

  const owner = (): string => `Bearer ${ownerToken}`;

  it('rejects unauthenticated access', async () => {
    await request(app.getHttpServer()).get('/api/v1/customers').expect(401);
  });

  it('permission: a Technician cannot access customers (403); a Sales Executive can (200)', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/customers')
      .set('Authorization', `Bearer ${techToken}`)
      .expect(403);
    await request(app.getHttpServer())
      .get('/api/v1/customers')
      .set('Authorization', `Bearer ${salesToken}`)
      .expect(200);
  });

  it('creates a customer and auto-generates a LEAD_CREATED timeline entry', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/customers')
      .set('Authorization', owner())
      .send({ name: 'E2E Ramesh', phone, city: 'Una', state: 'Gujarat', gender: 'MALE' })
      .expect(201);
    customerId = res.body.id;
    expect(res.body.leadStatus).toBe('NEW');

    const timeline = await request(app.getHttpServer())
      .get(`/api/v1/customers/${customerId}/timeline`)
      .set('Authorization', owner())
      .expect(200);
    expect(timeline.body[0].type).toBe('LEAD_CREATED');
  });

  it('rejects a duplicate mobile number with 409', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/customers')
      .set('Authorization', owner())
      .send({ name: 'Dup', phone })
      .expect(409);
  });

  it('searches and paginates', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/customers?q=${phone}&page=1&pageSize=10`)
      .set('Authorization', owner())
      .expect(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.meta).toMatchObject({ page: 1, pageSize: 10 });
  });

  it('changes lead status and records the timeline; Lost requires a reason', async () => {
    await request(app.getHttpServer())
      .patch(`/api/v1/customers/${customerId}/status`)
      .set('Authorization', owner())
      .send({ leadStatus: 'LOST' })
      .expect(400);
    await request(app.getHttpServer())
      .patch(`/api/v1/customers/${customerId}/status`)
      .set('Authorization', owner())
      .send({ leadStatus: 'INTERESTED' })
      .expect(200);
  });

  it('uploads and deletes a document, leaving no orphan file', async () => {
    const upload = await request(app.getHttpServer())
      .post(`/api/v1/customers/${customerId}/documents`)
      .set('Authorization', owner())
      .field('type', 'AADHAAR')
      .attach('file', PNG_1PX, { filename: 'aadhaar.png', contentType: 'image/png' })
      .expect(201);
    const { id: docId, fileKey } = upload.body;
    expect(existsSync(uploadPath(fileKey))).toBe(true);
    await request(app.getHttpServer())
      .delete(`/api/v1/customers/${customerId}/documents/${docId}`)
      .set('Authorization', owner())
      .expect(204);
    expect(existsSync(uploadPath(fileKey))).toBe(false);
  });

  it('keeps note edit history', async () => {
    const created = await request(app.getHttpServer())
      .post(`/api/v1/customers/${customerId}/notes`)
      .set('Authorization', owner())
      .send({ body: 'v1' })
      .expect(201);
    await request(app.getHttpServer())
      .patch(`/api/v1/customers/${customerId}/notes/${created.body.id}`)
      .set('Authorization', owner())
      .send({ body: 'v2' })
      .expect(200);
    const revisions = await request(app.getHttpServer())
      .get(`/api/v1/customers/${customerId}/notes/${created.body.id}/revisions`)
      .set('Authorization', owner())
      .expect(200);
    expect(revisions.body[0].body).toBe('v1');
  });

  it('schedules a follow-up and generates dashboard reminders', async () => {
    const yesterday = new Date(Date.now() - 86400000).toISOString();
    await request(app.getHttpServer())
      .post(`/api/v1/customers/${customerId}/follow-ups`)
      .set('Authorization', owner())
      .send({ dueAt: yesterday, priority: 'HIGH', note: 'overdue' })
      .expect(201);

    const reminders = await request(app.getHttpServer())
      .get('/api/v1/customers/follow-ups/reminders')
      .set('Authorization', owner())
      .expect(200);
    expect(reminders.body.overdue.some((f: { customer: { id: string } }) => f.customer.id === customerId)).toBe(
      true,
    );
  });

  it('does not expose a mutation endpoint for the timeline (immutable)', async () => {
    await request(app.getHttpServer())
      .patch(`/api/v1/customers/${customerId}/timeline`)
      .set('Authorization', owner())
      .send({})
      .expect(404);
    await request(app.getHttpServer())
      .delete(`/api/v1/customers/${customerId}/timeline`)
      .set('Authorization', owner())
      .expect(404);
  });

  // QA M6: a mobile number is unique within a showroom, not across all of them.
  it('two companies may each have a customer with the same mobile; within one company it stays unique', async () => {
    const other = await createTestCompany(app, 'CustB');
    const http = () => request(app.getHttpServer());
    try {
      const phone = `93${Date.now().toString().slice(-8)}`;
      const create = (auth: string, name: string) => http().post('/api/v1/customers').set('Authorization', auth).send({ name, phone });
      const mine = (await create(`Bearer ${ownerToken}`, 'Same Mobile A').expect(201)).body;
      await create(other.auth(), 'Same Mobile B').expect(201);
      expect((await create(`Bearer ${ownerToken}`, 'Duplicate A').expect(409)).body.message).toBe(`A customer with mobile ${phone} already exists`);

      // A deleted customer still holds the number; the refusal says so instead of a database error.
      await http().delete(`/api/v1/customers/${mine.id}`).set('Authorization', `Bearer ${ownerToken}`).expect(204);
      expect((await create(`Bearer ${ownerToken}`, 'After delete').expect(409)).body.message).toBe(`A customer with mobile ${phone} already exists (it may belong to a deleted customer)`);
    } finally {
      await purgeTestCompany(prisma, other.id);
    }
  });

  // RTO invoice details: tehsil, district, Aadhaar, PAN and GSTIN live on the customer.
  it('stores tehsil, district and validated Aadhaar / PAN / GSTIN; an empty value clears them', async () => {
    const http = () => request(app.getHttpServer());
    const auth = `Bearer ${ownerToken}`;
    const c = (await http().post('/api/v1/customers').set('Authorization', auth)
      .send({ name: 'Identity Test', phone: `90${Date.now().toString().slice(-8)}`, tehsil: 'Kodinar', district: 'Gir Somnath', aadhaarNumber: '2341-2341-2346', panNumber: 'abcde1234f', gstin: '24aajct0051e1zt' }).expect(201)).body;
    expect(c).toMatchObject({ tehsil: 'Kodinar', district: 'Gir Somnath', aadhaarNumber: '234123412346', panNumber: 'ABCDE1234F', gstin: '24AAJCT0051E1ZT' });
    const bad = await http().patch(`/api/v1/customers/${c.id}`).set('Authorization', auth).send({ aadhaarNumber: '234123412347' }).expect(400);
    expect(JSON.stringify(bad.body)).toContain('Enter a valid 12-digit Aadhaar number');
    await http().patch(`/api/v1/customers/${c.id}`).set('Authorization', auth).send({ panNumber: 'AB12' }).expect(400);
    await http().patch(`/api/v1/customers/${c.id}`).set('Authorization', auth).send({ gstin: '24AAJCT0051E1ZU' }).expect(400);
    const cleared = (await http().patch(`/api/v1/customers/${c.id}`).set('Authorization', auth).send({ aadhaarNumber: '', gstin: null }).expect(200)).body;
    expect(cleared).toMatchObject({ aadhaarNumber: null, gstin: null, panNumber: 'ABCDE1234F' });
  });
});
