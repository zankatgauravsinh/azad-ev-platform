-- CreateEnum
CREATE TYPE "ServicePriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'EMERGENCY');

-- CreateEnum
CREATE TYPE "InspectionResult" AS ENUM ('GOOD', 'NEEDS_ATTENTION', 'REPLACED');

-- AlterEnum
BEGIN;
CREATE TYPE "ServiceJobType_new" AS ENUM ('FREE_1', 'FREE_2', 'FREE_3', 'PAID', 'WARRANTY', 'REPAIR', 'INSPECTION');
ALTER TABLE "ServiceJob" ALTER COLUMN "type" DROP DEFAULT;
ALTER TABLE "ServiceJob" ALTER COLUMN "type" TYPE "ServiceJobType_new" USING ("type"::text::"ServiceJobType_new");
ALTER TYPE "ServiceJobType" RENAME TO "ServiceJobType_old";
ALTER TYPE "ServiceJobType_new" RENAME TO "ServiceJobType";
DROP TYPE "ServiceJobType_old";
ALTER TABLE "ServiceJob" ALTER COLUMN "type" SET DEFAULT 'PAID';
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "ServiceStatus_new" AS ENUM ('BOOKED', 'CHECKED_IN', 'DIAGNOSIS', 'WAITING_FOR_PARTS', 'REPAIRING', 'QUALITY_CHECK', 'READY', 'DELIVERED', 'CANCELLED');
ALTER TABLE "ServiceJob" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "ServiceJob" ALTER COLUMN "status" TYPE "ServiceStatus_new" USING ("status"::text::"ServiceStatus_new");
ALTER TYPE "ServiceStatus" RENAME TO "ServiceStatus_old";
ALTER TYPE "ServiceStatus_new" RENAME TO "ServiceStatus";
DROP TYPE "ServiceStatus_old";
ALTER TABLE "ServiceJob" ALTER COLUMN "status" SET DEFAULT 'BOOKED';
COMMIT;

-- DropForeignKey
ALTER TABLE "ServicePart" DROP CONSTRAINT "ServicePart_accessoryId_fkey";

-- AlterTable
ALTER TABLE "CompanySetting" ADD COLUMN     "freeService1Days" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "freeService1Km" INTEGER NOT NULL DEFAULT 500,
ADD COLUMN     "freeService2Days" INTEGER NOT NULL DEFAULT 90,
ADD COLUMN     "freeService2Km" INTEGER NOT NULL DEFAULT 3000,
ADD COLUMN     "freeService3Days" INTEGER NOT NULL DEFAULT 180,
ADD COLUMN     "freeService3Km" INTEGER NOT NULL DEFAULT 6000;

-- AlterTable
ALTER TABLE "ServiceJob" DROP COLUMN "complaint",
ADD COLUMN     "actualDelivery" TIMESTAMP(3),
ADD COLUMN     "bookingId" TEXT,
ADD COLUMN     "checkInAt" TIMESTAMP(3),
ADD COLUMN     "checkOutAt" TIMESTAMP(3),
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "discount" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "expectedDelivery" TIMESTAMP(3),
ADD COLUMN     "feedbackNote" TEXT,
ADD COLUMN     "feedbackRating" INTEGER,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "priority" "ServicePriority" NOT NULL DEFAULT 'MEDIUM',
ADD COLUMN     "saleId" TEXT,
ADD COLUMN     "scheduledDate" TIMESTAMP(3),
ADD COLUMN     "taxAmount" BIGINT NOT NULL DEFAULT 0,
ALTER COLUMN "status" SET DEFAULT 'BOOKED';

-- AlterTable
ALTER TABLE "ServiceLabour" DROP COLUMN "hours",
DROP COLUMN "rate",
ADD COLUMN     "cost" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "labourItemId" TEXT;

-- AlterTable
ALTER TABLE "ServicePart" DROP COLUMN "accessoryId",
ADD COLUMN     "sparePartId" TEXT,
ADD COLUMN     "unitPrice" BIGINT NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "ServiceComplaint" (
    "id" TEXT NOT NULL,
    "serviceJobId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "priority" "ServicePriority" NOT NULL DEFAULT 'MEDIUM',
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceComplaint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceInspectionItem" (
    "id" TEXT NOT NULL,
    "serviceJobId" TEXT NOT NULL,
    "item" TEXT NOT NULL,
    "result" "InspectionResult" NOT NULL DEFAULT 'GOOD',
    "notes" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceInspectionItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceJobPhoto" (
    "id" TEXT NOT NULL,
    "serviceJobId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "caption" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceJobPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SparePart" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "name" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "cost" BIGINT NOT NULL DEFAULT 0,
    "sellingPrice" BIGINT NOT NULL DEFAULT 0,
    "warrantyMonths" INTEGER NOT NULL DEFAULT 0,
    "minStock" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "SparePart_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabourItem" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "name" TEXT NOT NULL,
    "defaultCost" BIGINT NOT NULL DEFAULT 0,
    "durationMins" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "LabourItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ServiceComplaint_serviceJobId_idx" ON "ServiceComplaint"("serviceJobId");

-- CreateIndex
CREATE INDEX "ServiceInspectionItem_serviceJobId_idx" ON "ServiceInspectionItem"("serviceJobId");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceInspectionItem_serviceJobId_item_key" ON "ServiceInspectionItem"("serviceJobId", "item");

-- CreateIndex
CREATE INDEX "ServiceJobPhoto_serviceJobId_idx" ON "ServiceJobPhoto"("serviceJobId");

-- CreateIndex
CREATE INDEX "SparePart_companyId_idx" ON "SparePart"("companyId");

-- CreateIndex
CREATE INDEX "SparePart_deletedAt_idx" ON "SparePart"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SparePart_companyId_sku_key" ON "SparePart"("companyId", "sku");

-- CreateIndex
CREATE INDEX "LabourItem_companyId_idx" ON "LabourItem"("companyId");

-- CreateIndex
CREATE INDEX "LabourItem_deletedAt_idx" ON "LabourItem"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "LabourItem_companyId_name_key" ON "LabourItem"("companyId", "name");

-- CreateIndex
CREATE INDEX "ServiceJob_scheduledDate_idx" ON "ServiceJob"("scheduledDate");

-- CreateIndex
CREATE INDEX "ServiceJob_deletedAt_idx" ON "ServiceJob"("deletedAt");

-- CreateIndex
CREATE INDEX "ServicePart_sparePartId_idx" ON "ServicePart"("sparePartId");

-- AddForeignKey
ALTER TABLE "ServiceJob" ADD CONSTRAINT "ServiceJob_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceJob" ADD CONSTRAINT "ServiceJob_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceComplaint" ADD CONSTRAINT "ServiceComplaint_serviceJobId_fkey" FOREIGN KEY ("serviceJobId") REFERENCES "ServiceJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceInspectionItem" ADD CONSTRAINT "ServiceInspectionItem_serviceJobId_fkey" FOREIGN KEY ("serviceJobId") REFERENCES "ServiceJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServicePart" ADD CONSTRAINT "ServicePart_sparePartId_fkey" FOREIGN KEY ("sparePartId") REFERENCES "SparePart"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceLabour" ADD CONSTRAINT "ServiceLabour_labourItemId_fkey" FOREIGN KEY ("labourItemId") REFERENCES "LabourItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceJobPhoto" ADD CONSTRAINT "ServiceJobPhoto_serviceJobId_fkey" FOREIGN KEY ("serviceJobId") REFERENCES "ServiceJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

