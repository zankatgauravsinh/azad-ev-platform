# Company Settings Framework

Status: **delivered** (milestone between Module 4 and Module 5). Not a simple settings table — a reusable company-configuration system that every current and future module (Sales, Service, Reports, Expenses, Notifications, Printing) reads from. One company = one `CompanySetting` row, strongly typed (no JSON blobs), editable from a single tabbed UI.

## What it replaces
Values that were previously hardcoded or seed-only now come from `CompanySetting`:
- Document prefixes (`INV / BK / QT / RC / JC`) and GST/tax — consumed by `SequenceService` and the quotation/invoice PDF.
- Currency, timezone, language, date/time format — localization.
- Default warranty months, service-reminder days — Sales/Service defaults.
- Brand colours (`primaryColor`, `secondaryColor`) and logo — applied to the web UI at runtime.

## Data model
- **`CompanySetting`** — one row per company (`@unique companyId`). ~40 typed columns grouped: Business, Localization, GST/Tax, Prefixes, Sales/Service, Branding, Working hours, Notifications, Backup, Invoice text, plus an `updatedById` audit link. See `docs/03-DATABASE-DESIGN.md §3.3`.
- **`InvoiceSetting`** — reduced to **sequence counters only** (`nextInvoiceNumber/Booking/Quotation/Receipt/Service`). Prefixes moved to `CompanySetting`; `SequenceService` reads the prefix from `CompanySetting` and the counter from `InvoiceSetting` in one transaction. This keeps *config* (CompanySetting) and *mutable counter state* (InvoiceSetting) separate.
- **`enum BackupFrequency { DAILY WEEKLY MONTHLY }`**.
- Migration preserves seeded data: before the old prefix/tax columns are dropped, an `UPDATE … FROM InvoiceSetting` copies `termsAndConditions`, `footerNote → invoiceFooter`, `showGst → gstEnabled`, `taxRate → taxPercentage` across. Verified zero drift.

## API (bearer auth; Swagger `/api/docs`)
- `GET /settings/company` — full settings DTO. **Roles: Owner, Manager** (read).
- `GET /settings/company/branding` — `{ businessName, primaryColor, secondaryColor, companyLogoUrl }` subset for app-wide theming. **All authenticated roles** (so branding applies for everyone, not just admins).
- `PATCH /settings/company` — partial update, Zod-validated (`updateCompanySettingsSchema`). **Role: Owner only.** Writes an activity-log entry and stamps `updatedById`.
- `POST /settings/company/{logo|favicon}` — multipart image upload (PNG/JPEG/WebP/SVG/ICO, ≤5 MB), company-scoped storage, replaces the previous file. **Owner only.**
- `DELETE /settings/company/{logo|favicon}` — remove image. **Owner only.**

Everyone else (Sales Executive, Technician) is denied read/write on the full settings object (403); they may read only the branding subset. Authorization is enforced by the global `RolesGuard`.

## Frontend
- `/settings` route (nav item visible to Owner + Manager). Tabbed page: **General, Branding, Sales, Invoice, Service, Notifications, Localization, Backup**.
- Single React-Hook-Form form (`zodResolver(updateCompanySettingsSchema)`): loads current values, tracks dirty state, shows a sticky **"unsaved changes"** save/discard bar, guards in-app navigation (`useBlocker`) and browser unload (`beforeunload`), validates inline, and toasts on success.
- **Manager is read-only** — the whole form is `disabled` and the save bar is hidden (`canWrite = role === OWNER`).
- `ThemeApplier` reads `/settings/company/branding` and sets the `--primary` / `--accent` design-token CSS variables at runtime (hex→HSL); the sidebar shows the company logo + business name when set.
- Logo/favicon upload with live preview and remove, on the Branding tab.

## Tests
- **Unit** `company-settings.service.spec.ts` — returns existing row without creating; creates a default row when missing; maps the DTO (`taxPercentage` string, `companyLogoUrl`); update normalizes empty email → null and writes the audit fields.
- **e2e** `company-settings.e2e-spec.ts` — 401 unauthenticated; **authorization matrix** (GET: Owner/Manager 200, Sales 403; PATCH: Owner 200, Manager 403, Sales 403); **validation** (bad hex colour, GST-enabled-without-number, bad currency, tax > 100 all 400; valid persists); **single source of truth** — patching `bookingPrefix` makes the next booking code start with the new prefix, then reverts.
- **Regression** — Inventory, Customers, Sales, Dashboard, tenant-isolation suites all still pass unchanged.

## Constraints honoured
No SaaS billing, no dealer onboarding, no subscriptions, no offline sync, no super-admin. Backward compatible: existing single-company behaviour is identical; dealer onboarding (future) simply creates a default `CompanySetting` row per company.
