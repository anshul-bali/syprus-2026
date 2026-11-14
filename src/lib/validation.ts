import { z } from 'zod'
import {
  APPLICATION_STATUSES,
  EMPLOYMENT_TYPES,
  EXPERIENCE_TYPES,
  LEARNING_FORMATS,
  PLAN_ITEM_STATUSES,
  PROFICIENCY_LEVELS,
  REQUIREMENT_LEVELS,
  RESOURCE_TYPES,
  SHARING_MODES,
  VALIDATION_STATUSES,
  WORK_MODES,
  WORK_PREFERENCES,
  EVIDENCE_TYPES,
  ACCOUNT_STATUSES,
} from './options'

/**
 * Server-side validation. Every server function and API route runs its input
 * through one of these schemas; client components reuse the same objects, so a
 * value that passes the browser check is checked again on the server.
 */

const trim = (value: unknown) => (typeof value === 'string' ? value.trim() : value)

const text = (message: string, max = 500) =>
  z.preprocess(trim, z.string().min(1, message).max(max, `Keep this under ${max} characters.`))

const optionalText = (max = 500) =>
  z.preprocess(
    (value) => {
      const trimmed = trim(value)
      return trimmed === '' ? undefined : trimmed
    },
    z.string().max(max, `Keep this under ${max} characters.`).optional(),
  )

const optionalWebUrl = (max: number) => optionalText(max).refine((value) => {
  if (!value) return true
  try {
    const url = new URL(value)
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
  } catch {
    return false
  }
}, 'Use an absolute http or https URL without credentials.')

const email = () => z.preprocess(trim, z.email('Enter a valid email address.'))

const password = () =>
  z
    .string()
    .min(8, 'Use at least 8 characters.')
    .max(72, 'Passwords are capped at 72 characters.')
    .refine((value) => new TextEncoder().encode(value).length <= 72, 'Passwords must fit within 72 UTF-8 bytes.')
    .refine((value) => /[a-zA-Z]/.test(value) && /[0-9]/.test(value), {
      message: 'Include at least one letter and one number.',
    })

const booleanField = (message?: string) =>
  z.preprocess((value) => {
    if (value === undefined || value === null || value === '') return false
    if (value === 'on' || value === 'yes' || value === 'true' || value === true) return true
    if (value === 'off' || value === 'no' || value === 'false' || value === false) return false
    return value
  }, message ? z.boolean({ error: message }) : z.boolean())

const numberField = (options: { min?: number; max?: number; int?: boolean } = {}) => {
  let schema = z.number({ error: 'Enter a number.' })
  if (options.int) schema = schema.int('Use a whole number.')
  if (options.min != null) schema = schema.min(options.min, `Must be at least ${options.min}.`)
  if (options.max != null) schema = schema.max(options.max, `Must be at most ${options.max}.`)
  return z.preprocess((value) => {
    if (value === '' || value === undefined || value === null) return Number.NaN
    const parsed = typeof value === 'number' ? value : Number(value)
    if (Number.isNaN(parsed)) return Number.NaN
    return options.int ? Math.trunc(parsed) : parsed
  }, schema)
}

const optionalNumberField = (options: { min?: number; max?: number; int?: boolean } = {}) => {
  let schema = z.number({ error: 'Enter a number.' })
  if (options.int) schema = schema.int('Use a whole number.')
  if (options.min != null) schema = schema.min(options.min, `Must be at least ${options.min}.`)
  if (options.max != null) schema = schema.max(options.max, `Must be at most ${options.max}.`)
  return z.preprocess((value) => {
    if (value === '' || value === undefined || value === null) return undefined
    const parsed = typeof value === 'number' ? value : Number(value)
    if (Number.isNaN(parsed)) return Number.NaN
    return options.int ? Math.trunc(parsed) : parsed
  }, schema.optional())
}

const dateField = () =>
  z.preprocess((value) => {
    if (value === '' || value === undefined || value === null) return undefined
    if (value instanceof Date) return value
    const parsed = new Date(String(value))
    return Number.isNaN(parsed.getTime()) ? value : parsed
  }, z.date({ error: 'Enter a valid date.' }).optional())

const enumField = <T extends readonly [string, ...string[]]>(values: T, message: string) =>
  z.preprocess(trim, z.enum(values as unknown as [string, ...string[]], { error: message })) as unknown as z.ZodType<
    T[number]
  >

const slugList = z.preprocess((value) => {
  if (Array.isArray(value)) return value
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return value
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
    }
  }
  return []
}, z.array(z.string().min(1)).max(40))

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

export const candidateSignupSchema = z
  .object({
    name: text('Enter your name.', 120),
    email: email(),
    password: password(),
    confirmPassword: z.string(),
    coreConsent: booleanField('Data-processing consent is required to create an account.'),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match.',
    path: ['confirmPassword'],
  })

export const employerSignupSchema = z
  .object({
    name: text('Enter your name.', 120),
    email: email(),
    password: password(),
    confirmPassword: z.string(),
    organizationName: text('Enter your organisation name.', 140),
    website: optionalWebUrl(200),
    industry: optionalText(80),
    sizeLabel: optionalText(60),
    locationCity: optionalText(80),
    locationCountry: optionalText(80),
    recruitmentConsent: booleanField('Confirm you accept the employer terms to continue.'),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match.',
    path: ['confirmPassword'],
  })

export const loginSchema = z.object({
  email: email(),
  password: z.string().min(1, 'Enter your password.'),
})

/** Codes arrive with spaces or dashes from password managers and from copy-paste. */
export const verificationCodeSchema = z.object({
  code: z.preprocess(
    (value) => (typeof value === 'string' ? value.replace(/[\s-]/g, '') : value),
    z.string().regex(/^\d{6}$/, 'Enter the six digits of the code.'),
  ),
})

// ---------------------------------------------------------------------------
// Candidate data
// ---------------------------------------------------------------------------

export const candidateProfileSchema = z.object({
  headline: optionalText(120),
  summary: optionalText(1200),
  locationCity: optionalText(80),
  locationCountry: optionalText(80),
  workPreference: enumField(WORK_PREFERENCES, 'Choose a work preference.'),
  availabilityHours: optionalNumberField({ min: 0, max: 80, int: true }),
  targetRole: optionalText(120),
  targetIndustry: optionalText(80),
  careerBreakMonths: optionalNumberField({ min: 0, max: 600, int: true }),
  breakReason: optionalText(300),
  returnTimeline: optionalText(120),
  yearsOfExperience: optionalNumberField({ min: 0, max: 60, int: false }),
  educationSummary: optionalText(300),
  sharingMode: enumField(SHARING_MODES, 'Choose how your profile is shared.'),
  visibleToEmployers: booleanField(),
})

export const experienceSchema = z.object({
  type: enumField(EXPERIENCE_TYPES, 'Choose the kind of experience.'),
  title: text('Enter a title.', 140),
  organization: optionalText(140),
  description: text('Describe what you did.', 2500),
  achievements: optionalText(1000),
  startDate: dateField(),
  endDate: dateField(),
  ongoing: booleanField(),
  hoursPerWeek: optionalNumberField({ min: 1, max: 100, int: true }),
  isCaregiving: booleanField(),
})

export const candidateSkillSchema = z.object({
  skillSlug: text('Choose a skill.', 80),
  level: enumField(PROFICIENCY_LEVELS, 'Choose a level.'),
  validationStatus: enumField(VALIDATION_STATUSES, 'Choose a status.'),
  note: optionalText(400),
})

export const skillEvidenceSchema = z.object({
  candidateSkillId: text('Missing skill reference.'),
  type: enumField(EVIDENCE_TYPES, 'Choose the evidence type.'),
  description: text('Describe the evidence.', 1000),
  url: optionalWebUrl(300),
})

export const onboardingAnswerSchema = z.object({
  stepKey: text('Missing step.'),
  answers: z.record(z.string(), z.union([z.string(), z.array(z.string()), z.number(), z.boolean()])),
})

export const planItemStatusSchema = z.object({
  itemId: text('Missing item.'),
  status: enumField(PLAN_ITEM_STATUSES, 'Choose a status.'),
  note: optionalText(300),
})

export const consentToggleSchema = z.object({
  type: z.enum([
    'DATA_PROCESSING',
    'SENSITIVE_DATA',
    'ANONYMIZED_PROFILE_SHARING',
    'IDENTIFIED_PROFILE_SHARING',
    'RULE_BASED_INFERENCE',
    'EMPLOYER_CONTACT',
    'PRODUCT_EMAILS',
    'RESEARCH_CONTRIBUTION',
  ]),
  granted: booleanField(),
})

// ---------------------------------------------------------------------------
// Employer data
// ---------------------------------------------------------------------------

export const organizationSchema = z.object({
  name: text('Enter the organisation name.', 140),
  website: optionalWebUrl(200),
  industry: optionalText(80),
  sizeLabel: optionalText(60),
  locationCity: optionalText(80),
  locationCountry: optionalText(80),
  description: optionalText(1500),
  flexPolicy: optionalText(600),
  returnshipNote: optionalText(600),
})

export const jobSkillInputSchema = z.object({
  skillSlug: text('Choose a skill.'),
  level: enumField(PROFICIENCY_LEVELS, 'Choose the level needed.'),
  weight: numberField({ min: 1, max: 5, int: true }),
  requirement: enumField(REQUIREMENT_LEVELS, 'Choose required or preferred.'),
})

export const jobSchema = z.object({
  title: text('Enter a role title.', 140),
  description: text('Describe the role.', 6000),
  responsibilities: z.preprocess((value) => {
    if (Array.isArray(value)) return value.filter((line) => String(line).trim().length > 0)
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value)
        if (Array.isArray(parsed)) return parsed
      } catch {
        // fall through to newline splitting
      }
      return value
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
    }
    return []
  }, z.array(z.string().trim().min(1, 'Remove empty lines.')).max(20)),
  requirementsText: optionalText(2000),
  locationCity: optionalText(80),
  locationCountry: optionalText(80),
  workMode: enumField(WORK_MODES, 'Choose a work mode.'),
  employmentType: enumField(EMPLOYMENT_TYPES, 'Choose an employment type.'),
  salaryMin: optionalNumberField({ min: 0, max: 1e9, int: true }),
  salaryMax: optionalNumberField({ min: 0, max: 1e9, int: true }),
  experienceYearsMin: optionalNumberField({ min: 0, max: 50, int: false }),
  experienceYearsMax: optionalNumberField({ min: 0, max: 50, int: false }),
  reEntryFriendly: booleanField(),
  flexibleHours: booleanField(),
  returnshipProgram: booleanField(),
  closesAt: dateField(),
  skills: z.preprocess((value) => {
    if (typeof value === 'string') {
      try {
        return JSON.parse(value)
      } catch {
        return []
      }
    }
    return value ?? []
  }, z.array(jobSkillInputSchema).min(1, 'Add at least one required or preferred skill.').max(30)),
})

export const applicationCreateSchema = z.object({
  jobId: text('Missing role reference.'),
  coverLetter: optionalText(2500),
  identityConsent: z.preprocess((value) => value === true || value === 'on', z.literal(true, { error: 'Explicit identity-sharing consent is required to apply.' })),
})

export const applicationStatusSchema = z.object({
  applicationId: text('Missing application.'),
  status: enumField(APPLICATION_STATUSES, 'Choose a status.'),
  note: optionalText(600),
  interviewScheduledAt: dateField(),
})

export const shortlistSchema = z.object({
  jobId: text('Missing role reference.'),
  candidateProfileId: text('Missing candidate.'),
  note: optionalText(400),
})

// ---------------------------------------------------------------------------
// Admin data
// ---------------------------------------------------------------------------

export const orgVerificationSchema = z.object({
  organizationId: text('Missing organisation.'),
  decision: enumField(['VERIFIED', 'REJECTED', 'PENDING'] as const, 'Choose a decision.'),
  note: text('Add the reason shown to the organisation.', 600),
})

export const jobModerationSchema = z.object({
  jobId: text('Missing role.'),
  decision: z.enum(['PUBLISHED', 'REJECTED', 'CLOSED']),
  note: optionalText(600),
})

export const userStatusSchema = z.object({
  userId: text('Missing user.'),
  status: enumField(ACCOUNT_STATUSES, 'Choose a status.'),
  reason: optionalText(400),
})

// ---------------------------------------------------------------------------
// Learning resource catalogue (admin-editable, seeded as demonstration data)
// ---------------------------------------------------------------------------

export const learningResourceSchema = z.object({
  title: text('Enter a title.', 160),
  provider: text('Enter the provider.', 120),
  url: optionalWebUrl(300),
  type: enumField(RESOURCE_TYPES, 'Choose a resource type.'),
  format: enumField(LEARNING_FORMATS, 'Choose a format.'),
  skillSlug: optionalText(80),
  targetLevel: enumField(PROFICIENCY_LEVELS, 'Choose the level reached.'),
  outcome: text('Describe what the learner can do afterwards.', 400),
  durationHours: optionalNumberField({ min: 1, max: 2000, int: true }),
  costLabel: optionalText(60),
  isFree: booleanField(),
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export type ValidationIssue = { path: string; message: string }

export type ParseResult<T> =
  | { ok: true; data: T }
  | {
      ok: false
      error: string
      fieldErrors: Record<string, string>
      /**
       * What the person had typed, minus anything secret, so a failed submit can
       * put it back. React's form actions reset uncontrolled inputs when the
       * action returns, and the only way to keep a long form is to hand its
       * values back as `defaultValue`.
       */
      values?: Record<string, string>
    }

/** Field names that must never come back over the wire after a failed submit. */
const NEVER_RESTORED = new Set([
  'password',
  'confirmPassword',
  'currentPassword',
  'newPassword',
  'code',
  'token',
  'ticket',
  'csrfToken',
  'clientSecret',
  'signature',
])

/**
 * The restorable half of a submitted form: plain string fields only. Files are
 * left out (they cannot be re-supplied by a value), as is anything that looks
 * like a secret — a password that fails its own rule is retyped, not echoed.
 */
export function restorableValues(formData: FormData): Record<string, string> {
  const values: Record<string, string> = {}
  for (const [key, value] of formData.entries()) {
    if (NEVER_RESTORED.has(key)) continue
    if (typeof value !== 'string') continue
    if (value.length > 4000) continue
    values[key] = value
  }
  return values
}

export function fieldErrorsFrom(error: z.ZodError): Record<string, string> {
  const errors: Record<string, string> = {}
  for (const issue of error.issues) {
    const path = issue.path.join('.')
    if (!path) continue
    if (!errors[path]) errors[path] = issue.message
  }
  return errors
}

/** Flattens FormData into a plain object, keeping repeated fields as arrays. */
export function formDataToRecord(formData: FormData) {
  const record: Record<string, unknown> = {}
  for (const [key, value] of formData.entries()) {
    if (value === null) continue
    if (record[key] === undefined) {
      record[key] = value
      continue
    }
    const existing = record[key]
    record[key] = Array.isArray(existing) ? [...existing, value] : [existing, value]
  }
  return record
}

export function parseFormData<T>(formData: FormData, schema: z.ZodType<T>): ParseResult<T> {
  const parsed = parseValue(formDataToRecord(formData), schema)
  return parsed.ok ? parsed : { ...parsed, values: restorableValues(formData) }
}

export function parseValue<T>(value: unknown, schema: z.ZodType<T>): ParseResult<T> {
  const result = schema.safeParse(value)
  if (result.success) return { ok: true, data: result.data }
  const errors = fieldErrorsFrom(result.error)
  const first = result.error.issues[0]
  return {
    ok: false,
    error: first ? first.message : 'Some fields need attention.',
    fieldErrors: errors,
  }
}

export function parseJsonField<T>(
  formData: FormData,
  field: string,
  schema: z.ZodType<T>,
): ParseResult<T> {
  const raw = formData.get(field)
  if (typeof raw !== 'string') {
    return { ok: false, error: `Missing ${field} payload.`, fieldErrors: {} }
  }
  try {
    return parseValue(JSON.parse(raw), schema)
  } catch {
    return { ok: false, error: `${field} is not valid JSON.`, fieldErrors: {} }
  }
}

export { slugList, optionalText, text }
