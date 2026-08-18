-- CreateEnum
CREATE TYPE "WarrantyStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'CANCELLED', 'CLAIMED');

-- CreateEnum
CREATE TYPE "WarrantyClaimStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "FreeServiceStatus" AS ENUM ('PENDING', 'COMPLETED', 'MISSED');

-- CreateEnum
CREATE TYPE "AmcPlanType" AS ENUM ('SILVER', 'GOLD', 'PLATINUM', 'CUSTOM');

-- CreateEnum
CREATE TYPE "AmcStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'CANCELLED');

-- AlterTable
ALTER TABLE "CompanySetting" ADD COLUMN     "amcEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "amcPrefix" TEXT NOT NULL DEFAULT 'AMC',
ADD COLUMN     "claimPrefix" TEXT NOT NULL DEFAULT 'CLM',
ADD COLUMN     "warrantyEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "warrantyPrefix" TEXT NOT NULL DEFAULT 'WR',
ADD COLUMN     "warrantyReminderDays" INTEGER NOT NULL DEFAULT 30;

-- AlterTable
ALTER TABLE "InvoiceSetting" ADD COLUMN     "nextAmcNumber" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "nextClaimNumber" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "nextWarrantyNumber" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "Warranty" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "warrantyNumber" TEXT NOT NULL,
    "status" "WarrantyStatus" NOT NULL DEFAULT 'ACTIVE',
    "customerId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "bookingId" TEXT,
    "saleId" TEXT,
    "invoiceNumber" TEXT,
    "motorNumber" TEXT,
    "batteryNumber" TEXT,
    "purchaseDate" TIMESTAMP(3) NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "periodMonths" INTEGER NOT NULL,
    "coverage" JSONB NOT NULL DEFAULT '[]',
    "dealerNotes" TEXT,
    "customerNotes" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Warranty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarrantyClaim" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "claimNumber" TEXT NOT NULL,
    "status" "WarrantyClaimStatus" NOT NULL DEFAULT 'PENDING',
    "warrantyId" TEXT NOT NULL,
    "complaint" TEXT NOT NULL,
    "diagnosis" TEXT,
    "partsReplaced" JSONB NOT NULL DEFAULT '[]',
    "labour" TEXT,
    "technicianId" TEXT,
    "claimDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completionDate" TIMESTAMP(3),
    "claimCost" BIGINT NOT NULL DEFAULT 0,
    "manufacturerClaimAmount" BIGINT NOT NULL DEFAULT 0,
    "dealerCost" BIGINT NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WarrantyClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FreeService" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "warrantyId" TEXT NOT NULL,
    "serviceNumber" INTEGER NOT NULL,
    "status" "FreeServiceStatus" NOT NULL DEFAULT 'PENDING',
    "dueDate" TIMESTAMP(3) NOT NULL,
    "completedDate" TIMESTAMP(3),
    "technicianId" TEXT,
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FreeService_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AmcPlan" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "amcNumber" TEXT NOT NULL,
    "status" "AmcStatus" NOT NULL DEFAULT 'ACTIVE',
    "planType" "AmcPlanType" NOT NULL DEFAULT 'SILVER',
    "customerId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "visitsIncluded" INTEGER NOT NULL DEFAULT 3,
    "visitsUsed" INTEGER NOT NULL DEFAULT 0,
    "price" BIGINT NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AmcPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AmcVisit" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "amcPlanId" TEXT NOT NULL,
    "visitNumber" INTEGER NOT NULL,
    "visitDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "technicianId" TEXT,
    "workDone" TEXT NOT NULL,
    "partsUsed" TEXT,
    "amount" BIGINT NOT NULL DEFAULT 0,
    "coveredUnderAmc" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AmcVisit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Warranty_companyId_status_idx" ON "Warranty"("companyId", "status");

-- CreateIndex
CREATE INDEX "Warranty_companyId_endDate_idx" ON "Warranty"("companyId", "endDate");

-- CreateIndex
CREATE INDEX "Warranty_companyId_customerId_idx" ON "Warranty"("companyId", "customerId");

-- CreateIndex
CREATE INDEX "Warranty_unitId_idx" ON "Warranty"("unitId");

-- CreateIndex
CREATE UNIQUE INDEX "Warranty_companyId_warrantyNumber_key" ON "Warranty"("companyId", "warrantyNumber");

-- CreateIndex
CREATE INDEX "WarrantyClaim_companyId_status_idx" ON "WarrantyClaim"("companyId", "status");

-- CreateIndex
CREATE INDEX "WarrantyClaim_warrantyId_idx" ON "WarrantyClaim"("warrantyId");

-- CreateIndex
CREATE INDEX "WarrantyClaim_companyId_claimDate_idx" ON "WarrantyClaim"("companyId", "claimDate");

-- CreateIndex
CREATE UNIQUE INDEX "WarrantyClaim_companyId_claimNumber_key" ON "WarrantyClaim"("companyId", "claimNumber");

-- CreateIndex
CREATE INDEX "FreeService_warrantyId_idx" ON "FreeService"("warrantyId");

-- CreateIndex
CREATE INDEX "FreeService_companyId_status_idx" ON "FreeService"("companyId", "status");

-- CreateIndex
CREATE INDEX "FreeService_companyId_dueDate_idx" ON "FreeService"("companyId", "dueDate");

-- CreateIndex
CREATE INDEX "AmcPlan_companyId_status_idx" ON "AmcPlan"("companyId", "status");

-- CreateIndex
CREATE INDEX "AmcPlan_companyId_endDate_idx" ON "AmcPlan"("companyId", "endDate");

-- CreateIndex
CREATE INDEX "AmcPlan_companyId_customerId_idx" ON "AmcPlan"("companyId", "customerId");

-- CreateIndex
CREATE INDEX "AmcPlan_unitId_idx" ON "AmcPlan"("unitId");

-- CreateIndex
CREATE UNIQUE INDEX "AmcPlan_companyId_amcNumber_key" ON "AmcPlan"("companyId", "amcNumber");

-- CreateIndex
CREATE INDEX "AmcVisit_amcPlanId_idx" ON "AmcVisit"("amcPlanId");

-- CreateIndex
CREATE INDEX "AmcVisit_companyId_visitDate_idx" ON "AmcVisit"("companyId", "visitDate");

-- AddForeignKey
ALTER TABLE "Warranty" ADD CONSTRAINT "Warranty_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Warranty" ADD CONSTRAINT "Warranty_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "InventoryUnit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarrantyClaim" ADD CONSTRAINT "WarrantyClaim_warrantyId_fkey" FOREIGN KEY ("warrantyId") REFERENCES "Warranty"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FreeService" ADD CONSTRAINT "FreeService_warrantyId_fkey" FOREIGN KEY ("warrantyId") REFERENCES "Warranty"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AmcPlan" ADD CONSTRAINT "AmcPlan_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AmcPlan" ADD CONSTRAINT "AmcPlan_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "InventoryUnit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AmcVisit" ADD CONSTRAINT "AmcVisit_amcPlanId_fkey" FOREIGN KEY ("amcPlanId") REFERENCES "AmcPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

