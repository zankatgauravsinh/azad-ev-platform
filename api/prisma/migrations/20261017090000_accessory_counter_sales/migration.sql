-- Accessory counter sales: their own invoice (AccessorySale + items), payments (PaymentContext ACCESSORY) and
-- refunds on cancellation (Refund.returnId / saleId become optional). Settings: invoice prefix + GST on/off + rate.
-- Additive: no existing row changes.

-- CreateEnum
CREATE TYPE "AccessorySaleStatus" AS ENUM ('ACTIVE', 'CANCELLED');

-- AlterEnum
ALTER TYPE "PaymentContext" ADD VALUE 'ACCESSORY';

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "accessorySaleId" TEXT;

-- AlterTable
ALTER TABLE "CompanySetting" ADD COLUMN     "accessoryGstEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "accessoryGstRateBp" INTEGER NOT NULL DEFAULT 1800,
ADD COLUMN     "accessoryInvoicePrefix" TEXT NOT NULL DEFAULT 'ACC';

-- AlterTable
ALTER TABLE "InvoiceSetting" ADD COLUMN     "nextAccessoryInvoiceNumber" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Refund" ADD COLUMN     "accessorySaleId" TEXT,
ALTER COLUMN "returnId" DROP NOT NULL,
ALTER COLUMN "saleId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "AccessorySale" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "invoiceNumber" TEXT NOT NULL,
    "invoiceDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "AccessorySaleStatus" NOT NULL DEFAULT 'ACTIVE',
    "customerId" TEXT NOT NULL,
    "bookingId" TEXT,
    "gstApplied" BOOLEAN NOT NULL DEFAULT false,
    "supplyType" TEXT,
    "subtotal" BIGINT NOT NULL DEFAULT 0,
    "cgst" BIGINT NOT NULL DEFAULT 0,
    "sgst" BIGINT NOT NULL DEFAULT 0,
    "igst" BIGINT NOT NULL DEFAULT 0,
    "gstAmount" BIGINT NOT NULL DEFAULT 0,
    "total" BIGINT NOT NULL DEFAULT 0,
    "notes" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelReason" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccessorySale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessorySaleItem" (
    "id" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "accessoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "hsnCode" TEXT,
    "qty" INTEGER NOT NULL,
    "unitPrice" BIGINT NOT NULL,
    "gstRateBp" INTEGER NOT NULL DEFAULT 0,
    "taxable" BIGINT NOT NULL DEFAULT 0,
    "gstAmount" BIGINT NOT NULL DEFAULT 0,
    "lineTotal" BIGINT NOT NULL,
    "costAtSale" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "AccessorySaleItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AccessorySale_companyId_invoiceDate_idx" ON "AccessorySale"("companyId", "invoiceDate");

-- CreateIndex
CREATE INDEX "AccessorySale_customerId_idx" ON "AccessorySale"("customerId");

-- CreateIndex
CREATE INDEX "AccessorySale_bookingId_idx" ON "AccessorySale"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "AccessorySale_companyId_invoiceNumber_key" ON "AccessorySale"("companyId", "invoiceNumber");

-- CreateIndex
CREATE INDEX "AccessorySaleItem_saleId_idx" ON "AccessorySaleItem"("saleId");

-- CreateIndex
CREATE INDEX "AccessorySaleItem_accessoryId_idx" ON "AccessorySaleItem"("accessoryId");

-- CreateIndex
CREATE INDEX "Payment_accessorySaleId_idx" ON "Payment"("accessorySaleId");

-- CreateIndex
CREATE INDEX "Refund_accessorySaleId_idx" ON "Refund"("accessorySaleId");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_accessorySaleId_fkey" FOREIGN KEY ("accessorySaleId") REFERENCES "AccessorySale"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_accessorySaleId_fkey" FOREIGN KEY ("accessorySaleId") REFERENCES "AccessorySale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessorySale" ADD CONSTRAINT "AccessorySale_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessorySale" ADD CONSTRAINT "AccessorySale_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessorySaleItem" ADD CONSTRAINT "AccessorySaleItem_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "AccessorySale"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessorySaleItem" ADD CONSTRAINT "AccessorySaleItem_accessoryId_fkey" FOREIGN KEY ("accessoryId") REFERENCES "Accessory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

