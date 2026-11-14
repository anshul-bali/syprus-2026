import type { ProficiencyLevel, ReadinessBand } from '@prisma/client'
import { LEVEL_VALUES, type CandidateSkillView, type JobSkillView } from './types'

/**
 * Gap & Pathway engine, part one: compares a skills inventory against a target
 * skill set and reports readiness, transferable strengths and prioritised gaps.
 *
 * The target is either one chosen role or the union of required skills across the
 * roles a candidate is already matched to, so a report is always available.
 */

export type GapSeverity = 'CRITICAL' | 'MAJOR' | 'MODERATE' | 'MINOR'

export type GapItem = {
  slug: string
  name: string
  requirement: 'REQUIRED' | 'PREFERRED'
  targetLevel: ProficiencyLevel
  currentLevel: ProficiencyLevel | null
  gapPoints: number
  severity: GapSeverity
  weight: number
  note: string
}

export type StrengthItem = {
  slug: string
  name: string
  level: ProficiencyLevel
  confidence: number
  evidenceCount: number
  transferable: boolean
  source: string
}

export type GapAnalysisInput = {
  candidateSkills: CandidateSkillView[]
  targets: JobSkillView[]
  yearsOfExperience: number
  experienceYearsMin: number | null
  contextLabel: string
}

export type GapAnalysis = {
  readiness: ReadinessBand
  readinessScore: number
  coverage: number
  evidenceQuality: number
  experienceFit: number
  /** False when the fit figure is the neutral assumption because no range existed. */
  experienceStated: boolean
  strengths: StrengthItem[]
  transferables: StrengthItem[]
  gaps: GapItem[]
  contextLabel: string
  generatedAtNote: string
}

const SEVERITY_RANK: Record<GapSeverity, number> = { CRITICAL: 0, MAJOR: 1, MODERATE: 2, MINOR: 3 }

/**
 * The weights the readiness score is actually built from, in one place so a
 * screen can show the real numbers instead of restating them from memory.
 */
export const GAP_READINESS_WEIGHTS = {
  coverage: 0.6,
  evidenceQuality: 0.22,
  experienceFit: 0.18,
} as const

/**
 * What the engine substitutes when a report has no published experience range
 * to compare against. It is a neutral placeholder, not a measurement.
 */
export const EXPERIENCE_FIT_ASSUMPTION = 0.7

function severityFor(gapPoints: number, requirement: 'REQUIRED' | 'PREFERRED'): GapSeverity {
  if (requirement === 'PREFERRED') return gapPoints >= 3 ? 'MODERATE' : 'MINOR'
  if (gapPoints >= 3) return 'CRITICAL'
  if (gapPoints === 2) return 'MAJOR'
  if (gapPoints === 1) return 'MODERATE'
  return 'MINOR'
}

function bandFor(score: number): ReadinessBand {
  if (score >= 0.82) return 'STRONG_MATCH'
  if (score >= 0.65) return 'JOB_READY'
  if (score >= 0.45) return 'DEVELOPING'
  return 'EMERGING'
}

export function analyseGaps(input: GapAnalysisInput): GapAnalysis {
  const candidateBySlug = new Map(input.candidateSkills.map((skill) => [skill.slug, skill]))

  // Collapse duplicate target rows (same skill across several roles) to the
  // highest level demanded, keeping the heaviest weight.
  const targetBySlug = new Map<string, JobSkillView>()
  for (const target of input.targets) {
    const existing = targetBySlug.get(target.slug)
    if (!existing) {
      targetBySlug.set(target.slug, target)
      continue
    }
    const keepHigher = LEVEL_VALUES[target.level] > LEVEL_VALUES[existing.level] ? target : existing
    const isRequired =
      target.requirement === 'REQUIRED' || existing.requirement === 'REQUIRED' ? 'REQUIRED' : 'PREFERRED'
    targetBySlug.set(target.slug, {
      ...keepHigher,
      requirement: isRequired,
      weight: Math.max(target.weight, existing.weight),
    })
  }

  const gaps: GapItem[] = []
  for (const target of targetBySlug.values()) {
    const held = candidateBySlug.get(target.slug)
    const currentLevel = held?.level ?? null
    const gapPoints = Math.max(
      0,
      LEVEL_VALUES[target.level] - (currentLevel ? LEVEL_VALUES[currentLevel] : 0),
    )
    if (gapPoints === 0) continue

    gaps.push({
      slug: target.slug,
      name: target.name,
      requirement: target.requirement,
      targetLevel: target.level,
      currentLevel,
      gapPoints,
      severity: severityFor(gapPoints, target.requirement),
      weight: target.weight,
      note: held
        ? `Held at ${currentLevel}; the target needs ${target.level}.`
        : target.requirement === 'REQUIRED'
          ? `No evidence for this required skill yet.`
          : `Not evidenced; would strengthen the profile.`,
    })
  }

  gaps.sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      b.weight - a.weight ||
      b.gapPoints - a.gapPoints ||
      a.name.localeCompare(b.name),
  )

  const weightTotal = [...targetBySlug.values()].reduce((total, target) => total + target.weight, 0)
  const weightCovered = [...targetBySlug.values()].reduce((total, target) => {
    const held = candidateBySlug.get(target.slug)
    if (!held) return total
    const ratio = Math.min(1, LEVEL_VALUES[held.level] / LEVEL_VALUES[target.level])
    return total + target.weight * ratio
  }, 0)
  const coverage = weightTotal > 0 ? weightCovered / weightTotal : 0

  const heldSkills = [...candidateBySlug.values()]
  const evidenceQuality =
    heldSkills.length === 0
      ? 0
      : heldSkills.reduce(
          (total, skill) =>
            total + Math.min(1, skill.confidence * 0.7 + Math.min(skill.evidenceCount, 3) * 0.1),
          0,
        ) / heldSkills.length

  const experienceFit =
    input.experienceYearsMin == null
      ? EXPERIENCE_FIT_ASSUMPTION
      : Math.min(1, input.yearsOfExperience / Math.max(0.5, input.experienceYearsMin))

  const readinessScore = Number(
    Math.max(
      0,
      Math.min(
        1,
        coverage * GAP_READINESS_WEIGHTS.coverage +
          evidenceQuality * GAP_READINESS_WEIGHTS.evidenceQuality +
          experienceFit * GAP_READINESS_WEIGHTS.experienceFit,
      ),
    ).toFixed(4),
  )

  const strengths: StrengthItem[] = heldSkills
    .filter((skill) => skill.confidence >= 0.5 || skill.evidenceCount >= 1)
    .map((skill) => ({
      slug: skill.slug,
      name: skill.name,
      level: skill.level,
      confidence: skill.confidence,
      evidenceCount: skill.evidenceCount,
      transferable: skill.transferable,
      source: skill.validationStatus,
    }))
    .sort(
      (a, b) =>
        LEVEL_VALUES[b.level] - LEVEL_VALUES[a.level] ||
        b.confidence - a.confidence ||
        b.evidenceCount - a.evidenceCount,
    )

  const transferables = strengths.filter((skill) => skill.transferable).slice(0, 12)

  return {
    readiness: bandFor(readinessScore),
    readinessScore,
    coverage: Number(coverage.toFixed(4)),
    evidenceQuality: Number(evidenceQuality.toFixed(4)),
    experienceFit: Number(experienceFit.toFixed(4)),
    experienceStated: input.experienceYearsMin != null,
    strengths: strengths.slice(0, 20),
    transferables,
    gaps,
    contextLabel: input.contextLabel,
    generatedAtNote: `Rule-based gap analysis against ${input.contextLabel}. No external model call and no claim of verified skill levels.`,
  }
}

export const GAP_ENGINE_NAME = 'Gap & Pathway Agent'
