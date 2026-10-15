-- RTO invoice module: one dealer-entered RTO invoice per booking (price + GST added on top), its own
-- number series (CompanySetting.rtoInvoicePrefix / InvoiceSetting.nextRtoInvoiceNumber). Additive only.

-- AlterTable
ALTER TABLE "CompanySetting" ADD COLUMN     "rtoInvoicePrefix" TEXT NOT NULL DEFAULT 'RTO';

-- AlterTable
ALTER TABLE "InvoiceSetting" ADD COLUMN     "nextRtoInvoiceNumber" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "RtoInvoice" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "invoiceNumber" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "invoiceDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sellingPrice" BIGINT NOT NULL,
    "gstRateBp" INTEGER NOT NULL,
    "supplyType" TEXT NOT NULL,
    "cgst" BIGINT NOT NULL DEFAULT 0,
    "sgst" BIGINT NOT NULL DEFAULT 0,
    "igst" BIGINT NOT NULL DEFAULT 0,
    "gstAmount" BIGINT NOT NULL,
    "total" BIGINT NOT NULL,
    "hsnCode" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RtoInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RtoInvoice_bookingId_key" ON "RtoInvoice"("bookingId");

-- CreateIndex
CREATE INDEX "RtoInvoice_companyId_invoiceDate_idx" ON "RtoInvoice"("companyId", "invoiceDate");

-- CreateIndex
CREATE INDEX "RtoInvoice_customerId_idx" ON "RtoInvoice"("customerId");

-- CreateIndex
CREATE INDEX "RtoInvoice_unitId_idx" ON "RtoInvoice"("unitId");

-- CreateIndex
CREATE UNIQUE INDEX "RtoInvoice_companyId_invoiceNumber_key" ON "RtoInvoice"("companyId", "invoiceNumber");

-- AddForeignKey
ALTER TABLE "RtoInvoice" ADD CONSTRAINT "RtoInvoice_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RtoInvoice" ADD CONSTRAINT "RtoInvoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RtoInvoice" ADD CONSTRAINT "RtoInvoice_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "InventoryUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

