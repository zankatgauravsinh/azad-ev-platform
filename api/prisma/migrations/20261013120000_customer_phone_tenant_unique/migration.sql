-- QA M6: a customer's mobile number becomes unique per company instead of across all companies.
-- Two showrooms may each have a customer with the same mobile; within a company it stays unique.
-- Safe for existing data: the old key was stricter (global), so no (companyId, phone) duplicate can exist.

-- DropIndex
DROP INDEX "Customer_phone_key";

-- CreateIndex
CREATE UNIQUE INDEX "Customer_companyId_phone_key" ON "Customer"("companyId", "phone");
