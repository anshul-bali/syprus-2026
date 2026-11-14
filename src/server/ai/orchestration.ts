import { prisma } from '@/lib/db'
import { AccessDeniedError, assertPermission, type Principal } from '@/lib/authz'
import type { AiAgentName } from '@prisma/client'
import { recordAudit } from '@/server/audit'
import { jsonOrNull } from '@/server/fields'
import { computeMatchesForProfile } from '@/server/matching'
import { notifyUser } from '@/server/notifications'
import { runSkillsDiscovery, runMarketIntelligence, runLearningPathways } from './agents'

/**
 * Orchestration: discovery → matching → pathways.
 *
 * Each step calls the same service the screens call, so the workflow cannot
 * produce a different answer from the UI. The capability graph needs no step: it
 * renders the confirmed skills and their relationships live, so it is current as
 * soon as a proposal is accepted. A step that falls back to the rule engine is
 * recorded as FALLBACK rather than reported as a model run.
 */

type StepDefinition = { agent: AiAgentName; label: string }

const STEPS: StepDefinition[] = [
  { agent: 'SKILLS_DISCOVERY', label: 'Refresh skill suggestions from your own words' },
  { agent: 'MARKET_INTELLIGENCE', label: 'Recompute matches and the target-role breakdown' },
  { agent: 'LEARNING_PATHWAYS', label: 'Regenerate the learning pathway' },
]

export type OrchestrationResult = {
  runId: string
  status: 'COMPLETED' | 'PARTIAL' | 'FAILED'
  mode: 'AI' | 'DETERMINISTIC'
  steps: { agent: string; label: string; status: string; produced: number; fallbackReason: string | null; detail: unknown }[]
  message: string | null
}

export async function runOrchestration(
  principal: Principal,
  options: { targetJobId?: string | null; profileId?: string } = {},
): Promise<OrchestrationResult> {
  const profileId = options.profileId ?? principal.candidateProfileId
  if (!profileId) throw new AccessDeniedError('No candidate profile attached to this account.')

  if (profileId !== principal.candidateProfileId) {
    assertPermission(principal, 'admin.user.update')
  } else {
    assertPermission(principal, 'candidate.plan.update')
  }

  const profile = await prisma.candidateProfile.findUnique({
    where: { id: profileId },
    select: { id: true, userId: true, targetRole: true },
  })
  if (!profile) throw new AccessDeniedError('Candidate profile not found.')

  const run = await prisma.orchestrationRun.create({
    data: {
      candidateProfileId: profileId,
      triggeredById: principal.userId,
      status: 'RUNNING',
      mode: 'DETERMINISTIC',
      targetJobId: options.targetJobId ?? null,
      currentStep: STEPS[0].agent,
    },
  })

  const results: OrchestrationResult['steps'] = []
  let sawFallback = false
  let sawFailure = false
  let message: string | null = null
  let anyAi = false

  for (const [index, step] of STEPS.entries()) {
    const position = index + 1
    await prisma.orchestrationStep.create({
      data: { runId: run.id, agent: step.agent, position, status: 'RUNNING' },
    })
    await prisma.orchestrationRun.update({ where: { id: run.id }, data: { currentStep: step.agent } })

    const startedAt = Date.now()
    try {
      const outcome = await executeStep(step.agent, principal, profileId, options.targetJobId ?? null)

      if (outcome.mode === 'AI') anyAi = true
      if (outcome.fallbackReason && !outcome.skipped) sawFallback = true
      const stepStatus = outcome.skipped ? 'SKIPPED' : outcome.fallbackReason ? 'FALLBACK' : 'SUCCESS'

      await prisma.orchestrationStep.update({
        where: { runId_position: { runId: run.id, position } },
        data: {
          status: stepStatus,
          aiRunId: outcome.aiRunId ?? null,
          producedCount: outcome.produced,
          blockedCount: outcome.blocked,
          durationMs: Date.now() - startedAt,
          fallbackReason: outcome.skipped ? null : outcome.fallbackReason,
          detail: jsonOrNull(outcome.detail),
        },
      })

      results.push({
        agent: step.agent,
        label: step.label,
        status: stepStatus,
        produced: outcome.produced,
        fallbackReason: outcome.skipped ? null : outcome.fallbackReason,
        detail: outcome.detail,
      })
    } catch (error) {
      sawFailure = true
      const reason = error instanceof Error ? error.message : 'Step failed.'
      message = `${step.label} did not complete: ${reason}`
      await prisma.orchestrationStep.update({
        where: { runId_position: { runId: run.id, position } },
        data: { status: 'FAILED', durationMs: Date.now() - startedAt, detail: jsonOrNull({ error: reason }) },
      })
      results.push({ agent: step.agent, label: step.label, status: 'FAILED', produced: 0, fallbackReason: null, detail: { error: reason } })

      // Matching must exist before pathways can rank gaps, so stop rather than
      // emit a plan built on a stale comparison.
      for (const remaining of STEPS.slice(index + 1)) {
        await prisma.orchestrationStep.create({
          data: { runId: run.id, agent: remaining.agent, position: STEPS.indexOf(remaining) + 1, status: 'SKIPPED' },
        })
        results.push({ agent: remaining.agent, label: remaining.label, status: 'SKIPPED', produced: 0, fallbackReason: null, detail: null })
      }
      break
    }
  }

  const status = sawFailure ? 'FAILED' : sawFallback ? 'PARTIAL' : 'COMPLETED'

  await prisma.orchestrationRun.update({
    where: { id: run.id },
    data: {
      status,
      mode: anyAi ? 'AI' : 'DETERMINISTIC',
      finishedAt: new Date(),
      currentStep: null,
      errorStep: sawFailure ? results.find((entry) => entry.status === 'FAILED')?.agent ?? null : null,
      errorMessage: message,
    },
  })

  await notifyUser(profile.userId, {
    type: 'NEW_MATCH',
    title: status === 'COMPLETED' ? 'Your profile was re-matched' : 'Partial refresh completed',
    body: message ?? `Steps: ${results.map((entry) => `${entry.agent} ${entry.status.toLowerCase()}`).join(', ')}.`,
    link: '/candidate',
  })

  await recordAudit({
    actor: principal,
    action: 'ai.orchestration.run',
    entityType: 'orchestration_runs',
    entityId: run.id,
    targetUserId: profile.userId,
    metadata: { status, mode: anyAi ? 'AI' : 'DETERMINISTIC', steps: results.map((entry) => [entry.agent, entry.status]) },
  })

  return { runId: run.id, status, mode: anyAi ? 'AI' : 'DETERMINISTIC', steps: results, message }
}

type StepOutcome = {
  produced: number
  blocked: number
  mode: 'AI' | 'DETERMINISTIC'
  aiRunId: string | null
  fallbackReason: string | null
  /** A deliberate non-action (an administrator refreshing someone else's profile) is not a fallback. */
  skipped?: boolean
  detail: Record<string, unknown>
}

async function executeStep(
  agent: AiAgentName,
  principal: Principal,
  profileId: string,
  targetJobId: string | null,
): Promise<StepOutcome> {
  if (agent === 'SKILLS_DISCOVERY') {
    // Discovery writes proposals only when the candidate owns the profile; an
    // administrator triggering a refresh uses the existing skills unchanged.
    if (profileId !== principal.candidateProfileId) {
      const count = await prisma.candidateSkill.count({ where: { candidateProfileId: profileId } })
      return {
        produced: count,
        blocked: 0,
        mode: 'DETERMINISTIC',
        aiRunId: null,
        fallbackReason: null,
        skipped: true,
        detail: { skipped: true, reason: 'an administrator triggered this run, so the candidate’s own skills were left as they are' },
      }
    }
    const outcome = await runSkillsDiscovery(principal)
    return {
      produced: outcome.created,
      blocked: outcome.blocked.length,
      mode: outcome.mode,
      aiRunId: outcome.aiRunId,
      fallbackReason: outcome.fallbackReason,
      detail: { proposals: outcome.output.proposals.length, skipped: outcome.skipped, summary: outcome.output.summary },
    }
  }

  if (agent === 'MARKET_INTELLIGENCE') {
    const computed = await computeMatchesForProfile(profileId)
    const top = await prisma.match.findFirst({
      where: { candidateProfileId: profileId, status: 'COMPUTED' },
      orderBy: { score: 'desc' },
      select: { jobId: true },
    })
    const jobId = targetJobId ?? top?.jobId ?? null
    if (!jobId) {
      return { produced: computed.written, blocked: 0, mode: 'DETERMINISTIC', aiRunId: null, fallbackReason: 'no-published-role', detail: computed }
    }
    const insight = await runMarketIntelligence(principal, jobId, profileId)
    return {
      produced: computed.written,
      blocked: insight.outcome.blocked.length,
      mode: insight.outcome.mode,
      aiRunId: insight.outcome.aiRunId,
      fallbackReason: insight.outcome.fallbackReason,
      detail: { jobId, score: insight.outcome.output.score, gaps: insight.outcome.output.gaps.length, live: insight.outcome.output.isLiveDemandSignal },
    }
  }

  // LEARNING_PATHWAYS
  if (profileId !== principal.candidateProfileId) {
    // Building a plan writes to the candidate's own record and consumes their
    // gap consent context, so an administrator trigger stops here and says so
    // rather than acting as them.
    return {
      produced: 0,
      blocked: 0,
      mode: 'DETERMINISTIC',
      aiRunId: null,
      fallbackReason: null,
      skipped: true,
      detail: { skipped: true, reason: 'the candidate runs this step from their own account; an administrator refresh does not build a plan for someone else' },
    }
  }
  const pathway = await runLearningPathways(principal, { targetJobId })
  if (!pathway.plan) {
    return { produced: 0, blocked: 0, mode: 'DETERMINISTIC', aiRunId: null, fallbackReason: null, detail: { message: pathway.message } }
  }
  return {
    produced: pathway.plan.items.length,
    blocked: pathway.outcome?.blocked.length ?? 0,
    mode: pathway.outcome?.mode ?? 'DETERMINISTIC',
    aiRunId: pathway.outcome?.aiRunId ?? null,
    fallbackReason: pathway.outcome?.fallbackReason ?? null,
    detail: {
      planId: pathway.plan.id,
      steps: pathway.plan.items.length,
      uncovered: (pathway.outcome?.output.uncoveredGaps ?? []).length,
    },
  }
}

/** Read model for the admin workflow screen and the candidate status card. */
export async function listOrchestrationRuns(principal: Principal, options: { profileId?: string; take?: number } = {}) {
  const profileId = options.profileId ?? principal.candidateProfileId
  if (profileId && profileId !== principal.candidateProfileId) {
    assertPermission(principal, 'admin.user.read')
  } else if (principal.role === 'ADMIN') {
    // An administrator with no profile of their own reads the whole table.
    assertPermission(principal, 'admin.user.read')
  } else {
    assertPermission(principal, 'candidate.plan.read')
  }

  return prisma.orchestrationRun.findMany({
    where: profileId ? { candidateProfileId: profileId } : {},
    orderBy: { startedAt: 'desc' },
    take: options.take ?? 20,
    include: {
      steps: { orderBy: { position: 'asc' } },
      candidateProfile: { select: { id: true, anonymousHandle: true, userId: true } },
    },
  })
}
