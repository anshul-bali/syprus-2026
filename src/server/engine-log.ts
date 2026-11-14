import type { EngineName } from '@prisma/client'
import { prisma } from '@/lib/db'
import { jsonOrNull } from '@/server/fields'
import { matchModelVersion } from '@/lib/env'

export type EngineRunResult<T> = {
  result: T
  itemsProcessed: number
  itemsAffected: number
  inputSummary?: unknown
}

/**
 * Wraps every engine invocation so `engine_runs` holds real timing, volume and
 * failure data. The admin health screen reports from this table instead of from
 * invented uptime figures.
 */
export async function runEngine<T>(
  engine: EngineName,
  execute: () => Promise<EngineRunResult<T>>,
): Promise<T> {
  const startedAt = new Date()
  const run = await prisma.engineRun.create({
    data: {
      engine,
      status: 'RUNNING',
      mode: 'RULE_BASED',
      modelVersion: matchModelVersion(),
      startedAt,
    },
  })

  try {
    const outcome = await execute()
    const finishedAt = new Date()
    await prisma.engineRun.update({
      where: { id: run.id },
      data: {
        status: 'SUCCESS',
        itemsProcessed: outcome.itemsProcessed,
        itemsAffected: outcome.itemsAffected,
        durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
        inputSummary: jsonOrNull(outcome.inputSummary),
        finishedAt,
      },
    })
    return outcome.result
  } catch (error) {
    const finishedAt = new Date()
    await prisma.engineRun.update({
      where: { id: run.id },
      data: {
        status: 'FAILED',
        durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
        errorMessage: error instanceof Error ? error.message : String(error),
        finishedAt,
      },
    })
    throw error
  }
}

export type EngineHealthRow = {
  engine: EngineName
  lastStatus: 'SUCCESS' | 'FAILED' | 'RUNNING' | null
  lastRunAt: Date | null
  lastDurationMs: number | null
  lastError: string | null
  runs: number
  successes: number
  failures: number
  successRate: number | null
  averageDurationMs: number | null
  itemsProcessed: number
}

const ENGINE_LABELS: Record<EngineName, string> = {
  SKILL_INFERENCE: 'Skills Discovery Agent',
  GAP_ANALYSIS: 'Gap & Pathway Agent — analysis',
  PATHWAY_PLANNER: 'Gap & Pathway Agent — pathway',
  MATCHING: 'Matching & Explanation Agent',
  FAIRNESS_AUDIT: 'Fairness Sentinel Agent',
  ANONYMIZATION: 'Anonymisation filter',
}

export function engineLabel(engine: EngineName) {
  return ENGINE_LABELS[engine]
}

/** Aggregates `engine_runs` over the requested window for the health dashboard. */
export async function engineHealth(windowHours = 168): Promise<EngineHealthRow[]> {
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000)

  const [recent, grouped] = await Promise.all([
    prisma.engineRun.findMany({
      where: { startedAt: { gte: since } },
      orderBy: { startedAt: 'desc' },
      take: 800,
    }),
    prisma.engineRun.groupBy({
      by: ['engine'],
      where: { startedAt: { gte: since } },
      _count: { _all: true },
      _sum: { itemsProcessed: true, durationMs: true },
    }),
  ])

  const engines = Object.keys(ENGINE_LABELS) as EngineName[]

  return engines.map((engine) => {
    const runs = recent.filter((run) => run.engine === engine)
    const aggregate = grouped.find((entry) => entry.engine === engine)
    const latest = runs[0] ?? null
    const successes = runs.filter((run) => run.status === 'SUCCESS').length
    const failures = runs.filter((run) => run.status === 'FAILED').length
    const durations = runs.map((run) => run.durationMs)

    return {
      engine,
      lastStatus: latest?.status ?? null,
      lastRunAt: latest?.startedAt ?? null,
      lastDurationMs: latest?.durationMs ?? null,
      lastError: latest?.errorMessage ?? null,
      runs: runs.length,
      successes,
      failures,
      successRate: runs.length > 0 ? successes / runs.length : null,
      averageDurationMs: durations.length
        ? Math.round(durations.reduce((total, value) => total + value, 0) / durations.length)
        : null,
      itemsProcessed: aggregate?._sum.itemsProcessed ?? 0,
    }
  })
}
