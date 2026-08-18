# Module 7 — Notifications & Reminders

Status: **delivered**. A company-scoped notification center with a top-bar bell, a filterable/searchable drawer, and automatic reminder generation from live dealership data. Designed so future channels (push/WhatsApp/SMS/email) and scheduled jobs plug into the same seam.

## Data model
`Notification` (repurposed from the old unused recipient-scoped model → **company-scoped**):
`id, companyId, title, message, type, priority, entityType?, entityId?, dedupeKey?, readAt?, archivedAt?, expiresAt?, createdById?, createdAt, updatedAt`. `isRead` is derived from `readAt`.
- `type` (`NotificationType`): DELIVERY · PAYMENT · SERVICE · INVENTORY · CUSTOMER · WARRANTY · SYSTEM.
- `priority` (`NotificationPriority`): CRITICAL · HIGH · MEDIUM · LOW (UI colours red / orange / blue / gray).
- Indexes: `@@unique([companyId, dedupeKey])` (dedupe), `[companyId, readAt]`, `[companyId, type]`, `[companyId, priority]`, `[companyId, createdAt]`, `[expiresAt]`.
- `CompanySetting` gained per-category toggles `notifyDelivery/Payment/Service/Inventory/Warranty` + `desktopNotifications` (existing `email/sms/whatsappEnabled` are the future channels).

## API (bearer; all roles — Owner/Manager/Sales/Technician; company-scoped)
- `GET /notifications` — filter (`type`, `priority`, `unread`, `archived`), `q` search (title/message), date range (`from`/`to`), `page`/`pageSize`. Newest first; hides archived + expired by default.
- `GET /notifications/unread-count` → `{ total }`.
- `POST /notifications/refresh` — regenerate auto notifications (de-duplicated).
- `POST /notifications` — create a manual reminder.
- `PATCH /notifications/:id/read`, `PATCH /notifications/read-all`, `PATCH /notifications/:id/archive`, `DELETE /notifications/:id`.

## Automatic generation (`generate()`)
Scans live data and creates notifications with a **stable `dedupeKey`** so repeated refreshes never pile up (verified: 2nd refresh creates 0). Respects the company's category toggles. Sources:
- **Delivery** — overdue (CRITICAL), due-today (HIGH), pending documents (MEDIUM).
- **Payment** — outstanding balance per booking (HIGH), with the pending amount.
- **Service** — overdue (HIGH) / due-today (MEDIUM) job cards.
- **Warranty** — expiring within 90/60/30/7 days or expired, priority scaled by days left (raw SQL using the company's `defaultWarrantyMonths`).
- **Inventory** — low stock (≤ 2 available, MEDIUM) / out of stock (HIGH).
- **Customer** — follow-ups due today (MEDIUM).

Each source is one aggregate/filtered query (no N+1); raw SQL is company-scoped explicitly. The `generate()` method is the seam a **future cron / queue** calls — no refactor needed to add scheduled reminders, push, or WhatsApp/SMS/email fan-out.

## Frontend
- **Bell** in the top bar with a live unread badge (60s poll + refetch-on-focus).
- **Drawer** (portaled to `document.body` so the header's `backdrop-blur` doesn't clip it): search, category + Unread filter chips, **infinite scroll**, grouped by **Today / Yesterday / Earlier**, priority colour dots + category icons, per-item mark-read / archive / delete, and mark-all-read. Full-width on mobile, 400px on desktop; `pt-safe` + `android-back` handling for Capacitor.
- **Settings → Notifications**: per-category toggles + desktop toggle (channels shown as future-ready).

## Android
The drawer is a responsive WebView overlay (verified full-width at 360 px) and closes on the hardware back button via the shared `android-back` seam. System-tray push is intentionally **not** implemented — the `generate()` + `dedupeKey` design is push-ready for Firebase later.

## Tests
- **e2e** `notifications.e2e-spec.ts` — generation + **dedupe** (2nd refresh → 0), list/paginate/unread-count parity, category + priority filters, create → unread++ → mark-read → unread--, search, archive hides from default list, mark-all clears count, delete → 404, anonymous 401.
- Totals: 64 API unit + 93 API e2e (10 suites) + 9 web, all green.
