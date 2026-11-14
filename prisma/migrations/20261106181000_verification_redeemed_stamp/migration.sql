-- Distinguishes a redeemed code from a written-off one.
-- Additive only: a nullable column on a table created minutes earlier, so no
-- existing row or column is altered.

ALTER TABLE "email_verifications" ADD COLUMN "verifiedAt" TIMESTAMP(3);
