-- Email verification for signup and login.
-- Additive only. No existing table or column is altered, so all current data is preserved.

CREATE TYPE "VerificationPurpose" AS ENUM ('SIGNUP', 'LOGIN');

CREATE TYPE "VerificationTransport" AS ENUM ('SENDGRID', 'PREVIEW');

CREATE TABLE "email_verifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "purpose" "VerificationPurpose" NOT NULL,
    "codeHash" TEXT NOT NULL,
    "previewCode" TEXT,
    "transport" "VerificationTransport" NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_verifications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "email_verifications_userId_createdAt_idx" ON "email_verifications"("userId", "createdAt");

CREATE INDEX "email_verifications_userId_purpose_expiresAt_idx" ON "email_verifications"("userId", "purpose", "expiresAt");

ALTER TABLE "email_verifications" ADD CONSTRAINT "email_verifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
