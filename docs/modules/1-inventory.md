# Module 1 — Inventory

Status: **delivered**. Full-stack inventory management: backend + frontend + validation + tests + docs.

## Scope delivered
- **Inventory dashboard** — status counts (Total, Available, Reserved, Booked, Delivered, In Service) + widgets (Low Inventory, Recently Added, Reserved, Ready for Delivery).
- **Scooter management** — Model, Variant, Colour (+ hex swatch), VIN, Motor Number, Battery Number, Purchase Date, Purchase Cost, Selling Price, Supplier, Location, Notes, Current Status.
- **Operations** — Add, Edit, Soft Delete, Search, Filter (status/model/supplier), Sort, Pagination, Bulk CSV import, Export Excel, Export PDF, Print.
- **VIN** — manual entry, camera QR/barcode scan (ZXing, reused later by Booking/Delivery), live duplicate validation.
- **Status timeline** — append-only `InventoryEvent` history (Purchased → Available → Reserved → Booked → Delivered → Service → Returned). Never mutated; only valid transitions allowed.
- **Detail page** — Information, Timeline, Bookings & Sales, Service history, Documents & Photos (uploads via `StorageService`), linked Customer.

## Data model additions
- `UnitStatus` gains `RETURNED`. `InventoryUnit` gains `notes`.
- `ScooterVariant` unique on `(modelId, name, colour)` — enables flat "model + variant + colour" UX via resolve-or-create.
- New tables: `InventoryEvent` (append-only status history), `InventoryUnitPhoto`, `InventoryUnitDocument`.
- Shared: `UNIT_STATUS_TRANSITIONS` + `canTransitionUnit()` enforce the lifecycle on client and server.
- Migration: `prisma/migrations/*_inventory_module`.

## API (all under `/api/v1`, bearer auth; see Swagger `/api/docs`)
| Method | Path | Roles | Purpose |
|---|---|---|---|
| GET | `/inventory/stats` | Owner, Manager, Sales | Status counts |
| GET | `/inventory/dashboard` | Owner, Manager | Stats + widgets |
| GET | `/inventory/models` · POST `/inventory/models` | read / write | List / create models |
| GET | `/inventory/units` | read | List, search (`q`), filter (`status`,`modelId`,`supplier`), sort, paginate |
| GET | `/inventory/units/check-vin?vin=` | read | Duplicate VIN check |
| GET | `/inventory/units/export?format=xlsx\|pdf` | write | Export |
| POST | `/inventory/units` | write | Add scooter (records genesis event) |
| POST | `/inventory/units/import/preview` | write | CSV dry run: validates every row, writes nothing (see *CSV import*) |
| POST | `/inventory/units/import` | write | CSV import, all or nothing (see *CSV import*) |
| GET | `/inventory/units/:id` | read | Detail (info, timeline, bookings, sales, service, media) |
| GET | `/inventory/units/:id/events` | read | Status history |
| PATCH | `/inventory/units/:id` | write | Edit |
| DELETE | `/inventory/units/:id` | write | Soft delete (blocked if Booked/Delivered) |
| PATCH | `/inventory/units/:id/status` | write | Change status (validated transition + history) |
| GET/POST/DELETE | `/inventory/units/:id/photos[/:photoId]` | read/write | Unit photos |
| GET/POST/DELETE | `/inventory/units/:id/documents[/:docId]` | read/write | Unit documents |
| GET | `/uploads/:key` | public (UUID key) | Serve stored media |

**Roles:** read = Owner, Manager, Sales Executive; write = Owner, Manager. (Sales Executive gets read-only inventory for the unit picker in later modules.)

## Business rules
- VIN / Motor No / Battery No are unique; duplicates → `409`.
- Status changes must follow `UNIT_STATUS_TRANSITIONS`; illegal → `400`. Every change appends an immutable `InventoryEvent`.
- Money stored as BigInt paise; the UI works in ₹ and converts at the edge.
- CSV import is all or nothing: every row is re-validated on the server in one transaction and either all scooters are added or none. It never creates or changes catalogue entries and never updates existing scooters (see *CSV import*).
- Soft delete retains history; Owner-only hard delete cascades events/media.

## CSV import
Inventory → **Import** opens a two-step dialog.

1. **Preview** — choosing a file uploads it to `POST /inventory/units/import/preview`. Nothing is saved. The dialog shows the total / valid / invalid / duplicate counts and, per source row (header = line 1), every problem with the column it concerns. Only a preview with no invalid rows can be confirmed. Choosing another file discards the old preview.
2. **Confirm** — **Import N scooters** uploads the *same bytes* with `expectedSha256` = the preview's `fileSha256`. The server re-validates the whole file (the preview is advisory) and answers:
   - `200 IMPORTED` — every row was added (units, their history events and one audit entry, in one transaction);
   - `200 REJECTED` — nothing was added; the dialog shows the server's own preview of the problems;
   - `409` — the file differs from the previewed one, or the inventory / catalogue changed: nothing was added — preview again;
   - `503` — the server could not confirm completion within its deadline (it rolls an unfinished import back) — refresh the inventory and preview again;
   - network failure, `502`, `504` or another server error — **the result is unknown**: the dialog never reports success or failure and never retries by itself; refreshing the inventory and previewing again shows any rows already imported as "already used by a scooter in your inventory";
   - `400` (unreadable file, no rows, more than 2,000 rows), `413` (over 2 MB), `401` / `403` — nothing was added.

**Template** — *Download template* builds the file from the company's active catalogue: the header plus one row per active variant of an active model, with Brand / Model / Variant / Colour filled in and the rest blank. Rows left without numbers are reported by the preview, never imported.

| Column | Required | Rules |
|---|---|---|
| Brand | no | Only needed when two brands use the same model name. |
| Model | yes | Must already exist and be active (Inventory → Models). |
| Variant | yes | Must already exist and be active for that model. |
| Colour | yes | The variant's colour, as in the catalogue. |
| VIN | yes | Unique across the system. |
| Motor Number | yes | Unique. |
| Battery Number | yes | Unique. |
| Purchase Date | no | `YYYY-MM-DD`, `D/M/YYYY` or `DD/MM/YYYY`. Slash dates are **day first**: `3/12/2026` is 3 December 2026. |
| Purchase Cost | no | Rupees, digits only (no commas or ₹). Blank = 0. |
| Selling Price | no | Rupees. Blank = the variant's list price; an explicit `0` is kept. |
| Supplier | no | Free text. |
| Location | no | Where the scooter is kept. |
| Status | no | Blank or `AVAILABLE` — imported scooters are always Available; any other status is refused. |

Headers are matched ignoring case and spaces (`Make` = Brand, `Color` = Colour, `Motor No` = Motor Number…); names are matched ignoring case and extra spaces. A number already used in your own inventory is reported as such (deleted scooters included); one registered by another company is only reported as *not available*. Limits: 2,000 rows and 2 MB per file.

## Tests
- **Unit** (`inventory.service.spec.ts`) — VIN dup guard, genesis event on create, transition validation, no-op guard, delete guard, VIN normalisation.
- **Integration / API** (`test/inventory.e2e-spec.ts`) — auth guard, create + genesis event, duplicate 409, check-vin, search, illegal vs legal transition + history growth, stats, xlsx export.
- **UI** (`web/src/components/common/data-table.test.tsx`, `brand-mark.test.tsx`) — table render/empty/sort/paginate; plus `money.test.ts`.
- Run: `npm test --workspace api`, `npm run test:e2e --workspace api`, `npm run test --workspace web`.

## Quality pass (verified)
- **Swagger** — all 20 inventory endpoints carry request examples/schemas + explicit response codes (`/api/docs`).
- **HTTP codes** — 200 (read/update), 201 (create), 204 (delete), 400 (validation/illegal transition), 401 (unauth), 404 (missing), 409 (duplicate / delete-blocked). Verified by sweep + e2e.
- **CSV import (M4D)** — preview then confirm; all or nothing. Superseded the original per-row import, where good rows imported alongside bad ones.
- **Exports at scale** — verified with 10,050 units: xlsx (10,050 data rows, no truncation, ~0.8s) and pdf (296 pages, ~1.3s). `EXPORT_CAP = 100,000`.
- **Duplicate VIN** — enforced by a DB `UNIQUE` index (vin, motorNumber, batteryNumber). 8 concurrent same-VIN creates → exactly 1 persisted, 7 × `409` (no `500`): race-safe via the constraint, not the pre-check.
- **Media safety** — deleting a photo/document removes both the DB row and the stored file; a failed insert after upload rolls back the file (no orphan). Verified on disk in e2e.
- **Immutable history** — `InventoryEvent` has only append + read paths; POST/PATCH/DELETE on `/events` → `404`. No code path updates or deletes events.

## How to test manually
1. Inventory → **Add scooter**: pick model, enter variant/colour/VIN/numbers/prices → saved as Available; Timeline shows "Purchased".
2. Try a duplicate VIN → inline "already exists".
3. Row **⋯ → Change status**: only valid next states are offered; Timeline records the change.
4. **Import** → download the template (your active variants), fill in one row per scooter, choose the file → review the preview (counts, row-level problems) → **Import N scooters** once every row is valid.
5. **Export** → Excel / PDF / Print.
6. Detail → **Documents & Photos**: upload an image/PDF, then open/delete it.

## Next
Module 2 — Customers.
