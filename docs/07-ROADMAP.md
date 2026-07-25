# AZAD EV POINT — 7. Development Roadmap

Built **module by module**. Each module ships end-to-end (DB → API → UI → wired & runnable) and is delivered in its **own response** for your approval before the next begins. No mock data; every module is production-ready when handed over.

---

## Delivery principle
> One complete module per response. After you approve a module, I start the next. Foundation (Module 0) must land first because every feature depends on it.

## Revised module order (2026-07-23)
Core business modules are built **before** the Dashboard so it shows real production data, not placeholders:
1. **Inventory** → 2. **Customers** → 3. **Bookings** → 4. **Sales & Payments** → 5. **Dashboard** → 6. **Service** → 7. **Reports**.
(Module 0 Foundation + Auth already delivered.) The sections below describe scope per module; the numbering above governs order.

## Module sequence

**Module 0 — Foundation & Scaffolding**
- Monorepo (pnpm workspaces), `docker-compose` Postgres, `.env`, shared package.
- **API:** Nest app, Prisma schema (full, from §3), first migration, seed (company, VX1/VZ1/MARS, Owner user, accessories, invoice series), PrismaService + soft-delete middleware, config module, StorageService (local, S3-ready), common guards/filters/interceptors/pipes, health check.
- **Web:** Vite + React 19 + TS strict, Tailwind + brand tokens, shadcn init, app shell (sidebar/topbar/theme/mobile nav), router skeleton, React Query + axios client, auth provider.
- **Auth (cross-cutting, included here):** login/refresh/logout/me/password, JWT strategies, RolesGuard, login page + protected routes.
- ✅ *Exit:* run `pnpm dev`, log in as Owner, see empty shell + seeded data.

**Module 1 — Dashboard** — minimal: Today's Sales/Collections, Available Inventory, Pending Deliveries/Payments, Service Due, Quick Actions, Recent Activity, single Monthly Sales chart. Live queries that fill in as later modules add data.

**Module 2 — Customers** — CRUD, search, timeline, notes, Aadhaar/DL upload, lead status. *(First full CRUD+upload vertical — sets the pattern.)*

**Module 3 — Inventory** — models, variants, units, status lifecycle + guarded transitions, search/filters, unit detail.

**Module 4 — Test Ride** — booking, assign exec/unit (reserve), feedback, status, convert→booking.

**Module 5 — Booking** — stepper, accessories, finance/insurance flags, advance payment, documents, cancel/convert (transactional). Includes **VIN QR/barcode scan** to select the unit on mobile (manual search fallback).

**Module 6 — Sales** — quotation builder, convert, invoice numbering, discount/accessories, finance & insurance details, payments/ledger, print/PDF invoice.

**Module 7 — Delivery** — checklist, photos, customer photo + signature pad, balance gate + override, Google review reminder. Includes **VIN scan to verify** the correct unit is being handed over.

**Module 8 — Service** — job, complaint, technician, parts, labour, warranty logic, service history, service-due.

**Module 9 — Expenses** — categorised CRUD, receipts, summary.

**Module 10 — Reports** — Sales, Expenses, Profit, Inventory, Pending Payments, Service (only these six) + PDF & Excel export on each.

**Module 11 — Settings** — profile, users mgmt, password, company details, invoice settings (**configurable GST: tax rate + GSTIN + showGst toggle, default OFF**), backup (SQL dump).

**Module 12 — Cross-cutting polish** — global search, notifications centre, activity-log viewer, empty/loading/error states, mobile QA, dark-mode QA, accessibility pass.

## Dependency order (why this sequence)
```
0 Foundation ─┬─ 2 Customers ─┬─ 4 Test Ride ─ 5 Booking ─ 6 Sales ─ 7 Delivery
              │               └─ 8 Service
              ├─ 3 Inventory ─(feeds 4,5,6,7,8)
              ├─ 9 Expenses
              └─ 1 Dashboard / 10 Reports (aggregate the above)
                 11 Settings · 12 Polish (last)
```
Dashboard (1) is placed early for the shell but its numbers become meaningful as 2–9 land; its queries are real from day one.

## Per-module definition of done (ALL required before the next module starts)
- **Backend** — controllers/services/repositories/DTOs, Zod validation, RolesGuard, transactions on multi-row ops, indexes, activity-log + audit (`createdById`/`updatedById`) + notifications where relevant.
- **Frontend** — reusable components only (no duplication), responsive, dark-mode, keyboard-friendly, loading/empty/error states.
- **Validation** — shared Zod schemas web↔api.
- **Database** — migration committed; seed updated if needed.
- **Tests** — API unit + e2e for the module's endpoints/business rules; web component/hook tests for critical logic. Green before handover.
- **Documentation** — a `docs/modules/<n>-<name>.md` covering endpoints, screens, permissions, and "how to test this module".
- **Quality bar** — strict TS, no `any`, no TODOs, no placeholder components, no mock implementations. Runs locally end-to-end.

## Environment & run (from Module 0)
```
docker compose up -d        # postgres
pnpm install
pnpm --filter api prisma:migrate && pnpm --filter api prisma:seed
pnpm dev                    # api :3000, web :5173
```

## Estimated shape (not calendar promises)
| Module | Relative size |
|---|---|
| 0 Foundation+Auth | L |
| 2 Customers, 6 Sales, 7 Delivery, 8 Service | L |
| 3 Inventory, 5 Booking, 10 Reports | M |
| 1 Dashboard, 4 Test Ride, 9 Expenses, 11 Settings | S–M |
| 12 Polish | M |

---

## ✅ Approval gate
This completes deliverables **1–7**. On your go-ahead I will build **Module 0 (Foundation & Auth)** and deliver it in the next response, then pause for approval before Module 1.

**Please confirm:**
1. Approve these 7 planning docs as-is, or note changes.
2. Confirm the module order (or reprioritise — e.g. want Inventory before Customers?).
3. Open items from PRD §1.9: **GSTIN + default tax rate**, and whether **VIN QR-scan** is wanted in v1.
