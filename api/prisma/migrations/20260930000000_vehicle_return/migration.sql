-- Vehicle Return workflow (Group 2: schema only, no business logic).

-- Sequence prefixes + counters (defaults backfill existing single-tenant rows).
ALTER TABLE "CompanySetting" ADD COLUMN "returnPrefix" TEXT NOT NULL DEFAULT 'RET';
ALTER TABLE "CompanySetting" ADD COLUMN "creditNotePrefix" TEXT NOT NULL DEFAULT 'CN';
ALTER TABLE "CompanySetting" ADD COLUMN "refundPrefix" TEXT NOT NULL DEFAULT 'RF';
ALTER TABLE "InvoiceSetting" ADD COLUMN "nextReturnNumber" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "InvoiceSetting" ADD COLUMN "nextCreditNoteNumber" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "InvoiceSetting" ADD COLUMN "nextRefundNumber" INTEGER NOT NULL DEFAULT 1;

-- Enums.
CREATE TYPE "ReturnStatus" AS ENUM ('REQUESTED', 'INSPECTION', 'APPROVED', 'REJECTED', 'COMPLETED', 'CANCELLED');
CREATE TYPE "ReturnDisposition" AS ENUM ('AVAILABLE', 'IN_SERVICE', 'SCRAP');

-- Vehicle return.
CREATE TABLE "VehicleReturn" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "returnNumber" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "status" "ReturnStatus" NOT NULL DEFAULT 'REQUESTED',
    "reason" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "inspectionOk" BOOLEAN,
    "inspectionNotes" TEXT,
    "inspectedById" TEXT,
    "inspectedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "disposition" "ReturnDisposition",
    "deductionAmount" BIGINT NOT NULL DEFAULT 0,
    "deductionReason" TEXT,
    "completedById" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "VehicleReturn_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "VehicleReturn_companyId_returnNumber_key" ON "VehicleReturn"("companyId", "returnNumber");
CREATE INDEX "VehicleReturn_companyId_idx" ON "VehicleReturn"("companyId");
CREATE INDEX "VehicleReturn_saleId_idx" ON "VehicleReturn"("saleId");
CREATE INDEX "VehicleReturn_unitId_idx" ON "VehicleReturn"("unitId");
CREATE INDEX "VehicleReturn_status_idx" ON "VehicleReturn"("status");
-- At most one OPEN (non-terminal) return per sale — DB-level double-submit guard.
CREATE UNIQUE INDEX "VehicleReturn_saleId_active_key" ON "VehicleReturn"("saleId")
    WHERE "status" IN ('REQUESTED', 'INSPECTION', 'APPROVED');

-- Credit note (invoice/GST reversal).
CREATE TABLE "CreditNote" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "creditNoteNumber" TEXT NOT NULL,
    "returnId" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "amount" BIGINT NOT NULL DEFAULT 0,
    "gstAmount" BIGINT NOT NULL DEFAULT 0,
    "total" BIGINT NOT NULL DEFAULT 0,
    "reason" TEXT NOT NULL,
    "issuedById" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CreditNote_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CreditNote_returnId_key" ON "CreditNote"("returnId");
CREATE UNIQUE INDEX "CreditNote_companyId_creditNoteNumber_key" ON "CreditNote"("companyId", "creditNoteNumber");
CREATE INDEX "CreditNote_companyId_idx" ON "CreditNote"("companyId");
CREATE INDEX "CreditNote_saleId_idx" ON "CreditNote"("saleId");

-- Refund (actual money returned).
CREATE TABLE "Refund" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "refundNumber" TEXT NOT NULL,
    "returnId" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "amount" BIGINT NOT NULL DEFAULT 0,
    "method" "PaymentMode" NOT NULL,
    "reference" TEXT,
    "note" TEXT,
    "refundedById" TEXT,
    "refundedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Refund_companyId_refundNumber_key" ON "Refund"("companyId", "refundNumber");
CREATE INDEX "Refund_companyId_idx" ON "Refund"("companyId");
CREATE INDEX "Refund_returnId_idx" ON "Refund"("returnId");
CREATE INDEX "Refund_saleId_idx" ON "Refund"("saleId");

-- Foreign keys.
ALTER TABLE "VehicleReturn" ADD CONSTRAINT "VehicleReturn_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VehicleReturn" ADD CONSTRAINT "VehicleReturn_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VehicleReturn" ADD CONSTRAINT "VehicleReturn_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "InventoryUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VehicleReturn" ADD CONSTRAINT "VehicleReturn_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "VehicleReturn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "VehicleReturn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
