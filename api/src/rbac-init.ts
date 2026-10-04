import { PrismaClient } from '@prisma/client';
import { seedRbac } from './common/rbac/rbac-seed';

/**
 * Production-safe RBAC initializer. Run it AFTER `prisma migrate deploy`, on every deploy, as
 * compiled JavaScript — it does NOT depend on `ts-node`:
 *
 *   cd api && node dist/rbac-init.js        # i.e. `npm run rbac:init`
 *
 * It reuses the same idempotent `seedRbac` used by the dev seed and the e2e suite to:
 *   - upsert the global Permission catalog,
 *   - upsert the five locked system roles (+ their permission bundles) for every company,
 *   - backfill each user's `roleId` from the legacy `role` enum, within their own company.
 *
 * Unlike `prisma/seed.ts` it creates NO demo/sample data (no company, user, scooter model, or
 * spare-part rows) and does not boot the Nest application, so none of that dev seeding can run
 * against production. It is safe to run repeatedly: a second run creates nothing new and backfills
 * zero users.
 *
 * It uses a bare PrismaClient (no tenant middleware): `seedRbac` iterates every company and sets
 * `companyId` explicitly, so it must see all companies rather than a single request's tenant.
 */
async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const r = await seedRbac(prisma);
    console.log(
      `[rbac-init] done — ${r.permissions} permissions, ${r.rolesUpserted} system roles across ` +
        `${r.companies} company(ies), ${r.rolePermissions} role-permission links, ` +
        `${r.usersBackfilled} user(s) backfilled`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('[rbac-init] FAILED:', err);
  process.exitCode = 1;
});
