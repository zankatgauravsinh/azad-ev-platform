# Production Readiness Report — AZAD EV POINT

**Date:** 2026-07-28 · **Scope:** hardening pass over all shipped modules (Auth, Company Settings, Dashboard, Inventory, Customers, Sales, Service) before Module 6. **No new business features added.**

> Every claim below was **verified** against code and a running instance (schema reads, endpoint calls, a seeded 100k-row benchmark, and a backup/restore round-trip) — not assumed.

## Score: **92 / 100 — Production-ready for the single-showroom launch**

Zero critical issues. The app is safe to open on 15 August via the verified **systemd + nginx + nightly-backup** path. The remaining items are one MAJOR (only relevant if the app is ever exposed to the public internet or made multi-tenant) and a few MINOR performance/ops notes.

| Area | Verdict |
|---|---|
| Authentication & sessions | ✅ Strong |
| Authorization / RBAC / tenant isolation | ✅ Strong (6 isolation e2e) |
| Input validation / mass assignment | ✅ Strong |
| Error handling & HTTP codes | ✅ Strong |
| Database schema / indexes / soft delete | ✅ Strong |
| Performance @ 100k rows | ✅ All hot paths < 200 ms |
| Config / secrets management | ✅ Fixed this pass |
| Frontend resilience | ✅ Fixed this pass |
| Deployment / backups / ops | ✅ Artifacts added + backup verified |
| File access to sensitive docs | ⚠️ Major (LAN-safe; fix before public hosting) |

---

## What changed this pass (all verified)

| # | Change | Why | File(s) |
|---|--------|-----|---------|
| 1 | **Boot guard rejects insecure production config** — example JWT secrets, reused access/refresh secret, secrets < 32 chars, or the seeded owner password all abort startup when `NODE_ENV=production`. | The #1 real deployment mistake is shipping `change-me…` secrets → trivial JWT forgery. | `api/src/config/env.ts` (+6 unit tests `env.spec.ts`) |
| 2 | **Strict auth rate limits** — login 10/min, refresh 20/min per IP (global stays 120/min); throttling skipped under `NODE_ENV=test`. | The global 120/min was too loose for credential brute-forcing. | `api/src/app.module.ts`, `api/src/auth/auth.controller.ts` |
| 3 | **Refresh session revoked on password change.** | A leaked refresh token previously survived a password change. | `api/src/auth/auth.service.ts` |
| 4 | **`main.ts`: bind the validated `API_PORT`; Swagger only in non-production.** | Listen ignored validated config; `/api/docs` exposed the full API surface in prod. | `api/src/main.ts` |
| 5 | **React `ErrorBoundary`** wraps the app — a render error shows a recoverable fallback instead of a white screen. | No error boundary existed; any component throw blanked the whole UI. | `web/src/components/common/error-boundary.tsx`, `web/src/App.tsx` |
| 6 | **Verified backup + restore scripts** (compressed `pg_dump`, 14-day retention, single-transaction restore). Caught & fixed a real bug: `pg_dump` rejects Prisma's `?schema=` param. | No backup tooling existed for a business opening in weeks. | `scripts/backup.sh`, `scripts/restore.sh` |
| 7 | **Deployment artifacts** — `api/Dockerfile`, `deploy/nginx.conf`, systemd units (`azad-api`, nightly `azad-backup` timer), and a full `docs/DEPLOYMENT.md` runbook. | No Docker/nginx/PM2/systemd/HTTPS/backup guidance existed. | `deploy/*`, `api/Dockerfile`, `docs/DEPLOYMENT.md` |

---

## Audit findings by area

### 1. API — ✅
- Every mutation is Zod-validated via `ZodValidationPipe`; Zod **strips unknown keys**, and no schema uses `.passthrough()` → **no mass-assignment**. Verified by grep across `packages/shared`.
- `AllExceptionsFilter` maps Prisma errors to correct codes — **P2002 → 409**, **P2025 → 404**, **P2003 → 400** — and returns a generic message for 5xx (no internal leakage); stack traces are logged server-side only.
- Duplicate-generation and race paths are guarded (e.g. invoice generation 409; VIN allocation uses a status-checked transaction → double-allocation 409). Covered by e2e.
- Pagination/sort/search are consistent (`buildPageMeta`, `page/pageSize/sort/order`); deep pagination (page 500) verified at 56 ms.

### 2. UI — ✅ (with new error boundary)
- Loading (skeletons), empty (`EmptyState`), and error (toasts) states are present across screens; confirm dialogs guard destructive actions; success toasts on mutations.
- Dark mode + responsive layouts verified earlier; login → app render verified this pass post-ErrorBoundary.

### 3. Workflows — ✅
- Quotation → Booking → Payment → Finance → Insurance → Invoice → Delivery and the Service pipeline are transaction-safe and **survive refresh** (state is server-derived). Duplicate clicks are handled by 409/idempotent reads (e.g. invoice PDF re-renders the immutable Sale).

### 4. Security — ✅ / ⚠️
- **JWT**: separate access (15m) / refresh (7d) secrets, HS256, refresh **rotation** + bcrypt-hashed storage, `isActive` checks, generic auth errors (no user enumeration).
- **Passwords**: bcrypt, 12 rounds.
- **Path traversal**: `LocalStorageService.absolutePath` resolves within `baseDir` and rejects escapes — verified not exploitable.
- **Helmet**, origin-scoped **CORS**, shutdown hooks.
- ⚠️ **MAJOR — unauthenticated file serving.** `/uploads/:key` is `@Public` (so `<img>` works). Keys are unguessable UUIDs, but KYC docs (Aadhaar/PAN) are served without a per-request auth check. **Acceptable on a private showroom LAN; must move to signed URLs / token-gated serving before any public or multi-tenant hosting.**

### 5. Database — ✅
- Comprehensive `@@index` coverage on hot columns (verified: `Payment.paidAt`, `CustomerTimelineEntry(customerId, occurredAt)`, `Sale.invoicedAt`, `CustomerFollowUp(status, dueAt)`, unit `status`/`variantId`, `companyId` everywhere).
- Soft-delete middleware covers read/**count/aggregate/groupBy** (prevents inflated stats). FKs use appropriate `onDelete` (Cascade for children, Restrict for units).
- MINOR: no composite `(context, paidAt)` on `Payment`; negligible at real scale.

### 6. Performance — ✅ (measured, not assumed)
Seeded **100,000 customers · 50,000 units · 100,000 timeline events**, then measured (warm):

| Endpoint | Time |
|---|---|
| `GET /dashboard/summary` (all aggregates) | **67 ms** |
| `GET /customers` (list, page 1) | 40 ms |
| `GET /customers?q=` name search | 55 ms |
| `GET /customers?q=` phone search | 49 ms |
| `GET /customers` page 500 (deep) | 56 ms |
| `GET /inventory/units` (list) | 12 ms |
| `GET /inventory/units?q=` VIN substring | 115 ms |
| `GET /search?q=` (global, VIN) | 134 ms |

All under 200 ms at 5–10× a real dealership's lifetime data. **Slowest paths** are VIN/global **substring** search (`ILIKE '%…%'` → sequential scan). MINOR recommendation: add a `pg_trgm` GIN index on `vin`/`name` **only if** unit count ever exceeds ~200k — premature now.

### 7. Offline-future readiness — ✅ architecture only (not built, per instruction)
- Clean API/data-access seams: all persistence behind services + a Prisma middleware; storage behind a `StorageService` interface (S3-ready); tenant scoping centralized. These are the right seams for a future SQLite/Capacitor/PWA sync engine. No offline code exists yet (confirmed) — and none was added.

### 8. Deployment — ✅ (added this pass)
- Was: only a Postgres `docker-compose.yml`, no app Dockerfile/nginx/PM2/backup.
- Now: `api/Dockerfile`, `deploy/nginx.conf` (HTTPS-ready), systemd units for the API and a nightly backup timer, verified backup/restore scripts, and `docs/DEPLOYMENT.md` with a go-live checklist. Health check (`/api/v1/health`, DB-probing) already existed.
- Note: the Docker image is reviewed but **not** built in this sandbox (no Docker daemon); build it in CI/host first. The systemd + nginx path is fully specified and the backup path is runtime-verified.

### 9. Code quality — ✅
- `strict` + `noUncheckedIndexedAccess` on api, web, and base tsconfig. **0 lint warnings**, **0 TypeScript errors** across all workspaces. Feature-sliced structure, consistent naming, no dead modules found.

---

## Risk assessment

| Risk | Likelihood | Impact | Status |
|---|---|---|---|
| Deploy with default secrets | ~~High~~ | Critical | **Eliminated** — boot guard |
| Credential brute-force | Medium | High | **Mitigated** — strict login throttle |
| White-screen on UI error | Medium | Medium | **Eliminated** — ErrorBoundary |
| Data loss (no backups) | ~~High~~ | Critical | **Eliminated** — verified nightly backups |
| KYC doc exposure if internet-facing | Low (LAN) | High | **Open** — documented; fix before public hosting |
| Search latency at >200k units | Low | Low | **Open** — pg_trgm recommendation |

**Overall: LOW risk** for the intended single-showroom, private-network deployment.

## Verdict
**Zero critical issues.** Cleared to proceed to Module 6 after this pass. Address the one MAJOR (file-access auth) before any internet-facing or multi-tenant/SaaS deployment.

## Test counts (all green)
- API unit: **62** (was 56; +6 config-guard tests)
- API e2e: **78** (8 suites) — unchanged, all still passing
- Web unit: **9**
- Lint: 0 warnings (api + web) · TypeScript: 0 errors · builds: clean
