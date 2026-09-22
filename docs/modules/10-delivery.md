# Module — Delivery workflow

Status: **delivered**. Turns the delivery step (previously a single "mark delivered" action buried in Bookings) into a full pipeline: schedule → pre-delivery/handover checklist → hand over with photos + customer signature → branded delivery note. Built on the existing `Delivery` / `DeliveryChecklist` / `DeliveryPhoto` models and the booking's `markDelivered` core — no sales logic duplicated.

## Data model (extended, not new)
- **`Delivery`** (1:1 with a `Sale`) — already existed: `deliveredAt`, `deliveredBy`, `customerSignatureKey`, `notes`, `overrideReason`, `googleReviewSent`.
- **`DeliveryChecklist`** — extended from 4 to **10** boolean items: `keys`, `charged`, `charger`, `helmet`, `accessoriesFitted`, `documents`, `invoice`, `insurance`, `rcBook`, `warrantyCard`.
- **`DeliveryPhoto`** — `fileKey` + `label`, via the shared `StorageService`.
- The pipeline reads existing `Booking` fields (`expectedDelivery`, `actualDelivery`, `deliveryExecutiveId`, `pendingDocuments`, `total`) and `Payment`s.

## Pipeline stages (computed, never stored)
For each confirmed/invoiced booking (`status IN (CONFIRMED, CONVERTED)`):
`DELIVERED` (actualDelivery set) → `AWAITING_PAYMENT` (balance > 0) → `OVERDUE` (expected date past) → `SCHEDULED` (expected date set) → `READY`. One company-scoped raw-SQL query computes the stage + balance and supports status filter, search and pagination.

## API (bearer; Owner / Manager / Sales Executive)
- `GET /deliveries` — pipeline (filter by stage, search booking/customer/VIN/invoice, paginate).
- `GET /deliveries/dashboard` — ready / scheduled / overdue / awaiting-payment / delivered-this-month / pending-docs.
- `GET /deliveries/:bookingId` — detail: booking + payment + delivery record (checklist, photos, signature).
- `POST /deliveries/:bookingId/schedule` — expected date + pending documents.
- `POST /deliveries/:bookingId/complete` — delegates to `BookingsService.markDelivered` (guards: invoice generated + zero balance; unit → Delivered; customer-timeline `DELIVERY` event; audit) then writes the checklist, notes and override reason. Also flips the `Sale` to Delivered and (via the existing warranty backfill) makes the vehicle warranty-eligible.
- `PATCH /deliveries/:bookingId/checklist` — edit the handover checklist after delivery.
- `POST /deliveries/:bookingId/photos` (+ `DELETE …/photos/:photoId`), `POST /deliveries/:bookingId/signature` — image uploads (JPG/PNG/WEBP, ≤10 MB).
- `GET /deliveries/:bookingId/note.pdf` — branded delivery note.

## Reused, not duplicated
- **markDelivered core** (invoice + balance guards, unit transition, timeline, audit) — the delivery module orchestrates around it.
- **StorageService** for photos + signature (S3-swappable). **PdfBrandService** for the note. **Reports/ExportService** for the delivery report. The **notifications** engine already emits delivery overdue / due-today / pending-documents alerts.

## Frontend
`Delivery` sidebar entry → `/delivery`: KPI strip + a pipeline table (stage filter, search, pagination) whose rows open a detail dialog. Not-yet-delivered bookings show a schedule form + the 10-item handover checklist + notes/override + **Complete delivery** (disabled while a balance is pending). Delivered bookings show the editable checklist, a photo gallery (upload/delete), signature capture, and a one-click delivery note. Responsive; PDFs use the native-aware `saveBlob`.

## Tests
- **e2e** `delivery.e2e-spec.ts` (9): booking appears as `READY` once invoiced + paid; schedule → `SCHEDULED`; complete with checklist → `DELIVERED` + unit Delivered + checklist persisted; double-complete rejected; post-delivery checklist edit; photo + signature upload (wrong mime → 400); delivery-note PDF; dashboard KPIs + `deliveries` CSV export; permissions (Technician 403, anonymous 401).
- Totals: **75 API unit + 132 API e2e (13 suites) + 9 web**, all green. Browser-verified end-to-end: pipeline with computed stages, schedule/checklist/complete, and the post-delivery photos/signature/note view.

## Deferred (optional)
Assigning a scheduling delivery-executive from the UI (there is no users-list endpoint yet; the person who completes is captured automatically as *delivered by*), a signature-pad capture (currently an image upload), and the Google-review send toggle (`googleReviewSent` field exists).
