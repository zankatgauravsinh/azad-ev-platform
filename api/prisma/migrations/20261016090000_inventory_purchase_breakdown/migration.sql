-- Inventory: controller / charger numbers, and the purchase cost broken into price + GST paid + transport charge
-- (purchaseCost stays the total). Additive.

-- AlterTable
ALTER TABLE "InventoryUnit" ADD COLUMN     "chargerNumber" TEXT,
ADD COLUMN     "controllerNumber" TEXT,
ADD COLUMN     "purchaseGst" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "purchaseGstRateBp" INTEGER,
ADD COLUMN     "purchasePrice" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "transportCharge" BIGINT NOT NULL DEFAULT 0;


-- Existing vehicles: their recorded cost becomes the purchase price (no GST or transport recorded separately).
UPDATE "InventoryUnit" SET "purchasePrice" = "purchaseCost" WHERE "purchasePrice" = 0 AND "purchaseCost" <> 0;
