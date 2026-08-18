# Module 9 — Finance & Expense Management

Status: **delivered**. Full dealership bookkeeping — expenses, vendors, additional income, bank movements, a computed daily cash book, and a realtime Profit & Loss that reads straight from the existing Sales / Service / AMC modules. A new **Accountant** role gets finance-only access. Every platform seam (settings, reports, notifications, PDFs, search, timeline, audit log) is reused, not duplicated.

## Data model
- **`ExpenseCategory`** — 15 seeded system categories (Rent, Electricity, … Accessories) plus custom ones; editable and de-activatable. Unique `(companyId, name)`.
- **`Vendor`** — `vendorNumber` (VND), contact + GSTIN, status. Outstanding balance and total purchases are **derived** (grouped over expenses), never stored.
- **`Expense`** — `expenseNumber` (EXP), date, category, optional vendor, `amount`/`gstAmount` (BigInt paise), `paymentMethod`, reference, attachment key, `status` (Pending/Approved/Rejected — default Approved), `paid` + `dueDate`/`settledDate`. Soft-deletable.
- **`Income`** — `incomeNumber` (INC), `source` (accessories / insurance-commission / finance-commission / registration / service / AMC / warranty-recovery / other), amount, optional customer link.
- **`BankTransaction`** — `txnNumber` (BNK), `type` (deposit/withdrawal/NEFT/RTGS/IMPS/cheque/UPI) + `direction` (credit/debit; deposit⇒credit, withdrawal⇒debit are forced, the rest are user-chosen).
- **`CashAdjustment`** — signed paise manual corrections to the cash book.
- Indexes on `(companyId, status|date|categoryId|vendorId|paymentMethod)`, unique numbers, and `reference`. Numbers come from the shared `SequenceService` (new EXP/VND/INC/BNK series + prefixes/counters in Company/Invoice settings).
- **Company Settings**: `financeEnabled`, prefixes, `financeGstRate`, `financialYearStartMonth`, `openingCash`/`openingBank`, `lowCashThreshold`/`largeExpenseThreshold`.

## Money model (how balances are derived — no double-entry duplication)
- **Cash in hand** = `openingCash` + cash income + cash sales/service payments + bank withdrawals − cash expenses (approved) − bank deposits ± manual adjustments.
- **Bank balance** = `openingBank` + recorded bank credits − debits.
- **Cash book (day)** = opening (cash-in-hand at start of day) + the day's cash movements → closing.
- **P&L** = Sales & Service revenue (from `Payment`) + AMC revenue (`AmcPlan.price`) + the Income ledger − approved Expenses; gross profit = sales − Vehicle-Purchase expenses (COGS). Computed live in `PnlService`, reused by the dashboard and the P&L report.

## API (bearer; company-scoped) — Owner/Manager/Accountant write, Sales/Technician read-only
- `/expenses` — list/get/create/update, `PATCH :id/status`, `POST :id/settle`, `DELETE`, `GET :id/voucher.pdf`.
- `/vendors` — list/get/create/update/delete, `GET :id/ledger` (+`.pdf`).
- `/income` — list/create/delete, `GET :id/receipt.pdf`.
- `/bank-transactions` — list/create/delete.
- `/finance` — `GET dashboard`, `GET/POST/PATCH categories`, `GET cash-book` (+`/pdf`), `POST cash-book/adjustments`, `GET pnl`.

## Integrations (reused, not duplicated)
- **Timeline** — commission / insurance / accessory / AMC / warranty-recovery income appends to `CustomerTimelineService` when linked to a customer.
- **Notifications** — `generate()` adds vendor-payment-due/overdue and low/negative cash alerts (uses `CashbookService`; gated by `notifyPayment` + `financeEnabled`); expense create emits large-expense + duplicate-expense alerts directly. All deduped.
- **Reports** — `expenses / income / vendors / bank / pnl / gst` join the `ExportService` architecture (PDF/Excel/CSV).
- **PDFs** — expense/payment voucher, receipt voucher, vendor ledger, cash book — all via the branded `PdfBrandService` letterhead.
- **Search** — expense/income/vendor numbers, references, vendor names.
- **Audit log** — every mutation records to `ActivityLogService`.

## Frontend
`Finance` sidebar entry → `/finance`: KPI strip (collection / expense / cash / bank / profit / payable / top vendor) + **Expenses / Income / Vendors / Bank / Cash Book / P&L** tabs. List tabs have search, filters, pagination, per-tab export and inline actions (approve / settle / voucher). Vendor rows open a ledger dialog with a PDF. Cash Book is a day view with opening/in/out/closing cards, an entries table, a PDF and a manual-adjustment inline form. P&L shows income/expense breakdowns with gross/net cards. Create dialogs for expense/income/vendor/bank. Responsive (`w-[calc(100%-2rem)]`, `overflow-auto` tables) with native-aware `saveBlob` PDFs. Settings → Finance exposes prefixes, GST, FY month, opening balances (entered in ₹, stored as paise) and alert thresholds.

## Permissions
Owner / Manager / **Accountant** — full finance access. Accountant is finance-only (no customers/sales/etc. — verified 403). Sales Executive + Technician (Service Advisor) — read-only.

## Tests
- **e2e** `finance.e2e-spec.ts` (12): category seeding + custom, vendor outstanding from an unpaid expense, settle clears it, income→customer-timeline, bank credit/debit, cash-book + adjustment, realtime P&L + dashboard, voucher/ledger/cash-book PDFs, expense/P&L/GST exports, global search, permission matrix (accountant finance-only, sales read-only 403, anon 401).
- **unit** `finance.helpers.spec.ts`: bank direction/cash-effect, financial-year window, bigint sum.
- Totals: **75 API unit + 117 API e2e (12 suites) + 9 web**, all green. Browser-verified: KPI strip, expense create updating cash-in-hand/profit live, cash book, and P&L reading real sales/service/AMC revenue.

## Module 9.1 — enhancements (delivered 2026-08-04)
1. **Expense attachments** — `ExpenseAttachment` (Invoice / GST Bill / Photo / PDF, ≤10 MB) stored through the `StorageService` abstraction (local today, S3-swappable without touching callers). Upload / preview-link / delete from the expense detail dialog; `POST/DELETE /expenses/:id/attachments`.
2. **Approval workflow** — `ExpenseStatus` gains `DRAFT`. Draft → Pending (`POST :id/submit`) → Approved/Rejected (`PATCH :id/status`) → Paid (`POST :id/settle`). Only `APPROVED` expenses hit cash-in-hand / P&L. Create supports "Save as draft".
3. **Recurring expenses** — `RecurringExpense` templates with a `dayOfMonth`; `POST /finance/recurring/run` generates the current month's expenses once (tracks `lastRunYear/Month`, idempotent) — the seam a future cron reuses.
4. **GST summary** — `GET /finance/gst-summary`: GST collected (income) vs paid (approved expenses) vs net, plus a 6-month breakdown; own tab + export.
5. **Monthly closing** — `MonthlyClosing` (`@@unique(companyId, year, month)`) locks a month. Every finance mutation calls `MonthlyClosingService.assertOpen(date)` → 400 inside a closed month. Close/reopen from the Closing tab (`/finance/closings`).
6. **Bank reconciliation** — `BankTransaction.reconStatus` (Pending / Cleared / Reconciled), `PATCH /bank-transactions/:id/reconcile`, inline control in the Bank tab.

Still deferred (architecture-ready): GST-return filing, Tally/Zoho/QuickBooks sync, Bank API, UPI reconciliation, OCR invoice scanner, and a full multi-step digital approval routing. The storage interface is already S3-ready; swapping the driver moves attachments to S3 with no caller changes.
