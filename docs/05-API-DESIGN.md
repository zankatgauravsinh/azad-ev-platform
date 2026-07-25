# AZAD EV POINT — 5. API Design (REST / NestJS)

Base URL `…/api/v1`. JSON. Auth via `Authorization: Bearer <accessToken>`. All list endpoints support `?page&pageSize&sort&order&q&<filters>` and return `{ data, meta:{ page, pageSize, total, totalPages } }`. Errors are RFC-7807-style `{ statusCode, error, message, details? }`.

---

## 5.1 Conventions
- **Verbs:** `GET` list/detail, `POST` create, `PATCH` partial update, `DELETE` soft-delete (hard-delete = `DELETE ?hard=true`, Owner only).
- **IDs:** UUID path params. **Money:** integer paise in/out.
- **Validation:** every body/query parsed by a Zod schema (`ZodValidationPipe`); invalid → 422.
- **Idempotency:** create endpoints for Sale/Booking accept optional `Idempotency-Key` header.
- **Pagination default:** `page=1, pageSize=20` (max 100).

## 5.2 Auth
```
POST   /auth/login            {email,password} → {accessToken, refreshToken, user}
POST   /auth/refresh          {refreshToken}   → {accessToken}
POST   /auth/logout           → 204
GET    /auth/me               → current user
PATCH  /auth/password         {current,next}   → 204
```

## 5.3 Users  (Owner, Manager-read)
```
GET    /users            list/filter by role,isActive
POST   /users            create {name,email,phone,role,password}
GET    /users/:id
PATCH  /users/:id        update profile/role/isActive
PATCH  /users/:id/password   (admin reset)
DELETE /users/:id        deactivate (soft)
```

## 5.4 Customers
```
GET    /customers            q, leadStatus, assignedToId, city
POST   /customers
GET    /customers/:id
PATCH  /customers/:id
DELETE /customers/:id        soft
GET    /customers/:id/timeline     merged notes+testrides+bookings+sales+service
POST   /customers/:id/notes        {body}
GET    /customers/:id/documents
POST   /customers/:id/documents    multipart {type,file}
DELETE /customers/:id/documents/:docId
```

## 5.5 Inventory
```
GET    /models                POST /models     PATCH/DELETE /models/:id
GET    /variants ?modelId     POST /variants   PATCH/DELETE /variants/:id
GET    /units    q,status,variantId    POST /units
GET    /units/:id             PATCH /units/:id     DELETE /units/:id
PATCH  /units/:id/status      {status,reason}  (guarded transitions)
GET    /inventory/summary     counts by status (dashboard/available)
```

## 5.6 Test Rides
```
GET    /test-rides   status,executiveId,date range
POST   /test-rides           (reserves unit if assigned)
GET    /test-rides/:id
PATCH  /test-rides/:id        status/assignment
PATCH  /test-rides/:id/feedback   {rating,note}
POST   /test-rides/:id/convert    → creates draft Booking
```

## 5.7 Bookings
```
GET    /bookings    status,customerId,executiveId
POST   /bookings             {customerId,unitId,accessories[],finance,insurance,advance{...}}  (tx: unit→BOOKED)
GET    /bookings/:id
PATCH  /bookings/:id
POST   /bookings/:id/cancel        (tx: unit→AVAILABLE)
POST   /bookings/:id/convert       → creates Sale carrying advance
POST   /bookings/:id/documents     multipart
GET    /bookings/:id/documents
```

## 5.8 Quotations
```
GET  /quotations   POST /quotations   GET /quotations/:id
PATCH /quotations/:id   POST /quotations/:id/accept  → draft Sale
GET  /quotations/:id/pdf
```

## 5.9 Sales & Invoices
```
GET    /sales      status,customerId,dateRange
POST   /sales               (from booking or direct; tx builds items+finance+insurance)
GET    /sales/:id
PATCH  /sales/:id
POST   /sales/:id/invoice          assigns invoiceNumber (InvoiceSetting series), status→INVOICED
POST   /sales/:id/cancel
GET    /sales/:id/invoice/pdf      print-ready invoice
POST   /sales/:id/finance          upsert FinanceDetail
POST   /sales/:id/insurance        upsert InsuranceDetail
```

## 5.10 Payments
```
GET    /payments   context,saleId,bookingId,serviceJobId,dateRange,mode
POST   /payments            {context,refId,amount,mode,reference}  (updates balanceDue)
GET    /sales/:id/ledger    payments + balanceDue
DELETE /payments/:id        (Owner/Manager, reason logged)
```

## 5.11 Deliveries
```
GET    /deliveries   pending|completed
POST   /deliveries          {saleId,checklist,overrideReason?} (blocks if balanceDue>0 w/o override; tx: unit→DELIVERED)
GET    /deliveries/:id
POST   /deliveries/:id/photos       multipart {label,file}
POST   /deliveries/:id/signature    multipart (canvas PNG)
POST   /deliveries/:id/customer-photo multipart
POST   /deliveries/:id/review-reminder   marks googleReviewSent + notification
```

## 5.12 Service
```
GET    /service-jobs   status,technicianId,customerId,unitId
POST   /service-jobs
GET    /service-jobs/:id
PATCH  /service-jobs/:id           status/assignment
POST   /service-jobs/:id/parts     {accessoryId?,name,qty,unitCost,warranty}
DELETE /service-jobs/:id/parts/:partId
POST   /service-jobs/:id/labour    {description,hours,rate}
DELETE /service-jobs/:id/labour/:labourId
POST   /service-jobs/:id/close     recomputes totals
GET    /units/:id/service-history
GET    /service/due                units past service interval → dashboard
```

## 5.13 Accessories / Parts
```
GET /accessories   POST /accessories   PATCH/DELETE /accessories/:id   (stock managed on booking/sale/service)
```

## 5.14 Expenses
```
GET    /expenses   category,dateRange     POST /expenses   PATCH/DELETE /expenses/:id
POST   /expenses/:id/receipt   multipart
GET    /expenses/summary   grouped by category for a period
```

## 5.15 Dashboard
```
GET /dashboard/summary
  → { todaySales, todayBookings, todayCollections, availableUnits,
      pendingDeliveries, pendingPaymentsTotal, serviceDueCount,
      monthSales, monthProfit, monthExpenses }
GET /dashboard/charts?range=30d
  → { salesTrend[], collectionsTrend[], topModels[], expenseBreakdown[] }
```

## 5.16 Reports (only these six)
```
GET /reports/sales?from&to            GET /reports/expenses?from&to
GET /reports/profit?from&to           GET /reports/inventory
GET /reports/pending-payments         GET /reports/service?from&to
GET /reports/:name/export?format=pdf|xlsx   → file stream  (every report exports PDF + Excel)
```

## 5.17 Search / Notifications / Activity / Settings / Uploads
```
GET  /search?q                global search across Customer name, Phone number, VIN, Invoice no, Booking code, Service code → grouped {customers,units,bookings,sales,service}
GET  /notifications           unread first     PATCH /notifications/:id/read     POST /notifications/read-all
GET  /activity-log            entityType,entityId,actorId,dateRange
GET  /settings/company        PATCH /settings/company
GET  /settings/invoice        PATCH /settings/invoice
POST /settings/backup         → SQL dump download (Owner)
POST /uploads                 multipart (generic; returns {fileKey,url}) — used by StorageService
GET  /uploads/:key            streamed with access check
```

## 5.18 Authorization matrix (RolesGuard)
Owner = full access. Manager = everything **except Settings**. Sales Executive = Customers/Bookings/Sales/Delivery. Technician = Service only.

| Area | Owner | Manager | Sales Exec | Technician |
|---|:--:|:--:|:--:|:--:|
| Dashboard | ✅ | ✅ | ❌ | ❌ |
| Customers | ✅ | ✅ | ✅ | ❌ |
| Inventory (write / read) | ✅ / ✅ | ✅ / ✅ | ❌ / read | ❌ / ❌ |
| Test Rides / Bookings / Sales / Delivery | ✅ | ✅ | ✅ | ❌ |
| Payments (sale/booking) | ✅ | ✅ | ✅ | ❌ |
| Service (jobs, parts, labour, payments) | ✅ | ✅ | ❌ | ✅ |
| Expenses | ✅ | ✅ | ❌ | ❌ |
| Reports | ✅ | ✅ | ❌ | ❌ |
| **Settings** (Users, Company, Invoice, Backup) | ✅ | ❌ | ❌ | ❌ |
| Own Profile / password | ✅ | ✅ | ✅ | ✅ |
| Hard delete | ✅ | ❌ | ❌ | ❌ |

Sales Exec needs read access to available inventory to book/sell (unit picker), but cannot create/edit units.

## 5.19 Cross-cutting behaviour
- **Guards order:** `JwtAuthGuard` → `RolesGuard`. `@Public()` opts out (login/refresh).
- **Interceptors:** `LoggingInterceptor` (method, path, user, ms), `TransformInterceptor` (envelope + meta).
- **Filter:** `AllExceptionsFilter` maps Prisma/known errors → clean HTTP + logs stack (never leaks internals).
- **Transactions:** booking-create, booking-cancel, booking-convert, sale-create, sale-invoice, payment-create, delivery-complete, service-close all run in `prisma.$transaction`.
- **Activity log + notifications** emitted from service layer via a `DomainEvents` helper (no controller noise).
- **Rate limiting** on `/auth/*`. **Throttling** global default. **Helmet + CORS** locked to the web origin.
