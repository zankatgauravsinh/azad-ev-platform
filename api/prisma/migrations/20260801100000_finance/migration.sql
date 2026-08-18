-- CreateEnum
CREATE TYPE "ExpenseStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "VendorStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "FinancePayMethod" AS ENUM ('CASH', 'UPI', 'CARD', 'BANK_TRANSFER', 'CHEQUE');

-- CreateEnum
CREATE TYPE "IncomeSource" AS ENUM ('ACCESSORIES', 'INSURANCE_COMMISSION', 'FINANCE_COMMISSION', 'REGISTRATION', 'SERVICE', 'AMC', 'WARRANTY_RECOVERY', 'OTHER');

-- CreateEnum
CREATE TYPE "BankTxnType" AS ENUM ('DEPOSIT', 'WITHDRAWAL', 'NEFT', 'RTGS', 'IMPS', 'CHEQUE', 'UPI');

-- CreateEnum
CREATE TYPE "BankDirection" AS ENUM ('CREDIT', 'DEBIT');

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'ACCOUNTANT';

-- DropIndex
DROP INDEX "Expense_category_idx";

-- DropIndex
DROP INDEX "Expense_companyId_idx";

-- DropIndex
DROP INDEX "Expense_spentAt_idx";

-- AlterTable
ALTER TABLE "CompanySetting" ADD COLUMN     "bankPrefix" TEXT NOT NULL DEFAULT 'BNK',
ADD COLUMN     "expensePrefix" TEXT NOT NULL DEFAULT 'EXP',
ADD COLUMN     "financeEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "financeGstRate" DECIMAL(5,2) NOT NULL DEFAULT 18,
ADD COLUMN     "financialYearStartMonth" INTEGER NOT NULL DEFAULT 4,
ADD COLUMN     "incomePrefix" TEXT NOT NULL DEFAULT 'INC',
ADD COLUMN     "largeExpenseThreshold" BIGINT NOT NULL DEFAULT 5000000,
ADD COLUMN     "lowCashThreshold" BIGINT NOT NULL DEFAULT 500000,
ADD COLUMN     "openingBank" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "openingCash" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "vendorPrefix" TEXT NOT NULL DEFAULT 'VND';

-- AlterTable
ALTER TABLE "Expense" DROP COLUMN "category",
DROP COLUMN "mode",
DROP COLUMN "note",
DROP COLUMN "paidTo",
DROP COLUMN "receiptKey",
DROP COLUMN "spentAt",
ADD COLUMN     "attachmentKey" TEXT,
ADD COLUMN     "categoryId" TEXT NOT NULL,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "dueDate" TIMESTAMP(3),
ADD COLUMN     "expenseDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "expenseNumber" TEXT NOT NULL,
ADD COLUMN     "gstAmount" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "paid" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "paymentMethod" "FinancePayMethod" NOT NULL DEFAULT 'CASH',
ADD COLUMN     "referenceNumber" TEXT,
ADD COLUMN     "settledDate" TIMESTAMP(3),
ADD COLUMN     "status" "ExpenseStatus" NOT NULL DEFAULT 'APPROVED',
ADD COLUMN     "vendorId" TEXT,
ALTER COLUMN "amount" SET DEFAULT 0;

-- AlterTable
ALTER TABLE "InvoiceSetting" ADD COLUMN     "nextBankNumber" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "nextExpenseNumber" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "nextIncomeNumber" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "nextVendorNumber" INTEGER NOT NULL DEFAULT 1;

-- DropEnum
DROP TYPE "ExpenseCategory";

-- CreateTable
CREATE TABLE "ExpenseCategory" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "name" TEXT NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExpenseCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vendor" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "vendorNumber" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mobile" TEXT,
    "email" TEXT,
    "gstNumber" TEXT,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "status" "VendorStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Vendor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Income" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "incomeNumber" TEXT NOT NULL,
    "incomeDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" "IncomeSource" NOT NULL DEFAULT 'OTHER',
    "amount" BIGINT NOT NULL DEFAULT 0,
    "gstAmount" BIGINT NOT NULL DEFAULT 0,
    "paymentMethod" "FinancePayMethod" NOT NULL DEFAULT 'CASH',
    "referenceNumber" TEXT,
    "description" TEXT,
    "customerId" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Income_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankTransaction" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "txnNumber" TEXT NOT NULL,
    "txnDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "type" "BankTxnType" NOT NULL,
    "direction" "BankDirection" NOT NULL,
    "amount" BIGINT NOT NULL DEFAULT 0,
    "bankName" TEXT,
    "reference" TEXT,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashAdjustment" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "adjDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "amount" BIGINT NOT NULL,
    "notes" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExpenseCategory_companyId_active_idx" ON "ExpenseCategory"("companyId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseCategory_companyId_name_key" ON "ExpenseCategory"("companyId", "name");

-- CreateIndex
CREATE INDEX "Vendor_companyId_status_idx" ON "Vendor"("companyId", "status");

-- CreateIndex
CREATE INDEX "Vendor_companyId_name_idx" ON "Vendor"("companyId", "name");

-- CreateIndex
CREATE INDEX "Vendor_deletedAt_idx" ON "Vendor"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Vendor_companyId_vendorNumber_key" ON "Vendor"("companyId", "vendorNumber");

-- CreateIndex
CREATE INDEX "Income_companyId_source_idx" ON "Income"("companyId", "source");

-- CreateIndex
CREATE INDEX "Income_companyId_incomeDate_idx" ON "Income"("companyId", "incomeDate");

-- CreateIndex
CREATE INDEX "Income_referenceNumber_idx" ON "Income"("referenceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Income_companyId_incomeNumber_key" ON "Income"("companyId", "incomeNumber");

-- CreateIndex
CREATE INDEX "BankTransaction_companyId_txnDate_idx" ON "BankTransaction"("companyId", "txnDate");

-- CreateIndex
CREATE INDEX "BankTransaction_companyId_type_idx" ON "BankTransaction"("companyId", "type");

-- CreateIndex
CREATE INDEX "BankTransaction_reference_idx" ON "BankTransaction"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "BankTransaction_companyId_txnNumber_key" ON "BankTransaction"("companyId", "txnNumber");

-- CreateIndex
CREATE INDEX "CashAdjustment_companyId_adjDate_idx" ON "CashAdjustment"("companyId", "adjDate");

-- CreateIndex
CREATE INDEX "Expense_companyId_status_idx" ON "Expense"("companyId", "status");

-- CreateIndex
CREATE INDEX "Expense_companyId_expenseDate_idx" ON "Expense"("companyId", "expenseDate");

-- CreateIndex
CREATE INDEX "Expense_companyId_categoryId_idx" ON "Expense"("companyId", "categoryId");

-- CreateIndex
CREATE INDEX "Expense_companyId_vendorId_idx" ON "Expense"("companyId", "vendorId");

-- CreateIndex
CREATE INDEX "Expense_companyId_paymentMethod_idx" ON "Expense"("companyId", "paymentMethod");

-- CreateIndex
CREATE INDEX "Expense_referenceNumber_idx" ON "Expense"("referenceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Expense_companyId_expenseNumber_key" ON "Expense"("companyId", "expenseNumber");

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ExpenseCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Income" ADD CONSTRAINT "Income_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

