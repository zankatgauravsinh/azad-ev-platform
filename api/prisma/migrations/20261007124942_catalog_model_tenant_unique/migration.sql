-- Catalog M1: model uniqueness becomes tenant-scoped.
-- Two companies may each have a "Comptech VX1"; within a company (brand, name) stays unique.
-- Safe for existing data: the old key was stricter (global), so no (companyId, brand, name) duplicate can exist.

-- DropIndex
DROP INDEX "ScooterModel_brand_name_key";

-- CreateIndex
CREATE UNIQUE INDEX "ScooterModel_companyId_brand_name_key" ON "ScooterModel"("companyId", "brand", "name");
