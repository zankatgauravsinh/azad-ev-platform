# AZAD EV POINT — 3. Database Design (PostgreSQL + Prisma)

Normalized relational schema. Money stored as **BigInt paise** (₹×100). **Every table** has `id (uuid)`, `createdAt`, `updatedAt`, `createdById`, `updatedById` (audit — mandatory). Soft-deletable business tables also have `deletedAt`. Every mutation additionally writes an `ActivityLog` row (audit trail).

---

## 3.1 ER Diagram (textual)
```
User 1──∞ (createdBy) ─ most tables
User 1──∞ TestRide.executive / Booking / Sale / ServiceJob.technician

Customer 1──∞ CustomerDocument
Customer 1──∞ CustomerNote
Customer 1──∞ TestRide ─∞──1 Customer
Customer 1──∞ Booking
Customer 1──∞ Sale
Customer 1──∞ ServiceJob
Customer 1──∞ ActivityLog (via entity refs)

ScooterModel 1──∞ ScooterVariant 1──∞ InventoryUnit
InventoryUnit 1──∞ TestRide (nullable)
InventoryUnit 1──1  Booking (active)   [unit currently booked]
InventoryUnit 1──1  Sale   (active)
InventoryUnit 1──∞ ServiceJob

Booking 1──1 Sale (nullable, on convert)
Booking 1──∞ BookingAccessory ∞──1 Accessory
Booking 1──∞ BookingDocument
Booking 1──∞ Payment

Quotation 1──∞ QuotationItem
Quotation 1──1 Sale (nullable)

Sale 1──∞ SaleItem
Sale 1──∞ Payment
Sale 1──1 FinanceDetail (nullable)
Sale 1──1 InsuranceDetail (nullable)
Sale 1──1 Delivery (nullable)
Sale 1──∞ SaleAccessory ∞──1 Accessory

Delivery 1──∞ DeliveryPhoto
Delivery 1──1 DeliveryChecklist

ServiceJob 1──∞ ServicePart ∞──1 Accessory/Part
ServiceJob 1──∞ ServiceLabour
ServiceJob 1──∞ Payment

Expense ∞──1 ExpenseCategory(enum)
Notification (company-scoped, auto-generated + manual)
ActivityLog ∞──1 User (actor)
CompanySetting (singleton) · InvoiceSetting (singleton)
```

## 3.2 Enums
```
Role                : OWNER | MANAGER | SALES_EXECUTIVE | TECHNICIAN
LeadStatus          : NEW | CONTACTED | INTERESTED | TEST_RIDE | NEGOTIATION | BOOKED | WON | LOST
Gender              : MALE | FEMALE | OTHER
CustomerEventType   : LEAD_CREATED | STATUS_CHANGED | PHONE_CALL | WALK_IN | TEST_RIDE | QUOTATION | BOOKING | ADVANCE_PAYMENT | FINANCE_APPROVED | VEHICLE_ASSIGNED | DELIVERY | FIRST_SERVICE | WARRANTY | FEEDBACK | REFERRAL | NOTE_ADDED | DOCUMENT_UPLOADED | FOLLOW_UP_SCHEDULED | FOLLOW_UP_COMPLETED
FollowUpPriority    : LOW | MEDIUM | HIGH
FollowUpStatus      : PENDING | COMPLETED | CANCELLED
DocumentType        : AADHAAR | DRIVING_LICENSE | PAN | FINANCE | INSURANCE | INVOICE | WARRANTY | DELIVERY_PHOTO | SIGNATURE | GOOGLE_REVIEW | PHOTO | OTHER
UnitStatus          : AVAILABLE | RESERVED | BOOKED | DELIVERED | IN_SERVICE | RETURNED
                      (transitions enforced via UNIT_STATUS_TRANSITIONS in @azad/shared)
TestRideStatus      : SCHEDULED | ONGOING | COMPLETED | CANCELLED | NO_SHOW
BookingStatus       : DRAFT | CONFIRMED | CONVERTED | CANCELLED
QuotationStatus     : DRAFT | SENT | ACCEPTED | EXPIRED | CANCELLED
FinanceStatus       : PENDING | APPROVED | REJECTED | CANCELLED
InsuranceStatus     : PENDING | ACTIVE | EXPIRED | CANCELLED
SaleStatus          : DRAFT | INVOICED | PAID | DELIVERED | CANCELLED
PaymentMode         : CASH | UPI | CARD | BANK_TRANSFER | FINANCE | EXCHANGE
PaymentContext      : BOOKING_ADVANCE | SALE | SERVICE
ServiceJobType      : FREE_1 | FREE_2 | FREE_3 | PAID | WARRANTY | REPAIR | INSPECTION
ServiceStatus       : BOOKED | CHECKED_IN | DIAGNOSIS | WAITING_FOR_PARTS | REPAIRING | QUALITY_CHECK | READY | DELIVERED | CANCELLED
ServicePriority     : LOW | MEDIUM | HIGH | EMERGENCY
InspectionResult    : GOOD | NEEDS_ATTENTION | REPLACED
ServiceStatus       : OPEN | IN_PROGRESS | READY | CLOSED | CANCELLED
ExpenseCategory     : RENT | ELECTRICITY | SALARY | MARKETING | TEA | FUEL | CLEANING | OFFICE | MISC
NotificationType    : DELIVERY | PAYMENT | SERVICE | INVENTORY | CUSTOMER | WARRANTY | SYSTEM
NotificationPriority: CRITICAL | HIGH | MEDIUM | LOW
ActivityAction      : CREATE | UPDATE | DELETE | STATUS_CHANGE | LOGIN | PAYMENT | EXPORT
```

## 3.3 Tables (key columns)

**User** — `name, email(unique), phone, passwordHash, role, isActive, lastLoginAt`
**Customer** — `name, phone(unique), altPhone, email, address, city, state, pin, village, occupation, dateOfBirth, gender, leadStatus, source, lostReason, preferredModelId→ScooterModel, preferredColour, preferredFinanceOption, assignedToId→User, deletedAt`
**CustomerDocument** — `customerId, type(DocumentType), fileKey, fileName, mimeType, sizeBytes` — the customer's **document folder** (Aadhaar, DL, PAN, finance, insurance, invoice, warranty, delivery photos, signature, other). Supports preview/download/replace/delete.
**CustomerTimelineEntry** (append-only, immutable) — `customerId, type(CustomerEventType), title, description, entityType, entityId, metadata, occurredAt, createdById`. The single auto-generated timeline; later modules append via `CustomerTimelineService`. No update/delete path.
**CustomerFollowUp** — `customerId, dueAt, priority(FollowUpPriority), note, remindBeforeMinutes, status(FollowUpStatus), completedAt, assignedToId→User`. Feeds dashboard reminders (overdue/today/upcoming).
**CustomerNote** — `customerId, authorId→User, body, editCount` (internal only).
**CustomerNoteRevision** — `noteId, body, editedById, createdAt` — a prior version saved on each edit (edit history).

**ScooterModel** — `name, brand, description, isActive` (e.g. Comptech VX1)
**ScooterVariant** — `modelId, name, colour, hexColour, exShowroomPrice(BigInt), batteryType, batteryCapacity, rangeKm, topSpeedKmph, chargingTimeHrs, motorPowerW, warrantyMonths, isActive`
**ScooterVariant** — unique `(modelId, name, colour)` so units resolve-or-create a variant from a flat "model + variant + colour" form/CSV.
**InventoryUnit** — `variantId, vin(unique), motorNumber(unique), batteryNumber(unique), status(UnitStatus), purchaseDate, purchaseCost(BigInt), sellingPrice(BigInt), location, supplier, notes, deletedAt` — tracks VIN, motor no, battery no, model/variant/colour (via variant), purchase date/cost, selling price, current status, location, supplier, notes.
**InventoryEvent** (append-only status history — never mutated) — `unitId, fromStatus(UnitStatus?), toStatus(UnitStatus), note, createdById, createdAt`. Genesis event = "Purchased" (fromStatus null).
**InventoryUnitPhoto** — `unitId, fileKey, label`. **InventoryUnitDocument** — `unitId, type(DocumentType), fileKey, fileName, mimeType, sizeBytes`.

**Accessory** (catalogue, doubles as service part) — `name, sku, sellPrice(BigInt), costPrice(BigInt), stockQty, isPart(bool), isActive`

**TestRide** — `customerId, variantId, unitId?, executiveId→User, scheduledAt, status, feedbackRating(1-5)?, feedbackNote?`

**Booking** (the deal) — `code(unique), customerId, unitId, salesExecutiveId→User, quotationId?, status, financeRequired, insuranceRequired, price breakup (exShowroom, discount, exchangeValue, accessoriesTotal, rto, insuranceCharge, registration, extendedWarranty, taxAmount, total, advanceAmount), delivery scheduling (expectedDelivery, actualDelivery, deliveryExecutiveId→User, pendingDocuments), notes, deletedAt`. Holds finance (1:1), insurance (1:1), payments, accessories; converts into a Sale (invoice).
**BookingAccessory** — `bookingId, accessoryId, qty, unitPrice(BigInt)`
**BookingDocument** — `bookingId, type, fileKey, fileName, mimeType, sizeBytes`

**Quotation** — `code(unique), customerId, variantId, exShowroom, discount, rto, insurance, accessoriesTotal, registration, extendedWarranty, total(BigInt), status, validUntil`
**QuotationItem** — `quotationId, label, amount(BigInt)` (flexible line items)

**Sale** — `invoiceNumber(unique,null until INVOICED), bookingId?, customerId, unitId, salesExecutiveId→User, exShowroom, discount, rto, insuranceCharge, accessoriesTotal, registration, extendedWarranty, taxAmount, total(BigInt), status, invoicedAt?, deletedAt`
**SaleItem** — `saleId, label, amount(BigInt), taxable(bool)`
**SaleAccessory** — `saleId, accessoryId, qty, unitPrice(BigInt)`
**Quotation** — adds `exchangeValue, financeDownPayment, financeLoanAmount, financeTenureMonths, financeEmi, notes`, `variant` relation, `QuotationAccessory[]`, and a `booking` link (on convert).
**Sale** (the invoice) — generated from a Booking: `invoiceNumber(unique), bookingId, …price snapshot…, status, invoicedAt`; anchors the Delivery.
**FinanceDetail** — `bookingId(unique), financeCompany, downPayment, loanAmount, emiAmount, tenureMonths, interestRate(decimal), disbursedAmount(BigInt), status(FinanceStatus)`
**InsuranceDetail** — `bookingId(unique), provider, policyNumber, premium(BigInt), startDate, endDate, status(InsuranceStatus)`
**Payment** — `receiptNumber(unique), context(PaymentContext), bookingId?, saleId?, serviceJobId?, amount(BigInt), mode(PaymentMode), reference, receivedById→User, paidAt`
**InvoiceSetting** — adds a receipt series (`receiptPrefix`, `nextReceiptNumber`), allocated atomically with booking/quotation/invoice numbers.

**Delivery** — `saleId(unique), deliveredAt, deliveredById→User, customerSignatureKey, notes, overrideReason?, googleReviewSent(bool)`
**DeliveryChecklist** — `deliveryId(unique), helmet, charger, keys, documents (all bool)` — the 4 handover items; documents = RC/insurance/invoice/warranty bundle.
**DeliveryPhoto** — `deliveryId, fileKey, label` — delivery photo(s).

**ServiceJob** — `code(unique), customerId, unitId, bookingId?, saleId?, technicianId→User, type, priority, status, odometerKm?, scheduledDate?, checkInAt?, checkOutAt?, expectedDelivery?, actualDelivery?, notes?, underWarranty(bool), partsTotal/labourTotal/discount/taxAmount/total(BigInt), feedbackRating?/feedbackNote?, closedAt?, deletedAt?` (soft-delete, tenant-scoped)
**ServiceComplaint** — `serviceJobId, description, priority(ServicePriority), resolved(bool)`
**ServiceInspectionItem** — `serviceJobId, item, result(InspectionResult), notes?` · unique `(serviceJobId,item)`
**ServicePart** — `serviceJobId, sparePartId?→SparePart, name, qty, unitCost, unitPrice(BigInt), warranty(bool)`
**ServiceLabour** — `serviceJobId, labourItemId?→LabourItem, description, cost(BigInt)`
**ServiceJobPhoto** — `serviceJobId, key(storage), caption?`
**SparePart** (workshop inventory) — `companyId, name, sku, quantity, cost/sellingPrice(BigInt), warrantyMonths, minStock, deletedAt?` · unique `(companyId,sku)`; stock decremented atomically when fitted
**LabourItem** (catalogue) — `companyId, name, defaultCost(BigInt), durationMins, deletedAt?` · unique `(companyId,name)`
**CompanySetting** (service additions) — `freeService{1,2,3}Km`, `freeService{1,2,3}Days` (configurable free-service intervals)

**Expense** — `category(ExpenseCategory), amount(BigInt), paidTo, mode(PaymentMode), spentAt, note, receiptKey?`

**Notification** — company-scoped: `title, message, type(category), priority, entityType?, entityId?, dedupeKey?(unique per company — de-dupes auto-generated), readAt?, archivedAt?, expiresAt?, createdById?`
**ActivityLog** — `actorId→User, action(ActivityAction), entityType, entityId, summary, metadata(jsonb), ip?`
**CompanySetting** (one row per company, `@unique companyId`) — the company configuration framework every module reads from. Strongly-typed columns, grouped:
- _Business_ — `businessName, legalName?, dealerName?, address?, city, state, phone?` (comma-separated for multiple), `email?, website?, tagline` (default "POWERING TOMORROW") — these drive the PDF letterhead via `PdfBrandService`.
- _Localization_ — `currency, timezone, language, dateFormat, timeFormat`
- _GST/Tax_ — `gstEnabled(bool), gstNumber?, taxPercentage(decimal 5,2)`
- _Document prefixes_ — `invoicePrefix, bookingPrefix, quotationPrefix, receiptPrefix, jobCardPrefix`
- _Sales/Service_ — `defaultWarrantyMonths(int), serviceReminderDays(int)`
- _Branding_ — `companyLogo?(key), favicon?(key), primaryColor, secondaryColor`
- _Working hours_ — `workingDays(string[]), workingHours`
- _Notifications_ — `notifyDelivery/Payment/Service/Inventory/Warranty, desktopNotifications` (in-app categories) + `emailEnabled, smsEnabled, whatsappEnabled` (future channels)
- _Backup_ — `backupEnabled(bool), backupFrequency(BackupFrequency enum: DAILY|WEEKLY|MONTHLY)`
- _Invoice text_ — `termsAndConditions?, invoiceFooter?`
- _Audit_ — `updatedById?→User`

**InvoiceSetting** (one row per company, `@unique companyId`) — **sequence counter state only** (separation of concerns; prefixes now live in CompanySetting): `nextInvoiceNumber, nextBookingNumber, nextQuotationNumber, nextReceiptNumber, nextServiceNumber`. `SequenceService` atomically reads the prefix from CompanySetting and increments the matching counter here inside a transaction.

## 3.4 Relationships summary
- **1:N** — Model→Variant→Unit; Customer→(Documents, Notes, TestRides, Bookings, Sales, ServiceJobs); Sale→(SaleItems, Payments, SaleAccessories); ServiceJob→(Parts, Labour, Payments); Booking→(Accessories, Documents, Payments); Delivery→Photos.
- **1:1** — Booking↔Sale (on convert); Sale↔FinanceDetail / InsuranceDetail / Delivery; Delivery↔Checklist; Quotation↔Sale.
- **N:1 to User** — createdBy, assignedTo, salesExecutive, technician, receivedBy, deliveredBy, actor, recipient.

## 3.5 Indexes
```
User(email) unique · Customer(phone) unique · Customer(leadStatus) · Customer(assignedToId) · Customer(name) (trigram/ILIKE)
InventoryUnit(vin) unique · (motorNumber) unique · (batteryNumber) unique · (status) · (variantId)
Booking(code) unique · (customerId) · (status) · (unitId)
Sale(invoiceNumber) unique · (customerId) · (status) · (unitId) · (invoicedAt)
Payment(saleId) · (bookingId) · (serviceJobId) · (paidAt) · (mode)
ServiceJob(code) unique · (unitId) · (customerId) · (status) · (technicianId)
Quotation(code) unique · (customerId) · (status)
Expense(category) · (spentAt)
Notification(companyId, readAt|type|priority|createdAt) · unique(companyId, dedupeKey) · (expiresAt) · ActivityLog(entityType, entityId) · (actorId, createdAt)
Composite for dashboard: Sale(status, invoicedAt) · Payment(context, paidAt) · Expense(category, spentAt)
```

## 3.6 Data-integrity rules (enforced in service layer + DB constraints)
- Unique across `InventoryUnit`: vin, motorNumber, batteryNumber.
- A unit may have at most one **active** (non-cancelled) Booking and one **non-cancelled** Sale.
- Money columns `BigInt >= 0`; `Sale.total = sum(components)`, validated before persist inside a transaction.
- `deletedAt` filtered by default via Prisma middleware (soft delete); Owner-only hard delete bypasses.
- Foreign keys `ON DELETE RESTRICT` for transactional links; child docs/photos `ON DELETE CASCADE`.

## 3.7 Seed data
Company = AZAD EV POINT. Models VX1 / VZ1 / MARS with real variants & colours (from `products/`, `Comptech *.pdf`). One Owner user. Accessory catalogue (helmet, charger, mat, guard). Expense categories via enum. Invoice series `AZAD/25-26/0001`.

> Full Prisma schema file is delivered with **Module 0 (Backend Foundation)** — this doc is its blueprint.
