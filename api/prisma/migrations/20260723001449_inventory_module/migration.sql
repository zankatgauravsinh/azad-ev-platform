-- AlterEnum
ALTER TYPE "UnitStatus" ADD VALUE 'RETURNED';

-- AlterTable
ALTER TABLE "InventoryUnit" ADD COLUMN     "notes" TEXT;

-- CreateTable
CREATE TABLE "InventoryEvent" (
    "id" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "fromStatus" "UnitStatus",
    "toStatus" "UnitStatus" NOT NULL,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryUnitPhoto" (
    "id" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "fileKey" TEXT NOT NULL,
    "label" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryUnitPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryUnitDocument" (
    "id" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "type" "DocumentType" NOT NULL,
    "fileKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryUnitDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InventoryEvent_unitId_createdAt_idx" ON "InventoryEvent"("unitId", "createdAt");

-- CreateIndex
CREATE INDEX "InventoryUnitPhoto_unitId_idx" ON "InventoryUnitPhoto"("unitId");

-- CreateIndex
CREATE INDEX "InventoryUnitDocument_unitId_idx" ON "InventoryUnitDocument"("unitId");

-- CreateIndex
CREATE INDEX "InventoryUnit_createdAt_idx" ON "InventoryUnit"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ScooterVariant_modelId_name_colour_key" ON "ScooterVariant"("modelId", "name", "colour");

-- AddForeignKey
ALTER TABLE "InventoryEvent" ADD CONSTRAINT "InventoryEvent_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "InventoryUnit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryUnitPhoto" ADD CONSTRAINT "InventoryUnitPhoto_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "InventoryUnit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryUnitDocument" ADD CONSTRAINT "InventoryUnitDocument_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "InventoryUnit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

