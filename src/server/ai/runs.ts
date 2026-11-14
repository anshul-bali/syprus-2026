import { prisma } from '@/lib/db'
import { aiConfig, aiConfigSummary, aiEndpoints } from '@/lib/ai/config'
import { runAgent, type AgentCall, type AgentOutcome } from '@/lib/ai/client'
import type { AiProvider } from '@/lib/ai/provider'
import { describeChain, createFailoverProvider } from '@/lib/ai/providers/failover'
import { jsonOrNull } from '@/server/fields'
import { PROMPT_VERSION } from '@/lib/ai/prompts'

/**
 * Runs an agent and persists the result as an `ai_runs` row.
 *
 * Every agent call goes through here, so the database holds the provider, model,
 * prompt and schema versions, token spend, latency, whether the answer came from
 * the model or from the deterministic fallback, and what the guardrails removed.
 */

/**
 * Resolved once per process: the ordered endpoint chain (Groq first, then any
 * allow-listed failover), or null when no credential is configured at all.
 */
export function resolveProvider(): AiProvider | null {
  const endpoints = aiEndpoints()
  if (endpoints.length === 0) return null
  return createFailoverProvider({ endpoints })
}

/** The chain this process will actually try, credential-free. */
export function providerChain() {
  return describeChain(aiEndpoints())
}

export type RunSubject = {
  userId?: string | null
  candidateProfileId?: string | null
  organizationId?: string | null
  jobId?: string | null
}

export type RecordedOutcome<T> = AgentOutcome<T> & { aiRunId: string }

export async function agentRun<TInput, TOutput>(
  call: AgentCall<TInput, TOutput>,
  subject: RunSubject,
  options: { inputSummary?: unknown; outputSummary?: (output: TOutput) => unknown } = {},
): Promise<RecordedOutcome<TOutput>> {
  const config = aiConfig()
  const selected = call.provider ?? resolveProvider()

  const started = await prisma.aiRun.create({
    data: {
      agent: call.agent as never,
      status: 'RUNNING',
      mode: selected ? 'AI' : 'DETERMINISTIC',
      provider: selected?.name ?? 'deterministic-rule-engines',
      model: selected?.model ?? 'rules',
      promptVersion: PROMPT_VERSION,
      schemaVersion: call.schemaVersion,
      subjectUserId: subject.userId ?? null,
      candidateProfileId: subject.candidateProfileId ?? null,
      organizationId: subject.organizationId ?? null,
      jobId: subject.jobId ?? null,
      inputSummary: jsonOrNull(options.inputSummary ?? null),
    },
  })

  let outcome: AgentOutcome<TOutput>
  try {
    outcome = await runAgent({ ...call, provider: selected ?? undefined, config })
  } catch (error) {
    await prisma.aiRun.update({ where: { id: started.id }, data: { status: 'FAILED', errorMessage: 'Agent execution failed unexpectedly.', finishedAt: new Date() } })
    throw error
  }

  const finishedAt = new Date()
  await prisma.aiRun.update({
    where: { id: started.id },
    data: {
      status: outcome.mode === 'AI' ? 'SUCCESS' : outcome.fallbackReason ? 'FALLBACK' : 'FAILED',
      mode: outcome.mode,
      provider: outcome.provider,
      model: outcome.model,
      fallbackReason: outcome.fallbackReason,
      fallbackNote: outcome.fallbackNote,
      errorMessage: outcome.providerError,
      attempts: outcome.attempts,
      durationMs: outcome.latencyMs,
      tokensPrompt: outcome.usage.promptTokens,
      tokensCompletion: outcome.usage.completionTokens,
      tokensTotal: outcome.usage.totalTokens,
      blockedCount: outcome.blocked.length,
      warningCount: outcome.warnings.length,
      blocked: jsonOrNull(outcome.blocked),
      warnings: jsonOrNull(outcome.warnings),
      outputSummary: jsonOrNull(options.outputSummary ? options.outputSummary(outcome.output) : null),
      finishedAt,
    },
  })

  return { ...outcome, aiRunId: started.id }
}

export type AiHealth = {
  config: ReturnType<typeof aiConfigSummary>
  totals: {
    runs: number
    ai: number
    fallback: number
    failed: number
    blockedItems: number
    tokens: number
    averageLatencyMs: number | null
    /** When the newest stored run began — history, not a claim about right now. */
    newestRunAt: Date | null
  }
  /** Exact window aggregates, so a chart never sums a capped sample. */
  byMode: { mode: string; runs: number }[]
  byStatus: { status: string; runs: number }[]
  byProvider: { provider: string | null; runs: number; tokens: number }[]
  byFallbackReason: { reason: string; runs: number }[]
  byAgent: {
    agent: string
    runs: number
    ai: number
    fallback: number
    failed: number
    fallbackRate: number | null
    blockedItems: number
    tokens: number
    averageLatencyMs: number | null
    lastRunAt: Date | null
  }[]
  recentFallbacks: {
    id: string
    agent: string
    fallbackReason: string | null
    fallbackNote: string | null
    startedAt: Date
  }[]
  recentBlocks: { id: string; agent: string; blocked: unknown; startedAt: Date }[]
}

/**
 * Health is derived from stored runs, not from a synthetic uptime figure: the
 * fallback rate and the guardrail block counts are the numbers that actually
 * tell an operator whether the AI path is working.
 */
export async function aiHealth(windowHours = 168): Promise<AiHealth> {
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000)

  const [runs, grouped, modeGrouped, statusGrouped, providerGrouped, reasonGrouped, newest] = await Promise.all([
    prisma.aiRun.findMany({
      where: { startedAt: { gte: since } },
      orderBy: { startedAt: 'desc' },
      take: 500,
      select: {
        id: true,
        agent: true,
        status: true,
        mode: true,
        fallbackReason: true,
        fallbackNote: true,
        blockedCount: true,
        tokensTotal: true,
        durationMs: true,
        startedAt: true,
        blocked: true,
      },
    }),
    prisma.aiRun.groupBy({
      by: ['agent'],
      where: { startedAt: { gte: since } },
      _count: { _all: true },
      _sum: { tokensTotal: true, blockedCount: true },
      _avg: { durationMs: true },
      _max: { startedAt: true },
    }),
    prisma.aiRun.groupBy({ by: ['mode'], where: { startedAt: { gte: since } }, _count: { _all: true } }),
    prisma.aiRun.groupBy({ by: ['status'], where: { startedAt: { gte: since } }, _count: { _all: true } }),
    prisma.aiRun.groupBy({
      by: ['provider'],
      where: { startedAt: { gte: since } },
      _count: { _all: true },
      _sum: { tokensTotal: true },
    }),
    prisma.aiRun.groupBy({
      by: ['fallbackReason'],
      where: { startedAt: { gte: since }, fallbackReason: { not: null } },
      _count: { _all: true },
    }),
    prisma.aiRun.findFirst({
      where: { startedAt: { gte: since } },
      orderBy: { startedAt: 'desc' },
      select: { startedAt: true },
    }),
  ])

  // Per-agent splits are aggregated over the whole window too, so the table and
  // the charts describe the same set of rows as the totals block.
  const [agentMode, agentStatus] = await Promise.all([
    prisma.aiRun.groupBy({ by: ['agent', 'mode'], where: { startedAt: { gte: since } }, _count: { _all: true } }),
    prisma.aiRun.groupBy({ by: ['agent', 'status'], where: { startedAt: { gte: since } }, _count: { _all: true } }),
  ])

  const modeCount = (agent: string, mode: string) =>
    agentMode.find((row) => row.agent === agent && row.mode === mode)?._count._all ?? 0
  const statusCount = (agent: string, status: string) =>
    agentStatus.find((row) => row.agent === agent && row.status === status)?._count._all ?? 0

  const byAgent = grouped.map((row) => {
    const runs = row._count._all
    const fallback = statusCount(row.agent, 'FALLBACK')
    return {
      agent: row.agent,
      runs,
      ai: modeCount(row.agent, 'AI'),
      fallback,
      failed: statusCount(row.agent, 'FAILED'),
      fallbackRate: runs > 0 ? fallback / runs : null,
      blockedItems: row._sum.blockedCount ?? 0,
      tokens: row._sum.tokensTotal ?? 0,
      averageLatencyMs: row._avg.durationMs == null ? null : Math.round(row._avg.durationMs),
      lastRunAt: row._max.startedAt ?? null,
    }
  })

  // Every coarse figure is a window aggregate, never a sum of the recent sample.
  const runsTotal = grouped.reduce((total, row) => total + row._count._all, 0)
  const tokensTotal = grouped.reduce((total, row) => total + (row._sum.tokensTotal ?? 0), 0)
  const blockedTotal = grouped.reduce((total, row) => total + (row._sum.blockedCount ?? 0), 0)
  const modeTotal = (mode: string) => modeGrouped.find((row) => row.mode === mode)?._count._all ?? 0
  const statusTotal = (status: string) => statusGrouped.find((row) => row.status === status)?._count._all ?? 0
  const latencyWeighted = byAgent
    .filter((agent) => agent.averageLatencyMs != null)
    .reduce((acc, agent) => ({ ms: acc.ms + (agent.averageLatencyMs ?? 0) * agent.runs, runs: acc.runs + agent.runs }), {
      ms: 0,
      runs: 0,
    })

  return {
    config: aiConfigSummary(),
    totals: {
      runs: runsTotal,
      ai: modeTotal('AI'),
      fallback: statusTotal('FALLBACK'),
      failed: statusTotal('FAILED'),
      blockedItems: blockedTotal,
      tokens: tokensTotal,
      averageLatencyMs: latencyWeighted.runs > 0 ? Math.round(latencyWeighted.ms / latencyWeighted.runs) : null,
      newestRunAt: newest?.startedAt ?? null,
    },
    byMode: modeGrouped.map((row) => ({ mode: row.mode, runs: row._count._all })),
    byStatus: statusGrouped.map((row) => ({ status: row.status, runs: row._count._all })),
    byProvider: providerGrouped.map((row) => ({
      provider: row.provider,
      runs: row._count._all,
      tokens: row._sum.tokensTotal ?? 0,
    })),
    byFallbackReason: reasonGrouped.map((row) => ({ reason: row.fallbackReason ?? 'unspecified', runs: row._count._all })),
    byAgent: byAgent.sort((a, b) => b.runs - a.runs),
    recentFallbacks: runs
      .filter((run) => run.status === 'FALLBACK')
      .slice(0, 8)
      .map((run) => ({
        id: run.id,
        agent: run.agent,
        fallbackReason: run.fallbackReason,
        fallbackNote: run.fallbackNote,
        startedAt: run.startedAt,
      })),
    recentBlocks: runs
      .filter((run) => run.blockedCount > 0)
      .slice(0, 8)
      .map((run) => ({ id: run.id, agent: run.agent, blocked: run.blocked, startedAt: run.startedAt })),
  }
}
