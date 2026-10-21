import { randomBytes } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import { seedRbac } from '../../src/common/rbac/rbac-seed';
import { PrismaService } from '../../src/prisma/prisma.service';

/**
 * Throwaway companies for e2e suites.
 *
 * A suite that works inside its own company never depends on (or grows) the seeded dev company, and
 * every assertion about counts or totals can be exact for that company alone. `purgeTestCompany`
 * hard-deletes everything the company owns, so no debris is left for later suites.
 *
 * Identification is threefold, and purge requires all three:
 *  - the slug starts with `e2e-` (the long-standing convention, kept),
 *  - the slug ends with this test run's id (E2E_RUN_ID, set by test/support/global-setup.ts),
 *  - this test FILE created the company in this process (an in-memory registry: every e2e file gets its
 *    own module instance, so one suite can never purge another suite's companies).
 * The seeded company, any company created outside these helpers and any earlier run's leftovers fail at
 * least one check, so purge refuses them before deleting anything.
 */

export const TEST_PASSWORD = 'Test@12345';

/** Every throwaway company's slug starts with this. */
export const SLUG_PREFIX = 'e2e-';

/** Identifies this test run; global-setup.ts sets it once for all suites (a fallback keeps a lone run unique). */
export const E2E_RUN_ID: string = (process.env.E2E_RUN_ID ??= randomBytes(4).toString('hex'));

/** Companies this test file created in this run: id → slug. */
const createdByThisFile = new Map<string, string>();

/**
 * Every document-number prefix with its production default. Generated numbers (prefix + counter) are
 * unique across companies, so each company gets its own prefixes: the default followed by the
 * company's tag (e.g. "JC" → "JCSALES1A2B3C-"), which keeps format checks such as /^JC/ meaningful.
 */
const DEFAULT_PREFIXES = {
  invoicePrefix: 'INV', bookingPrefix: 'BK', quotationPrefix: 'QT', receiptPrefix: 'RC', jobCardPrefix: 'JC', warrantyPrefix: 'WR',
  amcPrefix: 'AMC', claimPrefix: 'CLM', expensePrefix: 'EXP', vendorPrefix: 'VND', incomePrefix: 'INC', bankPrefix: 'BNK',
  returnPrefix: 'RET', creditNotePrefix: 'CN', refundPrefix: 'RF', rtoInvoicePrefix: 'RTO',
} as const;

export interface TestUser {
  id: string;
  email: string;
  token: string;
}

export interface TestCompany {
  id: string;
  /** Short unique tag (label + random hex) used in this company's names and document prefixes. */
  tag: string;
  /** A scooter model of this company with no variants yet (units can be created against it with variant + colour). */
  modelId: string;
  users: Partial<Record<Role, TestUser>>;
  /** The user created for `role` (OWNER by default). */
  user(role?: Role): TestUser;
  /** `Bearer <token>` for the user created for `role` (OWNER by default). */
  auth(role?: Role): string;
}

export interface TestCompanyOptions {
  /** Users to create, one per role. OWNER is always created. */
  roles?: Role[];
}

/**
 * Creates a company with a primary branch, its settings, one user per requested role (logged in through
 * the API) and one scooter model. Users get their system role exactly as production backfills them.
 */
export async function createTestCompany(app: INestApplication, label: string, options: TestCompanyOptions = {}): Promise<TestCompany> {
  const prisma = app.get(PrismaService);
  const rand = randomBytes(3).toString('hex');
  const tag = `${label}${rand}`;
  const company = await prisma.company.create({ data: { name: `E2E ${label} ${rand}`, slug: `${SLUG_PREFIX}${label.toLowerCase()}-${rand}-${E2E_RUN_ID}` } });
  createdByThisFile.set(company.id, company.slug); // registered first, so a half-built company can still be purged
  await prisma.branch.create({ data: { companyId: company.id, name: 'HQ', isPrimary: true } });
  const prefixes = Object.fromEntries(Object.entries(DEFAULT_PREFIXES).map(([field, value]) => [field, `${value}${tag.toUpperCase()}-`]));
  await prisma.companySetting.create({ data: { companyId: company.id, ...prefixes } });
  await prisma.invoiceSetting.create({ data: { companyId: company.id } });
  const model = await prisma.scooterModel.create({ data: { companyId: company.id, name: `E2E Model ${tag}`, brand: 'TESTBRAND' } });

  const roles = [...new Set<Role>([Role.OWNER, ...(options.roles ?? [])])];
  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 12);
  const created: { role: Role; id: string; email: string }[] = [];
  for (const role of roles) {
    const email = `${label.toLowerCase()}.${role.toLowerCase()}.${rand}@e2e.test`;
    const user = await prisma.user.create({ data: { companyId: company.id, name: `${label} ${role}`, email, role, passwordHash } });
    created.push({ role, id: user.id, email });
  }
  // System roles + roleId backfill, as every production user has them — for THIS company only.
  await seedRbac(prisma, { companyIds: [company.id] });

  const users: Partial<Record<Role, TestUser>> = {};
  for (const { role, id, email } of created) {
    const res = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email, password: TEST_PASSWORD });
    // A failed setup login is otherwise opaque (every test then fails): keep the response visible.
    if (res.status !== 200) throw new Error(`login for ${email} failed: ${res.status} ${JSON.stringify(res.body)}`);
    users[role] = { id, email, token: res.body.accessToken as string };
  }

  const user = (role: Role = Role.OWNER): TestUser => {
    const found = users[role];
    if (!found) throw new Error(`Test company ${tag} has no ${role} user`);
    return found;
  };
  return { id: company.id, tag, modelId: model.id, users, user, auth: (role) => `Bearer ${user(role).token}` };
}

let deleteOrder: string[] | null = null;

/** Company-scoped tables (those with a "companyId" column), children before the tables they reference. */
async function companyTablesInDeleteOrder(prisma: PrismaService): Promise<string[]> {
  if (deleteOrder) return deleteOrder;
  const tables = (await prisma.$queryRawUnsafe<{ table: string }[]>(
    `SELECT c.relname AS "table" FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = current_schema() AND c.relkind = 'r'
        AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'companyId' AND NOT a.attisdropped)`,
  )).map((r) => r.table);
  const edges = await prisma.$queryRawUnsafe<{ child: string; parent: string }[]>(
    `SELECT cl.relname AS child, pl.relname AS parent FROM pg_constraint con
       JOIN pg_class cl ON cl.oid = con.conrelid JOIN pg_class pl ON pl.oid = con.confrelid
       JOIN pg_namespace n ON n.oid = cl.relnamespace
      WHERE con.contype = 'f' AND n.nspname = current_schema() AND cl.relname <> pl.relname`,
  );
  const scoped = new Set(tables);
  const referencedBy = new Map<string, Set<string>>(tables.map((t) => [t, new Set<string>()]));
  for (const { child, parent } of edges) if (scoped.has(child) && scoped.has(parent)) referencedBy.get(parent)!.add(child);

  // Depth-first: a table is emitted only after every table that references it.
  const order: string[] = [];
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (table: string): void => {
    if (state.has(table)) return; // done, or a reference cycle (resolved by the retry passes below)
    state.set(table, 'visiting');
    for (const child of [...referencedBy.get(table)!].sort()) visit(child);
    state.set(table, 'done');
    order.push(table);
  };
  for (const table of [...tables].sort()) visit(table);
  deleteOrder = order;
  return order;
}

/** Why purgeTestCompany would refuse this company, or null when it is this file's own throwaway company. */
export function purgeRefusal(companyId: string, slug: string): string | null {
  if (!slug.startsWith(SLUG_PREFIX)) return 'not an e2e throwaway company';
  if (!slug.endsWith(`-${E2E_RUN_ID}`)) return 'not created by this test run';
  if (createdByThisFile.get(companyId) !== slug) return 'not created by this test file';
  return null;
}

/**
 * Hard-deletes a throwaway company and every row it owns. Raw SQL on purpose: several models are
 * soft-delete aware or write-once through the Prisma client. Rows of tables without a companyId all
 * hang off a company-scoped parent and go with it (cascade), or are released once it is gone.
 *
 * A missing id (setup failed before the company existed) or an already-deleted company is a no-op —
 * never a broader delete. Every statement is scoped to the one verified company id.
 */
/**
 * Deletes a company's audit entries. The audit log is append-only (a database trigger refuses DELETE); only a
 * statement that first sets azad.audit_purge for its own transaction gets through — for throwaway test companies.
 */
export const PURGE_ACTIVITY_LOG_SQL =
  `WITH purge AS (SELECT set_config('azad.audit_purge', 'on', true)) DELETE FROM "ActivityLog" WHERE ("companyId" = $1 OR "actorId" IN (SELECT id FROM "User" WHERE "companyId" = $1)) AND EXISTS (SELECT 1 FROM purge)`;

export async function purgeTestCompany(prisma: PrismaService, companyId: string | undefined): Promise<void> {
  if (!companyId) return;
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { slug: true } });
  if (!company) {
    createdByThisFile.delete(companyId);
    return;
  }
  const refusal = purgeRefusal(companyId, company.slug);
  if (refusal) throw new Error(`Refusing to purge company ${companyId}: ${refusal}`);

  let pending = await companyTablesInDeleteOrder(prisma);
  for (let pass = 0; pending.length > 0; pass += 1) {
    const failed: { table: string; error: string }[] = [];
    for (const table of pending) {
      try {
        await prisma.$executeRawUnsafe(table === 'ActivityLog' ? PURGE_ACTIVITY_LOG_SQL : `DELETE FROM "${table}" WHERE "companyId" = $1`, companyId);
      } catch (e) {
        failed.push({ table, error: (e as Error).message.split('\n').pop() ?? '' });
      }
    }
    if (failed.length === 0) break;
    if (pass >= 4 || failed.length === pending.length) {
      throw new Error(`Could not purge test company ${companyId}: ${failed.map((f) => `${f.table} (${f.error})`).join('; ')}`);
    }
    pending = failed.map((f) => f.table);
  }
  await prisma.$executeRawUnsafe('DELETE FROM "Company" WHERE id = $1', companyId);
  createdByThisFile.delete(companyId);
}
