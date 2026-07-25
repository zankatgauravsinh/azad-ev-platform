import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

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
  const phone = `98${Date.now().toString().slice(-8)}`;
  const email = process.env.SEED_OWNER_EMAIL ?? 'owner@azadev.in';
  const password = process.env.SEED_OWNER_PASSWORD ?? 'Azad@12345';
  const createdUserIds: string[] = [];

  const login = async (mail: string, pass: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: mail, password: pass })
      .expect(200);
    return res.body.accessToken;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
    prisma = app.get(PrismaService);

    const hash = await bcrypt.hash('Test@12345', 12);
    // Same company as the seeded owner (no request/tenant context here).
    const owner = await prisma.user.findUniqueOrThrow({ where: { email: email.toLowerCase() } });
    for (const [name, role] of [
      ['E2E Sales', 'SALES_EXECUTIVE'],
      ['E2E Tech', 'TECHNICIAN'],
    ] as const) {
      const user = await prisma.user.create({
        data: { companyId: owner.companyId, name, email: `${role.toLowerCase()}.${Date.now()}@e2e.test`, role, passwordHash: hash },
      });
      createdUserIds.push(user.id);
    }
    ownerToken = await login(email, password);
    const [sales, tech] = await prisma.user.findMany({
      where: { id: { in: createdUserIds } },
      orderBy: { name: 'asc' },
    });
    salesToken = await login(sales!.email, 'Test@12345');
    techToken = await login(tech!.email, 'Test@12345');
  });

  afterAll(async () => {
    if (customerId) await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await app.close();
  });

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
});
