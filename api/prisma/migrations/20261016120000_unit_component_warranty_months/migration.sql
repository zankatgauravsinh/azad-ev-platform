-- Warranty months per component (motor, battery, controller, charger) entered with the scooter; delivery
-- issues the warranty card from them. Additive.

-- AlterTable
ALTER TABLE "InventoryUnit" ADD COLUMN     "batteryWarrantyMonths" INTEGER,
ADD COLUMN     "chargerWarrantyMonths" INTEGER,
ADD COLUMN     "controllerWarrantyMonths" INTEGER,
ADD COLUMN     "motorWarrantyMonths" INTEGER;

