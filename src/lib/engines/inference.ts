import type { ProficiencyLevel } from '@prisma/client'
import { levelFromValue, type CatalogSkill } from './types'

/**
 * Skills Discovery engine.
 *
 * Deterministic keyword inference — no external model call. A suggested skill
 * always carries the exact phrases from the candidate's own words that produced
 * it, so the UI can explain the suggestion and the candidate can reject it.
 */

export type InferenceHit = {
  slug: string
  name: string
  phrases: string[]
  hits: number
  contexts: string[]
  confidence: number
  level: ProficiencyLevel
}

export type InferenceContext = 'WORK' | 'CAREGIVING' | 'VOLUNTEER' | 'LEARNING' | 'GENERAL'

export type InferenceInput = {
  text: string
  context?: InferenceContext
  yearsInRole?: number
}

function normalize(value: string) {
  return value
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/[^a-z0-9+#.\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Adds plural/singular and hyphen variants so "mentored" matches "mentoring". */
function aliasForms(alias: string) {
  const base = normalize(alias)
  const forms = new Set<string>([base])
  if (base.endsWith('ing')) forms.add(`${base.slice(0, -3)}ed`)
  if (base.endsWith('e')) forms.add(`${base.slice(0, -1)}ing`)
  if (base.endsWith('y')) forms.add(`${base.slice(0, -1)}ied`)
  if (base.endsWith('or')) forms.add(`${base}s`)
  if (!base.includes(' ')) forms.add(`${base}s`)
  forms.add(base.replace(/\s/g, '-'))
  return [...forms].filter(Boolean)
}

const CONTEXT_BONUS: Record<InferenceContext, number> = {
  WORK: 0.12,
  CAREGIVING: 0.04,
  VOLUNTEER: 0.06,
  LEARNING: 0.05,
  GENERAL: 0,
}

/**
 * Confidence is capped below the threshold that would justify "Advanced" from
 * text alone: keyword evidence cannot establish expert performance.
 */
const MAX_INFERRED_CONFIDENCE = 0.85

export function inferSkills(
  inputs: InferenceInput[],
  catalog: CatalogSkill[],
): InferenceHit[] {
  const prepared = inputs
    .map((input) => ({
      normalized: normalize(input.text),
      context: input.context ?? 'GENERAL',
      yearsInRole: input.yearsInRole ?? 0,
    }))
    .filter((input) => input.normalized.length > 0)

  if (prepared.length === 0) return []

  const hits: InferenceHit[] = []

  for (const skill of catalog) {
    const phrases = new Set<string>()
    const contexts = new Set<string>()
    let weightedHits = 0
    let bestContextBonus = 0
    let maxYears = 0

    for (const input of prepared) {
      let matchedHere = 0
      for (const alias of skill.aliases) {
        for (const form of aliasForms(alias)) {
          if (form.length < 3) continue
          if (input.normalized.includes(form)) {
            matchedHere += 1
            phrases.add(alias.toLowerCase())
          }
        }
      }
      if (matchedHere > 0) {
        weightedHits += Math.min(matchedHere, 3)
        contexts.add(input.context)
        bestContextBonus = Math.max(bestContextBonus, CONTEXT_BONUS[input.context])
        maxYears = Math.max(maxYears, input.yearsInRole)
      }
    }

    if (weightedHits === 0) continue

    const breadthBonus = Math.min(contexts.size - 1, 2) * 0.05
    const durationBonus = maxYears >= 3 ? 0.08 : maxYears >= 1 ? 0.04 : 0
    const confidence = Math.min(
      MAX_INFERRED_CONFIDENCE,
      Number((0.32 + weightedHits * 0.09 + bestContextBonus + breadthBonus + durationBonus).toFixed(2)),
    )

    // Two or more independent mentions in paid-work context can reach Proficient;
    // a single passing mention stays Developing.
    const levelScore =
      1.4 + Math.min(weightedHits, 6) * 0.45 + (maxYears >= 2 ? 0.5 : 0) + (skill.transferable ? 0.2 : 0)
    const capped = confidence >= MAX_INFERRED_CONFIDENCE ? Math.min(levelScore, 4) : Math.min(levelScore, 3.6)

    hits.push({
      slug: skill.slug,
      name: skill.name,
      phrases: [...phrases],
      hits: weightedHits,
      contexts: [...contexts],
      confidence,
      level: levelFromValue(capped) as ProficiencyLevel,
    })
  }

  return hits.sort((a, b) => b.confidence - a.confidence || b.hits - a.hits)
}

/**
 * Short explanation of why a skill was suggested, shown next to the suggestion.
 */
export function explainHit(hit: InferenceHit) {
  const phrases = hit.phrases.slice(0, 3).map((phrase) => `“${phrase}”`)
  const contextText = hit.contexts.length
    ? ` Mentioned in ${hit.contexts.map((c) => c.toLowerCase()).join(' and ')} entries.`
    : ''
  return `Matched ${phrases.join(', ')} in your own words.${contextText} Confidence ${(hit.confidence * 100).toFixed(0)}%.`
}

export const INFERENCE_ENGINE_NAME = 'Skills Discovery Agent'
export const INFERENCE_ENGINE_MODE = 'RULE_BASED_KEYWORD'
export { normalize as normalizeForMatching }
