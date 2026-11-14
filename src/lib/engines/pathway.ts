import type { GapItem } from './gap'

/**
 * Gap & Pathway engine, part two: turns prioritised gaps into an ordered
 * learning plan by selecting from the local resource catalogue.
 *
 * Only resources that already exist in `learning_resources` can appear in a
 * plan. If the catalogue has nothing for a gap, the plan says so instead of
 * inventing a course.
 */

export type PlanningResource = {
  id: string
  title: string
  provider: string
  type: string
  format: string
  skillSlug: string | null
  targetLevel: string
  durationHours: number | null
  isFree: boolean
  costLabel: string | null
  outcome: string
  url: string | null
  demonstration: boolean
}

export type PlanItemDraft = {
  resourceId: string
  position: number
  gapSkillSlug: string | null
  reason: string
}

export type PlanDraft = {
  title: string
  goal: string
  summary: string
  priority: number
  estimatedHours: number
  weeklyHours: number
  weeksAtFiveHours: number
  items: PlanItemDraft[]
  uncoveredGaps: string[]
}

const TYPE_RANK: Record<string, number> = {
  MICRO_CREDENTIAL: 0,
  CERTIFICATION: 1,
  COURSE: 2,
  WORKSHOP: 3,
  BOOTCAMP: 4,
  PRACTICE_PROJECT: 5,
  MENTORSHIP: 6,
  READING: 7,
}

const MAX_ITEMS = 8
const MAX_ITEMS_PER_GAP = 2

export type PlanOptions = {
  weeklyHours?: number
  skipResourceIds?: string[]
  maxItems?: number
}

export function buildLearningPlan(
  gaps: GapItem[],
  resources: PlanningResource[],
  contextLabel: string,
  options: PlanOptions = {},
): PlanDraft {
  const weeklyHours = options.weeklyHours ?? 5
  const maxItems = options.maxItems ?? MAX_ITEMS
  const skip = new Set(options.skipResourceIds ?? [])

  const bySkill = new Map<string, PlanningResource[]>()
  for (const resource of resources) {
    if (!resource.skillSlug) continue
    const list = bySkill.get(resource.skillSlug) ?? []
    list.push(resource)
    bySkill.set(resource.skillSlug, list)
  }

  const items: PlanItemDraft[] = []
  const uncoveredGaps: string[] = []
  let estimatedHours = 0

  const orderedGaps = gaps
    .filter((gap) => gap.requirement === 'REQUIRED' || gap.gapPoints >= 2)
    .slice(0, 6)

  // Preferred gaps with a clear shortfall still get a slot if space remains.
  const stretchGaps = gaps
    .filter((gap) => gap.requirement === 'PREFERRED' && gap.gapPoints >= 2)
    .slice(0, 2)

  for (const gap of [...orderedGaps, ...stretchGaps]) {
    if (items.length >= maxItems) break

    const pool = (bySkill.get(gap.slug) ?? []).filter((resource) => !skip.has(resource.id))
    if (pool.length === 0) {
      uncoveredGaps.push(gap.name)
      continue
    }

    pool.sort((a, b) => {
      const rank = (TYPE_RANK[a.type] ?? 5) - (TYPE_RANK[b.type] ?? 5)
      if (rank !== 0) return rank
      if (a.isFree !== b.isFree) return a.isFree ? -1 : 1
      return (a.durationHours ?? 999) - (b.durationHours ?? 999)
    })

    const take = gap.severity === 'CRITICAL' || gap.severity === 'MAJOR' ? MAX_ITEMS_PER_GAP : 1
    for (const resource of pool.slice(0, take)) {
      if (items.length >= maxItems) break
      estimatedHours += resource.durationHours ?? 8
      items.push({
        resourceId: resource.id,
        position: items.length + 1,
        gapSkillSlug: gap.slug,
        reason: `${gap.severity} gap in ${gap.name}: ${gap.note}`,
      })
      skip.add(resource.id)
    }
  }

  const weeksAtFiveHours = weeklyHours > 0 ? Math.ceil(estimatedHours / weeklyHours) : 0

  const topGap = orderedGaps[0]
  const summaryParts = [
    `${items.length} step${items.length === 1 ? '' : 's'} targeting ${
      new Set(items.map((item) => item.gapSkillSlug).filter(Boolean)).size
    } skill${new Set(items.map((item) => item.gapSkillSlug).filter(Boolean)).size === 1 ? '' : 's'} against ${contextLabel}.`,
  ]
  if (topGap) {
    summaryParts.push(
      `Highest priority is ${topGap.name} — ${topGap.note.replace(/\.$/, '')} (${topGap.severity.toLowerCase()} gap).`,
    )
  }
  if (uncoveredGaps.length > 0) {
    summaryParts.push(
      `No catalogued resource yet covers: ${uncoveredGaps.join(', ')}. These stay listed as open gaps rather than being filled with an unverified suggestion.`,
    )
  }
  summaryParts.push(
    `Estimated ${estimatedHours} hours, about ${weeksAtFiveHours} week${weeksAtFiveHours === 1 ? '' : 's'} at ${weeklyHours} hours per week.`,
  )

  return {
    title: topGap ? `Build ${topGap.name}` : `Close gaps for ${contextLabel}`,
    goal: topGap
      ? `Reach ${topGap.targetLevel} in ${topGap.name} and clear the remaining required gaps.`
      : `Strengthen the profile against ${contextLabel}.`,
    summary: summaryParts.join(' '),
    priority: 1,
    estimatedHours,
    weeklyHours,
    weeksAtFiveHours,
    items,
    uncoveredGaps,
  }
}

export const PATHWAY_ENGINE_NAME = 'Gap & Pathway Agent'
export const PATHWAY_ENGINE_MODE = 'CATALOGUE_LOOKUP'
