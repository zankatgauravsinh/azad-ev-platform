# Module 6 — Reports & Analytics

Status: **delivered**. A production reporting layer over the whole dealership — Sales, Customers, Inventory, Payments, and Service — with charts and PDF / Excel / CSV export. Read-only; no new tables (pure aggregation over existing data).

## API (bearer auth; **Owner + Manager** only; Swagger `/api/docs`)
- `GET /reports/overview?from&to` — dealership summary: invoiced sales, revenue collected, service revenue, customers, available stock, pending deliveries, outstanding payments; + 6-month revenue trend + payment-method mix.
- `GET /reports/sales?from&to` — bookings, delivered, cancelled, invoiced revenue, avg ticket; monthly sales; **sales by model**; per-booking rows.
- `GET /reports/customers?from&to` — total / new / repeat / active; 6-month growth; top 20 buyers by spend.
- `GET /reports/inventory` — units by status, stock valuation; **stock by model**, **low stock** (≤ 2 available), 6-month intake.
- `GET /reports/payments?from&to` — collected, by mode (cash / UPI / bank / card), outstanding; **14-day daily collection**; per-receipt rows.
- `GET /reports/:type/export?format=pdf|excel|csv&from&to` — `type ∈ {sales, customers, inventory, payments}`. Streams a file with `Content-Disposition`.
- **Service** reports (job cards, technician performance, revenue, top parts, warranty) reuse Module 5's `GET /service/reports`.

`from`/`to` are optional ISO dates (Zod `reportRangeSchema`); the server defaults to the last 30 days. Charts (monthly series) always span 6 calendar months, gap-filled.

## Performance
- Every figure is a single `aggregate` / `groupBy` / `count` or **one targeted raw-SQL join** — no N+1. Relational rollups (sales-by-model, stock-by-model, top customers, outstanding balance, daily/monthly buckets via `date_trunc`) run as raw SQL, **scoped to the company** explicitly (raw SQL bypasses the Prisma tenant middleware).
- Uses the existing indexes on `Sale.invoicedAt`, `Payment.paidAt`/`mode`, `InventoryUnit.status`, `Booking.status`, `Customer.createdAt`, and every `companyId` — no new indexes required. Report calls fan out with `Promise.all`.

## Export — branded, single source of truth
`ExportService` gained `toCsv` (UTF-8 BOM so Excel reads ₹) and its `toPdf` now uses the **shared branded letterhead** (`drawBrandHeader`/`drawBrandFooter`) + the embedded Unicode font, so report PDFs match invoices/quotations and render ₹ correctly. Excel keeps the navy header + autofilter.

## Frontend (`/reports`, Owner + Manager nav)
Tabbed page — **Overview · Sales · Customers · Inventory · Payments · Service** — with a From/To date range + presets (7d/30d/90d/1y). Each tab: tone-coded KPI cards, charts (reused `BarChart`; new `HBarList` for ranked amounts, `DailyBars` for the 14-day collection), a scrollable data table, and PDF/Excel/CSV export buttons. Exports use the native-aware `saveBlob` (share sheet on Android). Fully responsive (2-col KPI grids on mobile, tables scroll) and Android-compatible.

## Tests
- **Unit** `export.service.spec.ts` — CSV BOM, header/rows, comma/quote/newline escaping.
- **e2e** `reports.e2e-spec.ts` — every endpoint's payload shape; **DB cross-checks** (sales "Delivered" = booking count, inventory "Total units" = unit count); custom date range (2020 window → empty); **exports** return real `%PDF-` / `PK`(xlsx) / CSV with correct content types; unknown type/format → 400; **authorization** (Sales Executive 403, anonymous 401).
- Totals after Module 6: 64 API unit + 86 API e2e + 9 web, all green.
