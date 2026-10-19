-- Vendor management, parts 2–5: per-scooter purchase payments, vendor payments (one payment settles several bills,
-- part or full, or stays as an advance), purchase orders with the vendor's PI and documents, and the switch of
-- scooter cost from 'Vehicle Purchase' expenses to cost of the scooters sold.

-- CreateEnum
CREATE TYPE "VendorBillKind" AS ENUM ('SCOOTER', 'ACCESSORY_PURCHASE', 'EXPENSE');

-- CreateEnum
CREATE TYPE "VendorPaymentStatus" AS ENUM ('ACTIVE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('DRAFT', 'ORDERED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PurchaseOrderLineKind" AS ENUM ('SCOOTER', 'ACCESSORY');

-- CreateEnum
CREATE TYPE "PurchaseOrderDocumentType" AS ENUM ('PROFORMA_INVOICE', 'INVOICE', 'DELIVERY_CHALLAN', 'OTHER');

-- AlterTable
ALTER TABLE "AccessoryPurchase" ADD COLUMN     "purchaseOrderId" TEXT;

-- AlterTable
ALTER TABLE "AccessoryPurchaseItem" ADD COLUMN     "purchaseOrderLineId" TEXT;

-- AlterTable
ALTER TABLE "CompanySetting" ADD COLUMN     "purchaseOrderPrefix" TEXT NOT NULL DEFAULT 'PO',
ADD COLUMN     "scooterCostCutoverAt" TIMESTAMP(3),
ADD COLUMN     "vendorPaymentPrefix" TEXT NOT NULL DEFAULT 'VPY';

-- AlterTable
ALTER TABLE "InventoryUnit" ADD COLUMN     "costInExpenses" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "purchaseOrderLineId" TEXT,
ADD COLUMN     "purchasePaid" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "purchasePaidAt" TIMESTAMP(3),
ADD COLUMN     "vendorBillNumber" TEXT;

-- AlterTable
ALTER TABLE "InvoiceSetting" ADD COLUMN     "nextPurchaseOrderNumber" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "nextVendorPaymentNumber" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "VendorPayment" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "paymentNumber" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "method" "FinancePayMethod" NOT NULL,
    "reference" TEXT,
    "amount" BIGINT NOT NULL,
    "notes" TEXT,
    "purchaseOrderId" TEXT,
    "status" "VendorPaymentStatus" NOT NULL DEFAULT 'ACTIVE',
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelReason" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorPaymentAllocation" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "paymentId" TEXT NOT NULL,
    "kind" "VendorBillKind" NOT NULL,
    "unitId" TEXT,
    "accessoryPurchaseId" TEXT,
    "expenseId" TEXT,
    "amount" BIGINT NOT NULL,
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VendorPaymentAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "poNumber" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "orderDate" TIMESTAMP(3) NOT NULL,
    "expectedDate" TIMESTAMP(3),
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "piNumber" TEXT,
    "piDate" TIMESTAMP(3),
    "notes" TEXT,
    "subtotal" BIGINT NOT NULL DEFAULT 0,
    "gstAmount" BIGINT NOT NULL DEFAULT 0,
    "total" BIGINT NOT NULL DEFAULT 0,
    "orderedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelReason" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrderLine" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "kind" "PurchaseOrderLineKind" NOT NULL,
    "variantId" TEXT,
    "accessoryId" TEXT,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitCost" BIGINT NOT NULL DEFAULT 0,
    "gstRateBp" INTEGER NOT NULL DEFAULT 0,
    "gstAmount" BIGINT NOT NULL DEFAULT 0,
    "lineTotal" BIGINT NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PurchaseOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrderDocument" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "purchaseOrderId" TEXT NOT NULL,
    "type" "PurchaseOrderDocumentType" NOT NULL DEFAULT 'PROFORMA_INVOICE',
    "fileKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseOrderDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VendorPayment_companyId_vendorId_idx" ON "VendorPayment"("companyId", "vendorId");

-- CreateIndex
CREATE INDEX "VendorPayment_companyId_paidAt_idx" ON "VendorPayment"("companyId", "paidAt");

-- CreateIndex
CREATE INDEX "VendorPayment_purchaseOrderId_idx" ON "VendorPayment"("purchaseOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "VendorPayment_companyId_paymentNumber_key" ON "VendorPayment"("companyId", "paymentNumber");

-- CreateIndex
CREATE INDEX "VendorPaymentAllocation_companyId_idx" ON "VendorPaymentAllocation"("companyId");

-- CreateIndex
CREATE INDEX "VendorPaymentAllocation_paymentId_idx" ON "VendorPaymentAllocation"("paymentId");

-- CreateIndex
CREATE INDEX "VendorPaymentAllocation_unitId_idx" ON "VendorPaymentAllocation"("unitId");

-- CreateIndex
CREATE INDEX "VendorPaymentAllocation_accessoryPurchaseId_idx" ON "VendorPaymentAllocation"("accessoryPurchaseId");

-- CreateIndex
CREATE INDEX "VendorPaymentAllocation_expenseId_idx" ON "VendorPaymentAllocation"("expenseId");

-- CreateIndex
CREATE INDEX "PurchaseOrder_companyId_vendorId_idx" ON "PurchaseOrder"("companyId", "vendorId");

-- CreateIndex
CREATE INDEX "PurchaseOrder_companyId_status_idx" ON "PurchaseOrder"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_companyId_poNumber_key" ON "PurchaseOrder"("companyId", "poNumber");

-- CreateIndex
CREATE INDEX "PurchaseOrderLine_purchaseOrderId_idx" ON "PurchaseOrderLine"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "PurchaseOrderLine_variantId_idx" ON "PurchaseOrderLine"("variantId");

-- CreateIndex
CREATE INDEX "PurchaseOrderLine_accessoryId_idx" ON "PurchaseOrderLine"("accessoryId");

-- CreateIndex
CREATE INDEX "PurchaseOrderDocument_companyId_idx" ON "PurchaseOrderDocument"("companyId");

-- CreateIndex
CREATE INDEX "PurchaseOrderDocument_purchaseOrderId_idx" ON "PurchaseOrderDocument"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "AccessoryPurchase_purchaseOrderId_idx" ON "AccessoryPurchase"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "AccessoryPurchaseItem_purchaseOrderLineId_idx" ON "AccessoryPurchaseItem"("purchaseOrderLineId");

-- CreateIndex
CREATE INDEX "InventoryUnit_purchaseOrderLineId_idx" ON "InventoryUnit"("purchaseOrderLineId");

-- AddForeignKey
ALTER TABLE "InventoryUnit" ADD CONSTRAINT "InventoryUnit_purchaseOrderLineId_fkey" FOREIGN KEY ("purchaseOrderLineId") REFERENCES "PurchaseOrderLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessoryPurchase" ADD CONSTRAINT "AccessoryPurchase_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessoryPurchaseItem" ADD CONSTRAINT "AccessoryPurchaseItem_purchaseOrderLineId_fkey" FOREIGN KEY ("purchaseOrderLineId") REFERENCES "PurchaseOrderLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorPayment" ADD CONSTRAINT "VendorPayment_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorPayment" ADD CONSTRAINT "VendorPayment_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorPaymentAllocation" ADD CONSTRAINT "VendorPaymentAllocation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "VendorPayment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorPaymentAllocation" ADD CONSTRAINT "VendorPaymentAllocation_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "InventoryUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorPaymentAllocation" ADD CONSTRAINT "VendorPaymentAllocation_accessoryPurchaseId_fkey" FOREIGN KEY ("accessoryPurchaseId") REFERENCES "AccessoryPurchase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorPaymentAllocation" ADD CONSTRAINT "VendorPaymentAllocation_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ScooterVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_accessoryId_fkey" FOREIGN KEY ("accessoryId") REFERENCES "Accessory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderDocument" ADD CONSTRAINT "PurchaseOrderDocument_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- An allocation settles exactly one bill, of its kind, with a positive amount.
ALTER TABLE "VendorPaymentAllocation" ADD CONSTRAINT "VendorPaymentAllocation_one_bill_check" CHECK (
  amount > 0 AND (
    (kind = 'SCOOTER' AND "unitId" IS NOT NULL AND "accessoryPurchaseId" IS NULL AND "expenseId" IS NULL) OR
    (kind = 'ACCESSORY_PURCHASE' AND "accessoryPurchaseId" IS NOT NULL AND "unitId" IS NULL AND "expenseId" IS NULL) OR
    (kind = 'EXPENSE' AND "expenseId" IS NOT NULL AND "unitId" IS NULL AND "accessoryPurchaseId" IS NULL)
  )
);
ALTER TABLE "VendorPayment" ADD CONSTRAINT "VendorPayment_amount_check" CHECK (amount > 0);
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_item_check" CHECK (
  quantity > 0 AND (
    (kind = 'SCOOTER' AND "accessoryId" IS NULL) OR
    (kind = 'ACCESSORY' AND "accessoryId" IS NOT NULL AND "variantId" IS NULL)
  )
);

-- ── Cutover ──────────────────────────────────────────────────────────────────────────────────────────────
-- Until now a scooter's cost reached the books as a 'Vehicle Purchase' expense. Every scooter that already exists
-- keeps it that way: marked as expensed and paid, so it is never a vendor bill, cost of sales or input GST again.
UPDATE "InventoryUnit" SET "costInExpenses" = true, "purchasePaid" = true;

UPDATE "CompanySetting" s SET "scooterCostCutoverAt" = now()
WHERE EXISTS (SELECT 1 FROM "InventoryUnit" u WHERE u."companyId" = s."companyId");

-- New scooter purchases are recorded on the scooter, not as an expense: the category is kept for old records only.
UPDATE "ExpenseCategory" SET active = false WHERE name = 'Vehicle Purchase';
