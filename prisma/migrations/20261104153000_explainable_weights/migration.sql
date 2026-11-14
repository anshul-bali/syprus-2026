-- Prompt 3: explainable, configurable match weights.
--
-- The two renamed columns keep their existing rows on purpose: `experienceScore`
-- held the experience-range fit, which now sits inside the wider "preferences and
-- constraints" bucket, and `transferableScore` is replaced by evidence strength.
-- Values are therefore placeholders for the previous model version until matches
-- are recomputed (`npm run db:seed`, or the admin "reapply weights" action), and
-- each row's `weightVersion` records which assumption set produced it.

-- AlterTable
ALTER TABLE "matches" RENAME COLUMN "experienceScore" TO "preferenceScore";
ALTER TABLE "matches" RENAME COLUMN "transferableScore" TO "evidenceScore";
ALTER TABLE "matches"
  ADD COLUMN "weightVersion" TEXT NOT NULL DEFAULT 'prototype-2026-11-a';

-- CreateTable
CREATE TABLE "weight_profiles" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "required" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "preferred" DOUBLE PRECISION NOT NULL DEFAULT 0.2,
    "evidence" DOUBLE PRECISION NOT NULL DEFAULT 0.2,
    "preferences" DOUBLE PRECISION NOT NULL DEFAULT 0.1,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "weight_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "weight_profiles_version_key" ON "weight_profiles"("version");

-- CreateIndex
CREATE INDEX "weight_profiles_active_idx" ON "weight_profiles"("active");
