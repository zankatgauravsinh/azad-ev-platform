# AZAD EV POINT — 2. User Flows

Notation: `→` step, `⟂` decision, `⎇` alternate path, `⟳` loop/reminder.

---

## 2.1 Lifecycle overview (the golden path)
```
Lead (Customer) → Test Ride → Booking (+advance) → Sale/Invoice (+payments)
      → Delivery (checklist+signature) → Service (recurring, after-sales)
```
A customer can enter at any stage (walk-in ready to buy skips test ride; existing owner enters directly at Service).

---

## 2.2 Authentication
```
Open app → ⟂ has valid session?
  yes → Dashboard (role-scoped)
  no  → Login (email + password)
        → ⟂ credentials valid?
            yes → issue access+refresh JWT → Dashboard
            no  → error, rate-limited after N attempts
Refresh token silently renews access token; logout clears both.
Forgot password → Owner/Manager resets from Settings › Users (no public email flow in v1).
```

## 2.3 Add Customer / Lead
```
Customers → "Add Customer"
  → form: name, phone(unique), alt phone, email, address, village/city, lead status, source, assigned executive
  → optional: upload Aadhaar, upload Driving License, add note
  → save → Customer detail page (Timeline tab shows "created")
Lead status: NEW → CONTACTED → TEST_RIDE → NEGOTIATION → BOOKED → WON → LOST

Customer Timeline (mandatory, auto-populated — nothing is entered by hand):
  Lead → Call → Visit → Test Ride → Quotation → Booking → Payment → Delivery → Service → Feedback → Referral
Every domain event (a call log, a visit, a test ride, a quotation, a booking, each payment, the delivery,
each service job, feedback rating, a referral) automatically writes a timeline entry via the DomainEvents helper.
Free-text Calls/Visits/Referrals are quick-add actions on the customer page; everything else is emitted by its module.
```

## 2.4 Book a Test Ride
```
Test Ride → "Book Test Ride"
  → pick/create Customer → choose ScooterModel/variant → ⟂ assign specific unit?
      yes → unit set RESERVED for the slot
  → assign Sales Executive → date/time
  → save (status SCHEDULED)
Ride happens → open ride → status ONGOING → COMPLETED
  → record feedback (rating + notes) → ⟂ interested?
      yes → one-click "Create Booking" (prefilled)   ⎇ no → status CANCELLED/NO_SHOW, unit released to AVAILABLE
```

## 2.5 Create Booking
```
Booking → "Create Booking" (or from Test Ride / Customer)
  Workflow: Customer → Select Scooter → Advance → Accessories → Finance → Insurance → Expected Delivery → Confirmation
  → select Customer → select inventory unit (search or 📷 scan VIN; must be AVAILABLE) → unit set BOOKED
  → record advance payment (amount, mode, ref) → add accessories (from catalogue, qty)
  → set finance required? insurance required? → set Expected Delivery date
  → review Confirmation → save (status CONFIRMED) → Booking detail
Booking statuses: DRAFT → CONFIRMED → CONVERTED(to sale) / CANCELLED(unit released)
```

## 2.6 Quotation → Sale → Invoice
```
Sales → "New Quotation" (or from Booking)
  → customer + unit + price breakup (ex-showroom, discount, RTO, insurance, accessories, registration, ext. warranty)
  → system computes on-road total → save/print/share quotation
  → ⟂ customer accepts?
      yes → "Convert to Sale"
Sale:
  → carries advance from booking → add finance detail (partner, down payment, EMI, tenure, disbursed) if finance
  → add insurance detail (company, policy no, premium, validity) if insurance
  → record Payment(s) until balanceDue = 0  ⟳
  → "Generate Invoice" → numbered per invoice-settings series → Print / Export PDF
Sale statuses: DRAFT → INVOICED → PAID → DELIVERED → CANCELLED
```

## 2.7 Delivery
```
Delivery → open pending delivery (Sale) → ⟂ balanceDue = 0?
   no  → block, unless Owner/Manager override with reason
   yes → 📷 Scan VIN to verify correct unit → Delivery Checklist:
        [ ] Helmet given     [ ] Charger given     [ ] Keys given
        [ ] Documents handed (RC/insurance/invoice/warranty)
   → capture Delivery Photo(s) → Customer Signature (on-screen canvas)
   → Delivery Notes (free text) → Google Review (mark reminder sent)
   → complete → unit set DELIVERED, Sale set DELIVERED
   → ⟳ schedule Google Review Reminder + first Service Due reminder
```

## 2.8 Service (after-sales)
```
Service → "Book Service"
  → find Customer/unit (by phone or VIN) → complaint(s) → job type (free/paid/warranty)
  → assign Technician → status OPEN
Work:
  → add Parts Used (part, qty, unit cost, warranty?)  → warranty parts charge ₹0
  → add Labour lines (description, hours, rate)
  → status IN_PROGRESS → READY → record payment if paid → CLOSED
Service History: per-unit and per-customer chronological list, visible on both detail pages.
```

## 2.9 Expenses
```
Expenses → "Add Expense" → category (Rent/Electricity/Salary/Marketing/Tea/Fuel/Stationery/Misc)
  → amount, date, paid-to, mode, note, optional receipt image → save
List filterable by category + date range; feeds monthly expense + profit reports.
```

## 2.10 Reports & Export
```
Reports → pick report (Daily/Weekly/Monthly/Inventory/Sales/Expenses/Profit/Top Models)
  → choose date range/filters → view table + chart
  → Export PDF (print-styled) or Export Excel (raw rows)
```

## 2.11 Global Search & Notifications
```
⌘K / tap search → type name/phone/VIN/invoice no → grouped results (Customers, Units, Bookings, Sales, Service) → jump to detail.
Notifications bell: pending payments, deliveries due, service due, low stock, test rides today. Click → target record.
```

## 2.12 Settings & Backup
```
Settings → Profile (own) → Company Details, Invoice Settings, Users (Owner/Manager) → Change Password → Backup (download SQL dump).
```
