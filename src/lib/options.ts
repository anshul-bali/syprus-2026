/**
 * Client-safe mirrors of the Prisma enums plus human labels.
 *
 * Prisma enum *values* are runtime objects, which must not reach the browser
 * bundle. These literal arrays are used by forms and by the Zod schemas that
 * validate them; `src/lib/db-enums.ts` maps them back for persistence.
 */

export const WORK_PREFERENCES = ['REMOTE', 'HYBRID', 'ONSITE', 'FLEXIBLE', 'OPEN'] as const
export const WORK_MODES = ['REMOTE', 'HYBRID', 'ONSITE'] as const
export const EMPLOYMENT_TYPES = ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERNSHIP', 'RETURNISH'] as const
export const EXPERIENCE_TYPES = [
  'PAID_EMPLOYMENT',
  'FREELANCE',
  'INTERNSHIP',
  'VOLUNTEERING',
  'ENTREPRENEURSHIP',
  'CAREGIVING',
  'COMMUNITY_LEADERSHIP',
  'EDUCATION',
  'UP_SKILLING',
] as const
export const PROFICIENCY_LEVELS = ['DEVELOPING', 'FUNCTIONAL', 'PROFICIENT', 'ADVANCED', 'EXPERT'] as const
export const SKILL_CATEGORIES = [
  'TECHNICAL',
  'ANALYTICAL',
  'COMMUNICATION',
  'LEADERSHIP',
  'COLLABORATION',
  'OPERATIONAL',
  'CREATIVE',
  'DIGITAL',
  'DOMAIN',
] as const
export const VALIDATION_STATUSES = ['SELF_REPORTED', 'RULE_INFERRED', 'HR_REVIEWED', 'DISPUTED'] as const
export const EVIDENCE_TYPES = [
  'ONBOARDING_ANSWER',
  'EXPERIENCE_DESCRIPTION',
  'PROJECT_ARTIFACT',
  'CERTIFICATION',
  'ASSESSMENT',
  'PEER_REVIEW',
  'EMPLOYER_CONFIRMATION',
] as const
export const SHARING_MODES = ['NOT_VISIBLE', 'ANONYMOUS_ONLY', 'ANONYMOUS_WITH_APPLY'] as const
export const JOB_STATUSES = ['DRAFT', 'PENDING_MODERATION', 'PUBLISHED', 'PAUSED', 'CLOSED', 'REJECTED'] as const
export const REQUIREMENT_LEVELS = ['REQUIRED', 'PREFERRED'] as const
export const APPLICATION_STATUSES = [
  'SUBMITTED',
  'IN_REVIEW',
  'SHORTLISTED',
  'INTERVIEW_INVITED',
  'INTERVIEW_COMPLETED',
  'OFFER_EXTENDED',
  'REJECTED',
  'WITHDRAWN',
  'HIRED',
] as const
export const RESOURCE_TYPES = [
  'COURSE',
  'MICRO_CREDENTIAL',
  'CERTIFICATION',
  'WORKSHOP',
  'BOOTCAMP',
  'MENTORSHIP',
  'PRACTICE_PROJECT',
  'READING',
] as const
export const LEARNING_FORMATS = ['SELF_PACED', 'INSTRUCTOR_LED', 'COHORT', 'ONE_ON_ONE'] as const
export const PLAN_ITEM_STATUSES = ['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED'] as const
export const PLAN_STATUSES = ['DRAFT', 'ACTIVE', 'COMPLETED', 'ABANDONED'] as const
export const ORG_VERIFICATION_STATUSES = ['PENDING', 'VERIFIED', 'REJECTED'] as const
export const ACCOUNT_STATUSES = ['PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED'] as const
export const READINESS_BANDS = ['EMERGING', 'DEVELOPING', 'JOB_READY', 'STRONG_MATCH'] as const

export type WorkPreference = (typeof WORK_PREFERENCES)[number]
export type WorkMode = (typeof WORK_MODES)[number]
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number]
export type ExperienceType = (typeof EXPERIENCE_TYPES)[number]
export type ProficiencyLevel = (typeof PROFICIENCY_LEVELS)[number]
export type SkillValidationStatus = (typeof VALIDATION_STATUSES)[number]
export type EvidenceType = (typeof EVIDENCE_TYPES)[number]
export type SharingMode = (typeof SHARING_MODES)[number]
export type JobStatus = (typeof JOB_STATUSES)[number]
export type RequirementLevel = (typeof REQUIREMENT_LEVELS)[number]
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number]
export type PlanItemStatus = (typeof PLAN_ITEM_STATUSES)[number]
export type OrgVerificationStatus = (typeof ORG_VERIFICATION_STATUSES)[number]
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number]
export type ReadinessBand = (typeof READINESS_BANDS)[number]

export const LABELS: Record<string, string> = {
  // Work
  REMOTE: 'Remote',
  HYBRID: 'Hybrid',
  ONSITE: 'On-site',
  FLEXIBLE: 'Flexible',
  OPEN: 'Open to any',
  FULL_TIME: 'Full time',
  PART_TIME: 'Part time',
  CONTRACT: 'Contract',
  INTERNSHIP: 'Internship',
  RETURNISH: 'Returnship',
  // Experience
  PAID_EMPLOYMENT: 'Paid employment',
  FREELANCE: 'Freelance',
  VOLUNTEERING: 'Volunteering',
  ENTREPRENEURSHIP: 'Own business',
  CAREGIVING: 'Caregiving',
  COMMUNITY_LEADERSHIP: 'Community leadership',
  EDUCATION: 'Education or training',
  UP_SKILLING: 'Up-skilling',
  // Login roles, so a chart or badge never reads as shouting.
  CANDIDATE: 'Candidate',
  EMPLOYER: 'Employer',
  ADMIN: 'Administrator',
  // Levels
  DEVELOPING: 'Developing',
  FUNCTIONAL: 'Functional',
  PROFICIENT: 'Proficient',
  ADVANCED: 'Advanced',
  EXPERT: 'Expert',
  // Categories
  TECHNICAL: 'Technical',
  ANALYTICAL: 'Analytical',
  COMMUNICATION: 'Communication',
  LEADERSHIP: 'Leadership',
  COLLABORATION: 'Collaboration',
  OPERATIONAL: 'Operational',
  CREATIVE: 'Creative',
  DIGITAL: 'Digital',
  DOMAIN: 'Domain knowledge',
  // Validation
  SELF_REPORTED: 'Self reported',
  RULE_INFERRED: 'Suggested from your words',
  HR_REVIEWED: 'Reviewed by a person',
  DISPUTED: 'Disputed',
  // Evidence
  ONBOARDING_ANSWER: 'Onboarding answer',
  EXPERIENCE_DESCRIPTION: 'Experience description',
  PROJECT_ARTIFACT: 'Project or artefact',
  CERTIFICATION: 'Certification',
  ASSESSMENT: 'Assessment result',
  PEER_REVIEW: 'Peer or manager review',
  EMPLOYER_CONFIRMATION: 'Employer confirmation',
  // Sharing
  NOT_VISIBLE: 'Not visible to employers',
  ANONYMOUS_ONLY: 'Visible anonymously only',
  ANONYMOUS_WITH_APPLY: 'Anonymous until you apply',
  // Jobs
  DRAFT: 'Draft',
  PENDING_MODERATION: 'Awaiting moderation',
  PUBLISHED: 'Published',
  PAUSED: 'Paused',
  CLOSED: 'Closed',
  REJECTED: 'Rejected',
  REQUIRED: 'Required',
  PREFERRED: 'Preferred',
  // Applications
  SUBMITTED: 'Submitted',
  IN_REVIEW: 'In review',
  SHORTLISTED: 'Shortlisted',
  INTERVIEW_INVITED: 'Interview invited',
  INTERVIEW_COMPLETED: 'Interview completed',
  OFFER_EXTENDED: 'Offer extended',
  WITHDRAWN: 'Withdrawn',
  HIRED: 'Hired',
  // Learning
  COURSE: 'Course',
  MICRO_CREDENTIAL: 'Micro-credential',
  WORKSHOP: 'Workshop',
  BOOTCAMP: 'Bootcamp',
  MENTORSHIP: 'Mentorship',
  PRACTICE_PROJECT: 'Practice project',
  READING: 'Reading',
  SELF_PACED: 'Self-paced',
  INSTRUCTOR_LED: 'Instructor-led',
  COHORT: 'Cohort',
  ONE_ON_ONE: 'One to one',
  NOT_STARTED: 'Not started',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Completed',
  SKIPPED: 'Skipped',
  ACTIVE: 'Active',
  ABANDONED: 'Archived',
  // Organisations and accounts
  PENDING: 'Pending',
  VERIFIED: 'Verified',
  SUSPENDED: 'Suspended',
  DEACTIVATED: 'Deactivated',
  PENDING_VERIFICATION: 'Pending verification',
  // Readiness
  EMERGING: 'Emerging',
  JOB_READY: 'Role ready',
  STRONG_MATCH: 'Strong match',
}

export function label(value: string | null | undefined) {
  if (value == null) return '—'
  return LABELS[value] ?? value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export function optionsFor<T extends readonly string[]>(values: T) {
  return values.map((value) => ({ value, label: label(value) }))
}
