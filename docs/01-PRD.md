# AZAD EV POINT — Showroom Management System
## 1. Product Requirements Document (PRD)

**Owner:** Azad Enterprise · **Location:** Una, Gujarat · **Type:** EV Scooter Dealer & Service Centre
**Doc status:** Draft for approval · **Date:** 2026-07-22

---

### 1.1 Product Summary
A single-dealership operations app for **AZAD EV POINT**. It runs the daily life of one showroom: walk-in leads → test rides → bookings → sales/invoicing → delivery → after-sales service, plus inventory, expenses, and reports. It is **not** an ERP and **not** multi-tenant SaaS. One company, one showroom, 3–10 daily users.

**Design north star:** Linear / Notion / Stripe — minimal, premium, fast, mobile-friendly, dark-mode ready. Desktop-first, tablet-compatible. **Principles:** very few colours (navy/teal/gold accents on neutral canvas), large spacing, keyboard-friendly, fast loading, and **one page = one task** — no dashboards drowning in dozens of cards.

### 1.2 Goals & Non-Goals
**Goals**
- Replace paper registers and WhatsApp-based tracking with one fast tool.
- Give the owner a live picture of sales, cash collected, stock, and profit.
- Make it usable on a phone at the counter or during delivery.
- Keep every VIN, payment, document, and delivery photo in one auditable place.

**Non-Goals (v1)**
- Multi-branch / multi-company. Accounting/GST filing engine. Public customer portal. Manufacturer (OEM) integration. E-commerce checkout. Payroll processing (salary is logged as an expense only).

### 1.3 Personas & Roles
| Role | Who | Primary jobs |
|---|---|---|
| **Owner** | Business owner | **Full access.** Everything including Settings (users, company, invoice, backup) and hard deletes. |
| **Manager** | Showroom manager | **Everything except Settings.** All operational modules + reports + expenses; cannot manage users/company/invoice settings/backup; no hard delete. |
| **Sales Executive** | Counter/field sales | **Customers, Bookings, Sales, Delivery** (and test rides + quotations as part of that pipeline). No expenses, no reports, no inventory writes, no service. |
| **Technician** | Service staff | **Service only** — job cards, parts, labour, service history. Nothing else. |

Role → permission matrix is defined in `05-API-DESIGN.md` (§ Authorization).

### 1.4 Modules (scope)
1. **Dashboard** — focused, minimal. Shows only: Today's Sales, Today's Collections, Pending Deliveries, Available Inventory, Pending Payments, Service Due, Quick Actions, Recent Activity, Monthly Sales chart. No card overload, no extra analytics.
2. **Customers** — CRUD, search, timeline, Aadhaar & DL upload, notes, lead status.
3. **Inventory** — model → variant → colour → unit (VIN, motor no, battery no), status lifecycle, search/filter.
4. **Test Ride** — booking, assign executive + scooter, feedback, status.
5. **Booking** — advance payment, accessories, finance/insurance flags, status, documents.
6. **Sales** — quotation, invoice, discount, accessories, payments, finance, insurance, print invoice.
7. **Delivery** — checklist, vehicle photos, documents-given, helmet/charger/keys, customer signature + photo, Google review reminder.
8. **Service** — booking, complaint, technician, parts used, labour, warranty, service history.
9. **Expenses** — categorised (rent, electricity, salary, marketing, tea, fuel, stationery, misc).
10. **Reports** — daily/weekly/monthly, inventory, sales, expenses, profit, top-selling models. Export PDF/Excel.
11. **Settings** — profile, users, password, backup, company details, invoice settings.

### 1.5 Cross-cutting Features
Global search · Notifications · Image/document upload (local now, S3-ready) · Export PDF · Export Excel · Print · Activity logs · Dashboard widgets · Responsive tables with pagination, sorting, filtering · **VIN QR/barcode scanning** (camera-based, mobile) used at booking and delivery to select/verify a unit.

### 1.6 Core Business Rules
- **Inventory unit lifecycle:** `AVAILABLE → RESERVED (test ride hold) → BOOKED → DELIVERED`; `IN_SERVICE` is a parallel state for owned/returned units. A unit can be on exactly one active booking/sale at a time; status transitions are enforced server-side.
- **Booking → Sale:** a Sale is created from a Booking (or directly for instant purchases). Advance paid on booking carries into the sale ledger.
- **Money:** all amounts stored as integer **paise** (₹×100) to avoid float errors; displayed as ₹. On-road = ex-showroom − discount + RTO + insurance + accessories + registration + extended warranty.
- **Payments:** a Sale has many Payments (cash/UPI/card/finance-disbursement/exchange). `balanceDue = total − sumPaid`. Sale cannot be marked fully paid while balance > 0.
- **Delivery gate:** delivery can be completed only when `balanceDue = 0` **or** owner/manager overrides with a recorded reason.
- **Service warranty:** if a used part / labour is under warranty, chargeable amount = 0 but the line is still recorded.
- **Profit (report):** `revenue (sales + service + accessories) − COGS (unit purchase cost + parts cost) − expenses` over the period.
- **Soft delete:** customers, sales, bookings are soft-deleted (`deletedAt`); only Owner can hard-delete. Inventory units are never hard-deleted once transacted.
- **Audit:** every create/update/delete/state-change on a business entity writes an ActivityLog row.

### 1.6b Future-Ready Architecture (build hooks, do NOT implement now)
The system is single-showroom and stays simple, but the architecture leaves clean seams so these can be added later without refactor — **none are built in v1**:
- **Notifications channels** — a `NotificationChannel` interface (in-app is the only concrete impl now) so **WhatsApp / SMS / Email** channels can be registered later. Notification records already carry type + target entity.
- **Cloud backup** — backup runs through a `BackupTarget` seam; local SQL dump now, cloud (S3/GDrive) later.
- **File storage** — `StorageService` interface with `LocalStorage` impl now, S3 later (already in §04/§05).
- **Mobile app** — the REST API is the single source of truth (no server-rendered coupling), so a future React Native app consumes the same endpoints. Auth is stateless JWT.

These are interfaces/abstractions only — no dead code, no stubs that throw, no TODOs. Each has exactly one working implementation today.

### 1.7 Non-Functional Requirements
- **Performance:** list views < 300 ms server response for ≤10k rows; dashboard < 1 s. Server-side pagination everywhere.
- **Mobile:** all primary flows (add customer, book test ride, take payment, complete delivery, log expense) usable one-handed on a phone.
- **Security:** JWT access + refresh, bcrypt/argon2 password hashing, role-based guards, rate-limited auth, input validation on every endpoint, uploaded files scoped & type/size-validated.
- **Reliability:** DB transactions for multi-row operations (booking, sale, delivery, service). One-click backup (SQL dump) from Settings.
- **i18n-ready:** English UI first; label layer structured so Gujarati can be added without refactor.
- **Offline-tolerant:** graceful error + retry on flaky counter Wi-Fi (React Query retry/cache); no data loss on submit failure.

### 1.8 Success Metrics
- 100% of new sales recorded in-app (no parallel register) within 1 month of go-live.
- Owner checks dashboard daily; monthly profit visible without manual spreadsheet work.
- Every delivered unit has photos + signature + checklist on file.
- Service due list drives proactive follow-up calls.

### 1.9 Assumptions & Open Questions
- **Single currency ₹ (INR)**, single timezone **Asia/Kolkata**.
- **GST — DECIDED:** fully configurable in Settings › Invoice. Tax rate + GSTIN + `showGst` toggle live in `InvoiceSetting`; **default OFF** (plain invoices) until the owner fills GSTIN and enables it. App never files returns. No hardcoded rate.
- Finance is tracked (partner, down payment, EMI, tenure, disbursed amount) but not underwritten by us.
- **VIN scanning — DECIDED:** included in v1. Camera-based QR/barcode scan on mobile at **Booking** (select unit) and **Delivery** (verify unit); manual VIN search remains the fallback everywhere.

Real product catalogue (Comptech **VX1**, **VZ1**, **MARS**) and brand tokens (Navy `#0B2545`, Teal `#00B8A9`, Gold `#F2A93B`, Poppins) seed the app — see `brand/` and `products/`.
