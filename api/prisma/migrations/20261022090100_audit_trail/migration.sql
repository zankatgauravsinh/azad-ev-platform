-- Audit trail, part 2: who (name and role kept as they were), from where (IP, device, request id), the record as
-- people know it, field changes, the reason, and who caused the entry (a person, the system, a customer link, or
-- the app's automatic record of a write that logged nothing itself). Then the table becomes append-only.

-- CreateEnum
CREATE TYPE "AuditSource" AS ENUM ('USER', 'SYSTEM', 'PUBLIC', 'AUTO');

-- DropIndex
DROP INDEX "ActivityLog_entityType_entityId_idx";

-- DropIndex
DROP INDEX "ActivityLog_actorId_createdAt_idx";

-- DropIndex
DROP INDEX "ActivityLog_companyId_idx";

-- AlterTable
ALTER TABLE "ActivityLog" ADD COLUMN     "actorName" TEXT,
ADD COLUMN     "actorRole" TEXT,
ADD COLUMN     "changes" JSONB,
ADD COLUMN     "entityLabel" TEXT,
ADD COLUMN     "reason" TEXT,
ADD COLUMN     "requestId" TEXT,
ADD COLUMN     "source" "AuditSource" NOT NULL DEFAULT 'USER',
ADD COLUMN     "userAgent" TEXT;

-- CreateIndex
CREATE INDEX "ActivityLog_companyId_createdAt_idx" ON "ActivityLog"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "ActivityLog_companyId_entityType_entityId_createdAt_idx" ON "ActivityLog"("companyId", "entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "ActivityLog_companyId_actorId_createdAt_idx" ON "ActivityLog"("companyId", "actorId", "createdAt");


-- ── Backfill ─────────────────────────────────────────────────────────────────────────────────────────────
-- The actor's name and role on every existing entry.
UPDATE "ActivityLog" a SET "actorName" = u.name, "actorRole" = u.role::text
FROM "User" u WHERE a."actorId" = u.id AND a."actorName" IS NULL;

-- Entries written on routes without a signed-in tenant (sign-ins) were saved with no company, so nobody could
-- see them: they belong to the company of the person who made them.
UPDATE "ActivityLog" a SET "companyId" = u."companyId"
FROM "User" u WHERE a."actorId" = u.id AND a."companyId" = '';

-- ── Append-only ──────────────────────────────────────────────────────────────────────────────────────────
-- No UPDATE, DELETE or TRUNCATE of the audit log, whoever connects. The only way through is deliberate: a
-- DELETE in a transaction that first runs SELECT set_config('azad.audit_purge', 'on', true) — used by the
-- automated tests to remove their throwaway companies, never by the application.
CREATE FUNCTION "activity_log_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('azad.audit_purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'The audit log is append-only: % is not allowed on "ActivityLog"', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END
$$;

CREATE TRIGGER "ActivityLog_append_only" BEFORE UPDATE OR DELETE ON "ActivityLog"
  FOR EACH ROW EXECUTE FUNCTION "activity_log_append_only"();
CREATE TRIGGER "ActivityLog_no_truncate" BEFORE TRUNCATE ON "ActivityLog"
  FOR EACH STATEMENT EXECUTE FUNCTION "activity_log_append_only"();
