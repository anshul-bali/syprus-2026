import type { MatchExplanation } from '@/lib/engines/matching'

/**
 * Stored match explanations are JSON, and rows written before the four-bucket
 * rebuild do not carry `calculation`. Rather than crash a screen or invent the
 * missing figures, a reader gets null and the screen says the score predates the
 * current model and needs a recompute.
 */
export function readExplanation(raw: unknown): MatchExplanation | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Partial<MatchExplanation>
  if (!Array.isArray(value.calculation) || !Array.isArray(value.credits) || !Array.isArray(value.preferenceChecks)) {
    return null
  }
  if (typeof value.modelVersion !== 'string' || !Array.isArray(value.summary)) return null
  return value as MatchExplanation
}

export const STALE_EXPLANATION_NOTE =
  'This score was stored by an earlier model version, so the full breakdown was never written for it. Recompute to replace it.'
