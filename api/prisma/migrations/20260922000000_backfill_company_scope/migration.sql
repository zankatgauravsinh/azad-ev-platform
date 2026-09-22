-- Backfill the sentinel companyId ('') to the sole company for models that the
-- tenant middleware was NOT scoping. Once these models join TENANT_MODELS, reads
-- are filtered by companyId, so any row still holding the '' sentinel (created via
-- the app before scoping) must be reassigned to the real company. Single-company
-- deployment today, so the sole Company row is the correct target. No-op where the
-- companyId was already set (seeded rows, finance/warranty creates).
DO $$
DECLARE cid text;
BEGIN
  SELECT id INTO cid FROM "Company" ORDER BY "createdAt" LIMIT 1;
  IF cid IS NULL THEN RETURN; END IF;
  UPDATE "SparePart"        SET "companyId" = cid WHERE "companyId" = '';
  UPDATE "LabourItem"       SET "companyId" = cid WHERE "companyId" = '';
  UPDATE "Vendor"           SET "companyId" = cid WHERE "companyId" = '';
  UPDATE "Income"           SET "companyId" = cid WHERE "companyId" = '';
  UPDATE "BankTransaction"  SET "companyId" = cid WHERE "companyId" = '';
  UPDATE "CashAdjustment"   SET "companyId" = cid WHERE "companyId" = '';
  UPDATE "ExpenseCategory"  SET "companyId" = cid WHERE "companyId" = '';
  UPDATE "ExpenseAttachment" SET "companyId" = cid WHERE "companyId" = '';
  UPDATE "RecurringExpense" SET "companyId" = cid WHERE "companyId" = '';
  UPDATE "MonthlyClosing"   SET "companyId" = cid WHERE "companyId" = '';
  UPDATE "Warranty"         SET "companyId" = cid WHERE "companyId" = '';
  UPDATE "WarrantyClaim"    SET "companyId" = cid WHERE "companyId" = '';
  UPDATE "FreeService"      SET "companyId" = cid WHERE "companyId" = '';
  UPDATE "AmcPlan"          SET "companyId" = cid WHERE "companyId" = '';
  UPDATE "AmcVisit"         SET "companyId" = cid WHERE "companyId" = '';
END $$;
