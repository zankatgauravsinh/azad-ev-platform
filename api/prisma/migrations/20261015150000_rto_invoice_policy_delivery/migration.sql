-- RTO invoice: insurance policy number and delivery date (calendar date) printed on the invoice. Additive.

-- AlterTable
ALTER TABLE "RtoInvoice" ADD COLUMN     "deliveryDate" DATE,
ADD COLUMN     "policyNumber" TEXT;


-- Invoices raised before these fields existed take the booking's values: its policy number, and its delivery
-- date as the calendar date in the company's time zone.
UPDATE "RtoInvoice" r
SET "policyNumber" = i."policyNumber"
FROM "InsuranceDetail" i
WHERE i."bookingId" = r."bookingId" AND r."policyNumber" IS NULL AND i."policyNumber" IS NOT NULL;

UPDATE "RtoInvoice" r
SET "deliveryDate" = (b."actualDelivery" AT TIME ZONE 'UTC' AT TIME ZONE COALESCE(cs.timezone, 'Asia/Kolkata'))::date
FROM "Booking" b
LEFT JOIN "CompanySetting" cs ON cs."companyId" = b."companyId"
WHERE b.id = r."bookingId" AND r."deliveryDate" IS NULL AND b."actualDelivery" IS NOT NULL;
