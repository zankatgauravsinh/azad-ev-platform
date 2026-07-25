# Changelog

All notable changes to the AZAD EV POINT Showroom Management System are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the project uses semantic-ish versioning during the module build-out.

## [Unreleased]
### Planned
- Module 5 — Service.

## [Platform Foundation] — 2026-07-25
Single-dealer → single-tenant-ready architecture, with no change to current behaviour. See `docs/PLATFORM-FOUNDATION.md`.

### Added
- `Company` (tenant root) and `Branch` (future multi-branch) tables; default AZAD EV company seeded/backfilled.
- `companyId` (indexed) on all 28 business entities; `companyId` in the JWT and `AuthUser`.
- Centralized tenant filtering: `TenantContext` (AsyncLocalStorage) + `TenantInterceptor` + a Prisma middleware that scopes reads/creates/aggregates and flattens compound-unique `findUnique`s.
- Company-scoped storage (`companies/<id>/…` key prefix) and company-scoped audit logging.
- Migration that adds columns nullable → backfills → sets NOT NULL (safe on existing data; verified zero drift).
- Tenant-isolation e2e proving two companies never see each other's customers, inventory, search or dashboard; `TenantContext` unit tests.

### Unchanged
- All existing modules (Inventory, Customers, Sales, Dashboard) pass regression tests untouched — single-company behaviour is identical. Not implemented (out of scope): subscriptions, onboarding, offline sync, billing, super-admin.

## [0.5.0] — 2026-07-24
Module 4 — Dashboard (operational control center) + global search.

### Added
- **Dashboard** `/dashboard/summary`: Today's Work (deliveries, follow-ups, pending payments/finance/insurance, low inventory, overdue bookings), Business Overview (today/monthly sales & collections, inventory counts, active customers), Recent Activity (newest first), Reminders (upcoming deliveries, follow-ups, pending balance/documents), and three charts (Monthly Sales, Monthly Collections, Lead Conversion).
- **Global search** `/search?q=` across customer name, phone, VIN, booking code and invoice number, grouped and click-through (⌘K in the navbar).
- Dashboard UI: Today's Work tiles, KPI cards, lightweight SVG charts (no chart-library dep), reminders, quick actions, and the command-palette search.
- Owners/Managers land on the dashboard after login; `GET /inventory/variants` reused for quotations.
- Tests: chart gap-fill unit spec; dashboard e2e cross-checking metrics against DB totals, chart shape, recent-activity ordering, reminders and search.

### Performance
- Dashboard built from parallel aggregate/groupBy/count queries + targeted raw SQL — no N+1. Verified ~55 ms with 10k+ records (bookings/customers/units/payments), well under the 1 s target.

### Changed
- API e2e now runs serially (`maxWorkers: 1`) for deterministic shared-DB assertions.

## [0.4.0] — 2026-07-24
Module 3 — Sales Domain (the full purchase journey).

### Added
- **Quotations**: create/edit/duplicate/convert-to-booking/PDF, price breakup, exchange, finance estimate, statuses.
- **Bookings**: transaction-safe creation that allocates a specific VIN (double-allocation prevented, 409); price breakup, accessories, expected delivery.
- **Payments**: recorded with auto receipt numbers; computed PENDING/PARTIAL/PAID summary and balance.
- **Finance & Insurance**: captured per booking with status lifecycles; approval/adding records timeline events.
- **Delivery scheduling** + **mark delivered** (requires invoice + zero balance; syncs unit → Delivered).
- **Invoice generation**: creates the Sale from the booking with an invoice number.
- **Inventory sync**: Available → Booked → Delivered, with immutable inventory events; cancellation releases the VIN.
- **Customer timeline** auto-appends the full pipeline (Quotation → … → Delivered) via the shared `CustomerTimelineService` seam.
- Atomic `SequenceService` for quotation/booking/invoice/receipt numbering; `SalesPdfService` for quotation/invoice PDFs.
- `GET /inventory/variants` and `/accessories` endpoints; sales UI (quotations + bookings lists and details, pipeline action dialogs).
- Tests: pricing + payment-summary unit specs; sales e2e covering reservation conflicts, double allocation, payment calc, finance, cancellation, timeline generation, inventory sync.

### Changed
- Finance/Insurance/Payments now attach to the **Booking** (Sale is the generated invoice).
- `QuotationStatus` uses `CANCELLED` (was `REJECTED`); `CustomerEventType` adds `INSURANCE_ADDED` / `INVOICE_GENERATED`.

## [0.3.0] — 2026-07-23
Module 2 — Customer Domain (the central profile entity).

### Added
- **Customer profile** with tabs: Overview, Timeline, Documents, Bookings, Payments, Deliveries, Service, Warranty, Notes, Activity Log.
- Overview fields incl. state/PIN/occupation/DOB/gender/preferred model-colour-finance and lost reason; `INTERESTED` lead status.
- **Immutable auto-generated timeline** (`CustomerTimelineEntry`) with type filtering and an exported `CustomerTimelineService` seam for later modules.
- **Follow-ups** (priority/reminder/complete/cancel) and dashboard **reminder generation** (overdue/today/upcoming).
- **Documents folder** with preview/download/replace/delete; **notes** with edit history (`CustomerNoteRevision`).
- **Lead management** (New→…→Won/Lost, Lost reason stored); **search** by name/mobile/VIN/booking/invoice.
- Customer feature UI: list with lead-status stats, tabbed detail, form/status/interaction dialogs, timeline, follow-ups, notes, documents panels.
- Tests: customer + follow-up unit specs; customers e2e (permissions, CRUD, search, timeline, documents, notes history, follow-up reminders, immutability).

### Fixed
- Soft-delete middleware now also filters `count` / `aggregate` / `groupBy`, so soft-deleted rows no longer inflate stats or pagination totals (corrects Inventory counts too).

### Removed
- Unused `CustomerInteraction` table / `InteractionType` enum (superseded by the timeline).

### Hardened (Module 1 quality pass)
- Swagger request examples + response codes on all 20 inventory endpoints.
- Upload rollback: a failed DB insert after saving a file removes the file (no orphans); photo/document delete removes the stored file too — verified on disk in e2e.
- Export cap raised to 100,000; verified xlsx/pdf export of 10,050 records with no truncation.
- Added exhaustive status-transition matrix test (36 pairs) and e2e tests for media delete + timeline immutability.
- Confirmed duplicate VIN is enforced by a DB unique index (race-safe: concurrent duplicates → 409, not 500).

## [0.2.0] — 2026-07-23
Module 1 — Inventory (first business module).

### Added
- **Inventory dashboard** — status counts + widgets (Low Inventory, Recently Added, Reserved, Ready for Delivery).
- **Scooter CRUD** — add/edit/soft-delete with Model, Variant, Colour (+ hex), VIN, Motor/Battery numbers, Purchase Date/Cost, Selling Price, Supplier, Location, Notes.
- **Operations** — server-side search, filter (status/model/supplier), sort, pagination; bulk CSV import (per-row validation + error report); Excel/PDF export; print.
- **VIN** — manual entry, camera QR/barcode scan (ZXing), live duplicate validation.
- **Status timeline** — append-only `InventoryEvent` history with enforced transitions (`UNIT_STATUS_TRANSITIONS`); added `RETURNED` status.
- **Detail page** — info, timeline, bookings/sales, service history, documents & photos (uploads via `StorageService`, served from `/uploads/:key`).
- **Reusable UI** — DataTable, StatCard, PageHeader, EmptyState, ConfirmDialog, Dialog/Select/Tabs/Table/Badge/Textarea/Skeleton primitives, VinScanner.
- **Tests** — inventory service unit tests, inventory e2e (13), DataTable UI test.
- **Docs** — `docs/modules/1-inventory.md`; updated database design + API docs (Swagger).

### Changed
- Module order revised (user request): Inventory → Customers → Bookings → Sales & Payments → Dashboard → Service → Reports.
- Moved the BigInt→JSON serializer into an `AppModule` side-effect so it applies in tests too.
- Removed unused API devDeps (`ts-loader`, `source-map-support`, `tsconfig-paths`).

## [0.1.0] — 2026-07-23
First delivered increment: project foundation and authentication.

### Added
- **Monorepo** (npm workspaces): `packages/shared`, `api` (NestJS), `web` (React 19 + Vite); Postgres via `docker-compose`.
- **Shared package** `@azad/shared`: all domain enums + Zod contracts (auth, pagination, API error envelope).
- **Database**: full Prisma schema for every module (32 models), initial migration, idempotent seed (company, invoice settings, Owner user, Comptech VX1/VZ1/MARS models). Audit fields (`createdById`/`updatedById`), soft delete, activity log.
- **API foundation**: Zod-validated env config, `PrismaService` with soft-delete middleware, `StorageService` seam + `LocalStorageService` (S3-ready), `ActivityLogService` audit writer, global `JwtAuthGuard` → `ThrottlerGuard` → `RolesGuard`, `AllExceptionsFilter` (consistent error envelope), `LoggingInterceptor`, `ZodValidationPipe`, `helmet` + CORS.
- **Auth**: `POST /auth/login`, `POST /auth/refresh` (rotated), `POST /auth/logout`, `GET /auth/me`, `PATCH /auth/password`; JWT access (15m) + refresh (7d, hashed at rest), bcrypt passwords.
- **Health**: public `GET /health` with DB check.
- **API docs**: Swagger UI at `/api/docs` (OpenAPI JSON at `/api/docs-json`) with bearer auth.
- **Web foundation**: Tailwind + brand tokens (Navy/Teal/Gold, Poppins), light/dark theme, shadcn primitives, app shell (role-aware sidebar with "Soon" states, topbar, mobile drawer), axios client with single-flight token refresh, `AuthProvider` + route guards, login page, account page (profile + working change-password).
- **Docs**: PRD, user flows, database design, folder structure, API design, UI wireframes, roadmap (`docs/`), `ARCHITECTURE.md`, `docs/UI-COMPONENTS.md`, `docs/modules/0-foundation.md`, `README.md`.
- **Tests**: API unit (auth service, Zod pipe) + e2e (auth flow); web unit (money helpers, BrandMark component).

### Notes
- Package manager is **npm workspaces** (not pnpm) — documented in `docs/04-FOLDER-STRUCTURE.md`.
- GST is fully configurable in Settings (default OFF); VIN QR/barcode scanning is planned for Booking + Delivery (Modules 5 & 7).
