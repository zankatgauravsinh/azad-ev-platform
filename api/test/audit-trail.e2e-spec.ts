import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Role } from '@azad/shared';
import { PrismaService } from '../src/prisma/prisma.service';
import { createE2eApp, E2E_HOOK_TIMEOUT } from './support/e2e-app';
import { createTestCompany, purgeTestCompany, TEST_PASSWORD, TestCompany } from './support/e2e-company';

/**
 * Audit trail foundation: sign-ins (and refused ones) land in the user's own company log with IP and device;
 * every entry carries the actor's name / role, IP, user agent and request id; a write whose handler recorded
 * nothing still gets an automatic (AUTO) entry; @NoAudit routes add none; the log is append-only for the app
 * and for the database itself.
 */
describe('Audit trail (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let A: TestCompany;
  const http = () => request(app.getHttpServer());
  const UA = 'AuditProbe/1.0 (e2e)';
  const entries = (where: Record<string, unknown> = {}) => prisma.activityLog.findMany({ where: { companyId: A.id, ...where }, orderBy: { createdAt: 'asc' } });

  beforeAll(async () => {
    app = await createE2eApp();
    prisma = app.get(PrismaService);
    A = await createTestCompany(app, 'Aud', { roles: [Role.MANAGER] });
  }, E2E_HOOK_TIMEOUT);

  afterAll(async () => {
    await purgeTestCompany(prisma, A?.id);
    await app.close();
  }, E2E_HOOK_TIMEOUT);

  it('a sign-in is recorded in the user’s own company, with name, role, IP and device', async () => {
    const owner = A.user();
    const res = await http().post('/api/v1/auth/login').set('User-Agent', UA).send({ email: owner.email, password: TEST_PASSWORD }).expect(200);
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    const login = (await entries({ action: 'LOGIN', actorId: owner.id, userAgent: UA }))[0];
    expect(login).toMatchObject({ entityType: 'User', entityId: owner.id, entityLabel: owner.email, actorName: expect.any(String), actorRole: 'OWNER', source: 'USER', requestId: res.headers['x-request-id'] });
    expect(login!.ip).toBeTruthy();
  });

  it('a refused sign-in on an existing account is recorded — never the password; an unknown email is not', async () => {
    const owner = A.user();
    const before = await prisma.activityLog.count({ where: { action: 'LOGIN_FAILED' } });
    await http().post('/api/v1/auth/login').send({ email: owner.email, password: 'Wrong-Pass-123' }).expect(401);
    await http().post('/api/v1/auth/login').send({ email: `nobody-${Date.now()}@example.invalid`, password: 'x12345678' }).expect(401);
    const failed = await entries({ action: 'LOGIN_FAILED' });
    expect(failed).toHaveLength(1);
    expect(failed[0]!.summary).toContain('wrong password');
    expect(JSON.stringify(failed)).not.toContain('Wrong-Pass-123');
    expect(await prisma.activityLog.count({ where: { action: 'LOGIN_FAILED' } })).toBe(before + 1);
  });

  it('every entry from a request carries IP, device and request id; signing out is recorded', async () => {
    const res = await http().post('/api/v1/auth/logout').set('Authorization', A.auth(Role.MANAGER)).set('User-Agent', UA).expect(204);
    const out = (await entries({ action: 'LOGOUT' }))[0];
    expect(out).toMatchObject({ actorId: A.user(Role.MANAGER).id, actorRole: 'MANAGER', userAgent: UA, requestId: res.headers['x-request-id'], source: 'USER' });
    expect(out!.ip).toBeTruthy();
  });

  it('every write route records its own entry: none of this suite fell back to an automatic one (the safety net is unit-tested)', async () => {
    await http().post('/api/v1/finance/categories').set('Authorization', A.auth()).set('User-Agent', UA).send({ name: `Audit probe ${Date.now()}` }).expect(201);
    await http().post('/api/v1/warranties/generate').set('Authorization', A.auth()).expect((r) => expect(r.status).toBeLessThan(300));
    expect(await entries({ source: 'AUTO' })).toEqual([]);
    expect((await entries({ entityType: 'ExpenseCategory' }))[0]).toMatchObject({ action: 'CREATE', userAgent: UA, actorId: A.user().id });
  });

  it('a route that writes its own entry gets no extra automatic one; @NoAudit routes get none', async () => {
    const before = await prisma.activityLog.count({ where: { companyId: A.id } });
    const vendor = await http().post('/api/v1/vendors').set('Authorization', A.auth()).send({ name: 'Audit Vendor' }).expect(201);
    expect(await prisma.activityLog.count({ where: { companyId: A.id } })).toBe(before + 1);
    expect(await entries({ entityId: vendor.body.id, source: 'AUTO' })).toHaveLength(0);
    await http().patch('/api/v1/notifications/read-all').set('Authorization', A.auth()).expect((r) => expect(r.status).toBeLessThan(300));
    expect(await prisma.activityLog.count({ where: { companyId: A.id } })).toBe(before + 1);
  });

  it('the log is append-only: the app cannot change or remove an entry, nor can SQL', async () => {
    const one = (await entries())[0]!;
    await expect(prisma.activityLog.update({ where: { id: one.id }, data: { summary: 'tampered' } })).rejects.toThrow(/immutable/);
    await expect(prisma.activityLog.delete({ where: { id: one.id } })).rejects.toThrow(/immutable/);
    await expect(prisma.$executeRawUnsafe('UPDATE "ActivityLog" SET summary = $2 WHERE id = $1', one.id, 'tampered')).rejects.toThrow(/append-only/);
    await expect(prisma.$executeRawUnsafe('DELETE FROM "ActivityLog" WHERE id = $1', one.id)).rejects.toThrow(/append-only/);
    expect((await prisma.activityLog.findUniqueOrThrow({ where: { id: one.id } })).summary).toBe(one.summary);
  });
});
