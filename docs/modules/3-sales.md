# Module 3 — Sales Domain

Status: **delivered**. Manages the whole purchase journey: **Quotation → Booking → Advance → Finance → Insurance → Vehicle Allocation → Delivery Scheduling → Invoice → Delivered**. Transaction-safe, with automatic inventory sync and customer-timeline generation.

## Design
- **Quotation** = estimate. **Booking** = the deal (holds pricing, advance, accessories, finance, insurance, payments, delivery scheduling, and the allocated VIN). **Sale** = the generated invoice (created from a booking). **Delivery** record is created when the booking is marked delivered.
- Finance, Insurance and Payments attach to the **Booking**; the invoice snapshots the figures into the Sale.
- Codes are allocated atomically from `InvoiceSetting` by `SequenceService` (quotation `QT/…`, booking `BK/…`, invoice `AZAD/…`, receipt `RCPT/…`), each with a unique constraint.

## Pipeline & rules
- **Vehicle allocation**: creating/converting a booking reserves one specific VIN — the unit must be `AVAILABLE` (double allocation → `409`), and it moves `AVAILABLE → BOOKED` with an inventory event + timeline entry.
- **Cancellation** releases the VIN back to `AVAILABLE` (unless already invoiced).
- **Payments**: each gets an auto receipt number; a computed summary reports `PENDING / PARTIAL / PAID` and the balance.
- **Finance**: company, loan, down payment, EMI, tenure, status `PENDING/APPROVED/REJECTED/CANCELLED` — approval records a timeline event.
- **Insurance**: provider, policy, premium, dates, status `PENDING/ACTIVE/EXPIRED/CANCELLED`.
- **Invoice**: generates the Sale (`INVOICED`), booking → `CONVERTED`.
- **Delivery**: requires an invoice **and** zero balance; sets unit `BOOKED → DELIVERED`, Sale `DELIVERED`, creates the Delivery record, timeline `DELIVERY`.
- **Customer timeline** auto-appends: `QUOTATION → BOOKING → VEHICLE_ASSIGNED → ADVANCE_PAYMENT → FINANCE_APPROVED → INSURANCE_ADDED → INVOICE_GENERATED → DELIVERY`.

## Data model changes
- Enums: `QuotationStatus` (adds `CANCELLED`, drops `REJECTED`), new `FinanceStatus`, `InsuranceStatus`; `CustomerEventType` adds `INSURANCE_ADDED`, `INVOICE_GENERATED`; shared adds a computed `PaymentStatus`.
- `Quotation`: exchange value, finance estimate, accessories (`QuotationAccessory`), variant relation, booking link.
- `Booking`: full price breakup, finance/insurance relations, quotation link, delivery scheduling (`actualDelivery`, `deliveryExecutive`, `pendingDocuments`).
- `FinanceDetail`/`InsuranceDetail`: reparented from Sale → **Booking**; renamed to `financeCompany` / `provider`; enum statuses.
- `Payment`: `receiptNumber` (unique). `InvoiceSetting`: receipt series.
- Migrations: `*_sales_domain`, `*_sales_timeline_events`.

## API (bearer auth; Swagger `/api/docs`) — roles Owner/Manager/Sales Executive
**Quotations** `/quotations`: list, create, `:id`, `:id/pdf`, PATCH `:id`, PATCH `:id/status`, `:id/duplicate`, `:id/convert`, DELETE `:id`.
**Bookings** `/bookings`: list, create, `:id`, PATCH `:id`, `:id/confirm`, `:id/cancel`, `:id/payments` (GET/POST), `:id/finance`, `:id/insurance`, `:id/schedule-delivery`, `:id/deliver`, `:id/invoice`.
**Accessories** `/accessories`: list, create. **Inventory** adds `/inventory/variants`.

## Tests (all required areas covered)
- **Unit**: `pricing.spec.ts` (on-road maths, exchange, tax, negative guard); `bookings.payment-summary.spec.ts` (PENDING/PARTIAL/PAID).
- **e2e** `sales.e2e-spec.ts`: quotation total, **booking allocation (inventory sync)**, **double allocation 409**, **payment calculations**, **finance flow**, insurance, deliver-before-invoice 400, invoice, delivery + unit `DELIVERED`, **timeline generation** (all 8 events), **cancellation releases the VIN**.
- Run: `npm test --workspace api`, `npm run test:e2e --workspace api`.

## Frontend
- **Quotations**: list (filter/search/duplicate/convert/PDF/status) + detail (price breakup, finance estimate, convert).
- **Bookings**: list (payment + booking status) + detail command-center — price breakup, payments (with receipts), finance/insurance/delivery cards, and actions: Take payment, Finance, Insurance, Schedule delivery, Generate invoice, Deliver, Cancel.
- Reusable: `CustomerCombobox`, `PriceFields` (live on-road total), status badges.

## Next
Module 4 — Dashboard (real data from Inventory + Customers + Sales).
