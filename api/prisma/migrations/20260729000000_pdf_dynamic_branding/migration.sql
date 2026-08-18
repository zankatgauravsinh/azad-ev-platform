-- Dynamic PDF branding: dealer letterhead details now live in CompanySetting.
-- AlterTable
ALTER TABLE "CompanySetting" ADD COLUMN     "dealerName" TEXT,
ADD COLUMN     "tagline" TEXT NOT NULL DEFAULT 'POWERING TOMORROW',
ADD COLUMN     "website" TEXT;

-- Backfill the letterhead for the existing AZAD EV company (was hardcoded in the PDF helper).
UPDATE "CompanySetting"
SET "dealerName" = COALESCE("dealerName", 'Authorized Dealer – COMPTECH Electric Vehicles'),
    "phone"      = COALESCE(NULLIF("phone", ''), '9274442390, 9978644457, 9978644458')
WHERE "businessName" = 'AZAD EV POINT';
