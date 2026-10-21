-- GST module: months whose GSTR-1 / GSTR-3B are marked filed (figures frozen, documents locked).

-- CreateEnum
CREATE TYPE "GstReturnType" AS ENUM ('GSTR1', 'GSTR3B');

-- CreateEnum
CREATE TYPE "GstFilingStatus" AS ENUM ('FILED', 'UNLOCKED');

-- CreateTable
CREATE TABLE "GstReturnFiling" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "period" TEXT NOT NULL,
    "returnType" "GstReturnType" NOT NULL,
    "status" "GstFilingStatus" NOT NULL DEFAULT 'FILED',
    "arn" TEXT,
    "filedOn" DATE NOT NULL,
    "filedById" TEXT,
    "notes" TEXT,
    "figures" JSONB NOT NULL,
    "unlockedAt" TIMESTAMP(3),
    "unlockedById" TEXT,
    "unlockReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GstReturnFiling_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GstReturnFiling_companyId_idx" ON "GstReturnFiling"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "GstReturnFiling_companyId_period_returnType_key" ON "GstReturnFiling"("companyId", "period", "returnType");

