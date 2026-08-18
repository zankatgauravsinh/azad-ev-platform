-- CreateEnum
CREATE TYPE "ExpenseAttachmentType" AS ENUM ('INVOICE', 'GST_BILL', 'PHOTO', 'PDF', 'OTHER');

-- CreateEnum
CREATE TYPE "BankReconStatus" AS ENUM ('PENDING', 'CLEARED', 'RECONCILED');

-- AlterEnum
ALTER TYPE "ExpenseStatus" ADD VALUE 'DRAFT';

-- AlterTable
ALTER TABLE "BankTransaction" ADD COLUMN     "reconStatus" "BankReconStatus" NOT NULL DEFAULT 'PENDING';

-- CreateTable
CREATE TABLE "ExpenseAttachment" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "expenseId" TEXT NOT NULL,
    "type" "ExpenseAttachmentType" NOT NULL DEFAULT 'OTHER',
    "fileKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExpenseAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringExpense" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "name" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "vendorId" TEXT,
    "amount" BIGINT NOT NULL DEFAULT 0,
    "gstAmount" BIGINT NOT NULL DEFAULT 0,
    "paymentMethod" "FinancePayMethod" NOT NULL DEFAULT 'BANK_TRANSFER',
    "dayOfMonth" INTEGER NOT NULL DEFAULT 1,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastRunYear" INTEGER,
    "lastRunMonth" INTEGER,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecurringExpense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonthlyClosing" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "notes" TEXT,
    "closedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MonthlyClosing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExpenseAttachment_expenseId_idx" ON "ExpenseAttachment"("expenseId");

-- CreateIndex
CREATE INDEX "ExpenseAttachment_companyId_idx" ON "ExpenseAttachment"("companyId");

-- CreateIndex
CREATE INDEX "RecurringExpense_companyId_active_idx" ON "RecurringExpense"("companyId", "active");

-- CreateIndex
CREATE INDEX "MonthlyClosing_companyId_year_month_idx" ON "MonthlyClosing"("companyId", "year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "MonthlyClosing_companyId_year_month_key" ON "MonthlyClosing"("companyId", "year", "month");

-- AddForeignKey
ALTER TABLE "ExpenseAttachment" ADD CONSTRAINT "ExpenseAttachment_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringExpense" ADD CONSTRAINT "RecurringExpense_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ExpenseCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringExpense" ADD CONSTRAINT "RecurringExpense_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

