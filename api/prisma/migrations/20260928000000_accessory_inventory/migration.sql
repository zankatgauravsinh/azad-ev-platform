-- Accessory inventory redesign (Group 1: schema only).
-- Renames preserve existing data: costPrice -> avgCost (weighted-average, system-maintained),
-- stockQty -> onHand. New columns: category, reserved, minStock.

ALTER TABLE "Accessory" RENAME COLUMN "costPrice" TO "avgCost";
ALTER TABLE "Accessory" RENAME COLUMN "stockQty" TO "onHand";
ALTER TABLE "Accessory" ADD COLUMN "category" TEXT;
ALTER TABLE "Accessory" ADD COLUMN "reserved" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Accessory" ADD COLUMN "minStock" INTEGER NOT NULL DEFAULT 0;

-- SaleAccessory: snapshot the cost basis for COGS.
ALTER TABLE "SaleAccessory" ADD COLUMN "costAtSale" BIGINT NOT NULL DEFAULT 0;

-- Movement kinds.
CREATE TYPE "AccessoryMovementType" AS ENUM ('OPENING', 'PURCHASE_IN', 'SALE_OUT', 'ADJUSTMENT', 'RESERVE', 'RELEASE');

-- Purchase (stock-in) header.
CREATE TABLE "AccessoryPurchase" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "purchaseNumber" TEXT NOT NULL,
    "vendorId" TEXT,
    "purchaseDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "subtotal" BIGINT NOT NULL DEFAULT 0,
    "gstAmount" BIGINT NOT NULL DEFAULT 0,
    "total" BIGINT NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AccessoryPurchase_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AccessoryPurchase_companyId_purchaseNumber_key" ON "AccessoryPurchase"("companyId", "purchaseNumber");
CREATE INDEX "AccessoryPurchase_companyId_idx" ON "AccessoryPurchase"("companyId");
CREATE INDEX "AccessoryPurchase_vendorId_idx" ON "AccessoryPurchase"("vendorId");

-- Purchase line items.
CREATE TABLE "AccessoryPurchaseItem" (
    "id" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "accessoryId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitCost" BIGINT NOT NULL DEFAULT 0,
    "gstAmount" BIGINT NOT NULL DEFAULT 0,
    "lineTotal" BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT "AccessoryPurchaseItem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AccessoryPurchaseItem_purchaseId_idx" ON "AccessoryPurchaseItem"("purchaseId");
CREATE INDEX "AccessoryPurchaseItem_accessoryId_idx" ON "AccessoryPurchaseItem"("accessoryId");

-- Auditable stock movement ledger.
CREATE TABLE "AccessoryStockMovement" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "accessoryId" TEXT NOT NULL,
    "type" "AccessoryMovementType" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitCost" BIGINT NOT NULL DEFAULT 0,
    "onHandAfter" INTEGER NOT NULL DEFAULT 0,
    "reservedAfter" INTEGER NOT NULL DEFAULT 0,
    "refType" TEXT,
    "refId" TEXT,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AccessoryStockMovement_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AccessoryStockMovement_companyId_idx" ON "AccessoryStockMovement"("companyId");
CREATE INDEX "AccessoryStockMovement_accessoryId_createdAt_idx" ON "AccessoryStockMovement"("accessoryId", "createdAt");

-- Foreign keys.
ALTER TABLE "AccessoryPurchase" ADD CONSTRAINT "AccessoryPurchase_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AccessoryPurchaseItem" ADD CONSTRAINT "AccessoryPurchaseItem_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "AccessoryPurchase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AccessoryPurchaseItem" ADD CONSTRAINT "AccessoryPurchaseItem_accessoryId_fkey" FOREIGN KEY ("accessoryId") REFERENCES "Accessory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AccessoryStockMovement" ADD CONSTRAINT "AccessoryStockMovement_accessoryId_fkey" FOREIGN KEY ("accessoryId") REFERENCES "Accessory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
