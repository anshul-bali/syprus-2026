-- A clickable verification link beside the six-digit code.
-- Additive only: two nullable columns and one unique index on a table whose rows
-- are ten-minute codes, so nothing existing is altered or backfilled.

ALTER TABLE "email_verifications" ADD COLUMN "linkTokenHash" TEXT;

ALTER TABLE "email_verifications" ADD COLUMN "previewToken" TEXT;

CREATE UNIQUE INDEX "email_verifications_linkTokenHash_key" ON "email_verifications"("linkTokenHash");
