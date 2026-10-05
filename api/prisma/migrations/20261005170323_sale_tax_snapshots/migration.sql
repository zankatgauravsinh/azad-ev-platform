-- CreateEnum
CREATE TYPE "GstAdjustmentTreatment" AS ENUM ('REDUCES_VEHICLE_TAXABLE_VALUE', 'AFTER_TAX_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "TaxSupplyType" AS ENUM ('INTRA', 'INTER');

-- CreateEnum
CREATE TYPE "TaxPricingMode" AS ENUM ('INCLUSIVE', 'EXCLUSIVE');

-- CreateEnum
CREATE TYPE "TaxLineComponent" AS ENUM ('VEHICLE', 'ACCESSORY', 'EXTENDED_WARRANTY', 'RTO', 'INSURANCE', 'REGISTRATION');

-- CreateEnum
CREATE TYPE "TaxMappedComponent" AS ENUM ('EXTENDED_WARRANTY', 'RTO', 'INSURANCE', 'REGISTRATION');

-- AlterTable
ALTER TABLE "Accessory" ADD COLUMN     "taxClassificationId" TEXT;

-- AlterTable
ALTER TABLE "CompanySetting" ADD COLUMN     "gstDiscountTreatment" "GstAdjustmentTreatment",
ADD COLUMN     "gstExchangeTreatment" "GstAdjustmentTreatment";

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "gstStateCode" TEXT;

-- AlterTable
ALTER TABLE "ScooterModel" ADD COLUMN     "taxClassificationId" TEXT;

-- CreateTable
CREATE TABLE "TaxComponentMapping" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "componentType" "TaxMappedComponent" NOT NULL,
    "classificationId" TEXT NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxComponentMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxSnapshot" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "saleId" TEXT NOT NULL,
    "engineVersion" TEXT NOT NULL,
    "asOf" DATE NOT NULL,
    "supplyType" "TaxSupplyType" NOT NULL,
    "supplierGstin" TEXT NOT NULL,
    "supplierStateCode" TEXT NOT NULL,
    "placeOfSupplyStateCode" TEXT NOT NULL,
    "discountTreatment" "GstAdjustmentTreatment",
    "exchangeTreatment" "GstAdjustmentTreatment",
    "discountAmount" BIGINT NOT NULL DEFAULT 0,
    "exchangeAmount" BIGINT NOT NULL DEFAULT 0,
    "totalGross" BIGINT NOT NULL,
    "totalTaxable" BIGINT NOT NULL,
    "totalCGST" BIGINT NOT NULL,
    "totalSGST" BIGINT NOT NULL,
    "totalIGST" BIGINT NOT NULL,
    "totalTax" BIGINT NOT NULL,
    "totalRoundOff" BIGINT NOT NULL,
    "documentTotal" BIGINT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaxSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxSnapshotLine" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "snapshotId" TEXT NOT NULL,
    "lineKey" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "componentType" "TaxLineComponent" NOT NULL,
    "description" TEXT NOT NULL,
    "sourceId" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitAmount" BIGINT NOT NULL,
    "classificationId" TEXT NOT NULL,
    "classificationName" TEXT NOT NULL,
    "codeType" "TaxCodeType" NOT NULL,
    "code" TEXT,
    "treatment" "TaxTreatment" NOT NULL,
    "ratePercent" DECIMAL(5,2),
    "pricingMode" "TaxPricingMode" NOT NULL,
    "grossAmount" BIGINT NOT NULL,
    "taxableAmount" BIGINT NOT NULL,
    "cgst" BIGINT NOT NULL,
    "sgst" BIGINT NOT NULL,
    "igst" BIGINT NOT NULL,
    "taxTotal" BIGINT NOT NULL,
    "roundOff" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaxSnapshotLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TaxComponentMapping_companyId_idx" ON "TaxComponentMapping"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "TaxComponentMapping_companyId_componentType_key" ON "TaxComponentMapping"("companyId", "componentType");

-- CreateIndex
CREATE UNIQUE INDEX "TaxSnapshot_saleId_key" ON "TaxSnapshot"("saleId");

-- CreateIndex
CREATE INDEX "TaxSnapshot_companyId_idx" ON "TaxSnapshot"("companyId");

-- CreateIndex
CREATE INDEX "TaxSnapshot_companyId_asOf_idx" ON "TaxSnapshot"("companyId", "asOf");

-- CreateIndex
CREATE INDEX "TaxSnapshotLine_companyId_idx" ON "TaxSnapshotLine"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "TaxSnapshotLine_snapshotId_lineKey_key" ON "TaxSnapshotLine"("snapshotId", "lineKey");

-- CreateIndex
CREATE UNIQUE INDEX "TaxSnapshotLine_snapshotId_position_key" ON "TaxSnapshotLine"("snapshotId", "position");

-- AddForeignKey
ALTER TABLE "ScooterModel" ADD CONSTRAINT "ScooterModel_taxClassificationId_fkey" FOREIGN KEY ("taxClassificationId") REFERENCES "TaxClassification"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Accessory" ADD CONSTRAINT "Accessory_taxClassificationId_fkey" FOREIGN KEY ("taxClassificationId") REFERENCES "TaxClassification"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxComponentMapping" ADD CONSTRAINT "TaxComponentMapping_classificationId_fkey" FOREIGN KEY ("classificationId") REFERENCES "TaxClassification"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxSnapshot" ADD CONSTRAINT "TaxSnapshot_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxSnapshotLine" ADD CONSTRAINT "TaxSnapshotLine_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "TaxSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
