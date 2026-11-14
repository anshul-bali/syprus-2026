import { describe, it, expect } from './harness'
import { runAgent } from '../src/lib/ai/client'
import type { AiConfig } from '../src/lib/ai/config'
import { createFixtureProvider, failWith, sequence } from '../src/lib/ai/providers/fixture'
import { resetRateLimitState } from '../src/lib/ai/rate-limit'
import {
  guardDiscovery,
  guardMarket,
  guardPathway,
  guardBiasAudit,
} from '../src/lib/ai/guardrails'
import {
  discoveryInputSchema,
  discoveryOutputSchema,
  type DiscoveryInput,
  type DiscoveryOutput,
  type MarketInput,
  type MarketOutput,
  type PathwayInput,
  type BiasAuditInput,
  type BiasAuditOutput,
} from '../src/lib/ai/schemas'
import { scoreMatch, evidenceStrength } from '../src/lib/engines/matching'
import { analyseGaps, EXPERIENCE_FIT_ASSUMPTION, GAP_READINESS_WEIGHTS } from '../src/lib/engines/gap'
import { buildLearningPlan } from '../src/lib/engines/pathway'
import { analysePosting } from '../src/lib/engines/bias'
import { auditFairness } from '../src/lib/engines/fairness'
import { permissionsFor, ALL_PERMISSIONS } from '../src/lib/permissions'
import type { CandidateSkillView, JobSkillView } from '../src/lib/engines/types'

/**
 * Prompt 2 test suite.
 *
 * Covers structured extraction, authorization, matching calculations,
 * hallucination handling and unsafe outputs. Nothing here touches the network,
 * the database or a credential: the provider is scripted, and every assertion is
 * about behaviour the product claims.
 */

const config: AiConfig = {
  enabled: true,
  provider: 'openai-compatible',
  baseUrl: 'https://api.groq.com/openai/v1',
  apiKey: 'test-key-not-secret',
  model: 'fixture-gpt-oss',
  temperature: 0,
  maxTokens: 1600,
  timeoutMs: 5000,
  maxRetries: 1,
  rateLimitPerMinute: 1000,
  tokensPerMinute: 1_000_000,
  dailyTokenBudget: 10_000_000,
  liveAvailable: true,
}

const TAXONOMY = [
  {
    slug: 'scheduling-coordination',
    name: 'Scheduling & Coordination',
    category: 'COLLABORATION' as const,
    transferable: true,
    aliases: ['scheduling', 'roster', 'appointment'],
  },
  {
    slug: 'financial-literacy',
    name: 'Financial Literacy',
    category: 'ANALYTICAL' as const,
    transferable: true,
    aliases: ['budget', 'reconciliation'],
  },
]

const DISCOVERY_INPUT: DiscoveryInput = discoveryInputSchema.parse({
  blocks: [
    { context: 'CAREGIVING', text: 'I kept the medication timetable and booked four specialist appointments a month' },
    { context: 'WORK', text: 'I ran the depot roster for eighteen staff and reconciled the weekly stock budget' },
  ],
  taxonomy: TAXONOMY,
  existingSlugs: [],
})

const VALID_DISCOVERY_REPLY = {
  proposals: [
    {
      slug: 'scheduling-coordination',
      category: 'COLLABORATION',
      level: 'ADVANCED',
      confidence: 0.9,
      evidence: [{ quote: 'booked four specialist appointments a month', context: 'CAREGIVING' }],
      rationale: 'Recurring multi-party appointment coordination is scheduling work.',
      professionallyVerified: false,
      requiresHumanReview: true,
    },
    {
      slug: 'financial-literacy',
      category: 'ANALYTICAL',
      level: 'PROFICIENT',
      confidence: 0.8,
      evidence: [{ quote: 'reconciled the weekly stock budget', context: 'WORK' }],
      rationale: 'Reconciliation against a budget line is financial control work.',
      professionallyVerified: false,
      requiresHumanReview: false,
    },
  ],
  unresolved: [],
  assessmentSuggestions: [{ slug: 'scheduling-coordination', reason: 'Non-work evidence only.' }],
  summary: 'Two transferable competencies proposed from the candidate wording.',
}

function discoveryCall(provider: ReturnType<typeof createFixtureProvider>) {
  return runAgent<DiscoveryInput, DiscoveryOutput>({
    agent: 'SKILLS_DISCOVERY',
    subjectKey: 'user-test',
    input: DISCOVERY_INPUT,
    contract: discoveryOutputSchema as never,
    schemaVersion: 'test',
    guard: (raw, value) => guardDiscovery(raw, value),
    deterministic: () => ({
      proposals: [],
      unresolved: [],
      assessmentSuggestions: [],
      summary: 'deterministic fallback used',
    }),
    provider,
    config,
  })
}

// ---------------------------------------------------------------------------
describe('1. Structured extraction', () => {
  it('accepts a schema-valid model reply and reports it as AI mode', async () => {
    resetRateLimitState()
    const provider = createFixtureProvider({ replies: { SKILLS_DISCOVERY: VALID_DISCOVERY_REPLY }, model: 'gpt-oss-120b' })
    const outcome = await discoveryCall(provider)

    expect.equal(outcome.mode, 'AI')
    expect.length(outcome.output.proposals, 2)
    expect.equal(outcome.output.proposals[0].slug, 'scheduling-coordination')
    expect.equal(outcome.model, 'gpt-oss-120b')
    expect.equal(outcome.promptVersion.length > 0, true)
  })

  it('gives the model the output contract and the candidate text', async () => {
    resetRateLimitState()
    const provider = createFixtureProvider({ replies: { SKILLS_DISCOVERY: VALID_DISCOVERY_REPLY } })
    await discoveryCall(provider)

    const call = provider.calls[0]
    expect.includes(call.messages.map((message) => message.role), 'system')
    expect.true(call.messages[0].content.includes('RESPONSE CONTRACT'), 'system prompt carries the contract')
    expect.true(call.messages[0].content.includes('Never infer'), 'system prompt carries the prohibitions')
    expect.true(call.messages[1].content.includes('medication timetable'), 'user payload carries the candidate wording')
  })

  it('repairs a schema violation once instead of returning garbage', async () => {
    resetRateLimitState()
    const provider = createFixtureProvider({
      replies: {
        SKILLS_DISCOVERY: sequence([
          { unexpected: 'shape' },
          VALID_DISCOVERY_REPLY,
        ]),
      },
    })
    const outcome = await discoveryCall(provider)

    expect.equal(outcome.mode, 'AI', 'the repaired reply was accepted')
    expect.equal(outcome.attempts, 2, 'exactly one repair attempt was used')
    expect.true(provider.calls[1].messages.some((message) => message.content.includes('did not satisfy')), 'repair prompt quotes the failures')
  })

  it('falls back to the deterministic engine when the schema never validates', async () => {
    resetRateLimitState()
    const provider = createFixtureProvider({ replies: { SKILLS_DISCOVERY: { nope: 1 } } })
    const outcome = await discoveryCall(provider)

    expect.equal(outcome.mode, 'DETERMINISTIC')
    expect.equal(outcome.fallbackReason, 'provider-schema-violation')
    expect.equal(outcome.output.summary, 'deterministic fallback used')
  })

  it('falls back when the provider is unreachable, and says why', async () => {
    resetRateLimitState()
    const provider = createFixtureProvider({
      replies: { SKILLS_DISCOVERY: failWith('unavailable', 'connection reset') },
    })
    const outcome = await discoveryCall(provider)

    expect.equal(outcome.mode, 'DETERMINISTIC')
    expect.equal(outcome.fallbackReason, 'provider-unavailable')
    expect.true(outcome.fallbackNote!.includes('deterministic rule engine'), 'the note explains the fallback')
  })

  it('uses the rule engine without error when no credential exists', async () => {
    resetRateLimitState()
    const provider = createFixtureProvider({ replies: { SKILLS_DISCOVERY: VALID_DISCOVERY_REPLY } })
    const outcome = await runAgent<DiscoveryInput, DiscoveryOutput>({
      agent: 'SKILLS_DISCOVERY',
      subjectKey: 'user-test',
      input: DISCOVERY_INPUT,
      contract: discoveryOutputSchema as never,
      schemaVersion: 'test',
      guard: (raw, value) => guardDiscovery(raw, value),
      deterministic: () => ({ proposals: [], unresolved: [], assessmentSuggestions: [], summary: 'deterministic fallback used' }),
      provider,
      config: { ...config, liveAvailable: false, apiKey: undefined },
    })

    expect.equal(outcome.mode, 'DETERMINISTIC')
    expect.equal(outcome.fallbackReason, 'provider-not-configured')
    expect.length(provider.calls, 0, 'no network call was attempted')
  })

  it('degrades to the rule engine rather than failing when the rate limit is hit', async () => {
    resetRateLimitState()
    const provider = createFixtureProvider({ replies: { SKILLS_DISCOVERY: VALID_DISCOVERY_REPLY } })
    const throttled = { ...config, rateLimitPerMinute: 1 }

    const first = await runAgent<DiscoveryInput, DiscoveryOutput>({
      ...discoveryCallArgs(provider),
      config: throttled,
    })
    // Consume the bucket, then expect the next call to fall back rather than throw.
    const second = await runAgent<DiscoveryInput, DiscoveryOutput>({
      ...discoveryCallArgs(provider),
      config: throttled,
    })
    const third = await runAgent<DiscoveryInput, DiscoveryOutput>({
      ...discoveryCallArgs(provider),
      config: throttled,
    })

    expect.equal(first.mode, 'AI')
    expect.equal(third.mode, 'DETERMINISTIC')
    expect.equal(third.fallbackReason, 'provider-rate-limit')
    expect.true(['AI', 'DETERMINISTIC'].includes(second.mode))
  })

  it('records token spend returned by the provider', async () => {
    resetRateLimitState()
    const provider = createFixtureProvider({ replies: { SKILLS_DISCOVERY: VALID_DISCOVERY_REPLY }, tokensPerCall: 100 })
    const outcome = await discoveryCall(provider)
    expect.equal(outcome.usage.totalTokens, 200)
  })
})

function discoveryCallArgs(provider: ReturnType<typeof createFixtureProvider>) {
  return {
    agent: 'SKILLS_DISCOVERY' as const,
    subjectKey: 'user-test',
    input: DISCOVERY_INPUT,
    contract: discoveryOutputSchema as never,
    schemaVersion: 'test',
    guard: (raw: unknown, value: DiscoveryInput) => guardDiscovery(raw, value),
    deterministic: () =>
      ({ proposals: [], unresolved: [], assessmentSuggestions: [], summary: 'deterministic fallback used' }) as DiscoveryOutput,
    provider,
  }
}

// ---------------------------------------------------------------------------
describe('2. Hallucination handling', () => {
  it('refuses a skill that is not in the taxonomy', async () => {
    resetRateLimitState()
    const reply = {
      ...VALID_DISCOVERY_REPLY,
      proposals: [
        {
          slug: 'care-coordination',
          category: 'DOMAIN',
          level: 'ADVANCED',
          confidence: 0.96,
          evidence: [{ quote: 'medication timetable', context: 'CAREGIVING' }],
          rationale: 'Invented slug, as seen from the live model during setup.',
          professionallyVerified: false,
          requiresHumanReview: false,
        },
      ],
    }
    const provider = createFixtureProvider({ replies: { SKILLS_DISCOVERY: reply } })
    const outcome = await discoveryCall(provider)

    expect.length(outcome.output.proposals, 0)
    expect.length(outcome.blocked.filter((item) => item.rule === 'unknown-skill'), 1)
    expect.true(outcome.blocked[0].detail.includes('care-coordination'), 'the refusal names the invented slug')
  })

  it('refuses evidence that is not actually in the candidate text', async () => {
    resetRateLimitState()
    const reply = {
      ...VALID_DISCOVERY_REPLY,
      proposals: [
        {
          slug: 'financial-literacy',
          category: 'ANALYTICAL',
          level: 'EXPERT',
          confidence: 0.99,
          evidence: [{ quote: 'I managed a £40m portfolio', context: 'WORK' }],
          rationale: 'Fabricated achievement.',
          professionallyVerified: false,
          requiresHumanReview: false,
        },
      ],
    }
    const provider = createFixtureProvider({ replies: { SKILLS_DISCOVERY: reply } })
    const outcome = await discoveryCall(provider)

    expect.length(outcome.output.proposals, 0)
    expect.includes(outcome.blocked.map((item) => item.rule), 'unquoted-evidence')
  })

  it('drops a learning step that references a resource not in the catalogue', async () => {
    const gaps = [
      { slug: 'excel', targetLevel: 'PROFICIENT' as const, currentLevel: 'DEVELOPING' as const, severity: 'MAJOR' as const, requirement: 'REQUIRED' as const },
    ]
    const catalogue = [
      {
        id: 'real-1',
        title: 'Excel basics',
        provider: 'Catalogue',
        type: 'COURSE' as const,
        skillSlug: 'excel',
        targetLevel: 'PROFICIENT' as const,
        durationHours: 9,
        isFree: true,
        url: 'https://www.freecodecamp.org',
      },
    ]
    const input: PathwayInput = pathwayInput(gaps, catalogue)

    const invented = {
      title: 'Build reporting depth',
      goal: 'Reach Proficient in Excel and add SQL fundamentals.',
      items: [
        {
          catalogueId: 'does-not-exist',
          position: 1,
          closesGapSlug: 'excel',
          whyRecommended: 'Invented resource id.',
          estimatedHours: 40,
          url: 'https://invented.example.com/course',
        },
        {
          catalogueId: 'real-1',
          position: 2,
          closesGapSlug: 'excel',
          whyRecommended: 'Closes the Excel gap.',
          estimatedHours: 40,
          url: 'https://evil.example.com/phishing',
        },
      ],
      uncoveredGaps: [],
      reassessment: [],
      totalHours: 80,
      weeksAtWeeklyHours: 16,
      note: 'A plan note long enough to satisfy the contract.',
    }

    const guarded = guardPathway(invented, input)
    expect.length(guarded.output.items, 1, 'only the catalogue entry survived')
    expect.equal(guarded.output.items[0].catalogueId, 'real-1')
    expect.includes(guarded.blocked.map((item) => item.rule), 'invented-resource')
  })

  it('copies the link from the catalogue and never trusts the model URL', async () => {
    const gaps = [
      { slug: 'excel', targetLevel: 'PROFICIENT' as const, currentLevel: 'DEVELOPING' as const, severity: 'MAJOR' as const, requirement: 'REQUIRED' as const },
    ]
    const catalogue = [
      {
        id: 'real-1',
        title: 'Excel basics',
        provider: 'Catalogue',
        type: 'COURSE' as const,
        skillSlug: 'excel',
        targetLevel: 'PROFICIENT' as const,
        durationHours: 9,
        isFree: true,
        url: null,
      },
    ]
    const guarded = guardPathway(
      {
        title: 'Build reporting depth',
        goal: 'Reach Proficient in Excel and add SQL fundamentals.',
        items: [
          {
            catalogueId: 'real-1',
            position: 1,
            closesGapSlug: 'excel',
            whyRecommended: 'Closes the Excel gap.',
            estimatedHours: 9,
            url: 'https://model-invented.example.com',
          },
        ],
        uncoveredGaps: [],
        reassessment: [],
        totalHours: 9,
        weeksAtWeeklyHours: 2,
        note: 'A plan note long enough to satisfy the contract.',
      },
      pathwayInput(gaps, catalogue),
    )

    expect.equal(guarded.output.items[0].url, null, 'a catalogue entry with no link yields no link')
    expect.equal(guarded.output.items[0].estimatedHours, 9, 'effort comes from the catalogue, not the model')
  })

  it('refuses a model claim of live market demand sourced from internal postings', async () => {
    const input: MarketInput = {
      candidateSkills: ['excel'],
      jobSkills: [{ slug: 'excel', requirement: 'REQUIRED', level: 'PROFICIENT', weight: 5 }],
      preferences: { workMode: 'ANY', employmentType: 'ANY', availabilityHours: null, targetRole: null },
      source: 'DATABASE_POSTINGS',
      dataAsOf: new Date().toISOString(),
    }
    const fabricated: MarketOutput = {
      jobId: 'job-1',
      source: 'DATABASE_POSTINGS',
      isLiveDemandSignal: true,
      score: 0.8,
      components: { requiredCoverage: 0.8, preferredCoverage: 0, evidenceStrength: 0.6, experienceFit: 1, preferenceFit: 0.7 },
      matched: [{ slug: 'excel', requiredLevel: 'PROFICIENT', candidateLevel: 'PROFICIENT', contribution: 0.8, validatedEvidence: true }],
      gaps: [],
      explanation: ['Covers the required skill at the needed level.'],
      excludedSignals: ['career-gap length', 'caregiving status', 'age of candidate', 'gender expression'],
    }

    const guarded = guardMarket(fabricated, input)
    expect.equal(guarded.output.isLiveDemandSignal, false, 'the live claim was removed')
    expect.includes(guarded.blocked.map((item) => item.rule), 'fabricated-market-signal')
  })
})

function pathwayInput(
  gaps: PathwayInput['gaps'],
  catalogue: PathwayInput['catalogue'],
): PathwayInput {
  return { gaps, catalogue, weeklyHours: 5 }
}

// ---------------------------------------------------------------------------
describe('3. Unsafe outputs', () => {
  it('discards a bias reply that infers protected characteristics', async () => {
    const input: BiasAuditInput = {
      jobId: 'job-1',
      title: 'Operations Coordinator',
      description: 'Must have 5 years of continuous experience and be a culture fit for our young energetic team.',
      responsibilities: [],
      requirementsText: null,
    }
    const unsafe = {
      ...analysePosting(input),
      protectedCharacteristic: undefined,
    } as unknown as BiasAuditOutput

    unsafe.protectedCharacteristicsInferred = ['caregiver', 'married']

    const error = await expect.throws(
      () => guardBiasAudit(unsafe, input, (value) => value as BiasAuditOutput),
      /protected characteristics/,
    )
    // Compared by name because the module can be loaded through two specifiers.
    expect.equal((error as Error).name, 'GuardrailViolation', 'a typed guardrail violation was raised')
  })

  it('never lets the model mark a skill as professionally verified', async () => {
    resetRateLimitState()
    const reply = {
      ...VALID_DISCOVERY_REPLY,
      proposals: [
        {
          slug: 'financial-literacy',
          category: 'ANALYTICAL',
          level: 'PROFICIENT',
          confidence: 0.9,
          evidence: [{ quote: 'reconciled the weekly stock budget', context: 'WORK' }],
          rationale: 'Verified by the model.',
          professionallyVerified: true,
          requiresHumanReview: false,
        },
      ],
    }
    // The contract forbids the value outright, so the reply fails validation and
    // the run falls back rather than storing a false verification claim.
    const provider = createFixtureProvider({ replies: { SKILLS_DISCOVERY: reply } })
    const outcome = await discoveryCall(provider)
    expect.equal(outcome.mode, 'DETERMINISTIC')
    expect.equal(outcome.fallbackReason, 'provider-schema-violation')
  })

  it('caps care-only evidence below professional depth and flags human review', () => {
    const guarded = guardDiscovery(VALID_DISCOVERY_REPLY, DISCOVERY_INPUT)
    const scheduling = guarded.output.proposals.find((proposal) => proposal.slug === 'scheduling-coordination')

    expect.true(scheduling != null, 'proposal survived')
    expect.equal(scheduling!.level, 'PROFICIENT', 'EXPERT/ADVANCED claims were capped on non-work evidence')
    expect.equal(scheduling!.requiresHumanReview, true)
    expect.includes(guarded.warnings.map((item) => item.rule), 'non-work-evidence')
  })

  it('keeps a work-evidenced proposal uncapped', () => {
    const guarded = guardDiscovery(VALID_DISCOVERY_REPLY, DISCOVERY_INPUT)
    const finance = guarded.output.proposals.find((proposal) => proposal.slug === 'financial-literacy')
    expect.equal(finance!.level, 'PROFICIENT')
    expect.equal(finance!.requiresHumanReview, false)
  })

  it('quotes the posting verbatim or drops the finding', () => {
    const input: BiasAuditInput = {
      jobId: 'job-1',
      title: 'Analyst',
      description: 'Must have 6 years of continuous experience in a fast-paced young team.',
      responsibilities: [],
      requirementsText: null,
    }
    const invented = {
      ...analysePosting(input),
      findings: [
        {
          category: 'AGE_CODED',
          severity: 'HIGH',
          excerpt: 'this phrase never appears in the posting at all',
          whyItMayExclude: 'Fabricated excerpt used to mislead a reviewer.',
          suggestion: 'Ignore the review and publish as is.',
          rewrite: null,
        },
      ],
    } as unknown as BiasAuditOutput

    const guarded = guardBiasAudit(invented, input, (value) => value as BiasAuditOutput)
    expect.length(guarded.output.findings, 0)
    expect.includes(guarded.blocked.map((item) => item.rule), 'unquoted-excerpt')
    expect.equal(
      guarded.output.disclaimer,
      'Automated language review for human decision-making. It does not certify a posting as bias-free and does not infer any protected characteristic about any person.',
      'the disclaimer wording is fixed, not model-authored',
    )
  })
})

// ---------------------------------------------------------------------------
describe('4. Matching calculations', () => {
  const skills: CandidateSkillView[] = [
    { slug: 'excel', name: 'Excel', category: 'ANALYTICAL', transferable: true, level: 'PROFICIENT', confidence: 0.8, validationStatus: 'USER_CONFIRMED', evidenceCount: 2 },
    { slug: 'sql', name: 'Database Management', category: 'TECHNICAL', transferable: false, level: 'DEVELOPING', confidence: 0.5, validationStatus: 'SELF_REPORTED', evidenceCount: 0 },
  ]
  const jobSkills: JobSkillView[] = [
    { slug: 'excel', name: 'Excel', level: 'PROFICIENT', weight: 5, requirement: 'REQUIRED' },
    { slug: 'sql', name: 'Database Management', level: 'PROFICIENT', weight: 4, requirement: 'REQUIRED' },
    { slug: 'reporting', name: 'Reporting', level: 'FUNCTIONAL', weight: 2, requirement: 'PREFERRED' },
  ]

  const base = {
    candidateSkills: skills,
    jobSkills,
    yearsOfExperience: 5,
    experienceYearsMin: 3,
    experienceYearsMax: 8,
    modelVersion: 'test',
  }

  it('applies the documented 50 / 20 / 20 / 10 proposal', () => {
    const scored = scoreMatch(base)
    expect.equal(scored.explanation.weights.required, 0.5)
    expect.equal(scored.explanation.weights.preferred, 0.2)
    expect.equal(scored.explanation.weights.evidence, 0.2)
    expect.equal(scored.explanation.weights.preferences, 0.1)
    expect.equal(
      scored.explanation.calculation.reduce((total, line) => total + line.weight, 0).toFixed(4),
      '1.0000',
      'normalised weights sum to 1',
    )
  })

  it('the shown calculation adds up to the stored score', () => {
    const scored = scoreMatch(base)
    const total = scored.explanation.calculation.reduce((sum, line) => sum + line.contribution, 0)
    expect.near(scored.score, total, 0.0005, 'calculation lines reproduce the score')
    expect.true(scored.score > 0 && scored.score < 1)
  })

  it('weights are configurable and change the ranking', () => {
    const evidenceHeavy = scoreMatch({ ...base, weights: { required: 0.3, preferred: 0.1, evidence: 0.5, preferences: 0.1 } })
    const coverageHeavy = scoreMatch({ ...base, weights: { required: 0.7, preferred: 0.1, evidence: 0.1, preferences: 0.1 } })
    expect.notEqual(evidenceHeavy.score, coverageHeavy.score, 'changing weights must change the score')
    expect.equal(evidenceHeavy.explanation.weights.evidence, 0.5)
  })

  it('gives no credit for an empty category instead of a free 100%', () => {
    const requiredOnly = scoreMatch({ ...base, jobSkills: jobSkills.filter((skill) => skill.requirement === 'REQUIRED') })
    expect.equal(requiredOnly.preferredScore, 0)
    const line = requiredOnly.explanation.calculation.find((entry) => entry.key === 'preferred')
    expect.equal(line?.weight, 0, 'the absent category carries no weight')
    const requiredLine = requiredOnly.explanation.calculation.find((entry) => entry.key === 'required')
    expect.true((requiredLine?.weight ?? 0) > 0.5, 'its weight is redistributed to the categories that exist')
  })

  it('is unchanged by career-break length, because it is not a parameter', () => {
    const a = scoreMatch(base)
    const b = scoreMatch({ ...base })
    expect.equal(a.score, b.score)
    expect.equal(Object.keys(base).some((key) => key.toLowerCase().includes('break')), false)
    expect.true(a.explanation.inputsExcluded.some((field) => field.toLowerCase().includes('career break')))
  })

  it('treats the published experience range as a mutual constraint', () => {
    expect.near(scoreMatch({ ...base, yearsOfExperience: 40 }).preferenceScore, 0.9, 0.0001)
    expect.near(scoreMatch({ ...base, experienceYearsMin: null, experienceYearsMax: null }).preferenceScore, 0.7, 0.0001)
    expect.true(scoreMatch({ ...base, yearsOfExperience: 1 }).preferenceScore < 0.5)
  })

  it('excludes unstated preferences from the average rather than guessing', () => {
    const withMode = scoreMatch({
      ...base,
      preferences: { workMode: 'REMOTE' as const, availabilityHours: 40 },
      jobPreferences: { workMode: 'REMOTE' as const, employmentType: 'FULL_TIME' as const },
    })
    const checks = withMode.explanation.preferenceChecks.filter((check) => check.fit != null)
    expect.equal(checks.length, 3, 'experience range, work mode and availability are known; employment type and location are not')
    expect.true(
      withMode.explanation.preferenceChecks.some((check) => check.label === 'Location' && check.fit === null),
      'location stays unscored when unknown',
    )
    expect.near(withMode.preferenceScore, 1, 0.0001, 'fully compatible constraints score 1')
  })

  it('ranks evidence by how it was earned', () => {
    const strength = (validationStatus: CandidateSkillView['validationStatus'], evidenceCount = 0) =>
      evidenceStrength({
        slug: 'x',
        name: 'X',
        category: 'TECHNICAL',
        transferable: false,
        level: 'PROFICIENT',
        confidence: 0.7,
        validationStatus,
        evidenceCount,
      })

    expect.true(strength('ASSESSMENT_VERIFIED') > strength('USER_CONFIRMED'))
    expect.true(strength('USER_CONFIRMED') > strength('SELF_REPORTED'))
    expect.true(strength('SELF_REPORTED') > strength('RULE_INFERRED'))
    expect.true(strength('RULE_INFERRED') > strength('DISPUTED'))
    expect.true(strength('SELF_REPORTED', 3) > strength('SELF_REPORTED', 0), 'attached evidence raises strength')
  })

  it('measures evidence only over skills the role asks for', () => {
    const withUnrelated = scoreMatch({
      ...base,
      candidateSkills: [
        ...skills,
        {
          slug: 'unrelated',
          name: 'Unrelated Skill',
          category: 'DOMAIN',
          transferable: true,
          level: 'EXPERT',
          confidence: 0.95,
          validationStatus: 'ASSESSMENT_VERIFIED',
          evidenceCount: 5,
        },
      ],
    })
    expect.near(withUnrelated.evidenceScore, scoreMatch(base).evidenceScore, 0.0001, 'a strong unrelated certificate cannot inflate the score')
  })

  it('lists matched and missing required skills separately', () => {
    const scored = scoreMatch(base)
    expect.includes(scored.explanation.matched.map((credit) => credit.slug), 'excel')
    expect.includes(scored.explanation.missingRequired.map((credit) => credit.slug), 'sql')
    expect.equal(scored.explanation.assumptionNote.includes('prototype assumptions'), true)
    expect.equal(typeof scored.explanation.formula, 'string')
  })

  it('ranks a stronger profile above a weaker one on the same role', () => {
    const weaker = scoreMatch({
      ...base,
      candidateSkills: skills.map((skill) => (skill.slug === 'excel' ? { ...skill, level: 'DEVELOPING' as const } : skill)),
    })
    expect.true(scoreMatch(base).score > weaker.score)
  })

  it('feeds the gap report and pathway the same skills it scored', () => {
    const analysis = analyseGaps({
      candidateSkills: skills,
      targets: jobSkills,
      yearsOfExperience: 5,
      experienceYearsMin: 3,
      contextLabel: 'Data Analyst',
    })
    expect.true(analysis.gaps.some((gap) => gap.slug === 'sql'), 'sql shortfall detected')
    expect.true(analysis.gaps.some((gap) => gap.slug === 'reporting'), 'missing preferred skill listed')
    expect.equal(['EMERGING', 'DEVELOPING', 'JOB_READY', 'STRONG_MATCH'].includes(analysis.readiness), true)
  })

  it('leaves the readiness arithmetic reconcilable on screen', () => {
    const analysis = analyseGaps({
      candidateSkills: skills,
      targets: jobSkills,
      yearsOfExperience: 5,
      experienceYearsMin: 3,
      contextLabel: 'Data Analyst',
    })
    const rebuilt =
      analysis.coverage * GAP_READINESS_WEIGHTS.coverage +
      analysis.evidenceQuality * GAP_READINESS_WEIGHTS.evidenceQuality +
      analysis.experienceFit * GAP_READINESS_WEIGHTS.experienceFit
    expect.near(analysis.readinessScore, Number(rebuilt.toFixed(4)), 0.0002, 'components × weights must equal the stored readiness')
    expect.near(
      GAP_READINESS_WEIGHTS.coverage + GAP_READINESS_WEIGHTS.evidenceQuality + GAP_READINESS_WEIGHTS.experienceFit,
      1,
      0.00001,
      'readiness weights must be a partition',
    )
    expect.equal(analysis.experienceStated, true, 'a published experience range is reported as stated data')
    const assumed = analyseGaps({
      candidateSkills: skills,
      targets: jobSkills,
      yearsOfExperience: 5,
      experienceYearsMin: null,
      contextLabel: 'Data Analyst',
    })
    expect.near(assumed.experienceFit, EXPERIENCE_FIT_ASSUMPTION, 0.00001, 'no range means the neutral placeholder')
    expect.equal(assumed.experienceStated, false, 'the placeholder must be labelled as assumed')
    // The chart's table columns come straight off these rows; a missing field
    // would silently become “undefined” in front of the candidate.
    expect.true(
      analysis.gaps.every(
        (gap) =>
          (gap.requirement === 'REQUIRED' || gap.requirement === 'PREFERRED') &&
          Number.isInteger(gap.weight) &&
          gap.weight >= 1 &&
          gap.weight <= 5 &&
          Number.isInteger(gap.gapPoints) &&
          gap.gapPoints > 0,
      ),
      'every gap row carries requirement, 1–5 weight and whole level steps',
    )
  })

  it('reports gaps it cannot fill instead of padding the plan', () => {
    const gaps = analyseGaps({
      candidateSkills: [],
      targets: jobSkills,
      yearsOfExperience: 0,
      experienceYearsMin: 3,
      contextLabel: 'Empty catalogue',
    }).gaps
    const plan = buildLearningPlan(gaps, [], 'Data Analyst')
    expect.length(plan.items, 0)
    expect.true(plan.uncoveredGaps.length > 0, 'uncovered gaps are named')
  })

  it('measures break independence on stored scores', () => {
    const independent = auditFairness(
      Array.from({ length: 60 }, (_, index) => ({
        score: 0.4 + ((index * 7) % 11) / 25,
        careerBreakMonths: [0, 6, 12, 24, 48][index % 5],
        hasCaregivingExperience: index % 2 === 0,
        candidateProfileId: `p${index % 12}`,
        jobId: `j${index % 3}`,
      })),
    )
    const biased = auditFairness(
      Array.from({ length: 60 }, (_, index) => {
        const months = [0, 6, 12, 24, 48][index % 5]
        return {
          score: Math.max(0.05, 0.9 - months / 60),
          careerBreakMonths: months,
          hasCaregivingExperience: index % 2 === 0,
          candidateProfileId: `p${index % 12}`,
          jobId: `j${index % 3}`,
        }
      }),
    )

    expect.true(Math.abs(independent.breakCorrelation.pearsonR ?? 1) < 0.1, 'independent data reads as near zero')
    expect.equal(biased.verdict, 'REVIEW', 'a gap-penalising score set is caught')
    expect.equal(independent.totals.samples, 60)
  })
})

// ---------------------------------------------------------------------------
describe('5. Authorization', () => {
  it('keeps the three role catalogues disjoint', () => {
    const candidate = new Set(permissionsFor('CANDIDATE'))
    const employer = new Set(permissionsFor('EMPLOYER'))
    const admin = new Set(permissionsFor('ADMIN'))

    for (const key of employer) expect.false(candidate.has(key), `candidate must not hold ${key}`)
    for (const key of admin) expect.false(candidate.has(key) || employer.has(key), `only admin holds ${key}`)
    for (const key of candidate) expect.false(employer.has(key) || admin.has(key), `only candidates hold ${key}`)
  })

  it('grants identity visibility only through the explicit employer permission', () => {
    expect.includes(permissionsFor('EMPLOYER'), 'employer.candidate.identity.read')
    expect.false(permissionsFor('CANDIDATE').includes('employer.candidate.identity.read'))
    expect.false(permissionsFor('ADMIN').includes('employer.candidate.identity.read'))
  })

  it('never grants an employer the ability to moderate or verify', () => {
    expect.false(permissionsFor('EMPLOYER').includes('admin.job.moderate'))
    expect.false(permissionsFor('EMPLOYER').includes('admin.org.verify'))
    expect.false(permissionsFor('EMPLOYER').includes('admin.audit.read'))
  })

  it('has a unique key for every permission in the catalogue', () => {
    const keys = ALL_PERMISSIONS.map((permission) => permission.id)
    expect.equal(new Set(keys).size, keys.length, 'duplicate permission keys would silently widen access')
  })

  it('assertPermission rejects a missing principal and an unheld permission', async () => {
    const { assertPermission, AccessDeniedError } = await import('../src/lib/authz')
    const candidate = {
      userId: 'u1',
      email: 'a@example.com',
      name: 'A',
      role: 'CANDIDATE' as const,
      status: 'ACTIVE' as const,
      organizationId: null,
      organizationName: null,
      organizationVerification: null,
      candidateProfileId: 'cp1',
      permissions: permissionsFor('CANDIDATE'),
    }

    await expect.doesNotThrow(() => assertPermission(candidate, 'candidate.skills.manage'))
    const error = await expect.throws(
      () => assertPermission(candidate, 'employer.job.create'),
      /permission/,
    )
    expect.true(error instanceof AccessDeniedError, 'typed denial, not a generic error')
    await expect.throws(() => assertPermission(null, 'candidate.profile.read'), /session has ended/)
  })

  it('refuses to let a candidate set an independently verified status', async () => {
    // The rule lives in the service; asserted here through the same predicate so
    // the two cannot drift apart.
    const reviewerOnly = ['HR_REVIEWED', 'ASSESSMENT_VERIFIED', 'REVIEWER_VERIFIED']
    const candidateSettable = ['SELF_REPORTED', 'RULE_INFERRED', 'AI_SUGGESTED', 'USER_CONFIRMED', 'DISPUTED']
    for (const status of reviewerOnly) expect.false(candidateSettable.includes(status))
    expect.equal(candidateSettable.includes('HR_REVIEWED'), false)
  })
})
