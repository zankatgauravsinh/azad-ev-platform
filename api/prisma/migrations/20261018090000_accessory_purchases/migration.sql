-- Accessory purchases from vendors: status (cancellation), supplier bill number, paid / unpaid with method and date,
-- GST rate per line, purchase number prefix + counter, and the PURCHASE_RETURN stock movement. Additive.

-- CreateEnum
CREATE TYPE "AccessoryPurchaseStatus" AS ENUM ('ACTIVE', 'CANCELLED');

-- AlterEnum
ALTER TYPE "AccessoryMovementType" ADD VALUE 'PURCHASE_RETURN';

-- AlterTable
ALTER TABLE "AccessoryPurchase" ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "cancelledById" TEXT,
ADD COLUMN     "paid" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "paidAt" TIMESTAMP(3),
ADD COLUMN     "paymentMethod" "FinancePayMethod",
ADD COLUMN     "paymentReference" TEXT,
ADD COLUMN     "status" "AccessoryPurchaseStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "vendorInvoiceNumber" TEXT;

-- AlterTable
ALTER TABLE "AccessoryPurchaseItem" ADD COLUMN     "gstRateBp" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "CompanySetting" ADD COLUMN     "accessoryPurchasePrefix" TEXT NOT NULL DEFAULT 'APU';

-- AlterTable
ALTER TABLE "InvoiceSetting" ADD COLUMN     "nextAccessoryPurchaseNumber" INTEGER NOT NULL DEFAULT 1;

