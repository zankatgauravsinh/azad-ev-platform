-- Document share links (a customer opens a quotation / invoice / delivery note / booking confirmation PDF from a
-- link sent on WhatsApp, until it expires) and the WhatsApp greeting per document in Settings. Additive.

-- CreateEnum
CREATE TYPE "DocumentShareType" AS ENUM ('QUOTATION', 'INVOICE', 'DELIVERY_NOTE', 'BOOKING_CONFIRMATION');

-- AlterTable
ALTER TABLE "CompanySetting" ADD COLUMN     "whatsappBookingMessage" TEXT,
ADD COLUMN     "whatsappDeliveryMessage" TEXT,
ADD COLUMN     "whatsappInvoiceMessage" TEXT,
ADD COLUMN     "whatsappQuotationMessage" TEXT;

-- CreateTable
CREATE TABLE "DocumentShareLink" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "tokenHash" TEXT NOT NULL,
    "docType" "DocumentShareType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "openCount" INTEGER NOT NULL DEFAULT 0,
    "lastOpenedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentShareLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DocumentShareLink_tokenHash_key" ON "DocumentShareLink"("tokenHash");

-- CreateIndex
CREATE INDEX "DocumentShareLink_companyId_idx" ON "DocumentShareLink"("companyId");

-- CreateIndex
CREATE INDEX "DocumentShareLink_docType_entityId_idx" ON "DocumentShareLink"("docType", "entityId");

