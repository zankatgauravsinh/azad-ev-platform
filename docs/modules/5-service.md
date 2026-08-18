# Module 5 — Service & After-Sales Management

Status: **delivered**. Runs the whole workshop: job cards, complaints, inspection, repairs, spare parts, labour, billing, warranty, technician assignment and a permanent per-customer service history. Integrated with Customers, Inventory, Sales, Dashboard, Company Settings and Activity Log.

## Job card (ServiceJob)
Created with a `JC…` code (from `CompanySetting.jobCardPrefix` via `SequenceService`), a customer, a vehicle (VIN), optional booking/invoice links, a **service type** (`FREE_1/2/3, PAID, WARRANTY, REPAIR, INSPECTION`), **priority** (`LOW/MEDIUM/HIGH/EMERGENCY`), one or more **complaints**, an optional technician, odometer, scheduled/expected dates and notes.

**Workshop status flow** (enforced by `SERVICE_STATUS_TRANSITIONS`):
`BOOKED → CHECKED_IN → DIAGNOSIS → WAITING_FOR_PARTS → REPAIRING → QUALITY_CHECK → READY → DELIVERED` (with `CANCELLED` from any active stage and QC→REPAIRING rework). `CHECKED_IN` stamps `checkInAt`; `DELIVERED` stamps `checkOutAt`, `actualDelivery` and `closedAt`. Illegal jumps return 400.

## Free-service tracking
Intervals live in **Company Settings** (`freeService{1,2,3}{Km,Days}`, defaults 500/30, 3000/90, 6000/180 — configurable). The dashboard computes, for each delivered vehicle, the next free service not yet done whose due date (delivery + interval days) falls inside the reminder window (`serviceReminderDays`).

## Vehicle inspection
Fixed 12-item checklist (`INSPECTION_ITEMS`: Brakes, Lights, Horn, Tyres, Suspension, Battery, Motor, Controller, Display, Charging Port, Fasteners, Test Ride). Each item is `GOOD | NEEDS_ATTENTION | REPLACED` with optional notes, upserted per `(job,item)`.

## Spare parts (SparePart)
Standalone workshop inventory: name, SKU (unique per company), quantity, cost, selling price, warranty months, min stock. Adding a part to a job **atomically decrements stock** (rejected if insufficient); removing the line restores it. Low-stock = `quantity ≤ minStock`.

## Labour (LabourItem)
Editable catalogue (General Service, Battery Replacement, Motor Repair, Brake Adjustment, Controller Update, Wheel Alignment — seeded). Labour lines reference a catalogue item or a free-text description + cost.

## Billing
`partsTotal` (Σ sell price × qty) + `labourTotal` (Σ cost) − discount, then GST% → `taxAmount`, → `total`. Payments (`PaymentContext.SERVICE`, receipt from `SequenceService`) drive a PENDING/PARTIAL/PAID summary. Unlimited PDF download.

## Warranty
Vehicle warranty = `CompanySetting.defaultWarrantyMonths` from the delivery date (booking `actualDelivery`, else purchase date) → status + days remaining. Part warranty is captured per fitted part from `SparePart.warrantyMonths`. Warranty jobs are flagged (`underWarranty`, type `WARRANTY`).

## PDFs (repeatable, never regenerate state)
`GET /service/jobs/:id/pdf/{job-card|estimate|bill|inspection}` — streamed `application/pdf` with `Content-Disposition: attachment`, rendered on demand from the persisted job.

## Customer timeline
Auto-appends `JOB_CARD_CREATED, VEHICLE_CHECKED_IN, DIAGNOSIS_COMPLETE, REPAIR_STARTED, PARTS_ADDED, QUALITY_CHECK, SERVICE_DELIVERED, FEEDBACK_RECEIVED`. The customer profile's Service tab lists every job (type, priority, technician, total, complaints).

## Dashboard & search
Dashboard `service` block: Today's Services, Overdue, Ready for Delivery, Pending QC, Low Parts Stock, Technician Workload, Upcoming Free Services (plus `serviceDueToday` in Today's Work). Global search matches job card number, customer, phone, VIN, complaint and technician.

## Reports (`GET /service/reports`, Owner/Manager)
Daily service report, technician performance (jobs/delivered/revenue/avg rating), revenue (billed/collected/parts/labour), warranty claims, repeat complaints, top replaced parts — all aggregate/`groupBy`, no N+1.

## API (bearer auth; Swagger `/api/docs`)
- `service/jobs`: `GET` (list; technicians see only their own), `POST` (create), `GET :id`, `PATCH :id`, `POST :id/status`, `POST :id/technician`, `POST :id/complaints`, `POST :id/complaints/:cid/resolve`, `POST :id/inspection`, `POST :id/parts` + `DELETE :id/parts/:pid`, `POST :id/labour` + `DELETE :id/labour/:lid`, `POST :id/bill`, `POST :id/payments`, `POST :id/feedback`, `GET :id/pdf/:doc`, `GET service/jobs/technicians`.
- `service/spare-parts`: list/get/create/patch/`:id/adjust`/delete.
- `service/labour-items`: list/create/patch/delete.
- `service/reports`: aggregated analytics.

## Role matrix
- **Owner**: everything. **Manager**: everything (settings read-only, per platform rules). **Technician**: read + workshop actions (status, inspection, parts, labour, complaints, feedback) **only on assigned jobs** (enforced in the service layer + list filter). **Sales Executive**: read-only.

## Data model
New/changed tables: `ServiceJob` (rich), `ServiceComplaint`, `ServiceInspectionItem`, `ServicePart` (→ `SparePart`), `ServiceLabour` (→ `LabourItem`), `ServiceJobPhoto`, `SparePart`, `LabourItem`; enums `ServiceJobType`/`ServiceStatus` expanded, `ServicePriority`, `InspectionResult`, and `CustomerEventType` service events added. `CompanySetting` gains the six free-service interval fields. See `docs/03-DATABASE-DESIGN.md`.

## Tests
- **Unit** `service-jobs.bill.spec.ts` — bill calculations (PENDING/PARTIAL/PAID, overpay clamp) and the status-transition matrix.
- **e2e** `service.e2e-spec.ts` — full lifecycle (create → workshop flow → inspection → parts/stock decrement → labour → bill+GST → payment → deliver → feedback), **PDF downloads** (real `%PDF-` bytes, unknown doc 400), **timeline** events, **technician scoping** (403 on others' jobs), **global search**, **dashboard service widgets**, **reports authorization** (403 for technician), **spare-parts stock guards**, and **read-only Sales Executive**.
- Regression: all prior suites (auth, inventory, customers, sales, dashboard, tenant-isolation, company-settings) still pass — **56 unit + 78 e2e**.
