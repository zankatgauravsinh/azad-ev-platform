import { randomBytes } from 'crypto';
import { writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { PrismaClient } from '@prisma/client';
import { assertLocalDatabase, e2eDatabaseUrl, fingerprint } from './protected-data';

/**
 * Runs once before all e2e suites (jest-e2e.json → globalSetup):
 *  1. refuses a non-local database,
 *  2. assigns this run's id (E2E_RUN_ID — inherited by the suites, embedded in every throwaway slug),
 *  3. fingerprints every pre-existing non-`e2e-` company (the seeded dev company included) and the
 *     existing Permission catalogue; the teardown compares and fails the run on any change.
 * Read-only: it writes nothing to the database.
 */
export default async function globalSetup(): Promise<void> {
  const url = e2eDatabaseUrl();
  assertLocalDatabase(url);
  const runId = randomBytes(4).toString('hex');
  process.env.E2E_RUN_ID = runId;

  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    const protectedIds = (await prisma.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM "Company" WHERE slug NOT LIKE 'e2e-%' ORDER BY id`)).map((r) => r.id);
    const permissionIds = (await prisma.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM "Permission" ORDER BY id`)).map((r) => r.id);
    const before = await fingerprint(prisma, protectedIds, permissionIds);
    const file = join(tmpdir(), `azad-e2e-guard-${runId}.json`);
    writeFileSync(file, JSON.stringify({ protectedIds, permissionIds, before }), { mode: 0o600 });
    process.env.E2E_GUARD_FILE = file;
    const rows = Object.values(before).reduce((n, t) => n + t.rows, 0);
    console.log(`\n[e2e guard] run ${runId}: ${protectedIds.length} protected compan${protectedIds.length === 1 ? 'y' : 'ies'}, ${rows} rows fingerprinted across ${Object.keys(before).length} tables`);
  } finally {
    await prisma.$disconnect();
  }
}
