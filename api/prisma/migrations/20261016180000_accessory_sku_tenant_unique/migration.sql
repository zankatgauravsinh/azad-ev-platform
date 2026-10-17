-- Accessory SKU: unique within a company instead of across all companies. The old global index already guarantees
-- no duplicates, so the new one always builds.

-- DropIndex
DROP INDEX "Accessory_sku_key";

-- CreateIndex
CREATE UNIQUE INDEX "Accessory_companyId_sku_key" ON "Accessory"("companyId", "sku");

