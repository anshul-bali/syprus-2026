import type { ProficiencyLevel, SkillValidationStatus } from '@prisma/client'
import {
  LEVEL_VALUES,
  MATCH_EXCLUDED_FIELDS,
  MATCH_INPUT_FIELDS,
  type CandidateSkillView,
  type JobSkillView,
} from './types'

/**
 * Matching engine.
 *
 * Four weighted buckets, each normalised to 0–1 before weighting, so a role that
 * defines no preferred skills cannot be flattered by an empty category:
 *
 *   required skill coverage          50%
 *   preferred skill coverage         20%
 *   evidence and assessment strength 20%
 *   candidate preferences/constraints 10%
 *
 * Those numbers are a **configurable prototype assumption**, not a validated
 * hiring instrument. The active weight set and its version are stored with every
 * score so a later reviewer can see which assumptions produced a ranking.
 *
 * Career-break length, caregiving status, age, name and other protected
 * characteristics are not parameters of this function — they cannot be passed in.
 */

export type MatchWeights = {
  required: number
  preferred: number
  evidence: number
  preferences: number
}

/** Prompt 3 proposed MVP weights. */
export const DEFAULT_WEIGHTS: MatchWeights = {
  required: 0.5,
  preferred: 0.2,
  evidence: 0.2,
  preferences: 0.1,
}

export const WEIGHTS_VERSION = 'prototype-2026-11-a'

/**
 * How much a validation status supports a claim. Ordered by how the status was
 * earned, from a platform assessment down to a keyword suggestion. A disputed
 * claim contributes almost nothing until it is resolved.
 */
export const EVIDENCE_WEIGHT_BY_STATUS: Record<SkillValidationStatus, number> = {
  ASSESSMENT_VERIFIED: 1,
  HR_REVIEWED: 0.95,
  USER_CONFIRMED: 0.8,
  SELF_REPORTED: 0.65,
  AI_SUGGESTED: 0.45,
  RULE_INFERRED: 0.45,
  DISPUTED: 0.15,
}

export const EVIDENCE_COUNT_BONUS = 0.05
export const MAX_EVIDENCE_COUNT_BONUS = 3

export type PreferenceInput = {
  workMode?: 'REMOTE' | 'HYBRID' | 'ONSITE' | 'FLEXIBLE' | 'OPEN' | null
  employmentType?: 'FULL_TIME' | 'PART_TIME' | 'CONTRACT' | 'RETURNISH' | 'ANY' | null
  availabilityHours?: number | null
  locationCity?: string | null
}

export type JobPreferenceInput = {
  workMode?: 'REMOTE' | 'HYBRID' | 'ONSITE' | null
  employmentType?: 'FULL_TIME' | 'PART_TIME' | 'CONTRACT' | 'INTERNSHIP' | 'RETURNISH' | null
  locationCity?: string | null
}

export type SkillCredit = {
  slug: string
  name: string
  requirement: 'REQUIRED' | 'PREFERRED'
  weight: number
  requiredLevel: ProficiencyLevel
  candidateLevel: ProficiencyLevel | null
  candidateConfidence: number | null
  validationStatus: SkillValidationStatus | null
  evidenceCount: number
  evidenceStrength: number
  credit: number
  contribution: number
  status: 'COVERED' | 'PARTIAL' | 'MISSING'
  transferable: boolean
}

export type CalculationLine = {
  key: keyof MatchWeights
  label: string
  raw: number
  weight: number
  contribution: number
  note: string
}

export type PreferenceCheck = {
  label: string
  fit: number | null
  note: string
}

export type MatchExplanation = {
  modelVersion: string
  weightsVersion: string
  inputsUsed: readonly string[]
  inputsExcluded: readonly string[]
  weights: MatchWeights
  formula: string
  assumptionNote: string
  calculation: CalculationLine[]
  preferenceChecks: PreferenceCheck[]
  credits: SkillCredit[]
  matched: SkillCredit[]
  missingRequired: SkillCredit[]
  matchedPreferred: SkillCredit[]
  gaps: SkillCredit[]
  strengths: SkillCredit[]
  evidenceSummary: { assessed: number; reviewed: number; confirmed: number; reported: number; suggested: number; disputed: number }
  summary: string[]
}

export type MatchScore = {
  score: number
  requiredScore: number
  preferredScore: number
  evidenceScore: number
  preferenceScore: number
  explanation: MatchExplanation
}

export type MatchInput = {
  candidateSkills: CandidateSkillView[]
  jobSkills: JobSkillView[]
  yearsOfExperience: number
  experienceYearsMin: number | null
  experienceYearsMax: number | null
  preferences?: PreferenceInput
  jobPreferences?: JobPreferenceInput
  weights?: MatchWeights
  weightsVersion?: string
  modelVersion: string
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value))
}

/** Strength of the claim behind one skill: how it was validated plus its evidence. */
export function evidenceStrength(skill: CandidateSkillView | undefined): number {
  if (!skill) return 0
  const statusWeight = EVIDENCE_WEIGHT_BY_STATUS[skill.validationStatus] ?? 0.45
  const bonus = Math.min(skill.evidenceCount, MAX_EVIDENCE_COUNT_BONUS) * EVIDENCE_COUNT_BONUS
  return clamp01(0.55 * statusWeight + 0.35 * skill.confidence + bonus)
}

function coverageFor(jobSkill: JobSkillView, candidate: CandidateSkillView | undefined) {
  if (!candidate) return 0
  const levelRatio = Math.min(1, LEVEL_VALUES[candidate.level] / Math.max(1, LEVEL_VALUES[jobSkill.level]))
  return clamp01(levelRatio * (0.6 + 0.4 * evidenceStrength(candidate)))
}

function experienceFit(
  years: number,
  min: number | null,
  max: number | null,
): { fit: number; note: string } {
  if (min == null && max == null) {
    return { fit: 0.7, note: 'The role publishes no experience range, so this constraint scores a neutral 0.7.' }
  }
  const lower = min ?? 0
  const upper = max ?? Math.max(lower * 1.5, lower + 2)

  if (lower === 0 && years === 0) {
    return { fit: 0.75, note: 'Entry-level role with no recorded total experience; treated as compatible.' }
  }
  if (years < lower) {
    const fit = Math.max(0.15, years / lower)
    return {
      fit,
      note: `${years.toFixed(1)} recorded years against a stated minimum of ${lower}; partial fit ${Math.round(fit * 100)}%.`,
    }
  }
  if (years > upper * 1.6) {
    return {
      fit: 0.9,
      note: `${years.toFixed(1)} years is well above the stated ${lower}–${upper} range; a 10% over-qualification adjustment applies.`,
    }
  }
  return { fit: 1, note: `${years.toFixed(1)} recorded years falls inside the stated range of ${lower}–${upper}.` }
}

function workModeFit(
  candidate: PreferenceInput['workMode'],
  job: JobPreferenceInput['workMode'],
): { fit: number | null; note: string } {
  if (!candidate || !job || candidate === 'OPEN' || candidate === 'FLEXIBLE') {
    return { fit: null, note: 'No work-mode constraint was stated, so it is excluded from the average.' }
  }
  if (candidate === job) return { fit: 1, note: `Both sides want ${job.toLowerCase()} work.` }
  if (job === 'REMOTE') {
    return candidate === 'ONSITE'
      ? { fit: 0.35, note: 'The role is remote and you asked for on-site work.' }
      : { fit: 0.85, note: 'A remote role is compatible with your hybrid preference.' }
  }
  if (job === 'ONSITE') {
    return candidate === 'REMOTE'
      ? { fit: 0.3, note: 'The role is on-site and you asked for remote work.' }
      : { fit: 0.85, note: 'An on-site role is compatible with your hybrid preference.' }
  }
  return { fit: 0.8, note: 'The role is hybrid, which sits inside your stated preference.' }
}

function employmentTypeFit(
  candidate: PreferenceInput['employmentType'],
  job: JobPreferenceInput['employmentType'],
): { fit: number | null; note: string } {
  if (!candidate || !job || candidate === 'ANY') {
    return { fit: null, note: 'No employment-type preference stated; excluded from the average.' }
  }
  if (candidate === job) return { fit: 1, note: `You asked for ${job.toLowerCase().replace(/_/g, '-')} work.` }
  if (candidate === 'RETURNISH' && job === 'RETURNISH') return { fit: 1, note: 'Returnship match.' }
  if ((candidate === 'PART_TIME' && job === 'FULL_TIME') || (candidate === 'FULL_TIME' && job === 'PART_TIME')) {
    return { fit: 0.5, note: `You asked for ${candidate.toLowerCase().replace(/_/g, '-')}, this role is ${job.toLowerCase().replace(/_/g, '-')}.` }
  }
  return { fit: 0.75, note: `Adjacent arrangement: you want ${candidate.toLowerCase().replace(/_/g, '-')}, the role is ${job.toLowerCase().replace(/_/g, '-')}.` }
}

function availabilityFit(hours: number | null | undefined, job: JobPreferenceInput['employmentType']) {
  if (hours == null) {
    return { fit: null as number | null, note: 'No weekly availability recorded; excluded from the average.' }
  }
  if (job && job !== 'FULL_TIME') {
    return { fit: 1, note: `Your ${hours} h/week suits a ${job.toLowerCase().replace(/_/g, '-')} arrangement.` }
  }
  if (hours >= 35) return { fit: 1, note: `Your ${hours} h/week covers a full-time expectation.` }
  if (hours >= 24) {
    return {
      fit: 0.65,
      note: `You can offer ${hours} h/week against a full-time role; job-share or compressed weeks may still fit.`,
    }
  }
  return { fit: 0.4, note: `You can offer ${hours} h/week against a full-time role, which is a real constraint to discuss.` }
}

function locationFit(candidate?: string | null, job?: string | null) {
  if (!candidate || !job) return { fit: null as number | null, note: 'Location comparison not available; excluded.' }
  const same = candidate.trim().toLowerCase() === job.trim().toLowerCase()
  return {
    fit: same ? 1 : 0.7,
    note: same ? `Both are in ${candidate}.` : `You are in ${candidate}, the role is based in ${job}; relocations are not scored down heavily.`,
  }
}

export function scoreMatch(input: MatchInput): MatchScore {
  const weights = input.weights ?? DEFAULT_WEIGHTS
  const candidateBySlug = new Map(input.candidateSkills.map((skill) => [skill.slug, skill]))

  const credits: SkillCredit[] = input.jobSkills.map((jobSkill) => {
    const candidate = candidateBySlug.get(jobSkill.slug)
    return {
      slug: jobSkill.slug,
      name: jobSkill.name,
      requirement: jobSkill.requirement,
      weight: jobSkill.weight,
      requiredLevel: jobSkill.level,
      candidateLevel: candidate?.level ?? null,
      candidateConfidence: candidate?.confidence ?? null,
      validationStatus: candidate?.validationStatus ?? null,
      evidenceCount: candidate?.evidenceCount ?? 0,
      evidenceStrength: evidenceStrength(candidate),
      credit: coverageFor(jobSkill, candidate),
      contribution: 0,
      status: 'MISSING',
      transferable: candidate?.transferable ?? false,
    }
  })
  for (const credit of credits) {
    credit.status = credit.credit >= 0.8 ? 'COVERED' : credit.credit > 0 ? 'PARTIAL' : 'MISSING'
  }

  const required = credits.filter((credit) => credit.requirement === 'REQUIRED')
  const preferred = credits.filter((credit) => credit.requirement === 'PREFERRED')

  const weightedSum = (list: SkillCredit[]) => list.reduce((total, credit) => total + credit.weight * credit.credit, 0)
  const weightTotal = (list: SkillCredit[]) => list.reduce((total, credit) => total + credit.weight, 0)

  const hasRequired = required.length > 0
  const hasPreferred = preferred.length > 0

  const requiredScore = hasRequired ? weightedSum(required) / weightTotal(required) : 0
  const preferredScore = hasPreferred ? weightedSum(preferred) / weightTotal(preferred) : 0

  // Evidence strength is measured over the skills this role actually asks for, so
  // a strong portfolio of unrelated certificates cannot inflate the score.
  const relevantSlugs = new Set(input.jobSkills.map((skill) => skill.slug))
  const relevant = input.candidateSkills.filter((skill) => relevantSlugs.has(skill.slug))
  const evidenceScore =
    relevant.length > 0
      ? relevant.reduce((total, skill) => total + evidenceStrength(skill), 0) / relevant.length
      : 0

  // --- preferences and constraints ---------------------------------------
  const experience = experienceFit(input.yearsOfExperience, input.experienceYearsMin, input.experienceYearsMax)
  const mode = workModeFit(input.preferences?.workMode, input.jobPreferences?.workMode)
  const type = employmentTypeFit(input.preferences?.employmentType, input.jobPreferences?.employmentType)
  const availability = availabilityFit(input.preferences?.availabilityHours, input.jobPreferences?.employmentType)
  const location = locationFit(input.preferences?.locationCity, input.jobPreferences?.locationCity)

  const preferenceChecks: PreferenceCheck[] = [
    { label: 'Published experience range', fit: experience.fit, note: experience.note },
    { label: 'Work mode', fit: mode.fit, note: mode.note },
    { label: 'Employment type', fit: type.fit, note: type.note },
    { label: 'Weekly availability', fit: availability.fit, note: availability.note },
    { label: 'Location', fit: location.fit, note: location.note },
  ]
  const scoredChecks = preferenceChecks.filter((check) => check.fit != null) as (PreferenceCheck & {
    fit: number
  })[]
  const preferenceScore =
    scoredChecks.length > 0
      ? scoredChecks.reduce((total, check) => total + check.fit, 0) / scoredChecks.length
      : 0.7

  // An empty category hands its weight to the categories that exist, so the
  // total is always the weighted mean of the signals that were actually present.
  const buckets: Record<keyof MatchWeights, number> = {
    required: requiredScore,
    preferred: preferredScore,
    evidence: evidenceScore,
    preferences: preferenceScore,
  }
  const present: (keyof MatchWeights)[] = ['preferences', 'evidence']
  if (hasRequired) present.push('required')
  if (hasPreferred) present.push('preferred')

  const weightSum = present.reduce((total, key) => total + weights[key], 0)
  const normalised: Record<keyof MatchWeights, number> = {
    required: 0,
    preferred: 0,
    evidence: 0,
    preferences: 0,
  }
  for (const key of present) {
    normalised[key] = weightSum > 0 ? weights[key] / weightSum : 0
  }

  const calculation: CalculationLine[] = (['required', 'preferred', 'evidence', 'preferences'] as const).map((key) => ({
    key,
    label:
      key === 'required'
        ? 'Required skill coverage'
        : key === 'preferred'
          ? 'Preferred skill coverage'
          : key === 'evidence'
            ? 'Evidence and assessment strength'
            : 'Preferences and constraints',
    raw: Number(buckets[key].toFixed(4)),
    weight: Number(normalised[key].toFixed(4)),
    contribution: Number((buckets[key] * normalised[key]).toFixed(4)),
    note:
      key === 'required'
        ? `${required.filter((credit) => credit.status === 'COVERED').length}/${required.length || 0} required skills covered at or near the needed level.`
        : key === 'preferred'
          ? hasPreferred
            ? `${preferred.filter((credit) => credit.status !== 'MISSING').length}/${preferred.length} preferred skills present.`
            : 'This role defines no preferred skills, so its weight is redistributed.'
          : key === 'evidence'
            ? relevant.length > 0
              ? `Mean claim strength across ${relevant.length} skill${relevant.length === 1 ? '' : 's'} the role asks for.`
              : 'None of the requested skills are on the profile yet, so evidence contributes nothing.'
            : `${scoredChecks.length} of 5 constraints were stated; unscored ones are excluded rather than guessed.`,
  }))

  const score = clamp01(calculation.reduce((total, line) => total + line.contribution, 0))

  for (const credit of credits) {
    const bucketKey = credit.requirement === 'REQUIRED' ? 'required' : 'preferred'
    const bucketTotal = credit.requirement === 'REQUIRED' ? weightTotal(required) : weightTotal(preferred)
    credit.contribution =
      bucketTotal > 0 ? (credit.weight * credit.credit / bucketTotal) * (normalised[bucketKey] / (weightSum || 1)) * weightSum : 0
  }

  const matched = credits.filter((credit) => credit.credit >= 0.8)
  const missingRequired = required.filter((credit) => credit.status !== 'COVERED')
  const matchedPreferred = preferred.filter((credit) => credit.status !== 'MISSING')
  const gaps = credits
    .filter((credit) => credit.credit < 0.8)
    .sort((a, b) => b.weight - a.weight || a.credit - b.credit)
  const strengths = credits.filter(
    (credit) => credit.candidateLevel && LEVEL_VALUES[credit.candidateLevel] > LEVEL_VALUES[credit.requiredLevel],
  )

  const evidenceSummary = {
    assessed: relevant.filter((skill) => skill.validationStatus === 'ASSESSMENT_VERIFIED').length,
    reviewed: relevant.filter((skill) => skill.validationStatus === 'HR_REVIEWED').length,
    confirmed: relevant.filter((skill) => skill.validationStatus === 'USER_CONFIRMED').length,
    reported: relevant.filter((skill) => skill.validationStatus === 'SELF_REPORTED').length,
    suggested: relevant.filter((skill) => skill.validationStatus === 'RULE_INFERRED' || skill.validationStatus === 'AI_SUGGESTED').length,
    disputed: relevant.filter((skill) => skill.validationStatus === 'DISPUTED').length,
  }

  const summary = [
    `Covers ${Math.round(requiredScore * 100)}% of the weighted required skills and ${Math.round(preferredScore * 100)}% of the preferred skills.`,
    experience.note,
    `Evidence and assessment strength for the requested skills scores ${Math.round(evidenceScore * 100)}%.`,
    gaps.length
      ? `Largest gap: ${gaps[0].name} (needed at ${gaps[0].requiredLevel.toLowerCase()}, currently ${
          gaps[0].candidateLevel?.toLowerCase() ?? 'not evidenced'
        }).`
      : 'No skill gaps against this role.',
    'Career-break length, break reason, age, caregiving status and employer names are not inputs to this score.',
  ]

  return {
    score: Number(score.toFixed(4)),
    requiredScore: Number(requiredScore.toFixed(4)),
    preferredScore: Number(preferredScore.toFixed(4)),
    evidenceScore: Number(evidenceScore.toFixed(4)),
    preferenceScore: Number(preferenceScore.toFixed(4)),
    explanation: {
      modelVersion: input.modelVersion,
      weightsVersion: input.weightsVersion ?? WEIGHTS_VERSION,
      inputsUsed: MATCH_INPUT_FIELDS,
      inputsExcluded: MATCH_EXCLUDED_FIELDS,
      weights: { ...weights },
      formula:
        'score = Σ (normalised weight × category score), where each category is normalised to 0–1 and any category with no data hands its weight to the categories that have data.',
      assumptionNote:
        `Weights (${Object.values(weights).map((weight) => Math.round(weight * 100)).join(' / ')}) are configurable prototype assumptions. They are not validated hiring criteria; review them with hiring teams before operational use.`,
      calculation,
      preferenceChecks,
      credits,
      matched,
      missingRequired,
      matchedPreferred,
      gaps,
      strengths,
      evidenceSummary,
      summary,
    },
  }
}

export const MATCHING_ENGINE_NAME = 'Matching & Explanation Agent'
export const MATCHING_ENGINE_MODE = 'WEIGHTED_RULE_MODEL'
