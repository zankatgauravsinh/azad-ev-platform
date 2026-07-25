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
| POST | `/inventory/units/import` | write | Bulk CSV import (per-row validation) |
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
- CSV import is per-row transactional: bad rows are reported (with row numbers) while good rows still import; models/variants are resolve-or-created.
- Soft delete retains history; Owner-only hard delete cascades events/media.

## Tests
- **Unit** (`inventory.service.spec.ts`) — VIN dup guard, genesis event on create, transition validation, no-op guard, delete guard, VIN normalisation.
- **Integration / API** (`test/inventory.e2e-spec.ts`) — auth guard, create + genesis event, duplicate 409, check-vin, search, illegal vs legal transition + history growth, stats, xlsx export.
- **UI** (`web/src/components/common/data-table.test.tsx`, `brand-mark.test.tsx`) — table render/empty/sort/paginate; plus `money.test.ts`.
- Run: `npm test --workspace api`, `npm run test:e2e --workspace api`, `npm run test --workspace web`.

## Quality pass (verified)
- **Swagger** — all 20 inventory endpoints carry request examples/schemas + explicit response codes (`/api/docs`).
- **HTTP codes** — 200 (read/update), 201 (create), 204 (delete), 400 (validation/illegal transition), 401 (unauth), 404 (missing), 409 (duplicate / delete-blocked). Verified by sweep + e2e.
- **CSV partial failures** — good rows import; each bad row is reported as `{ row, message }` (duplicate VIN, missing field, unknown status, bad number all distinctly messaged).
- **Exports at scale** — verified with 10,050 units: xlsx (10,050 data rows, no truncation, ~0.8s) and pdf (296 pages, ~1.3s). `EXPORT_CAP = 100,000`.
- **Duplicate VIN** — enforced by a DB `UNIQUE` index (vin, motorNumber, batteryNumber). 8 concurrent same-VIN creates → exactly 1 persisted, 7 × `409` (no `500`): race-safe via the constraint, not the pre-check.
- **Media safety** — deleting a photo/document removes both the DB row and the stored file; a failed insert after upload rolls back the file (no orphan). Verified on disk in e2e.
- **Immutable history** — `InventoryEvent` has only append + read paths; POST/PATCH/DELETE on `/events` → `404`. No code path updates or deletes events.

## How to test manually
1. Inventory → **Add scooter**: pick model, enter variant/colour/VIN/numbers/prices → saved as Available; Timeline shows "Purchased".
2. Try a duplicate VIN → inline "already exists".
3. Row **⋯ → Change status**: only valid next states are offered; Timeline records the change.
4. **Import** → download template, upload CSV → summary of created/failed rows.
5. **Export** → Excel / PDF / Print.
6. Detail → **Documents & Photos**: upload an image/PDF, then open/delete it.

## Next
Module 2 — Customers.
