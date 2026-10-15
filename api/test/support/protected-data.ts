import { readFileSync } from 'fs';
import { PrismaClient } from '@prisma/client';

/*
 * The run-level guard behind test/support/global-setup.ts and global-teardown.ts: every company that
 * existed before the e2e run (the seeded dev company and anything else that is not an `e2e-` throwaway)
 * is "protected". Its rows in every company-scoped table, its roles' permission links and its Company
 * row — plus the global Permission catalogue as it stood before the run — are fingerprinted before the
 * run and again after it; any difference fails the run. Only counts and hashes are stored — never row
 * contents or credentials.
 */

/** The database the e2e app will use: the environment, else DATABASE_URL in ./.env (what ConfigModule loads). */
export function e2eDatabaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  let text = '';
  try {
    text = readFileSync('.env', 'utf8');
  } catch {
    throw new Error('E2E: DATABASE_URL is not set and ./.env cannot be read (run the e2e suite from api/)');
  }
  const line = text.split(/\r?\n/).find((l) => /^DATABASE_URL=/.test(l));
  if (!line) throw new Error('E2E: no DATABASE_URL in ./.env');
  return line.slice('DATABASE_URL='.length).trim().replace(/^"(.*)"$/, '$1');
}

/** e2e suites create and purge data: refuse anything but a database on this machine. Never prints the URL. */
export function assertLocalDatabase(url: string): void {
  let parsed: URL;
  try {
    // A socket URL (postgresql://user@/db?host=/tmp) has an empty host, which URL rejects: give it a placeholder.
    parsed = new URL(url.replace(/^(postgres(?:ql)?:\/\/(?:[^@/]*@)?)\//, '$1socket.invalid/'));
  } catch {
    throw new Error('E2E: DATABASE_URL is not a valid URL');
  }
  const socket = parsed.searchParams.get('host');
  const host = parsed.hostname.replace(/^\[(.*)\]$/, '$1');
  const local = socket ? socket.startsWith('/') : ['localhost', '127.0.0.1', '::1'].includes(host);
  if (!local) throw new Error(`E2E: refusing to run against a non-local database host (${host || socket}); e2e tests may only use a database on this machine`);
}

export interface Fingerprint {
  [table: string]: { rows: number; hash: string };
}

/** Company-scoped tables (those with a "companyId" column), sorted. */
export async function companyScopedTables(prisma: PrismaClient): Promise<string[]> {
  const rows = await prisma.$queryRawUnsafe<{ table: string }[]>(
    `SELECT c.relname AS "table" FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = current_schema() AND c.relkind = 'r'
        AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'companyId' AND NOT a.attisdropped)
      ORDER BY 1`,
  );
  return rows.map((r) => r.table);
}

/**
 * Row count and a hash of the exact row contents, per table, for the given companies (read-only): their
 * Company rows, every company-scoped table and the RolePermission links of their roles. With
 * `permissionIds`, also those rows of the global Permission catalogue (rows added later are not covered:
 * seedRbac may legitimately add catalogue entries; changing or removing an existing one is detected).
 */
export async function fingerprint(prisma: PrismaClient, companyIds: string[], permissionIds?: string[]): Promise<Fingerprint> {
  const out: Fingerprint = {};
  const measure = async (table: string, where: string, ids: string[]): Promise<void> => {
    const [r] = await prisma.$queryRawUnsafe<{ rows: number; hash: string }[]>(
      `SELECT count(*)::int AS rows, coalesce(md5(string_agg(t::text, '|' ORDER BY t::text)), '') AS hash
         FROM "${table}" t WHERE ${where}`,
      ids,
    );
    out[table] = { rows: r!.rows, hash: r!.hash };
  };
  await measure('Company', 't."id" = ANY($1::text[])', companyIds);
  for (const table of await companyScopedTables(prisma)) await measure(table, 't."companyId" = ANY($1::text[])', companyIds);
  // Role-permission links have no companyId: they belong to a company through its roles.
  await measure('RolePermission', 't."roleId" IN (SELECT r.id FROM "AppRole" r WHERE r."companyId" = ANY($1::text[]))', companyIds);
  if (permissionIds) await measure('Permission', 't."id" = ANY($1::text[])', permissionIds);
  return out;
}

/** Tables whose rows differ between two fingerprints, with their row counts. */
export function fingerprintChanges(before: Fingerprint, after: Fingerprint): string[] {
  const tables = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  return tables
    .filter((t) => before[t]?.hash !== after[t]?.hash || before[t]?.rows !== after[t]?.rows)
    .map((t) => `${t} (rows ${before[t]?.rows ?? 'absent'} → ${after[t]?.rows ?? 'absent'})`);
}
