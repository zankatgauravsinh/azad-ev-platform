-- RTO invoice details (modelled on the dealer's reference invoice): customer tehsil / district / Aadhaar / PAN /
-- GSTIN, the scooter's key number, and list price − discount on the RTO invoice. Additive only.

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "aadhaarNumber" TEXT,
ADD COLUMN     "district" TEXT,
ADD COLUMN     "gstin" TEXT,
ADD COLUMN     "panNumber" TEXT,
ADD COLUMN     "tehsil" TEXT;

-- AlterTable
ALTER TABLE "InventoryUnit" ADD COLUMN     "keyNumber" TEXT;

-- AlterTable
ALTER TABLE "RtoInvoice" ADD COLUMN     "discount" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "listPrice" BIGINT NOT NULL DEFAULT 0;


-- Invoices raised before the discount existed: their price was the list price, with no discount.
UPDATE "RtoInvoice" SET "listPrice" = "sellingPrice" WHERE "listPrice" = 0;
