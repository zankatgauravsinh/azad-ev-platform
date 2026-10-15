import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createE2eApp, E2E_HOOK_TIMEOUT } from './support/e2e-app';
import { createTestCompany, purgeTestCompany, TEST_PASSWORD, TestCompany } from './support/e2e-company';

/**
 * End-to-end auth flow, as the OWNER of a throwaway company (never the seeded owner).
 * Requires a migrated local Postgres. Run with: npm run test:e2e
 */
describe('Auth (e2e)', () => {
  let app: INestApplication;
  let co: TestCompany;
  let email = '';
  const password = TEST_PASSWORD;

  beforeAll(async () => {
    app = await createE2eApp();
    co = await createTestCompany(app, 'Auth');
    email = co.user().email;
  }, E2E_HOOK_TIMEOUT);

  afterAll(async () => {
    await purgeTestCompany(app.get(PrismaService), co?.id);
    await app.close();
  }, E2E_HOOK_TIMEOUT);

  it('GET /health is public and reports status', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    expect(res.body.status).toBe('ok');
  });

  it('GET /auth/me without a token is rejected', async () => {
    await request(app.getHttpServer()).get('/api/v1/auth/me').expect(401);
  });

  it('POST /auth/login → GET /auth/me with the issued token', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);

    expect(login.body.accessToken).toBeDefined();
    expect(login.body.refreshToken).toBeDefined();
    expect(login.body.user.email).toBe(email.toLowerCase());

    const me = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .expect(200);

    expect(me.body.role).toBe('OWNER');
  });

  it('POST /auth/login with wrong password is rejected', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: 'wrong-password' })
      .expect(401);
  });
});
