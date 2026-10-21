-- Audit trail, part 1: new audit actions. On their own, so a later migration (and the app) may use them.
ALTER TYPE "ActivityAction" ADD VALUE 'LOGIN_FAILED';
ALTER TYPE "ActivityAction" ADD VALUE 'LOGOUT';
ALTER TYPE "ActivityAction" ADD VALUE 'DOWNLOAD';
ALTER TYPE "ActivityAction" ADD VALUE 'SHARE_OPEN';
ALTER TYPE "ActivityAction" ADD VALUE 'CANCEL';
ALTER TYPE "ActivityAction" ADD VALUE 'APPROVE';
