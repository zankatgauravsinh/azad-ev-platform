import { randomBytes, randomUUID } from 'crypto';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { INestApplication } from '@nestjs/common';
import { Role } from '@prisma/client';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createE2eApp, E2E_HOOK_TIMEOUT } from './support/e2e-app';
import { createTestCompany, E2E_RUN_ID, purgeRefusal, purgeTestCompany, SLUG_PREFIX, TestCompany } from './support/e2e-company';
import { companyScopedTables, fingerprint, fingerprintChanges } from './support/protected-data';

/**
 * Guards the e2e isolation rules themselves: suites never act as the seeded owner, and cleanup can only
 * ever remove a throwaway company that the calling test file created in this run — never the seeded
 * company, an unrelated company, another suite's company or another run's leftovers — and a failed
 * setup degrades to a no-op, never a broad delete.
 */
describe('E2E isolation and cleanup safety (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const own: TestCompany[] = [];
  const http = () => request(app.getHttpServer());
  /** Companies created directly (outside the helpers) by this suite, removed directly by id. */
  const direct: string[] = [];
  const createDirect = async (slug: string): Promise<string> => {
    const c = await prisma.company.create({ data: { name: `Isolation ${slug}`, slug } });
    direct.push(c.id);
    return c.id;
  };
  const totals = async (): Promise<Record<string, number>> => {
    const out: Record<string, number> = {};
    for (const t of ['Company', ...(await companyScopedTables(prisma))]) {
      out[t] = (await prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM "${t}"`))[0]!.n;
    }
    return out;
  };

  beforeAll(async () => {
    app = await createE2eApp();
    prisma = app.get(PrismaService);
  }, E2E_HOOK_TIMEOUT);

  afterAll(async () => {
    for (const c of own) await purgeTestCompany(prisma, c.id);
    // This suite's own direct companies have no rows besides the Company row itself.
    if (direct.length > 0) await prisma.$executeRawUnsafe('DELETE FROM "Company" WHERE id = ANY($1::text[])', direct);
    await app.close();
  }, E2E_HOOK_TIMEOUT);

  it('no e2e suite signs in as the seeded owner or seeds every company', () => {
    const dir = __dirname;
    const offenders = readdirSync(dir)
      .filter((f) => f.endsWith('.e2e-spec.ts') && f !== 'e2e-isolation.e2e-spec.ts')
      .flatMap((f) => {
        const src = readFileSync(join(dir, f), 'utf8');
        const hits = [/SEED_OWNER_(EMAIL|PASSWORD)/, /owner@azadev\.in/, /Azad@12345/, /azad-ev-point/, /seedRbac\(prisma\)/].filter((re) => re.test(src));
        return hits.map((re) => `${f}: ${re.source}`);
      });
    expect(offenders).toEqual([]);
  });

  it('runs suites serially and always wraps the run in the protected-data guard', () => {
    const config = JSON.parse(readFileSync(join(__dirname, 'jest-e2e.json'), 'utf8')) as Record<string, unknown>;
    expect(config.maxWorkers).toBe(1);
    expect(config.globalSetup).toBe('<rootDir>/support/global-setup.ts');
    expect(config.globalTeardown).toBe('<rootDir>/support/global-teardown.ts');
    expect(process.env.E2E_RUN_ID).toBe(E2E_RUN_ID); // set by global setup, inherited by this suite
  });

  // Checked through the pure purgeRefusal decision only: no test ever aims the destructive purge at
  // protected data, so a regression in the refusal fails here without deleting anything.
  it('refuses the seeded company (every pre-existing non-e2e company) without ever calling the purge on it', async () => {
    const protectedCompanies = await prisma.$queryRawUnsafe<{ id: string; slug: string }[]>(
      `SELECT id, slug FROM "Company" WHERE slug NOT LIKE 'e2e-%' AND NOT (id = ANY($1::text[]))`,
      direct,
    );
    for (const { id, slug } of [...protectedCompanies, { id: randomUUID(), slug: 'some-showroom' }]) {
      expect(purgeRefusal(id, slug)).toBe('not an e2e throwaway company');
      // Even under a slug that looks like one of this run's throwaways, a company this file did not create is refused.
      expect(purgeRefusal(id, `${SLUG_PREFIX}spoof-${randomBytes(3).toString('hex')}-${E2E_RUN_ID}`)).toBe('not created by this test file');
    }
  });

  it('refuses an unrelated company, another suite’s e2e company and another run’s e2e company', async () => {
    const unrelated = await createDirect(`isolation-unrelated-${randomBytes(3).toString('hex')}`);
    const otherSuite = await createDirect(`${SLUG_PREFIX}foreign-${randomBytes(3).toString('hex')}-${E2E_RUN_ID}`); // right run, not this file's
    const otherRun = await createDirect(`${SLUG_PREFIX}stale-${randomBytes(3).toString('hex')}-0ldrun00`);
    await expect(purgeTestCompany(prisma, unrelated)).rejects.toThrow(/not an e2e throwaway company/);
    await expect(purgeTestCompany(prisma, otherSuite)).rejects.toThrow(/not created by this test file/);
    await expect(purgeTestCompany(prisma, otherRun)).rejects.toThrow(/not created by this test run/);
    expect(await prisma.company.count({ where: { id: { in: [unrelated, otherSuite, otherRun] } } })).toBe(3);
  });

  it('purges exactly its own tenant — every row of A — and leaves a neighbouring tenant B untouched', async () => {
    const A = await createTestCompany(app, 'IsoA');
    const B = await createTestCompany(app, 'IsoB');
    own.push(B);
    for (const co of [A, B]) {
      await http().post('/api/v1/customers').set('Authorization', co.auth()).send({ name: `Iso ${co.tag}`, phone: `7${Date.now().toString().slice(-9)}` }).expect(201);
      await http().post('/api/v1/inventory/units').set('Authorization', co.auth())
        .send({ modelId: co.modelId, variant: 'Iso', colour: 'Grey', vin: `ISO${co.tag}`.toUpperCase(), motorNumber: `ISOM${co.tag}`, batteryNumber: `ISOB${co.tag}` }).expect(201);
    }
    const bBefore = await fingerprint(prisma, [B.id]);
    expect(bBefore.Customer!.rows).toBe(1);

    await purgeTestCompany(prisma, A.id);

    const aAfter = await fingerprint(prisma, [A.id]);
    expect(Object.entries(aAfter).filter(([, v]) => v.rows > 0)).toEqual([]); // nothing of A remains, Company row included
    expect(fingerprintChanges(bBefore, await fingerprint(prisma, [B.id]))).toEqual([]);
    await expect(purgeTestCompany(prisma, A.id)).resolves.toBeUndefined(); // already gone: a no-op
  });

  it('a failed setup never widens cleanup: missing / unknown ids are no-ops, and a half-built company stays purgeable', async () => {
    const before = await totals();
    await purgeTestCompany(prisma, undefined);
    await purgeTestCompany(prisma, '');
    await purgeTestCompany(prisma, randomUUID());
    expect(await totals()).toEqual(before);

    // Setup failing after the company row exists (an impossible role): the company is already registered…
    await expect(createTestCompany(app, 'HalfBuilt', { roles: ['NOT_A_ROLE' as Role] })).rejects.toThrow();
    const half = await prisma.company.findFirstOrThrow({ where: { slug: { startsWith: `${SLUG_PREFIX}halfbuilt-`, endsWith: `-${E2E_RUN_ID}` } } });
    // …so this file can still remove it (and nothing else); the global teardown would report it otherwise.
    expect(purgeRefusal(half.id, half.slug)).toBeNull();
    expect(purgeRefusal(randomUUID(), half.slug)).toBe('not created by this test file'); // only the registered id
    await purgeTestCompany(prisma, half.id);
    expect(await prisma.company.count({ where: { id: half.id } })).toBe(0);
  });

  it('the protected-data fingerprint detects inserts and in-place updates', async () => {
    const co = await createTestCompany(app, 'IsoFp');
    own.push(co);
    const fp0 = await fingerprint(prisma, [co.id]);
    const created = await http().post('/api/v1/customers').set('Authorization', co.auth()).send({ name: 'Fp One', phone: `6${Date.now().toString().slice(-9)}` }).expect(201);
    const fp1 = await fingerprint(prisma, [co.id]);
    expect(fingerprintChanges(fp0, fp1)).toEqual(expect.arrayContaining([expect.stringMatching(/^Customer \(rows 0 → 1\)$/)]));
    await prisma.$executeRawUnsafe('UPDATE "Customer" SET name = $1 WHERE id = $2', 'Fp Renamed', created.body.id);
    expect(fingerprintChanges(fp1, await fingerprint(prisma, [co.id]))).toEqual(['Customer (rows 1 → 1)']);
  });

  it('the fingerprint covers a company’s role-permission links (own throwaway company only)', async () => {
    const co = await createTestCompany(app, 'IsoRp');
    own.push(co);
    const before = await fingerprint(prisma, [co.id]);
    const links = before.RolePermission!.rows;
    expect(links).toBeGreaterThan(0);
    const [link] = await prisma.$queryRawUnsafe<{ roleId: string; permissionId: string }[]>(
      `SELECT rp."roleId", rp."permissionId" FROM "RolePermission" rp JOIN "AppRole" r ON r.id = rp."roleId" WHERE r."companyId" = $1 ORDER BY 1, 2 LIMIT 1`,
      co.id,
    );
    await prisma.$executeRawUnsafe('DELETE FROM "RolePermission" WHERE "roleId" = $1 AND "permissionId" = $2', link!.roleId, link!.permissionId);
    expect(fingerprintChanges(before, await fingerprint(prisma, [co.id]))).toEqual([`RolePermission (rows ${links} → ${links - 1})`]);
  });

  it('the fingerprint covers the Permission catalogue, and creating a test company leaves the catalogue unchanged', async () => {
    const catalogue = (await prisma.permission.findMany({ select: { id: true } })).map((p) => p.id);
    const catalogueBefore = await fingerprint(prisma, [], catalogue);
    own.push(await createTestCompany(app, 'IsoCat')); // re-runs seedRbac's global catalogue upsert
    expect(fingerprintChanges(catalogueBefore, await fingerprint(prisma, [], catalogue))).toEqual([]);

    // Detection is proven on a probe row this test creates and removes — never on a real catalogue row.
    const probe = await prisma.permission.create({
      data: { key: `e2e.fingerprint-probe.${E2E_RUN_ID}`, module: 'e2e', action: 'probe', label: 'E2E fingerprint probe' },
    });
    try {
      const fp0 = await fingerprint(prisma, [], [probe.id]);
      expect(fp0.Permission!.rows).toBe(1);
      await prisma.permission.update({ where: { id: probe.id }, data: { label: 'E2E fingerprint probe (changed)' } });
      expect(fingerprintChanges(fp0, await fingerprint(prisma, [], [probe.id]))).toEqual(['Permission (rows 1 → 1)']);
    } finally {
      await prisma.permission.delete({ where: { id: probe.id } });
    }
  });
});
