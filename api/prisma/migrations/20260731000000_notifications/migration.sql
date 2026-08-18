-- CreateEnum
CREATE TYPE "NotificationPriority" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW');

-- AlterEnum
BEGIN;
CREATE TYPE "NotificationType_new" AS ENUM ('DELIVERY', 'PAYMENT', 'SERVICE', 'INVENTORY', 'CUSTOMER', 'WARRANTY', 'SYSTEM');
ALTER TABLE "Notification" ALTER COLUMN "type" TYPE "NotificationType_new" USING ("type"::text::"NotificationType_new");
ALTER TYPE "NotificationType" RENAME TO "NotificationType_old";
ALTER TYPE "NotificationType_new" RENAME TO "NotificationType";
DROP TYPE "NotificationType_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "Notification" DROP CONSTRAINT "Notification_recipientId_fkey";

-- DropIndex
DROP INDEX "Notification_companyId_idx";

-- DropIndex
DROP INDEX "Notification_recipientId_readAt_idx";

-- DropIndex
DROP INDEX "Notification_type_idx";

-- AlterTable
ALTER TABLE "CompanySetting" ADD COLUMN     "desktopNotifications" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "notifyDelivery" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "notifyInventory" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "notifyPayment" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "notifyService" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "notifyWarranty" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "Notification" DROP COLUMN "body",
DROP COLUMN "recipientId",
ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "dedupeKey" TEXT,
ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "message" TEXT NOT NULL,
ADD COLUMN     "priority" "NotificationPriority" NOT NULL DEFAULT 'MEDIUM';

-- CreateIndex
CREATE INDEX "Notification_companyId_readAt_idx" ON "Notification"("companyId", "readAt");

-- CreateIndex
CREATE INDEX "Notification_companyId_type_idx" ON "Notification"("companyId", "type");

-- CreateIndex
CREATE INDEX "Notification_companyId_priority_idx" ON "Notification"("companyId", "priority");

-- CreateIndex
CREATE INDEX "Notification_companyId_createdAt_idx" ON "Notification"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_expiresAt_idx" ON "Notification"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_companyId_dedupeKey_key" ON "Notification"("companyId", "dedupeKey");

