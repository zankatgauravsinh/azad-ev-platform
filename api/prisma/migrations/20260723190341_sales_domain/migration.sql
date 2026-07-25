-- CreateEnum
CREATE TYPE "FinanceStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InsuranceStatus" AS ENUM ('PENDING', 'ACTIVE', 'EXPIRED', 'CANCELLED');

-- AlterEnum
BEGIN;
CREATE TYPE "QuotationStatus_new" AS ENUM ('DRAFT', 'SENT', 'ACCEPTED', 'EXPIRED', 'CANCELLED');
ALTER TABLE "Quotation" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Quotation" ALTER COLUMN "status" TYPE "QuotationStatus_new" USING ("status"::text::"QuotationStatus_new");
ALTER TYPE "QuotationStatus" RENAME TO "QuotationStatus_old";
ALTER TYPE "QuotationStatus_new" RENAME TO "QuotationStatus";
DROP TYPE "QuotationStatus_old";
ALTER TABLE "Quotation" ALTER COLUMN "status" SET DEFAULT 'DRAFT';
COMMIT;

-- DropForeignKey
ALTER TABLE "FinanceDetail" DROP CONSTRAINT "FinanceDetail_saleId_fkey";

-- DropForeignKey
ALTER TABLE "InsuranceDetail" DROP CONSTRAINT "InsuranceDetail_saleId_fkey";

-- DropIndex
DROP INDEX "FinanceDetail_saleId_key";

-- DropIndex
DROP INDEX "InsuranceDetail_saleId_key";

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "accessoriesTotal" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "actualDelivery" TIMESTAMP(3),
ADD COLUMN     "deliveryExecutiveId" TEXT,
ADD COLUMN     "discount" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "exShowroom" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "exchangeValue" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "extendedWarranty" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "insuranceCharge" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "pendingDocuments" TEXT,
ADD COLUMN     "quotationId" TEXT,
ADD COLUMN     "registration" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "rto" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "taxAmount" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "total" BIGINT NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "FinanceDetail" DROP COLUMN "partnerName",
DROP COLUMN "saleId",
ADD COLUMN     "bookingId" TEXT NOT NULL,
ADD COLUMN     "financeCompany" TEXT NOT NULL,
DROP COLUMN "status",
ADD COLUMN     "status" "FinanceStatus" NOT NULL DEFAULT 'PENDING';

-- AlterTable
ALTER TABLE "InsuranceDetail" DROP COLUMN "company",
DROP COLUMN "saleId",
DROP COLUMN "validFrom",
DROP COLUMN "validTo",
ADD COLUMN     "bookingId" TEXT NOT NULL,
ADD COLUMN     "endDate" TIMESTAMP(3),
ADD COLUMN     "provider" TEXT NOT NULL,
ADD COLUMN     "startDate" TIMESTAMP(3),
ADD COLUMN     "status" "InsuranceStatus" NOT NULL DEFAULT 'PENDING';

-- AlterTable
ALTER TABLE "InvoiceSetting" ADD COLUMN     "nextReceiptNumber" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "receiptPrefix" TEXT NOT NULL DEFAULT 'RCPT/25-26/';

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "receiptNumber" TEXT;

-- AlterTable
ALTER TABLE "Quotation" ADD COLUMN     "exchangeValue" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "financeDownPayment" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "financeEmi" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "financeLoanAmount" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "financeTenureMonths" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "notes" TEXT;

-- AlterTable
ALTER TABLE "Sale" ADD COLUMN     "exchangeValue" BIGINT NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "QuotationAccessory" (
    "id" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "accessoryId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL DEFAULT 1,
    "unitPrice" BIGINT NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuotationAccessory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QuotationAccessory_quotationId_idx" ON "QuotationAccessory"("quotationId");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_quotationId_key" ON "Booking"("quotationId");

-- CreateIndex
CREATE INDEX "Booking_createdAt_idx" ON "Booking"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceDetail_bookingId_key" ON "FinanceDetail"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "InsuranceDetail_bookingId_key" ON "InsuranceDetail"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_receiptNumber_key" ON "Payment"("receiptNumber");

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "Quotation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_deliveryExecutiveId_fkey" FOREIGN KEY ("deliveryExecutiveId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ScooterVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotationAccessory" ADD CONSTRAINT "QuotationAccessory_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "Quotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotationAccessory" ADD CONSTRAINT "QuotationAccessory_accessoryId_fkey" FOREIGN KEY ("accessoryId") REFERENCES "Accessory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceDetail" ADD CONSTRAINT "FinanceDetail_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InsuranceDetail" ADD CONSTRAINT "InsuranceDetail_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

