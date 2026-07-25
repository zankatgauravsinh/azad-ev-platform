# Platform Foundation — single-tenant-ready architecture

Converts the app from single-dealer to **single-tenant-ready** without changing any business behaviour. One company (AZAD EV POINT) exists today; the architecture now supports many with no further schema migration. **Not** included (explicitly out of scope): subscriptions, dealer onboarding, offline sync, billing, super-admin.

## What changed

### 1. Tenant root
- **`Company`** — the tenant root (`id`, `name`, `slug`). A default company (`AZAD EV POINT`, id `a0000000-…-a2ad…`) is seeded/backfilled.
- **`Branch`** — created for future multi-branch use; one primary branch per company today. No code depends on it yet.

### 2. companyId on every business entity
`companyId` (indexed) added to all 28 tenant tables: User, Customer(+timeline/follow-ups/documents/notes), ScooterModel/Variant, InventoryUnit(+events/photos/documents), Accessory, TestRide, Booking(+documents), Quotation, Sale, FinanceDetail, InsuranceDetail, Payment, Delivery, ServiceJob, Expense, Notification, ActivityLog, CompanySetting, InvoiceSetting. Pure child/join tables (SaleItem, BookingAccessory, DeliveryChecklist, …) are scoped through their parent.
- The column has a `@default("")` sentinel so it is **optional in Prisma's create types** — the middleware (or seed) always supplies the real value, so `""` is never actually stored.
- Migration `*_platform_foundation` creates Company/Branch, inserts the default company, then for each table adds the column **nullable → backfills → sets NOT NULL** (safe on existing rows). Verified **zero drift** afterwards.

### 3. companyId in the JWT
`JwtPayload` and `AuthUser` carry `companyId`; issued at login, re-read from the DB user on every request by `JwtStrategy`.

### 4. Centralized tenant filtering (the data-access layer)
- **`TenantContext`** (`src/tenant/`) — an `AsyncLocalStorage` holder. `TenantInterceptor` binds the authenticated user's `companyId` for the whole request (subscription wrapped inside `runWith` so the store survives async).
- **Prisma middleware** (`PrismaService`) reads the context and, for tenant models:
  - reads (`findFirst/findMany/count/aggregate/groupBy`) → inject `where.companyId`;
  - `findUnique*` → converted to `findFirst*` with `companyId` (compound-unique keys like `modelId_name_colour` are flattened to field equalities first);
  - `create/createMany` → set `data.companyId`;
  - `updateMany/deleteMany` → scope `where`; `upsert` → scope `create`.
  - Single `update/delete` keep their unique `where` (Prisma requires it) and are protected by the scoped read-before-write every service already performs.
- **No tenant in context** (seed, system tasks, pre-auth user lookup) → filtering is skipped, preserving current behaviour.
- **Raw SQL bypasses middleware**, so the Dashboard's raw queries take an explicit `companyId` filter from `TenantContext`.

### 5. Company-scoped storage & audit
- `LocalStorageService` prefixes every file with `companies/<companyId>/…` (the same key prefix an S3 driver would use).
- `ActivityLog` carries `companyId`, auto-injected on create — audit trails are per-company.

## Guarantees & known limits
- Lists, counts, aggregates, searches, dashboards, and creates are all company-scoped centrally — one place, not per-query.
- Business unique keys (customer `phone`, unit `vin`, user `email`) remain **globally** unique for now (unchanged behaviour). True multi-tenant would make these composite (`@@unique([companyId, …])`); that is a deliberate future step, not needed for single-tenant readiness.

## Tests
- **Regression** — the full existing suite (auth, inventory, customers, sales, dashboard: 42 unit + 42 e2e) passes unchanged, proving AZAD EV behaviour is intact after migration.
- **Isolation** (`test/tenant-isolation.e2e-spec.ts`) — creates a second company and proves: JWTs are scoped; customers, inventory models, global search and dashboard metrics never cross tenants; cross-tenant `GET /:id` returns 404 both ways; created rows persist the correct `companyId`.
- **Unit** (`tenant-context.service.spec.ts`) — ALS binding, async preservation, concurrent isolation.

## Files
`src/tenant/{tenant-context.service,tenant.interceptor,tenant.module}.ts`, `src/prisma/prisma.service.ts` (tenant middleware), `prisma/schema.prisma` (Company, Branch, companyId), migrations `*_platform_foundation` + `*_tenant_default`.
