# Module 4 — Dashboard (Operational Control Center)

Status: **delivered**. Not a statistics page — the owner understands the whole showroom in seconds. Built entirely from real Inventory + Customer + Sales data, with a single fast aggregated endpoint and global search.

## Sections (spec order)
1. **Today's Work** (always first) — Today's Deliveries, Today's Follow-ups, Pending Payments (count + ₹), Pending Finance Approvals, Pending Insurance, Service Due Today, Low Inventory, Overdue Bookings. Colour-coded (amber/red) and click-through to the relevant list.
2. **Business Overview** — Today's Sales, Today's Collections, Monthly Sales, Monthly Collections, Available Inventory, Booked Inventory, Delivered Vehicles, Active Customers.
3. **Recent Activity** — newest first: customer booked, payment received, vehicle allocated, vehicle delivered, finance approved, insurance added, new customer, service completed (sourced from the immutable customer timeline).
4. **Quick Actions** — Add Customer, Add Inventory, Create Quotation, Create Booking, Receive Payment, Schedule Delivery, Book Service (last disabled until the Service module).

**Charts (only three):** Monthly Sales, Monthly Collections (6-month bars), Lead Conversion (funnel). Lightweight SVG — no chart-library dependency.

**Reminders (from real data):** Upcoming Deliveries, Follow-ups, Pending Balance, Pending Documents, Service Due.

## Global search (top navbar, ⌘K)
`GET /search?q=` across **customer name, phone, VIN, booking code, invoice number**; grouped results (Customers / Vehicles / Bookings / Invoices) that navigate to the matching detail page.

## API (bearer auth; Swagger `/api/docs`)
- `GET /dashboard/summary` (Owner, Manager) — one aggregated payload: `{ todaysWork, businessOverview, recentActivity, reminders, charts, generatedAt }`.
- `GET /search?q=` (Owner, Manager, Sales Executive).

## Performance
- Every figure comes from an **aggregate/`groupBy`/`count`** query or a targeted raw SQL — **no N+1**. All section queries run in parallel (`Promise.all`).
- Verified: with **10,050 bookings / 10,000 customers / 10,000 units / 10,000 payments / 5,000 sales**, `/dashboard/summary` returns in **~55 ms** (requirement: < 1 s).
- Charts use `date_trunc('month', …)` group-bys; pending balances use a single joined aggregate.

## Tests
- **Unit** `chart-utils.spec.ts` — 6-month gap-filling and amount coercion (verifies charts).
- **e2e** `dashboard.e2e-spec.ts` — payload shape; **metrics cross-checked against DB totals** (available/booked/delivered inventory, active customers, today's collections vs the Payment table); three charts × six points; **recent-activity newest-first ordering**; reminders from real data; global search by name/phone/VIN.
- Note: the e2e suite now runs serially (`maxWorkers: 1`) so shared-DB assertions are deterministic.

## Frontend
- `/dashboard` (Owner/Manager) — becomes the post-login landing for those roles. Sales/Technician keep the Account home.
- Reusable: `BarChart`, `LeadConversion`, `TodayWork`, `Reminders`, `RecentActivity`, `QuickActions`, `GlobalSearch` (⌘K).

## Note
`serviceDueToday` and the Service reminder are wired to return empty until **Module 5 — Service** populates them.

## Next
Module 5 — Service.
