import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

// 1×1 transparent PNG
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
const uploadPath = (key: string): string => resolve(process.cwd(), 'uploads', key);

/**
 * Inventory integration/API tests. Requires Postgres up + migrated + seeded.
 * Run with: npm run test:e2e
 */
describe('Inventory (e2e)', () => {
  let app: INestApplication;
  let token: string;
  let modelId: string;
  let unitId: string;
  const vin = `E2E${Date.now()}`;
  const email = process.env.SEED_OWNER_EMAIL ?? 'owner@azadev.in';
  const password = process.env.SEED_OWNER_PASSWORD ?? 'Azad@12345';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();

    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);
    token = login.body.accessToken;

    const models = await request(app.getHttpServer())
      .get('/api/v1/inventory/models')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    modelId = models.body[0].id;
  });

  afterAll(async () => {
    if (unitId) {
      await request(app.getHttpServer())
        .delete(`/api/v1/inventory/units/${unitId}`)
        .set('Authorization', `Bearer ${token}`);
    }
    await app.close();
  });

  const bearer = (): string => `Bearer ${token}`;

  it('rejects unauthenticated access', async () => {
    await request(app.getHttpServer()).get('/api/v1/inventory/units').expect(401);
  });

  it('creates a scooter and records a genesis event', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/inventory/units')
      .set('Authorization', bearer())
      .send({
        modelId,
        variant: 'E2E-Variant',
        colour: 'TestBlue',
        vin,
        motorNumber: `MOT${Date.now()}`,
        batteryNumber: `BAT${Date.now()}`,
        purchaseCost: 10000000,
        sellingPrice: 12000000,
      })
      .expect(201);
    expect(res.body.status).toBe('AVAILABLE');
    expect(res.body.vin).toBe(vin.toUpperCase());
    unitId = res.body.id;

    const events = await request(app.getHttpServer())
      .get(`/api/v1/inventory/units/${unitId}/events`)
      .set('Authorization', bearer())
      .expect(200);
    expect(events.body).toHaveLength(1);
    expect(events.body[0].fromStatus).toBeNull();
    expect(events.body[0].toStatus).toBe('AVAILABLE');
  });

  it('rejects a duplicate VIN with 409', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/inventory/units')
      .set('Authorization', bearer())
      .send({ modelId, variant: 'E2E-Variant', colour: 'TestBlue', vin, motorNumber: 'X', batteryNumber: 'Y' })
      .expect(409);
  });

  it('validates VIN existence via check-vin', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/inventory/units/check-vin?vin=${vin}`)
      .set('Authorization', bearer())
      .expect(200);
    expect(res.body.exists).toBe(true);
  });

  it('finds the unit via search', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/inventory/units?q=${vin}`)
      .set('Authorization', bearer())
      .expect(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    expect(res.body.meta.total).toBeGreaterThanOrEqual(1);
  });

  it('rejects an illegal status transition', async () => {
    await request(app.getHttpServer())
      .patch(`/api/v1/inventory/units/${unitId}/status`)
      .set('Authorization', bearer())
      .send({ toStatus: 'DELIVERED' })
      .expect(400);
  });

  it('applies a legal status transition and appends history', async () => {
    await request(app.getHttpServer())
      .patch(`/api/v1/inventory/units/${unitId}/status`)
      .set('Authorization', bearer())
      .send({ toStatus: 'RESERVED', note: 'e2e hold' })
      .expect(200);

    const events = await request(app.getHttpServer())
      .get(`/api/v1/inventory/units/${unitId}/events`)
      .set('Authorization', bearer())
      .expect(200);
    expect(events.body).toHaveLength(2);
    expect(events.body[1].toStatus).toBe('RESERVED');
  });

  it('blocks the generic status API from marking a vehicle RETURNED (return-only path)', async () => {
    // A dedicated unit driven to IN_SERVICE, from where the transition machine allows
    // → RETURNED — but the generic API must refuse it: RETURNED is reachable only
    // through the vehicle-return workflow, so a sold vehicle can't be walked back to stock.
    const stamp = Date.now();
    const created = await request(app.getHttpServer())
      .post('/api/v1/inventory/units')
      .set('Authorization', bearer())
      .send({ modelId, variant: 'RET-Variant', colour: 'RetBlue', vin: `RET${stamp}`, motorNumber: `RMOT${stamp}`, batteryNumber: `RBAT${stamp}`, purchaseCost: 10000000, sellingPrice: 12000000 })
      .expect(201);
    const rid = created.body.id;

    await request(app.getHttpServer()).patch(`/api/v1/inventory/units/${rid}/status`).set('Authorization', bearer()).send({ toStatus: 'IN_SERVICE' }).expect(200);
    const blocked = await request(app.getHttpServer()).patch(`/api/v1/inventory/units/${rid}/status`).set('Authorization', bearer()).send({ toStatus: 'RETURNED' }).expect(400);
    expect(String(blocked.body.message)).toMatch(/vehicle-return workflow/i);

    // Clean up (IN_SERVICE → AVAILABLE is unaffected by the guard).
    await request(app.getHttpServer()).patch(`/api/v1/inventory/units/${rid}/status`).set('Authorization', bearer()).send({ toStatus: 'AVAILABLE' }).expect(200);
    await request(app.getHttpServer()).delete(`/api/v1/inventory/units/${rid}`).set('Authorization', bearer());
  });

  it('returns stats including the new unit', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/inventory/stats')
      .set('Authorization', bearer())
      .expect(200);
    expect(res.body.total).toBeGreaterThanOrEqual(1);
    expect(typeof res.body.reserved).toBe('number');
  });

  it('exports inventory as xlsx', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/inventory/units/export?format=xlsx')
      .set('Authorization', bearer())
      .expect(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
  });

  it('uploads a photo, serves it, then deletes it leaving no orphaned file', async () => {
    const upload = await request(app.getHttpServer())
      .post(`/api/v1/inventory/units/${unitId}/photos`)
      .set('Authorization', bearer())
      .attach('file', PNG_1PX, { filename: 'unit.png', contentType: 'image/png' })
      .expect(201);

    const { id: photoId, fileKey, url } = upload.body;
    expect(fileKey).toBeTruthy();
    expect(existsSync(uploadPath(fileKey))).toBe(true);

    // Served via the signed URL the API returned…
    expect(url).toContain('sig=');
    await request(app.getHttpServer()).get(url).expect(200);
    // …but an unsigned key is rejected.
    await request(app.getHttpServer())
      .get(`/api/v1/uploads/${encodeURIComponent(fileKey)}`)
      .expect(403);

    await request(app.getHttpServer())
      .delete(`/api/v1/inventory/units/${unitId}/photos/${photoId}`)
      .set('Authorization', bearer())
      .expect(204);

    // File is gone from disk — no orphan.
    expect(existsSync(uploadPath(fileKey))).toBe(false);
  });

  it('uploads and deletes a document, removing the stored file', async () => {
    const upload = await request(app.getHttpServer())
      .post(`/api/v1/inventory/units/${unitId}/documents`)
      .set('Authorization', bearer())
      .field('type', 'INVOICE')
      .attach('file', PNG_1PX, { filename: 'invoice.png', contentType: 'image/png' })
      .expect(201);

    const { id: docId, fileKey } = upload.body;
    expect(existsSync(uploadPath(fileKey))).toBe(true);

    await request(app.getHttpServer())
      .delete(`/api/v1/inventory/units/${unitId}/documents/${docId}`)
      .set('Authorization', bearer())
      .expect(204);
    expect(existsSync(uploadPath(fileKey))).toBe(false);
  });

  it('does not expose any endpoint to mutate timeline history (immutability)', async () => {
    // Only GET is defined for events; write verbs must not be routed.
    await request(app.getHttpServer())
      .post(`/api/v1/inventory/units/${unitId}/events`)
      .set('Authorization', bearer())
      .send({ toStatus: 'AVAILABLE' })
      .expect(404);
    await request(app.getHttpServer())
      .patch(`/api/v1/inventory/units/${unitId}/events`)
      .set('Authorization', bearer())
      .send({})
      .expect(404);
    await request(app.getHttpServer())
      .delete(`/api/v1/inventory/units/${unitId}/events`)
      .set('Authorization', bearer())
      .expect(404);
  });
});
