import { z } from 'zod'

/**
 * Typed input/output contracts for the four agents.
 *
 * Every provider reply is validated with these schemas before it can be
 * persisted, and the schema is also rendered into the prompt so the model knows
 * exactly what shape is required. A reply that fails here never reaches the
 * database — it triggers one repair attempt, then the deterministic fallback.
 */

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

const slug = z.string().min(2).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Must be a lowercase kebab-case slug')

const confidence = z.number().min(0).max(1)

export const PROFICIENCY_LEVELS = ['DEVELOPING', 'FUNCTIONAL', 'PROFICIENT', 'ADVANCED', 'EXPERT'] as const
export const level = z.enum(PROFICIENCY_LEVELS)

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
export const category = z.enum(SKILL_CATEGORIES)

export const EXPERIENCE_CONTEXTS = ['WORK', 'CAREGIVING', 'VOLUNTEER', 'EDUCATION', 'ACHIEVEMENT', 'GENERAL'] as const
export const experienceContext = z.enum(EXPERIENCE_CONTEXTS)

/** Provenance states, kept deliberately separate from one another. */
export const PROVENANCE_STATES = [
  'AI_SUGGESTED',
  'RULE_INFERRED',
  'USER_CONFIRMED',
  'SELF_REPORTED',
  'ASSESSMENT_VERIFIED',
  'REVIEWER_VERIFIED',
  'DISPUTED',
] as const
export const provenanceState = z.enum(PROVENANCE_STATES)

/** Reference entry passed to the model so it must choose from the taxonomy. */
export const taxonomyEntrySchema = z.object({
  slug,
  name: z.string().min(1).max(80),
  category,
  transferable: z.boolean(),
  /**
   * Aliases belong to the keyword engine, not the model prompt: sending all of
   * them for every skill roughly doubles the request size for no benefit, since
   * the model chooses by name. Optional so callers can send the compact form.
   */
  aliases: z.array(z.string().max(60)).max(24).default([]),
})
export type TaxonomyEntry = z.infer<typeof taxonomyEntrySchema>

// ---------------------------------------------------------------------------
// Agent 1 — Skills Discovery
// ---------------------------------------------------------------------------

export const discoveryInputSchema = z.object({
  blocks: z
    .array(
      z.object({
        context: experienceContext,
        text: z.string().min(12).max(4000),
        yearsInRole: z.number().min(0).max(60).optional(),
      }),
    )
    .min(1)
    .max(24),
  /** Canonical skills. The model may only propose slugs from this list. */
  taxonomy: z.array(taxonomyEntrySchema).min(1).max(400),
  existingSlugs: z.array(slug).max(200).default([]),
})
export type DiscoveryInput = z.infer<typeof discoveryInputSchema>

export const discoveryOutputSchema = z.object({
  proposals: z
    .array(
      z.object({
        slug,
        category,
        level,
        confidence,
        /** Verbatim substring of the supplied text. Invented quotes are rejected. */
        evidence: z
          .array(
            z.object({
              quote: z.string().min(3).max(400),
              context: experienceContext,
            }),
          )
          .min(1)
          .max(6),
        rationale: z.string().min(10).max(500),
        /** Care work is proposed as transferable, never as verified competence. */
        professionallyVerified: z.literal(false),
        requiresHumanReview: z.boolean(),
      }),
    )
    .max(30),
  /** Text the model could not map, kept so nothing is silently dropped. */
  unresolved: z
    .array(z.object({ quote: z.string().min(3).max(300), reason: z.string().min(5).max(300) }))
    .max(20)
    .default([]),
  assessmentSuggestions: z
    .array(z.object({ slug, reason: z.string().min(5).max(300) }))
    .max(10)
    .default([]),
  summary: z.string().min(10).max(600),
})
export type DiscoveryOutput = z.infer<typeof discoveryOutputSchema>

// ---------------------------------------------------------------------------
// Agent 2 — Market Intelligence
// ---------------------------------------------------------------------------

/**
 * Where a requirement set came from. `DATABASE_POSTINGS` is honest about being
 * an internal snapshot; only a configured live connector may claim `LIVE_FEED`.
 */
export const requirementSources = ['DATABASE_POSTINGS', 'LIVE_PROVIDER', 'CURATED_IMPORT'] as const
export type RequirementSource = (typeof requirementSources)[number]

export const marketInputSchema = z.object({
  candidateSkills: z.array(slug).max(200),
  jobSkills: z
    .array(
      z.object({
        slug,
        requirement: z.enum(['REQUIRED', 'PREFERRED']),
        level,
        weight: z.number().int().min(1).max(5),
      }),
    )
    .min(1)
    .max(40),
  preferences: z
    .object({
      workMode: z.enum(['REMOTE', 'HYBRID', 'ONSITE', 'ANY']).default('ANY'),
      employmentType: z.enum(['FULL_TIME', 'PART_TIME', 'CONTRACT', 'RETURNISH', 'ANY']).default('ANY'),
      availabilityHours: z.number().min(0).max(80).nullable().default(null),
      targetRole: z.string().max(140).nullable().default(null),
    })
    .default({ workMode: 'ANY', employmentType: 'ANY', availabilityHours: null, targetRole: null }),
  source: z.enum(requirementSources),
  dataAsOf: z.string().datetime(),
})
export type MarketInput = z.infer<typeof marketInputSchema>

export const marketOutputSchema = z.object({
  jobId: z.string().min(1),
  source: z.enum(requirementSources),
  /** False unless a live provider produced the requirement set. Never inferred. */
  isLiveDemandSignal: z.boolean(),
  score: confidence,
  components: z.object({
    requiredCoverage: confidence,
    preferredCoverage: confidence,
    evidenceStrength: confidence,
    experienceFit: confidence,
    preferenceFit: confidence,
  }),
  matched: z
    .array(
      z.object({
        slug,
        requiredLevel: level,
        candidateLevel: level.nullable(),
        contribution: z.number().min(0).max(1),
        validatedEvidence: z.boolean(),
      }),
    )
    .max(40),
  gaps: z
    .array(
      z.object({
        slug,
        requirement: z.enum(['REQUIRED', 'PREFERRED']),
        targetLevel: level,
        currentLevel: level.nullable(),
        severity: z.enum(['CRITICAL', 'MAJOR', 'MODERATE', 'MINOR']),
      }),
    )
    .max(40),
  explanation: z.array(z.string().min(10).max(400)).min(1).max(8),
  /** Fields the ranking explicitly did not use. Rendered in the UI. */
  excludedSignals: z.array(z.string().min(5).max(120)).min(4).max(12),
})
export type MarketOutput = z.infer<typeof marketOutputSchema>

// ---------------------------------------------------------------------------
// Agent 3 — Learning Pathways
// ---------------------------------------------------------------------------

export const pathwayInputSchema = z.object({
  gaps: z
    .array(
      z.object({
        slug,
        targetLevel: level,
        currentLevel: level.nullable(),
        severity: z.enum(['CRITICAL', 'MAJOR', 'MODERATE', 'MINOR']),
        requirement: z.enum(['REQUIRED', 'PREFERRED']),
      }),
    )
    .min(1)
    .max(20),
  /** Only these catalogue entries may be recommended. */
  catalogue: z
    .array(
      z.object({
        id: z.string().min(1),
        title: z.string().min(3).max(200),
        provider: z.string().min(2).max(120),
        type: z.enum([
          'COURSE',
          'MICRO_CREDENTIAL',
          'CERTIFICATION',
          'WORKSHOP',
          'BOOTCAMP',
          'MENTORSHIP',
          'PRACTICE_PROJECT',
          'READING',
        ]),
        skillSlug: slug.nullable(),
        targetLevel: level,
        durationHours: z.number().min(1).max(600).nullable(),
        isFree: z.boolean(),
        url: z.string().url().nullable(),
      }),
    )
    .min(1)
    .max(200),
  weeklyHours: z.number().min(1).max(40).default(5),
})
export type PathwayInput = z.infer<typeof pathwayInputSchema>

export const pathwayOutputSchema = z.object({
  title: z.string().min(5).max(140),
  goal: z.string().min(10).max(300),
  items: z
    .array(
      z.object({
        catalogueId: z.string().min(1),
        position: z.number().int().min(1).max(20),
        closesGapSlug: slug,
        /** Must quote the gap that motivated this step. */
        whyRecommended: z.string().min(15).max(400),
        estimatedHours: z.number().min(1).max(600).nullable(),
        /** Only copied from the catalogue entry; a model-supplied URL is discarded. */
        url: z.string().url().nullable(),
      }),
    )
    .min(1)
    .max(12),
  uncoveredGaps: z.array(slug).max(20).default([]),
  reassessment: z
    .array(z.object({ slug, suggestedFormat: z.enum(['QUIZ', 'PRACTICE_PROJECT', 'PEER_REVIEW', 'PORTFOLIO']) }))
    .max(12)
    .default([]),
  totalHours: z.number().min(1).max(4000),
  weeksAtWeeklyHours: z.number().min(1).max(200),
  note: z.string().min(20).max(600),
})
export type PathwayOutput = z.infer<typeof pathwayOutputSchema>

// ---------------------------------------------------------------------------
// Agent 4 — Bias Audit
// ---------------------------------------------------------------------------

export const biasAuditInputSchema = z.object({
  jobId: z.string().min(1).optional(),
  title: z.string().min(3).max(140),
  description: z.string().min(20).max(8000),
  responsibilities: z.array(z.string().max(400)).max(20).default([]),
  requirementsText: z.string().max(3000).nullable().default(null),
})
export type BiasAuditInput = z.infer<typeof biasAuditInputSchema>

export const biasFindingSchema = z.object({
  category: z.enum([
    'CAREER_CONTINUITY',
    'TENURE_THRESHOLD',
    'EXCLUSIONARY_LANGUAGE',
    'UNNECESSARY_CREDENTIAL',
    'CULTURE_FIT_VAGUENESS',
    'LOGISTICS_BARRIER',
    'BIASED_TONE',
    'OTHER',
  ]),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  /** Verbatim substring of the posting. */
  excerpt: z.string().min(3).max(300),
  whyItMayExclude: z.string().min(15).max(500),
  suggestion: z.string().min(15).max(600),
  /** Suggested replacement text, offered for human review only. */
  rewrite: z.string().max(600).nullable().default(null),
})
export type BiasFinding = z.infer<typeof biasFindingSchema>

export const biasAuditOutputSchema = z.object({
  overallRisk: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  findings: z.array(biasFindingSchema).max(25),
  continuityChecks: z
    .array(
      z.object({
        requirement: z.string().min(5).max(300),
        isLikelyUnnecessary: z.boolean(),
        reason: z.string().min(10).max(400),
        suggestedRewrite: z.string().max(600).nullable().default(null),
      }),
    )
    .max(15)
    .default([]),
  positives: z.array(z.string().min(10).max(300)).max(10).default([]),
  /**
   * Always empty by contract. Any non-empty value is a guardrail violation:
   * the system must not infer protected characteristics from a posting or a
   * candidate profile.
   */
  protectedCharacteristicsInferred: z.array(z.string()).max(0),
  reviewRequired: z.boolean(),
  disclaimer: z.string().min(20).max(500),
})
export type BiasAuditOutput = z.infer<typeof biasAuditOutputSchema>

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export const AGENT_NAMES = [
  'SKILLS_DISCOVERY',
  'MARKET_INTELLIGENCE',
  'LEARNING_PATHWAYS',
  'BIAS_AUDIT',
] as const
export type AgentName = (typeof AGENT_NAMES)[number]

export const orchestrationStepSchema = z.object({
  agent: z.enum(AGENT_NAMES),
  status: z.enum(['PENDING', 'RUNNING', 'SUCCESS', 'FALLBACK', 'FAILED', 'SKIPPED']),
  provider: z.string().max(60),
  model: z.string().max(120),
  fallbackReason: z.string().max(300).nullable().default(null),
  guardrailBlocks: z.number().int().min(0).max(999).default(0),
  produced: z.number().int().min(0).default(0),
  durationMs: z.number().int().min(0).default(0),
})
export type OrchestrationStep = z.infer<typeof orchestrationStepSchema>

// ---------------------------------------------------------------------------
// SYPRUS Sona — the conversational assistant
// ---------------------------------------------------------------------------

/**
 * Sona answers from facts the server read out of this account's own records.
 * The model is given identifiers, not free-form authority: anything it says
 * about a number has to point back at a fact it was handed.
 */
export const assistantInputSchema = z.object({
  role: z.enum(['CANDIDATE', 'EMPLOYER', 'ADMIN']),
  question: z.string().min(3).max(600),
  history: z
    .array(z.object({ role: z.enum(['USER', 'ASSISTANT']), content: z.string().max(1200) }))
    .max(8)
    .default([]),
  facts: z
    .array(
      z.object({
        id: z.string().min(1).max(40),
        label: z.string().max(120),
        value: z.string().max(300),
      }),
    )
    .max(24)
    .default([]),
  limits: z.array(z.string().max(200)).max(10).default([]),
})
export type AssistantInput = z.infer<typeof assistantInputSchema>

export const assistantOutputSchema = z.object({
  answer: z.string().min(20).max(1200),
  /** Ids of the supplied facts the answer actually rests on. */
  citations: z.array(z.string().max(40)).max(12).default([]),
  caveats: z.array(z.string().max(240)).max(4).default([]),
  followUps: z.array(z.string().max(120)).max(3).default([]),
})
export type AssistantOutput = z.infer<typeof assistantOutputSchema>

export function renderContract(schema: z.ZodTypeAny, label: string): string {
  // Compact, model-facing description. Full validation still happens server-side.
  const shape = (schema as unknown as { _def?: { shape?: Record<string, unknown> } })._def?.shape
  if (!shape) return `${label}: a JSON object matching the stated contract.`
  return `${label}: JSON object with top-level keys ${Object.keys(shape).join(', ')}.`
}
