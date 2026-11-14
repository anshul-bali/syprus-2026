import type { ProficiencyLevel, SkillValidationStatus } from '@prisma/client'

export const LEVEL_VALUES: Record<ProficiencyLevel, number> = {
  DEVELOPING: 1,
  FUNCTIONAL: 2,
  PROFICIENT: 3,
  ADVANCED: 4,
  EXPERT: 5,
}

export const ALL_LEVELS: ProficiencyLevel[] = [
  'DEVELOPING',
  'FUNCTIONAL',
  'PROFICIENT',
  'ADVANCED',
  'EXPERT',
]

export function levelFromValue(value: number): ProficiencyLevel {
  const clamped = Math.min(5, Math.max(1, Math.round(value)))
  return ALL_LEVELS[clamped - 1]
}

export function levelLabel(level: ProficiencyLevel) {
  return level.charAt(0) + level.slice(1).toLowerCase()
}

export type CatalogSkill = {
  slug: string
  name: string
  category: string
  transferable: boolean
  aliases: string[]
}

export type CandidateSkillView = {
  slug: string
  name: string
  category: string
  transferable: boolean
  level: ProficiencyLevel
  confidence: number
  validationStatus: SkillValidationStatus
  evidenceCount: number
}

export type JobSkillView = {
  slug: string
  name: string
  level: ProficiencyLevel
  weight: number
  requirement: 'REQUIRED' | 'PREFERRED'
}

/**
 * Fields the scoring model is allowed to read. Anything absent from this list
 * cannot influence a score, which is what the fairness monitoring page checks.
 */
export const MATCH_INPUT_FIELDS = [
  'candidate skill levels',
  'candidate skill confidence',
  'skill evidence count',
  'job required and preferred skill levels',
  'job skill weights',
  'stated years of experience',
  'job published experience range',
] as const

/** Fields deliberately excluded from scoring. */
export const MATCH_EXCLUDED_FIELDS = [
  'length of career break',
  'reason for career break',
  'age',
  'marital status',
  'gender',
  'names of previous employers',
  'education institution names',
  'photograph or location beyond work-mode fit',
] as const
