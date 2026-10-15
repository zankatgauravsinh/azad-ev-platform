import { readFileSync, rmSync } from 'fs';
import { PrismaClient } from '@prisma/client';
import { e2eDatabaseUrl, fingerprint, fingerprintChanges, type Fingerprint } from './protected-data';

/**
 * Runs once after all e2e suites (jest-e2e.json → globalTeardown). Fails the run when
 *  - any protected (pre-existing, non-`e2e-`) company's rows changed, or
 *  - a throwaway company created by this run was left behind.
 * Read-only: it reports, it never cleans anything up.
 */
export default async function globalTeardown(): Promise<void> {
  const file = process.env.E2E_GUARD_FILE;
  const runId = process.env.E2E_RUN_ID;
  if (!file || !runId) throw new Error('[e2e guard] global setup did not run; the protected-data check could not be made');
  const { protectedIds, permissionIds, before } = JSON.parse(readFileSync(file, 'utf8')) as {
    protectedIds: string[];
    permissionIds: string[];
    before: Fingerprint;
  };

  const prisma = new PrismaClient({ datasources: { db: { url: e2eDatabaseUrl() } } });
  try {
    const after = await fingerprint(prisma, protectedIds, permissionIds);
    const changed = fingerprintChanges(before, after);
    const leftovers = await prisma.$queryRawUnsafe<{ slug: string }[]>(`SELECT slug FROM "Company" WHERE slug LIKE 'e2e-%' AND slug LIKE $1`, `%-${runId}`);
    const problems: string[] = [];
    if (changed.length > 0) problems.push(`protected (seeded / pre-existing) data changed: ${changed.join('; ')}`);
    if (leftovers.length > 0) problems.push(`${leftovers.length} throwaway compan${leftovers.length === 1 ? 'y' : 'ies'} of this run left behind: ${leftovers.map((l) => l.slug).join(', ')}`);
    if (problems.length > 0) throw new Error(`[e2e guard] run ${runId} FAILED — ${problems.join(' | ')}`);
    console.log(`[e2e guard] run ${runId}: protected company data unchanged; no throwaway companies left behind`);
  } finally {
    await prisma.$disconnect();
    rmSync(file, { force: true });
  }
}
