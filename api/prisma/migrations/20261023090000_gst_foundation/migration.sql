-- GST module foundation (release 3.7): GST registration date, versioned GST breakdown with the buyer, GST of
-- service bills, credit notes linked to the GST breakdown they reverse, vendor state code, ITC eligibility.

-- DropIndex
DROP INDEX "TaxSnapshot_saleId_key";

-- AlterTable
ALTER TABLE "ServiceJob" ADD COLUMN     "billedAt" TIMESTAMP(3),
ADD COLUMN     "buyerGstin" TEXT,
ADD COLUMN     "cgst" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "igst" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "labourSacCode" TEXT,
ADD COLUMN     "labourTaxable" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "partsHsnCode" TEXT,
ADD COLUMN     "partsTaxable" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "placeOfSupplyStateCode" TEXT,
ADD COLUMN     "sgst" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "taxRateBp" INTEGER;

-- AlterTable
ALTER TABLE "CompanySetting" ADD COLUMN     "gstAatoAbove5Cr" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "gstEffectiveFrom" DATE,
ADD COLUMN     "serviceGstRateBp" INTEGER NOT NULL DEFAULT 1800,
ADD COLUMN     "servicePartsHsnCode" TEXT,
ADD COLUMN     "serviceSacCode" TEXT DEFAULT '9987';

-- AlterTable
ALTER TABLE "CreditNote" ADD COLUMN     "taxSnapshotId" TEXT;

-- AlterTable
ALTER TABLE "ExpenseCategory" ADD COLUMN     "itcEligible" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "Vendor" ADD COLUMN     "gstStateCode" TEXT;

-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "itcEligible" BOOLEAN;

-- AlterTable
ALTER TABLE "TaxSnapshot" ADD COLUMN     "buyerGstin" TEXT,
ADD COLUMN     "buyerName" TEXT,
ADD COLUMN     "reason" TEXT,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "AccessorySale" ADD COLUMN     "buyerGstin" TEXT,
ADD COLUMN     "placeOfSupplyStateCode" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "TaxSnapshot_saleId_version_key" ON "TaxSnapshot"("saleId", "version");

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_taxSnapshotId_fkey" FOREIGN KEY ("taxSnapshotId") REFERENCES "TaxSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ── Backfill ──
-- Vendor state code from the GSTIN (its first two digits).
UPDATE "Vendor" SET "gstStateCode" = substring("gstNumber" from 1 for 2)
WHERE "gstNumber" ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$';

-- Food and refreshments are blocked credits (CGST Act s.17(5)(b)(i)).
UPDATE "ExpenseCategory" SET "itcEligible" = false WHERE "isSystem" = true AND "name" = 'Tea & Snacks';

-- Existing GST breakdowns: the buyer as on record now (the best available), and credit notes → the breakdown they reversed.
UPDATE "TaxSnapshot" t SET "buyerName" = c."name", "buyerGstin" = c."gstin"
FROM "Sale" s JOIN "Customer" c ON c."id" = s."customerId" WHERE s."id" = t."saleId";
UPDATE "CreditNote" n SET "taxSnapshotId" = t."id" FROM "TaxSnapshot" t WHERE t."saleId" = n."saleId" AND t."version" = 1;

-- Accessory invoices: place of supply (the showroom's state unless inter-state) and the buyer's GSTIN.
UPDATE "AccessorySale" a SET
  "placeOfSupplyStateCode" = CASE WHEN a."supplyType" = 'INTER' THEN c."gstStateCode" ELSE cs."gstStateCode" END,
  "buyerGstin" = c."gstin"
FROM "Customer" c, "CompanySetting" cs
WHERE c."id" = a."customerId" AND cs."companyId" = a."companyId" AND a."gstApplied" = true;

-- Service bills made before rates were stored: their bill date (taxRateBp stays null = rate not recorded).
UPDATE "ServiceJob" SET "billedAt" = COALESCE("actualDelivery", "closedAt", "updatedAt") WHERE "total" > 0 AND "billedAt" IS NULL;
