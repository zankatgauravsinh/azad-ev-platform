-- Vendor management, part 1: vendor profile (type, contact, PAN, credit days, bank / UPI), the vendor a scooter was
-- bought from (InventoryUnit.vendorId) and the default scooter vendor. Existing scooters are linked to the vendor
-- whose name matches their supplier text, otherwise to the showroom's COMPTECH vendor (created when missing).

-- CreateEnum
CREATE TYPE "VendorType" AS ENUM ('SCOOTER_SUPPLIER', 'ACCESSORIES', 'SPARE_PARTS', 'SERVICES', 'UTILITIES', 'OTHER');

-- AlterTable
ALTER TABLE "InventoryUnit" ADD COLUMN     "vendorId" TEXT;

-- AlterTable
ALTER TABLE "CompanySetting" ADD COLUMN     "defaultScooterVendorId" TEXT;

-- AlterTable
ALTER TABLE "Vendor" ADD COLUMN     "altMobile" TEXT,
ADD COLUMN     "bankAccountName" TEXT,
ADD COLUMN     "bankAccountNumber" TEXT,
ADD COLUMN     "bankIfsc" TEXT,
ADD COLUMN     "bankName" TEXT,
ADD COLUMN     "contactPerson" TEXT,
ADD COLUMN     "creditDays" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "pan" TEXT,
ADD COLUMN     "type" "VendorType" NOT NULL DEFAULT 'OTHER',
ADD COLUMN     "upiId" TEXT;

-- CreateIndex
CREATE INDEX "InventoryUnit_vendorId_idx" ON "InventoryUnit"("vendorId");

-- AddForeignKey
ALTER TABLE "InventoryUnit" ADD CONSTRAINT "InventoryUnit_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ── Backfill ─────────────────────────────────────────────────────────────────────────────────────────────
-- 1. Every company with scooters gets a COMPTECH vendor, unless it already has a vendor named like it.
WITH missing AS (
  SELECT c.id AS company_id
  FROM "Company" c
  WHERE EXISTS (SELECT 1 FROM "InventoryUnit" u WHERE u."companyId" = c.id)
    AND NOT EXISTS (SELECT 1 FROM "Vendor" v WHERE v."companyId" = c.id AND v."deletedAt" IS NULL AND v.name ILIKE '%comptech%')
), created AS (
  INSERT INTO "Vendor" (id, "companyId", "vendorNumber", name, type, status, "createdAt", "updatedAt")
  SELECT gen_random_uuid()::text, m.company_id,
         COALESCE(cs."vendorPrefix", 'VND') || lpad(COALESCE(i."nextVendorNumber", 1)::text, 4, '0'),
         'COMPTECH', 'SCOOTER_SUPPLIER', 'ACTIVE', now(), now()
  FROM missing m
  LEFT JOIN "CompanySetting" cs ON cs."companyId" = m.company_id
  LEFT JOIN "InvoiceSetting" i ON i."companyId" = m.company_id
  RETURNING "companyId"
)
UPDATE "InvoiceSetting" i SET "nextVendorNumber" = i."nextVendorNumber" + 1 FROM created c WHERE i."companyId" = c."companyId";

-- The COMPTECH vendor of each company (the oldest one named like it) supplies scooters.
UPDATE "Vendor" v SET type = 'SCOOTER_SUPPLIER'
WHERE v.id IN (
  SELECT DISTINCT ON ("companyId") id FROM "Vendor" WHERE "deletedAt" IS NULL AND name ILIKE '%comptech%' ORDER BY "companyId", "createdAt"
);

-- 2. Scooters whose supplier text names a vendor exactly (ignoring case and spaces) → that vendor.
UPDATE "InventoryUnit" u SET "vendorId" = m.id
FROM (
  SELECT DISTINCT ON ("companyId", lower(trim(name))) id, "companyId", lower(trim(name)) AS key
  FROM "Vendor" WHERE "deletedAt" IS NULL ORDER BY "companyId", lower(trim(name)), "createdAt"
) m
WHERE u."vendorId" IS NULL AND u.supplier IS NOT NULL AND m."companyId" = u."companyId" AND m.key = lower(trim(u.supplier));

-- 3. Every other scooter → the company's COMPTECH vendor; its supplier text follows the vendor's name when blank.
UPDATE "InventoryUnit" u SET "vendorId" = c.id, supplier = COALESCE(NULLIF(trim(u.supplier), ''), c.name)
FROM (
  SELECT DISTINCT ON ("companyId") id, "companyId", name FROM "Vendor"
  WHERE "deletedAt" IS NULL AND name ILIKE '%comptech%' ORDER BY "companyId", "createdAt"
) c
WHERE u."vendorId" IS NULL AND c."companyId" = u."companyId";

-- 4. New scooters default to that vendor.
UPDATE "CompanySetting" s SET "defaultScooterVendorId" = c.id
FROM (
  SELECT DISTINCT ON ("companyId") id, "companyId" FROM "Vendor"
  WHERE "deletedAt" IS NULL AND name ILIKE '%comptech%' ORDER BY "companyId", "createdAt"
) c
WHERE s."companyId" = c."companyId" AND s."defaultScooterVendorId" IS NULL;
