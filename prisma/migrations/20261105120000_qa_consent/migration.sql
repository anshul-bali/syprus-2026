DROP INDEX "consent_records_userId_type_policyVersion_key";
CREATE INDEX "consent_records_userId_type_policyVersion_decidedAt_idx" ON "consent_records"("userId", "type", "policyVersion", "decidedAt");
ALTER TABLE "applications" ADD COLUMN "identityConsentAt" TIMESTAMP(3);
