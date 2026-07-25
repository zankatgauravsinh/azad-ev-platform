-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'OTHER');

-- CreateEnum
CREATE TYPE "CustomerEventType" AS ENUM ('LEAD_CREATED', 'STATUS_CHANGED', 'PHONE_CALL', 'WALK_IN', 'TEST_RIDE', 'QUOTATION', 'BOOKING', 'ADVANCE_PAYMENT', 'FINANCE_APPROVED', 'VEHICLE_ASSIGNED', 'DELIVERY', 'FIRST_SERVICE', 'WARRANTY', 'FEEDBACK', 'REFERRAL', 'NOTE_ADDED', 'DOCUMENT_UPLOADED', 'FOLLOW_UP_SCHEDULED', 'FOLLOW_UP_COMPLETED');

-- CreateEnum
CREATE TYPE "FollowUpPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "FollowUpStatus" AS ENUM ('PENDING', 'COMPLETED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "LeadStatus" ADD VALUE 'INTERESTED';

-- DropForeignKey
ALTER TABLE "CustomerInteraction" DROP CONSTRAINT "CustomerInteraction_customerId_fkey";

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "dateOfBirth" TIMESTAMP(3),
ADD COLUMN     "gender" "Gender",
ADD COLUMN     "lostReason" TEXT,
ADD COLUMN     "occupation" TEXT,
ADD COLUMN     "pin" TEXT,
ADD COLUMN     "preferredColour" TEXT,
ADD COLUMN     "preferredFinanceOption" TEXT,
ADD COLUMN     "preferredModelId" TEXT,
ADD COLUMN     "state" TEXT;

-- AlterTable
ALTER TABLE "CustomerNote" ADD COLUMN     "editCount" INTEGER NOT NULL DEFAULT 0;

-- DropTable
DROP TABLE "CustomerInteraction";

-- DropEnum
DROP TYPE "InteractionType";

-- CreateTable
CREATE TABLE "CustomerTimelineEntry" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "type" "CustomerEventType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "metadata" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerTimelineEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerFollowUp" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "priority" "FollowUpPriority" NOT NULL DEFAULT 'MEDIUM',
    "note" TEXT,
    "remindBeforeMinutes" INTEGER,
    "status" "FollowUpStatus" NOT NULL DEFAULT 'PENDING',
    "completedAt" TIMESTAMP(3),
    "assignedToId" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerFollowUp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerNoteRevision" (
    "id" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "editedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerNoteRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustomerTimelineEntry_customerId_occurredAt_idx" ON "CustomerTimelineEntry"("customerId", "occurredAt");

-- CreateIndex
CREATE INDEX "CustomerTimelineEntry_customerId_type_idx" ON "CustomerTimelineEntry"("customerId", "type");

-- CreateIndex
CREATE INDEX "CustomerFollowUp_customerId_idx" ON "CustomerFollowUp"("customerId");

-- CreateIndex
CREATE INDEX "CustomerFollowUp_status_dueAt_idx" ON "CustomerFollowUp"("status", "dueAt");

-- CreateIndex
CREATE INDEX "CustomerFollowUp_assignedToId_idx" ON "CustomerFollowUp"("assignedToId");

-- CreateIndex
CREATE INDEX "CustomerNoteRevision_noteId_createdAt_idx" ON "CustomerNoteRevision"("noteId", "createdAt");

-- CreateIndex
CREATE INDEX "Customer_phone_idx" ON "Customer"("phone");

-- CreateIndex
CREATE INDEX "Customer_preferredModelId_idx" ON "Customer"("preferredModelId");

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_preferredModelId_fkey" FOREIGN KEY ("preferredModelId") REFERENCES "ScooterModel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerTimelineEntry" ADD CONSTRAINT "CustomerTimelineEntry_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerFollowUp" ADD CONSTRAINT "CustomerFollowUp_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerFollowUp" ADD CONSTRAINT "CustomerFollowUp_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerNoteRevision" ADD CONSTRAINT "CustomerNoteRevision_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "CustomerNote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

