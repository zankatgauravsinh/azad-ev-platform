-- CreateEnum
CREATE TYPE "BackupFrequency" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');

-- AlterTable
ALTER TABLE "CompanySetting" DROP COLUMN "gstin",
DROP COLUMN "logoKey",
ADD COLUMN     "backupEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "backupFrequency" "BackupFrequency" NOT NULL DEFAULT 'WEEKLY',
ADD COLUMN     "bookingPrefix" TEXT NOT NULL DEFAULT 'BK',
ADD COLUMN     "companyLogo" TEXT,
ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'INR',
ADD COLUMN     "dateFormat" TEXT NOT NULL DEFAULT 'DD/MM/YYYY',
ADD COLUMN     "defaultWarrantyMonths" INTEGER NOT NULL DEFAULT 36,
ADD COLUMN     "emailEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "favicon" TEXT,
ADD COLUMN     "gstEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "gstNumber" TEXT,
ADD COLUMN     "invoiceFooter" TEXT,
ADD COLUMN     "invoicePrefix" TEXT NOT NULL DEFAULT 'INV',
ADD COLUMN     "jobCardPrefix" TEXT NOT NULL DEFAULT 'JC',
ADD COLUMN     "language" TEXT NOT NULL DEFAULT 'en',
ADD COLUMN     "primaryColor" TEXT NOT NULL DEFAULT '#0B2545',
ADD COLUMN     "quotationPrefix" TEXT NOT NULL DEFAULT 'QT',
ADD COLUMN     "receiptPrefix" TEXT NOT NULL DEFAULT 'RC',
ADD COLUMN     "secondaryColor" TEXT NOT NULL DEFAULT '#00B8A9',
ADD COLUMN     "serviceReminderDays" INTEGER NOT NULL DEFAULT 90,
ADD COLUMN     "smsEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "state" TEXT NOT NULL DEFAULT 'Gujarat',
ADD COLUMN     "taxPercentage" DECIMAL(5,2) NOT NULL DEFAULT 0,
ADD COLUMN     "termsAndConditions" TEXT,
ADD COLUMN     "timeFormat" TEXT NOT NULL DEFAULT '12h',
ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
ADD COLUMN     "whatsappEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "workingDays" TEXT[] DEFAULT ARRAY['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']::TEXT[],
ADD COLUMN     "workingHours" TEXT NOT NULL DEFAULT '10:00-19:00';

-- Preserve settings that moved from InvoiceSetting to CompanySetting.
UPDATE "CompanySetting" cs SET "termsAndConditions" = iv."termsAndConditions", "invoiceFooter" = iv."footerNote", "gstEnabled" = iv."showGst", "taxPercentage" = iv."taxRate" FROM "InvoiceSetting" iv WHERE iv."companyId" = cs."companyId";

-- AlterTable
ALTER TABLE "InvoiceSetting" DROP COLUMN "bookingPrefix",
DROP COLUMN "footerNote",
DROP COLUMN "invoicePrefix",
DROP COLUMN "quotationPrefix",
DROP COLUMN "receiptPrefix",
DROP COLUMN "servicePrefix",
DROP COLUMN "showGst",
DROP COLUMN "taxRate",
DROP COLUMN "termsAndConditions";

