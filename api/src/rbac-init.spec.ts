import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * C1 — the production RBAC initializer must be runnable on a prod box without dev tooling and must
 * never carry demo seeding. This guards the *command path* (entry point + package script) so a
 * future edit can't quietly reintroduce a `ts-node` / demo-seed dependency. The RBAC logic itself
 * (fresh init, bundles, backfill, idempotency, multi-company, demo-free data) is proven against a
 * real database in `test/rbac-seed.e2e-spec.ts`.
 */
describe('rbac-init (production RBAC initializer)', () => {
  const src = readFileSync(join(__dirname, 'rbac-init.ts'), 'utf8');
  const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')) as { scripts: Record<string, string> };

  it('runs as compiled node (no ts-node / dev-only dependency)', () => {
    // No ts-node import/require (a mention in the doc comment is fine); it runs as compiled JS.
    expect(src).not.toMatch(/(from|require)\s*\(?\s*['"][^'"]*ts-node/);
    expect(pkg.scripts['rbac:init']).toBe('node dist/rbac-init.js');
  });

  it('delegates to the shared idempotent seedRbac', () => {
    expect(src).toContain("from './common/rbac/rbac-seed'");
    expect(src).toContain('seedRbac(prisma)');
    expect(src).toContain("from '@prisma/client'");
  });

  it('does not import the Nest app or seed any demo data', () => {
    expect(src).not.toMatch(/app\.module|NestFactory/); // no Nest bootstrap
    expect(src).not.toMatch(/\b(company|user|scooterModel|sparePart|customer)\.(create|upsert)\b/i);
    expect(src).not.toContain('./prisma/seed'); // never reuses the dev seed
  });

  it('fails loudly (non-zero exit) when seeding throws', () => {
    expect(src).toMatch(/process\.exitCode\s*=\s*1/);
  });
});
