-- CreateEnum
CREATE TYPE "TaxCodeType" AS ENUM ('HSN', 'SAC');

-- CreateEnum
CREATE TYPE "TaxTreatment" AS ENUM ('TAXABLE', 'EXEMPT', 'NON_TAXABLE', 'NIL_RATED');

-- AlterTable
ALTER TABLE "CompanySetting" ADD COLUMN     "gstStateCode" TEXT;

-- CreateTable
CREATE TABLE "TaxClassification" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "name" TEXT NOT NULL,
    "codeType" "TaxCodeType" NOT NULL,
    "code" TEXT,
    "treatment" "TaxTreatment" NOT NULL DEFAULT 'TAXABLE',
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "TaxClassification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxRate" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "classificationId" TEXT NOT NULL,
    "ratePercent" DECIMAL(5,2) NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxRate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TaxClassification_companyId_idx" ON "TaxClassification"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "TaxClassification_companyId_name_key" ON "TaxClassification"("companyId", "name");

-- CreateIndex
CREATE INDEX "TaxRate_companyId_idx" ON "TaxRate"("companyId");

-- CreateIndex
CREATE INDEX "TaxRate_classificationId_effectiveFrom_idx" ON "TaxRate"("classificationId", "effectiveFrom");

-- AddForeignKey
ALTER TABLE "TaxRate" ADD CONSTRAINT "TaxRate_classificationId_fkey" FOREIGN KEY ("classificationId") REFERENCES "TaxClassification"("id") ON DELETE CASCADE ON UPDATE CASCADE;
