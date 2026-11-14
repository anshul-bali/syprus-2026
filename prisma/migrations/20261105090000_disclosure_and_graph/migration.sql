-- CreateEnum
CREATE TYPE "DisclosureRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'DECLINED', 'WITHDRAWN', 'EXPIRED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'DISCLOSURE_REQUEST';
ALTER TYPE "NotificationType" ADD VALUE 'DISCLOSURE_DECISION';
ALTER TYPE "NotificationType" ADD VALUE 'SUGGESTION_INBOX';

-- CreateTable
CREATE TABLE "identity_disclosure_requests" (
    "id" TEXT NOT NULL,
    "candidateProfileId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "jobId" TEXT,
    "requestedById" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "DisclosureRequestStatus" NOT NULL DEFAULT 'PENDING',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "identity_disclosure_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "graph_annotations" (
    "id" TEXT NOT NULL,
    "candidateProfileId" TEXT NOT NULL,
    "nodeKey" TEXT NOT NULL,
    "positionX" DOUBLE PRECISION,
    "positionY" DOUBLE PRECISION,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "labelOverride" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "graph_annotations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "identity_disclosure_requests_candidateProfileId_status_idx" ON "identity_disclosure_requests"("candidateProfileId", "status");

-- CreateIndex
CREATE INDEX "identity_disclosure_requests_organizationId_status_idx" ON "identity_disclosure_requests"("organizationId", "status");

-- CreateIndex
CREATE INDEX "identity_disclosure_requests_status_createdAt_idx" ON "identity_disclosure_requests"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "graph_annotations_candidateProfileId_nodeKey_key" ON "graph_annotations"("candidateProfileId", "nodeKey");

-- AddForeignKey
ALTER TABLE "identity_disclosure_requests" ADD CONSTRAINT "identity_disclosure_requests_candidateProfileId_fkey" FOREIGN KEY ("candidateProfileId") REFERENCES "candidate_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity_disclosure_requests" ADD CONSTRAINT "identity_disclosure_requests_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity_disclosure_requests" ADD CONSTRAINT "identity_disclosure_requests_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "graph_annotations" ADD CONSTRAINT "graph_annotations_candidateProfileId_fkey" FOREIGN KEY ("candidateProfileId") REFERENCES "candidate_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

