-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "CustomerEventType" ADD VALUE 'JOB_CARD_CREATED';
ALTER TYPE "CustomerEventType" ADD VALUE 'VEHICLE_CHECKED_IN';
ALTER TYPE "CustomerEventType" ADD VALUE 'DIAGNOSIS_COMPLETE';
ALTER TYPE "CustomerEventType" ADD VALUE 'REPAIR_STARTED';
ALTER TYPE "CustomerEventType" ADD VALUE 'PARTS_ADDED';
ALTER TYPE "CustomerEventType" ADD VALUE 'QUALITY_CHECK';
ALTER TYPE "CustomerEventType" ADD VALUE 'SERVICE_DELIVERED';
ALTER TYPE "CustomerEventType" ADD VALUE 'FEEDBACK_RECEIVED';

