import { createServer, type Server } from 'http';
import { AddressInfo } from 'net';
import { networkInterfaces } from 'os';
import { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { CSV_IMPORT_THROTTLED_MESSAGE } from '../src/common/throttle/throttle.config';
import { InventoryService } from '../src/modules/inventory/inventory.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { createE2eApp, E2E_HOOK_TIMEOUT } from './support/e2e-app';
import { createTestCompany, purgeTestCompany, TestCompany } from './support/e2e-company';

/**
 * Rate limiting through the real guard chain (JwtAuthGuard → ThrottlerGuard) and the real proxy trust
 * (configureHttpApp, shared with main.ts). Throttling is switched on for this suite only, AFTER setup,
 * with THROTTLE_IN_TESTS=1 (every other suite runs with throttling off, as before).
 *
 * Supertest connects over loopback, i.e. from the address nginx uses on the same host, so a request
 * with X-Forwarded-For here is what the API sees behind that proxy. A second listener on this machine's
 * LAN address provides a NON-loopback (direct, untrusted) peer.
 */
describe('Rate limiting — CSV import limits, default limit and proxy trust (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let A: TestCompany;
  let B: TestCompany;
  const http = () => request(app.getHttpServer());
  const HEADER_ONLY = Buffer.from('Model,Variant,Colour,VIN,Motor Number,Battery Number\n', 'utf8');
  const preview = (auth?: string, xff?: string) => {
    let r = http().post('/api/v1/inventory/units/import/preview');
    if (auth) r = r.set('Authorization', auth);
    if (xff) r = r.set('X-Forwarded-For', xff);
    return r.attach('file', HEADER_ONLY, 'units.csv');
  };
  const importCsv = (auth: string) => http().post('/api/v1/inventory/units/import').set('Authorization', auth).attach('file', HEADER_ONLY, 'units.csv');
  /** A cheap authenticated route covered only by the default (per-IP) throttler. */
  const checkVin = (target: ReturnType<typeof request>, xff?: string) => {
    let r = target.get('/api/v1/inventory/units/check-vin?vin=THROTTLE0001').set('Authorization', B.auth());
    if (xff) r = r.set('X-Forwarded-For', xff);
    return r;
  };
  const statuses = async (n: number, send: (i: number) => Promise<request.Response>) => {
    const out: number[] = [];
    for (let i = 0; i < n; i += 1) out.push((await send(i)).status);
    return out;
  };
  const tally = (s: number[]) => s.reduce<Record<number, number>>((acc, x) => ({ ...acc, [x]: (acc[x] ?? 0) + 1 }), {});

  beforeAll(async () => {
    app = await createE2eApp();
    prisma = app.get(PrismaService);
    A = await createTestCompany(app, 'Thr', { roles: ['MANAGER'] }); // logins happen before throttling is on
    B = await createTestCompany(app, 'ThrB');
    process.env.THROTTLE_IN_TESTS = '1';
  }, 60_000);

  afterAll(async () => {
    delete process.env.THROTTLE_IN_TESTS;
    await purgeTestCompany(prisma, A?.id);
    await purgeTestCompany(prisma, B?.id);
    await app.close();
  }, E2E_HOOK_TIMEOUT);

  afterEach(() => jest.restoreAllMocks());

  it('preview: 10 requests per minute per user succeed, the 11th is refused with 429 and is never processed', async () => {
    const svc = jest.spyOn(app.get(InventoryService), 'previewCsv');
    const first = await preview(A.auth());
    expect(first.status).toBe(200);
    expect(first.headers['x-ratelimit-limit-csvimport']).toBe('10');
    expect(first.headers['x-ratelimit-remaining-csvimport']).toBe('9');
    expect(first.headers['x-ratelimit-limit']).toBe('120'); // the default limit still applies to the route
    expect(await statuses(9, () => preview(A.auth()))).toEqual(Array(9).fill(200));
    const over = await preview(A.auth());
    expect(over.status).toBe(429);
    expect(over.body.message).toBe(CSV_IMPORT_THROTTLED_MESSAGE);
    expect(Number(over.headers['retry-after-csvimport'])).toBeGreaterThan(0);
    expect(svc).toHaveBeenCalledTimes(10); // the 11th never reached the service
  });

  it('the limit is per USER, not per IP: another user in the same company, and a user of another company, on the same IP are unaffected', async () => {
    expect((await preview(A.auth())).status).toBe(429); // A's owner is still throttled …
    expect((await preview(A.auth('MANAGER'))).status).toBe(200); // … but A's manager, same IP, is not
    expect((await preview(B.auth())).status).toBe(200);
  });

  it('forwarded headers cannot move a throttled user to a fresh bucket', async () => {
    for (const xff of ['198.51.100.50', '203.0.113.77', '10.1.2.3, 198.51.100.51']) {
      expect((await preview(A.auth(), xff)).status).toBe(429);
    }
  });

  it('import has its own per-user bucket of 10; the 11th is refused before the service runs (nothing can be imported)', async () => {
    const svc = jest.spyOn(app.get(InventoryService), 'importCsv');
    const res = await statuses(11, () => importCsv(A.auth())); // A's preview bucket is exhausted; the import bucket is not
    expect(res).toEqual([...Array(10).fill(400), 429]); // a header-only file → 400 "no rows"; the 11th never gets that far
    expect(svc).toHaveBeenCalledTimes(10);
    const last = await importCsv(A.auth());
    expect(last.body.message).toBe(CSV_IMPORT_THROTTLED_MESSAGE);
  });

  it('unauthenticated requests are rejected by authentication (401) before throttling and are never processed', async () => {
    const svc = jest.spyOn(app.get(InventoryService), 'previewCsv');
    expect(tally(await statuses(15, () => preview()))).toEqual({ 401: 15 });
    expect(svc).not.toHaveBeenCalled();
  });

  it('proxy trust: only loopback hops are trusted', () => {
    const trust = (app as NestExpressApplication).getHttpAdapter().getInstance().get('trust proxy fn') as (addr: string, i: number) => boolean;
    for (const addr of ['127.0.0.1', '127.0.0.53', '::1', '::ffff:127.0.0.1']) expect([addr, trust(addr, 0)]).toEqual([addr, true]);
    for (const addr of ['192.168.1.10', '10.0.0.1', '172.17.0.1', '198.51.100.7', '::ffff:198.51.100.7', 'fe80::1']) expect([addr, trust(addr, 0)]).toEqual([addr, false]);
  });

  it('default limit behind the loopback proxy: 120 per route per real client IP; a client-supplied X-Forwarded-For prefix is ignored', async () => {
    const via = (xff: string) => checkVin(http(), xff);
    const first = await statuses(120, () => via('198.51.100.7'));
    expect(tally(first)).toEqual({ 200: 120 });
    expect((await via('198.51.100.7')).status).toBe(429); // 121st from that client
    // What nginx forwards when the CLIENT sends X-Forwarded-For: its value, then the real address appended.
    for (const spoof of ['10.9.9.9, 198.51.100.7', '127.0.0.1, 198.51.100.7', '198.51.100.8, 198.51.100.7']) {
      const res = await via(spoof);
      expect([spoof, res.status, res.body.message]).toEqual([spoof, 429, 'ThrottlerException: Too Many Requests']);
    }
    expect((await via('198.51.100.8')).status).toBe(200); // a different real client has its own bucket
    expect((await checkVin(http())).status).toBe(200); // no header: the loopback peer itself
  });

  it('direct (non-loopback) connection: X-Forwarded-For is ignored and the peer address is the key', async () => {
    const lan = Object.values(networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal)?.address;
    if (!lan) throw new Error('no non-loopback IPv4 interface on this machine; this test needs one');
    const server: Server = createServer((app as NestExpressApplication).getHttpAdapter().getInstance());
    await new Promise<void>((resolve) => server.listen(0, '0.0.0.0', resolve));
    try {
      const direct = () => request(`http://${lan}:${(server.address() as AddressInfo).port}`);
      // 198.51.100.7 is exhausted above; if this header were believed, the request would be refused.
      const first = await checkVin(direct(), '198.51.100.7');
      expect(first.status).toBe(200);
      const rest = await statuses(119, (i) => checkVin(direct(), `203.0.113.${i % 250}`)); // a fresh fake address every time
      expect(tally(rest)).toEqual({ 200: 119 });
      expect((await checkVin(direct(), '203.0.113.251')).status).toBe(429); // all 121 counted against the one peer address
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
