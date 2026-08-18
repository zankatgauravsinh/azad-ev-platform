# Module 8 — Warranty & AMC

Status: **delivered**. Every sold vehicle carries a warranty (coverage schedule + free-service plan); service advisors raise warranty claims; customers buy Annual Maintenance Contracts with tracked service visits. Dashboards, reports, notifications, branded PDFs and global search all plug into the existing platform seams — no module was redesigned.

## Data model
- **`Warranty`** — `warrantyNumber` (WR series), `status` (Active/Expired/Cancelled/Claimed), `customer`, `unit`, `booking?`/`sale?`/`invoiceNumber?`, `motor`/`battery` no., `purchaseDate`/`startDate`/`endDate`/`periodMonths`, `coverage` (typed JSON: `{item,label,covered,remarks}[]`), dealer/customer notes. One active warranty per vehicle.
- **`WarrantyClaim`** — `claimNumber` (CLM), `status` (Pending/Approved/Rejected/Completed), complaint, diagnosis, `partsReplaced` (JSON), labour, `claimCost`/`manufacturerClaimAmount`/`dealerCost` (BigInt paise; dealer = claim − OEM recovery), technician, claim/completion dates.
- **`FreeService`** — three per warranty (`serviceNumber` 1–3), `dueDate` seeded from Company Settings `freeServiceNDays`, `status` (Pending/Completed/Missed), technician, remarks.
- **`AmcPlan`** — `amcNumber` (AMC), `planType` (Silver/Gold/Platinum/Custom), `status`, start/end, `visitsIncluded`/`visitsUsed` (remaining is derived), `price`.
- **`AmcVisit`** — `visitNumber`, date, technician, work done, parts, amount, `coveredUnderAmc` (a covered visit decrements the plan's remaining visits).
- Indexes: `(companyId, status)`, `(companyId, endDate)`, `(companyId, customerId)`, `unitId`, unique `(companyId, warrantyNumber|amcNumber|claimNumber)`. Technicians are stored as plain ids and resolved to names in one batched query (no extra `User` back-relations).
- **Company Settings**: `warrantyEnabled`, `amcEnabled`, `warrantyReminderDays`, plus `warrantyPrefix`/`amcPrefix`/`claimPrefix` and `nextWarranty/Amc/ClaimNumber` counters (allocated by the shared `SequenceService`).

## API (bearer; company-scoped)
Reads: all roles. Writes: Owner/Manager/Technician (Sales Executive is read-only; cancel is Owner/Manager).
- `GET /warranties` (filter `status`/`customerId`/`expiringInDays`, `q` over number/customer/VIN/motor/battery), `GET /warranties/:id` (detail + timeline), `POST /warranties`, `POST /warranties/generate` (idempotent backfill of delivered vehicles), `PATCH /warranties/:id`, `POST /warranties/:id/cancel`, `PATCH /warranties/free-service/:id`, `GET /warranties/dashboard`, `GET /warranties/:id/certificate.pdf`.
- `GET/POST /warranty-claims`, `PATCH /warranty-claims/:id/status` (a Completed claim flips the warranty to `CLAIMED`).
- `GET/POST /amc`, `GET /amc/:id`, `POST /amc/:id/visits`, `GET /amc/:id/agreement.pdf`.

## Integrations (reused, not duplicated)
- **Timeline** — warranty activation, claims and AMC purchase/visits append to the immutable `CustomerTimelineService` (WARRANTY events).
- **Notifications** — `NotificationsService.generate()` now reads the `Warranty` table for expiry buckets (90/60/30/7d/expired) and adds AMC expiring/exhausted and free-service-due candidates; claim approve/reject emit de-duplicated WARRANTY notifications directly. All respect the company toggles and stable `dedupeKey`s.
- **Reports** — `warranty` and `amc` join the report export architecture (PDF/Excel/CSV via `ExportService`), surfaced as an **Export** menu on the Warranty page.
- **PDFs** — Warranty Certificate and AMC Agreement use the branded `PdfBrandService` letterhead/fonts (Unicode ₹).
- **Global search** — warranty/AMC/claim numbers, VIN, motor and battery numbers.

## Frontend
`Warranty & AMC` sidebar entry → `/warranty`: KPI strip (active/expiring/pending claims/AMC revenue) + **Warranties / Claims / AMC** tabs (search, status filter, pagination, per-tab export). Warranty detail dialog shows the details grid, coverage table, free services (mark done), claims (approve/reject/complete inline), and a chronological timeline, with a one-click certificate. AMC detail dialog lists visits and records new ones. Create dialogs pick a vehicle by VIN. Dialogs are responsive (`w-[calc(100%-2rem)]`, `max-h-[88vh]` scroll) and PDFs use the native-aware `saveBlob` handoff on Android. Settings → Service gained the Warranty & AMC toggles + reminder-days.

## Tests
- **e2e** `warranty.e2e-spec.ts` (12): create (default coverage + 3 free services), duplicate-guard, list/detail, complete free service, claim lifecycle → warranty `CLAIMED`, claim filter, AMC + visit (remaining decrements), dashboard KPIs, certificate + agreement PDFs, warranty + AMC CSV export, global search, permissions (sales read-only 403, anon 401).
- **unit** `warranty.helpers.spec.ts`: default coverage, label fill, month-add clamping, days-to-expiry.
- Totals: **69 API unit + 105 API e2e (11 suites) + 9 web**, all green.

## Deliberately deferred (design-ready, not built)
Coverage-editing UI (the `PATCH` endpoint accepts it), Warranty-Claim & AMC-Visit PDFs (Certificate + Agreement shipped), embedded warranty tabs on the customer/vehicle detail pages (events already flow to the customer timeline), and the future-ready surfaces from the spec (manufacturer API, QR/online registration, digital signatures, barcode scanning).
