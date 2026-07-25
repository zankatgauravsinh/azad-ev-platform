# AZAD EV POINT — 6. UI Wireframes (ASCII)

Design language: Linear/Notion/Stripe. Persistent left sidebar (collapsible), top bar with global search + notifications + theme + profile. Cards: rounded-2xl, soft shadow, generous spacing. Brand: Navy `#0B2545` primary, Teal `#00B8A9` accent/active, Gold `#F2A93B` highlight/CTA, Poppins. Dark-mode via CSS vars. Desktop-first; sidebar → bottom nav on mobile.

---

## 6.1 App Shell
```
┌──────────────────────────────────────────────────────────────────────┐
│ [≡] AZAD EV POINT        ⌘K Search…            🔔3   ☾   ⟠ Owner ▾     │  ← Topbar
├────────────┬─────────────────────────────────────────────────────────┤
│ ◈ Dashboard│                                                          │
│ ◕ Customers│                    PAGE CONTENT                          │
│ ⛃ Inventory│                                                          │
│ ⚡ Test Ride│                                                          │
│ ▤ Bookings │                                                          │
│ ₹ Sales    │                                                          │
│ 🛵 Delivery │                                                          │
│ 🔧 Service  │                                                          │
│ 💸 Expenses │                                                          │
│ ▦ Reports  │                                                          │
│ ⚙ Settings │                                                          │
└────────────┴─────────────────────────────────────────────────────────┘
Mobile: sidebar hidden → bottom tab bar [Home][Cust][Sales][Service][More]
```

## 6.2 Dashboard (minimal — only what's below, no card overload)
```
Dashboard                                            [+ Quick Action ▾]
Quick Actions:  [New Customer] [New Booking] [Take Payment] [Book Service]
┌───────────┐┌───────────┐┌───────────┐
│Today Sales││Today Coll.││Available  │   ← 3 lightweight stat tiles
│ ₹1,24,000 ││ ₹42,500   ││ 17 units  │
└───────────┘└───────────┘└───────────┘
┌───────────┐┌───────────┐┌───────────┐
│Pend. Deliv││Pend. Pay. ││Service Due│
│    4      ││ ₹2,10,000 ││    6      │
└───────────┘└───────────┘└───────────┘
┌──────────────────────────────┐┌──────────────────────────┐
│ Monthly Sales (single chart) ││ Recent Activity          │
│  ╱╲    ╱╲   area chart         ││ • Sale #0042 — ₹1.24L    │
│ ╱  ╲__╱  ╲__                  ││ • Booking #018 confirmed │
│                               ││ • Payment ₹10k (UPI)     │
└──────────────────────────────┘│ • Service #231 closed    │
                                 └──────────────────────────┘
```
Only: Today's Sales, Today's Collections, Available Inventory, Pending Deliveries, Pending Payments,
Service Due, Quick Actions, Recent Activity, Monthly Sales chart. Nothing else.

## 6.3 Customers — List + Detail
```
Customers                          [q Search name/phone] [Lead ▾][+ Add Customer]
┌───────────────────────────────────────────────────────────────────────┐
│ Name           Phone        City     Lead        Assigned   Updated    │
│ Ramesh Bhai    98250xxxxx   Una      NEGOTIATION Kiran      2h ago  ⋯  │
│ …                                          ← rows, sort, paginate       │
└───────────────────────────────────────────────────────────────────────┘

Customer Detail  ┌ Ramesh Bhai   NEGOTIATION ●  98250xxxxx  Una ─────────┐
[Overview][Timeline][Documents][Notes]                       [Edit][⋯]  │
Overview: contact card | quick stats (test rides, bookings, sales, service)
Timeline:  ● Booking #AZAD/… created        (Kiran, 2h)
           ● Test ride VX1 – rating ★★★★☆  (Kiran, 1d)
           ● Note: "wants teal, EMI"        (Kiran, 1d)
Documents: [Aadhaar ▣][DL ▣]  drag-drop uploader
```

## 6.4 Inventory
```
Inventory   [Model ▾][Status ▾][q VIN/Motor/Battery]              [+ Add Unit]
┌───────────────────────────────────────────────────────────────────────┐
│ Model/Variant     Colour   VIN          Status      Motor#   Battery#  │
│ VX1 / Standard    ●Teal    MD…001       AVAILABLE   MT…      BT…    ⋯  │
│ VZ1 / Pro         ●Gold    MD…014       BOOKED      …                  │
└───────────────────────────────────────────────────────────────────────┘
Status pills: AVAILABLE(teal) RESERVED(gold) BOOKED(navy) DELIVERED(grey) IN_SERVICE(amber)
Unit Detail: specs, purchase cost/date, current status + transition button, linked booking/sale/service history.
Model/Variant manager: nested — Model → variants (colour swatch, price, specs).
```

## 6.5 Test Ride
```
Test Rides   [Status ▾][Executive ▾][📅 Today]                 [+ Book Test Ride]
Board or table:  SCHEDULED | ONGOING | COMPLETED | CANCELLED
Card: Ramesh · VX1 Teal · 4:30 PM · Exec: Kiran · [Start][Feedback][Convert→Booking]
Feedback modal: ★ rating + notes → on save, prompt "Create Booking?"
```

## 6.6 Booking
```
New Booking (stepper)   ①Customer ②Vehicle ③Accessories ④Finance/Insurance ⑤Advance
Step ② Vehicle:  [🔍 Search VIN…]  or  [📷 Scan VIN]  → picks AVAILABLE unit
Right rail = live summary:
   Unit: VX1 Std Teal (VIN …001)
   Accessories: Helmet ₹1,200
   Advance: ₹10,000 (UPI)
   ─────────────
   Finance: Required   Insurance: Required
[Save Draft]                                   [Confirm Booking]
Booking Detail: status timeline, documents tab, payments, [Convert to Sale].
```

## 6.7 Sales — Quotation & Invoice
```
Quotation / Invoice builder
┌ Price Breakup ───────────────┐  ┌ Summary ─────────┐
│ Ex-showroom      1,05,000     │  │ Subtotal 1,18,700 │
│ Discount        −  3,000      │  │ GST (5%)   …      │
│ RTO                8,500      │  │ ───────────       │
│ Insurance          4,200      │  │ TOTAL  1,24,000   │
│ Accessories        1,200      │  │ Paid    10,000    │
│ Registration       1,500      │  │ Balance 1,14,000  │
│ Ext. Warranty      2,300      │  └──────────────────┘
└──────────────────────────────┘  [Save][Generate Invoice][Print/PDF]
GST row appears only when Settings › Invoice has showGst=ON (default OFF → no tax line).
Invoice print view: company header + logo, GSTIN (if set), customer, VIN block, breakup, T&C, signature.
```

## 6.8 Delivery
```
Delivery Checklist – Sale #AZAD/25-26/0042            Balance: ₹0 ✅
[📷 Scan VIN to verify] → ✓ matches unit …001 (green) / ✗ mismatch (red block)
[✓] RC/Temp reg   [✓] Insurance copy  [✓] Invoice copy
[✓] Helmet        [✓] Charger         [✓] Keys ×2
[✓] Manual        [✓] Motor/Battery numbers verified
Vehicle Photos:  [＋front][＋side][＋odometer]
Customer Photo:  [＋capture]        Signature: ┌───✍───┐ [clear]
[ Complete Delivery ]  → toast "Delivered ✓  Send Google review reminder? [Send]"
Blocked state (balance>0): banner "Balance ₹14,000 due" + [Owner override ▾ reason]
```

## 6.9 Service
```
Service Jobs  [Status ▾][Technician ▾][q VIN/phone]            [+ Book Service]
Job Detail #SVC-231   VX1 (VIN …001) · Ramesh · Tech: Mahesh · IN_PROGRESS
Complaint: "brake noise, slow charging"
Parts:  Brake pad ×1  ₹450 [warranty ▢]           [+ Add part]
Labour: Brake service 0.5h ₹300                    [+ Add labour]
Totals: Parts ₹450 · Labour ₹300 · Total ₹750  → [Take Payment][Close Job]
Warranty part → charge ₹0 shown struck-through. Service History timeline below.
```

## 6.10 Expenses
```
Expenses   [Category ▾][📅 range]                              [+ Add Expense]
Summary chips: Rent ₹15k · Salary ₹42k · Marketing ₹8k · Misc ₹3k
Table: Date · Category(pill) · Paid To · Mode · Amount · Receipt · ⋯
Add modal: category, amount, paid-to, mode, date, note, receipt upload.
```

## 6.11 Reports
```
Reports  [Daily|Weekly|Monthly|Sales|Inventory|Expenses|Profit|Top Models]
[📅 range][filters]                               [Export PDF][Export Excel][Print]
Renders: KPI row + chart + responsive table. Profit = revenue − COGS − expenses.
```

## 6.12 Settings
```
Settings  [Profile][Users][Password][Company][Invoice][Backup]
Users: table + role selector + reset password + activate/deactivate.
Company: name, address, phone, GSTIN, logo upload.
Invoice: prefix, next number, tax rate, GST toggle, T&C, footer.
Backup: [Download SQL Backup]  last backup: —
```

## 6.13 Reusable components (shadcn-based)
`StatCard · DataTable(pagination/sort/filter/column-visibility) · FilterBar · StatusBadge · PageHeader · EmptyState · ConfirmDialog · FormDialog · FormField(RHF+Zod) · Uploader/SignaturePad · VinScanner(camera QR/barcode, reused by Booking + Delivery) · Combobox · DateRangePicker · Chart wrappers · Toaster · CommandPalette(⌘K global search)`. Every table/form/dialog/filter/search/scanner is a single shared component — no duplication across features.

## 6.14 Responsive & theming
- Tables collapse to card lists < md. Steppers stack vertically on mobile. Bottom nav replaces sidebar.
- Light/dark via `data-theme`; brand tokens as CSS variables; focus-visible rings in teal; AA contrast (navy/white per brand rules; gold only at label/heading sizes).
