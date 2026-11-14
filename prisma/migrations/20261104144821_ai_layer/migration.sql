-- CreateEnum
CREATE TYPE "AiMode" AS ENUM ('AI', 'DETERMINISTIC');

-- CreateEnum
CREATE TYPE "AiRunStatus" AS ENUM ('RUNNING', 'SUCCESS', 'FALLBACK', 'FAILED');

-- CreateEnum
CREATE TYPE "AiAgentName" AS ENUM ('SKILLS_DISCOVERY', 'MARKET_INTELLIGENCE', 'LEARNING_PATHWAYS', 'BIAS_AUDIT', 'ORCHESTRATOR');

-- CreateEnum
CREATE TYPE "ProposalStatus" AS ENUM ('PROPOSED', 'CONFIRMED', 'EDITED', 'REJECTED');

-- CreateEnum
CREATE TYPE "UploadStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'REMOVED');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "RequirementSource" AS ENUM ('DATABASE_POSTINGS', 'LIVE_PROVIDER', 'CURATED_IMPORT');

-- CreateEnum
CREATE TYPE "OrchestrationStatus" AS ENUM ('RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "OrchestrationStepStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCESS', 'FALLBACK', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "ReviewTaskKind" AS ENUM ('BIAS_FINDING', 'SHORTLIST_DECISION', 'INTERVIEW_INVITATION', 'IDENTITY_DISCLOSURE', 'PROFILE_VISIBILITY', 'SKILL_VERIFICATION');

-- CreateEnum
CREATE TYPE "ReviewTaskStatus" AS ENUM ('OPEN', 'APPROVED', 'REJECTED', 'DEFERRED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SkillValidationStatus" ADD VALUE 'AI_SUGGESTED';
ALTER TYPE "SkillValidationStatus" ADD VALUE 'USER_CONFIRMED';
ALTER TYPE "SkillValidationStatus" ADD VALUE 'ASSESSMENT_VERIFIED';

-- CreateTable
CREATE TABLE "ai_runs" (
    "id" TEXT NOT NULL,
    "agent" "AiAgentName" NOT NULL,
    "status" "AiRunStatus" NOT NULL,
    "mode" "AiMode" NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "fallbackReason" TEXT,
    "fallbackNote" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "tokensPrompt" INTEGER NOT NULL DEFAULT 0,
    "tokensCompletion" INTEGER NOT NULL DEFAULT 0,
    "tokensTotal" INTEGER NOT NULL DEFAULT 0,
    "blockedCount" INTEGER NOT NULL DEFAULT 0,
    "warningCount" INTEGER NOT NULL DEFAULT 0,
    "blocked" JSONB,
    "warnings" JSONB,
    "inputSummary" JSONB,
    "outputSummary" JSONB,
    "errorMessage" TEXT,
    "subjectUserId" TEXT,
    "candidateProfileId" TEXT,
    "organizationId" TEXT,
    "jobId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ai_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_proposals" (
    "id" TEXT NOT NULL,
    "aiRunId" TEXT NOT NULL,
    "candidateProfileId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "proposedLevel" "ProficiencyLevel" NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "evidence" JSONB NOT NULL,
    "rationale" TEXT NOT NULL,
    "requiresHumanReview" BOOLEAN NOT NULL DEFAULT false,
    "status" "ProposalStatus" NOT NULL DEFAULT 'PROPOSED',
    "decisionNote" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessments" (
    "id" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "instructions" TEXT NOT NULL,
    "questionCount" INTEGER NOT NULL,
    "passMark" DOUBLE PRECISION NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "demonstration" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_questions" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "prompt" TEXT NOT NULL,
    "options" TEXT[],
    "correctIndex" INTEGER NOT NULL,
    "explanation" TEXT NOT NULL,

    CONSTRAINT "assessment_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_attempts" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "candidateProfileId" TEXT NOT NULL,
    "aiRunId" TEXT,
    "score" DOUBLE PRECISION NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "assessment_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_responses" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "selectedIndex" INTEGER NOT NULL,
    "correct" BOOLEAN NOT NULL,

    CONSTRAINT "assessment_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence_uploads" (
    "id" TEXT NOT NULL,
    "candidateProfileId" TEXT NOT NULL,
    "candidateSkillId" TEXT,
    "uploadedById" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "storedKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "status" "UploadStatus" NOT NULL DEFAULT 'PENDING',
    "reviewNote" TEXT,
    "reviewedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "evidence_uploads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "language_reviews" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "aiRunId" TEXT,
    "overallRisk" "RiskLevel" NOT NULL,
    "findings" JSONB NOT NULL,
    "continuityChecks" JSONB NOT NULL,
    "positives" JSONB NOT NULL,
    "mode" "AiMode" NOT NULL,
    "status" "ReviewStatus" NOT NULL DEFAULT 'OPEN',
    "reviewNote" TEXT,
    "reviewedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "language_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "market_insights" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "candidateProfileId" TEXT,
    "organizationId" TEXT,
    "aiRunId" TEXT,
    "source" "RequirementSource" NOT NULL,
    "isLive" BOOLEAN NOT NULL DEFAULT false,
    "dataAsOf" TIMESTAMP(3) NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "components" JSONB NOT NULL,
    "matched" JSONB NOT NULL,
    "gaps" JSONB NOT NULL,
    "explanation" TEXT[],
    "excludedSignals" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "market_insights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_source_connectors" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "source" "RequirementSource" NOT NULL,
    "baseUrl" TEXT,
    "credentialConfigured" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "lastSyncAt" TIMESTAMP(3),
    "lastError" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_source_connectors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orchestration_runs" (
    "id" TEXT NOT NULL,
    "candidateProfileId" TEXT NOT NULL,
    "triggeredById" TEXT NOT NULL,
    "status" "OrchestrationStatus" NOT NULL,
    "mode" "AiMode" NOT NULL,
    "targetJobId" TEXT,
    "currentStep" TEXT,
    "errorStep" TEXT,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "orchestration_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orchestration_steps" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "agent" "AiAgentName" NOT NULL,
    "position" INTEGER NOT NULL,
    "status" "OrchestrationStepStatus" NOT NULL,
    "aiRunId" TEXT,
    "producedCount" INTEGER NOT NULL DEFAULT 0,
    "blockedCount" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "fallbackReason" TEXT,
    "detail" JSONB,

    CONSTRAINT "orchestration_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_tasks" (
    "id" TEXT NOT NULL,
    "kind" "ReviewTaskKind" NOT NULL,
    "status" "ReviewTaskStatus" NOT NULL DEFAULT 'OPEN',
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "organizationId" TEXT,
    "candidateProfileId" TEXT,
    "jobId" TEXT,
    "reason" TEXT NOT NULL,
    "payload" JSONB,
    "assigneeRole" TEXT NOT NULL DEFAULT 'ADMIN',
    "createdById" TEXT,
    "decidedById" TEXT,
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "review_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_runs_agent_startedAt_idx" ON "ai_runs"("agent", "startedAt");

-- CreateIndex
CREATE INDEX "ai_runs_status_startedAt_idx" ON "ai_runs"("status", "startedAt");

-- CreateIndex
CREATE INDEX "ai_runs_subjectUserId_idx" ON "ai_runs"("subjectUserId");

-- CreateIndex
CREATE INDEX "ai_proposals_candidateProfileId_status_idx" ON "ai_proposals"("candidateProfileId", "status");

-- CreateIndex
CREATE INDEX "assessments_skillId_isActive_idx" ON "assessments"("skillId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_questions_assessmentId_position_key" ON "assessment_questions"("assessmentId", "position");

-- CreateIndex
CREATE INDEX "assessment_attempts_candidateProfileId_idx" ON "assessment_attempts"("candidateProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_responses_attemptId_questionId_key" ON "assessment_responses"("attemptId", "questionId");

-- CreateIndex
CREATE UNIQUE INDEX "evidence_uploads_storedKey_key" ON "evidence_uploads"("storedKey");

-- CreateIndex
CREATE INDEX "evidence_uploads_candidateProfileId_status_idx" ON "evidence_uploads"("candidateProfileId", "status");

-- CreateIndex
CREATE INDEX "language_reviews_jobId_status_idx" ON "language_reviews"("jobId", "status");

-- CreateIndex
CREATE INDEX "market_insights_jobId_createdAt_idx" ON "market_insights"("jobId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "job_source_connectors_key_key" ON "job_source_connectors"("key");

-- CreateIndex
CREATE INDEX "orchestration_runs_candidateProfileId_startedAt_idx" ON "orchestration_runs"("candidateProfileId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "orchestration_steps_runId_position_key" ON "orchestration_steps"("runId", "position");

-- CreateIndex
CREATE INDEX "review_tasks_status_kind_idx" ON "review_tasks"("status", "kind");

-- CreateIndex
CREATE INDEX "review_tasks_organizationId_idx" ON "review_tasks"("organizationId");

-- AddForeignKey
ALTER TABLE "ai_proposals" ADD CONSTRAINT "ai_proposals_aiRunId_fkey" FOREIGN KEY ("aiRunId") REFERENCES "ai_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_proposals" ADD CONSTRAINT "ai_proposals_candidateProfileId_fkey" FOREIGN KEY ("candidateProfileId") REFERENCES "candidate_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_proposals" ADD CONSTRAINT "ai_proposals_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "skills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "skills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_questions" ADD CONSTRAINT "assessment_questions_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "assessments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_attempts" ADD CONSTRAINT "assessment_attempts_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "assessments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_attempts" ADD CONSTRAINT "assessment_attempts_candidateProfileId_fkey" FOREIGN KEY ("candidateProfileId") REFERENCES "candidate_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_attempts" ADD CONSTRAINT "assessment_attempts_aiRunId_fkey" FOREIGN KEY ("aiRunId") REFERENCES "ai_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_responses" ADD CONSTRAINT "assessment_responses_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "assessment_attempts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_responses" ADD CONSTRAINT "assessment_responses_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "assessment_questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_uploads" ADD CONSTRAINT "evidence_uploads_candidateProfileId_fkey" FOREIGN KEY ("candidateProfileId") REFERENCES "candidate_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "language_reviews" ADD CONSTRAINT "language_reviews_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "language_reviews" ADD CONSTRAINT "language_reviews_aiRunId_fkey" FOREIGN KEY ("aiRunId") REFERENCES "ai_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "market_insights" ADD CONSTRAINT "market_insights_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "market_insights" ADD CONSTRAINT "market_insights_candidateProfileId_fkey" FOREIGN KEY ("candidateProfileId") REFERENCES "candidate_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "market_insights" ADD CONSTRAINT "market_insights_aiRunId_fkey" FOREIGN KEY ("aiRunId") REFERENCES "ai_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orchestration_runs" ADD CONSTRAINT "orchestration_runs_candidateProfileId_fkey" FOREIGN KEY ("candidateProfileId") REFERENCES "candidate_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orchestration_steps" ADD CONSTRAINT "orchestration_steps_runId_fkey" FOREIGN KEY ("runId") REFERENCES "orchestration_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orchestration_steps" ADD CONSTRAINT "orchestration_steps_aiRunId_fkey" FOREIGN KEY ("aiRunId") REFERENCES "ai_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
