import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { AccessDeniedError, assertPermission, type Principal } from '@/lib/authz'
import { matchModelVersion } from '@/lib/env'
import {
  discoveryInputSchema,
  discoveryOutputSchema,
  marketOutputSchema,
  pathwayOutputSchema,
  biasAuditOutputSchema,
  type BiasAuditInput,
  type BiasAuditOutput,
  type DiscoveryInput,
  type DiscoveryOutput,
  type MarketInput,
  type MarketOutput,
  type PathwayInput,
  type PathwayOutput,
} from '@/lib/ai/schemas'
import { guardDiscovery, guardMarket, guardPathway, guardBiasAudit } from '@/lib/ai/guardrails'
import { analysePosting, reconcileBias } from '@/lib/engines/bias'
import { SKILL_TAXONOMY } from '@/lib/taxonomy/skills'
import { inferSkills, type InferenceInput } from '@/lib/engines/inference'
import { scoreMatch } from '@/lib/engines/matching'
import { analyseGaps, type GapItem } from '@/lib/engines/gap'
import { buildLearningPlan, type PlanningResource } from '@/lib/engines/pathway'
import { candidateSkillViews, jobSkillViews, hasConsent } from '@/server/skill-catalog'
import { activeWeights } from '@/server/weights'
import { json, nullableString } from '@/server/fields'
import { recordAudit } from '@/server/audit'
import { notifyUser } from '@/server/notifications'
import { agentRun, type RecordedOutcome } from './runs'

/**
 * The four agents, wired to the platform.
 *
 * Each one has two implementations behind the same output contract: the live
 * model and the deterministic engine that is already in the product. The caller
 * is told which one produced the answer, and the guardrails run on the model
 * path only — a rule engine cannot hallucinate a skill slug because it reads the
 * taxonomy directly.
 */

const SCHEMA_VERSION = 'prompt2-schemas-2026-11-a'

/**
 * Compact output shape sent to the model. The server still validates against the
 * full Zod contract; sending the generated JSON Schema instead cost enough tokens
 * that Groq's reasoning models spent the whole completion budget before answering.
 */
const DISCOVERY_SKETCH = `{
 "proposals":[{"slug":"taxonomy-slug","category":"ANALYTICAL","level":"PROFICIENT","confidence":0.8,"evidence":[{"quote":"verbatim substring of the input","context":"WORK"}],"rationale":"why","professionallyVerified":false,"requiresHumanReview":false}],
 "unresolved":[{"quote":"verbatim substring","reason":"why it could not be mapped"}],
 "assessmentSuggestions":[{"slug":"taxonomy-slug","reason":"why a short assessment helps"}],
 "summary":"under 60 words"
}`

/** Keyword aliases, re-joined for the deterministic pass from the seeded taxonomy. */
const ALIASES_BY_SLUG = new Map(SKILL_TAXONOMY.map((entry) => [entry.slug, entry.aliases]))

function ownProfileId(principal: Principal) {
  if (!principal.candidateProfileId) {
    throw new AccessDeniedError('No candidate profile is attached to this account.')
  }
  return principal.candidateProfileId
}

// ---------------------------------------------------------------------------
// Agent 1 — Skills Discovery
// ---------------------------------------------------------------------------

/** Public so the live provider check and admin tooling can reuse one definition. */
export async function buildDiscoveryInput(principal: Principal, profileId: string): Promise<DiscoveryInput> {
  const [experiences, taxonomy, existing] = await Promise.all([
    prisma.experience.findMany({
      where: { candidateProfileId: profileId },
      orderBy: { createdAt: 'asc' },
    }),
    // Compact on purpose: the model chooses by name, so the keyword aliases are
    // left out of the request and re-joined below for the deterministic pass.
    prisma.skill.findMany({
      select: { slug: true, name: true, category: true, transferable: true },
      orderBy: { name: 'asc' },
    }),
    prisma.candidateSkill.findMany({
      where: { candidateProfileId: profileId },
      select: { skill: { select: { slug: true } } },
    }),
  ])

  const blocks = experiences.map((experience) => ({
    context: contextFor(experience.type, experience.isCaregiving),
    text: [experience.title, experience.description, experience.achievements].filter(Boolean).join('. '),
  }))

  return discoveryInputSchema.parse({
    blocks,
    taxonomy,
    existingSlugs: existing.map((entry) => entry.skill.slug),
  })
}

function contextFor(type: string, isCaregiving: boolean): DiscoveryInput['blocks'][number]['context'] {
  if (isCaregiving || type === 'CAREGIVING') return 'CAREGIVING'
  if (type === 'VOLUNTEERING' || type === 'COMMUNITY_LEADERSHIP') return 'VOLUNTEER'
  if (type === 'EDUCATION' || type === 'UP_SKILLING') return 'EDUCATION'
  return 'WORK'
}

/** The keyword engine, expressed in the same output shape as the model. */
export function deterministicDiscovery(input: DiscoveryInput): DiscoveryOutput {
  // The model payload carries names only; the rule engine needs the aliases, so
  // they are re-joined from the seeded taxonomy here.
  const catalog = input.taxonomy.map((entry) => ({
    ...entry,
    aliases: ALIASES_BY_SLUG.get(entry.slug) ?? [],
  }))

  const inferenceInputs: InferenceInput[] = input.blocks.map((block) => ({
    text: block.text,
    context:
      block.context === 'EDUCATION'
        ? 'LEARNING'
        : block.context === 'ACHIEVEMENT'
          ? 'GENERAL'
          : block.context,
  }))
  const hits = inferSkills(inferenceInputs, catalog)
  const bySlug = new Map(input.taxonomy.map((entry) => [entry.slug, entry]))

  const proposals: DiscoveryOutput['proposals'] = []
  for (const hit of hits) {
    const entry = bySlug.get(hit.slug)
    if (!entry || input.existingSlugs.includes(hit.slug)) continue
    const hasWork = hit.contexts.includes('WORK')
    proposals.push({
      slug: hit.slug,
      category: entry.category,
      // With no paid-work evidence the rule engine stops at PROFICIENT.
      level: hasWork ? hit.level : (['DEVELOPING', 'FUNCTIONAL', 'PROFICIENT'].includes(hit.level) ? hit.level : 'PROFICIENT'),
      confidence: hit.confidence,
      evidence: hit.phrases.slice(0, 3).map((quote) => ({
        quote,
        context: (hit.contexts[0] as DiscoveryInput['blocks'][number]['context']) ?? 'GENERAL',
      })),
      rationale: `Keyword match on ${hit.phrases.slice(0, 3).map((phrase) => `“${phrase}”`).join(', ')} in your own description.`,
      professionallyVerified: false,
      requiresHumanReview: !hasWork,
    })
  }

  return {
    proposals,
    unresolved: [],
    assessmentSuggestions: proposals
      .filter((proposal) => proposal.requiresHumanReview)
      .slice(0, 4)
      .map((proposal) => ({ slug: proposal.slug, reason: 'Non-work evidence only; a short assessment would strengthen the claim.' })),
    summary: `Rule-based pass produced ${proposals.length} suggestion${proposals.length === 1 ? '' : 's'} from the wording already on your profile.`,
  }
}

export async function runSkillsDiscovery(
  principal: Principal,
): Promise<RecordedOutcome<DiscoveryOutput> & { created: number; skipped: number }> {
  assertPermission(principal, 'candidate.skills.manage')
  const profileId = ownProfileId(principal)
  if (!(await hasConsent(principal.userId, 'RULE_BASED_INFERENCE'))) {
    throw new AccessDeniedError('Enable skill-inference consent in Privacy controls before running discovery.')
  }

  const input = await buildDiscoveryInput(principal, profileId)
  if (input.blocks.length === 0) {
    throw new AccessDeniedError('Add at least one experience entry before asking for skill suggestions.')
  }

  const outcome = await agentRun<DiscoveryInput, DiscoveryOutput>(
    {
      agent: 'SKILLS_DISCOVERY',
      subjectKey: principal.userId,
      input,
      contract: discoveryOutputSchema as never,
      contractSketch: DISCOVERY_SKETCH,
      schemaVersion: SCHEMA_VERSION,
      // The guard runs on the already schema-validated reply, so a malformed
      // response is repaired before any of it can reach the database.
      guard: (raw, value) => guardDiscovery(raw, value),
      deterministic: deterministicDiscovery,
    },
    {
      userId: principal.userId,
      candidateProfileId: profileId,
    },
    {
      inputSummary: { blocks: input.blocks.length, taxonomy: input.taxonomy.length, existing: input.existingSlugs.length },
      outputSummary: (value) => ({ proposals: value.proposals.length, blocked: value.proposals.length }),
    },
  )

  const guarded = outcome.output
  const skillRows = await prisma.skill.findMany({ where: { slug: { in: guarded.proposals.map((p) => p.slug) } } })
  const idBySlug = new Map(skillRows.map((row) => [row.slug, row.id]))

  let created = 0
  let skipped = 0
  for (const proposal of guarded.proposals) {
    const skillId = idBySlug.get(proposal.slug)
    if (!skillId) {
      skipped += 1
      continue
    }
    const existing = await prisma.candidateSkill.findUnique({
      where: { candidateProfileId_skillId: { candidateProfileId: profileId, skillId } },
    })
    if (existing) {
      skipped += 1
      continue
    }
    const open = await prisma.aiProposal.findFirst({
      where: { candidateProfileId: profileId, skillId, status: 'PROPOSED' },
    })
    if (open) {
      await prisma.aiProposal.update({
        where: { id: open.id },
        data: {
          aiRunId: outcome.aiRunId,
          proposedLevel: proposal.level,
          confidence: proposal.confidence,
          evidence: json(proposal.evidence),
          rationale: proposal.rationale,
          requiresHumanReview: proposal.requiresHumanReview,
        },
      })
      continue
    }
    await prisma.aiProposal.create({
      data: {
        aiRunId: outcome.aiRunId,
        candidateProfileId: profileId,
        skillId,
        proposedLevel: proposal.level,
        confidence: proposal.confidence,
        evidence: json(proposal.evidence),
        rationale: proposal.rationale,
        requiresHumanReview: proposal.requiresHumanReview,
        status: 'PROPOSED',
      },
    })
    created += 1
  }

  await recordAudit({
    actor: principal,
    action: 'ai.skills_discovery.run',
    entityType: 'ai_runs',
    entityId: outcome.aiRunId,
    metadata: {
      mode: outcome.mode,
      model: outcome.model,
      created,
      skipped,
      blocked: outcome.blocked.length,
      fallbackReason: outcome.fallbackReason,
    },
  })

  if (created > 0) {
    await notifyUser(principal.userId, {
      type: 'NEW_MATCH',
      title: `${created} skill suggestion${created === 1 ? '' : 's'} waiting for you`,
      body:
        outcome.mode === 'AI'
          ? `Proposed by the ${outcome.model} model. Nothing was added to your inventory — review and accept each one.`
          : 'Proposed by the rule-based keyword engine. Nothing was added to your inventory — review and accept each one.',
      link: '/candidate/suggestions',
    })
  }

  return { ...outcome, created, skipped }
}

// ---------------------------------------------------------------------------
// Agent 2 — Market Intelligence
// ---------------------------------------------------------------------------

function marketFromScore(
  scored: ReturnType<typeof scoreMatch>,
  jobId: string,
  input: MarketInput,
): MarketOutput {
  return {
    jobId,
    source: input.source,
    isLiveDemandSignal: input.source === 'LIVE_PROVIDER',
    score: scored.score,
    components: {
      requiredCoverage: scored.requiredScore,
      preferredCoverage: scored.preferredScore,
      evidenceStrength: scored.evidenceScore,
      experienceFit: scored.preferenceScore,
      preferenceFit: 0.7,
    },
    matched: scored.explanation.matched.map((credit) => ({
      slug: credit.slug,
      requiredLevel: credit.requiredLevel,
      candidateLevel: credit.candidateLevel,
      contribution: Number((credit.credit * credit.weight).toFixed(4)),
      validatedEvidence: credit.evidenceCount > 0,
    })),
    gaps: scored.explanation.gaps.map((credit) => ({
      slug: credit.slug,
      requirement: credit.requirement,
      targetLevel: credit.requiredLevel,
      currentLevel: credit.candidateLevel,
      severity:
        credit.requirement === 'PREFERRED'
          ? ('MINOR' as const)
          : credit.credit === 0
            ? ('CRITICAL' as const)
            : credit.credit < 0.5
              ? ('MAJOR' as const)
              : ('MODERATE' as const),
    })),
    explanation: scored.explanation.summary,
    excludedSignals: [...scored.explanation.inputsExcluded],
  }
}

export async function compareStoredPostings(principal: Principal, jobId: string) {
  assertPermission(principal, 'employer.job.read')
  if (!principal.organizationId) throw new AccessDeniedError('No organisation is attached to this account.')
  const job = await prisma.job.findFirst({ where: { id: jobId, organizationId: principal.organizationId }, include: { skills: { include: { skill: true } } } })
  if (!job || !job.skills.length) throw new AccessDeniedError('Choose your own role with defined skills.')
  const postings = await prisma.job.findMany({
    where: { id: { not: jobId }, status: 'PUBLISHED', organization: { verificationStatus: 'VERIFIED' } },
    select: { skills: { select: { skillId: true } } },
  })
  const matched = job.skills.map((skill) => ({ slug: skill.skill.slug, postings: postings.filter((post) => post.skills.some((entry) => entry.skillId === skill.skillId)).length }))
  const score = postings.length ? matched.reduce((sum, item) => sum + item.postings / postings.length, 0) / matched.length : 0
  const insight = await prisma.marketInsight.create({ data: {
    jobId, organizationId: principal.organizationId, candidateProfileId: null, source: 'DATABASE_POSTINGS', isLive: false, dataAsOf: new Date(), score,
    components: { postingCount: postings.length, skillCount: matched.length }, matched: json(matched), gaps: [],
    explanation: [`Compared ${matched.length} role skills with ${postings.length} other published database postings.`,
      ...matched.map((item) => `${item.slug}: present in ${item.postings} of ${postings.length} postings.`),
      'The percentage is mean skill overlap in this database, not market demand or a candidate score.'],
    excludedSignals: ['Candidate profiles', 'Career breaks', 'Protected characteristics'],
  } })
  await recordAudit({ actor: principal, action: 'employer.postings.compare', entityType: 'market_insights', entityId: insight.id, organizationId: principal.organizationId })
  return insight
}

export async function runMarketIntelligence(principal: Principal, jobId: string, profileIdArg?: string) {
  const profileId = profileIdArg ?? ownProfileId(principal)
  if (profileId === principal.candidateProfileId) {
    assertPermission(principal, 'candidate.match.read')
  } else if (principal.role === 'ADMIN') {
    assertPermission(principal, 'admin.job.read')
  } else {
    throw new AccessDeniedError('Candidate-specific intelligence is private to the candidate and administrators.')
  }

  const [profile, job, skills] = await Promise.all([
    prisma.candidateProfile.findUniqueOrThrow({
      where: { id: profileId },
      select: { id: true, yearsOfExperience: true, workPreference: true, availabilityHours: true, targetRole: true, userId: true, locationCity: true },
    }),
    prisma.job.findUniqueOrThrow({
      where: { id: jobId },
      select: { id: true, title: true, organizationId: true, experienceYearsMin: true, experienceYearsMax: true, postedAt: true, workMode: true, employmentType: true, locationCity: true },
    }),
    candidateSkillViews(profileId),
  ])

  if (!(await hasConsent(profile.userId, 'RULE_BASED_INFERENCE'))) {
    throw new AccessDeniedError('The candidate has not consented to inferred recommendations.')
  }
  const jobSkills = await jobSkillViews(jobId)
  if (jobSkills.length === 0) throw new AccessDeniedError('This role defines no skills, so it cannot be compared.')

  const { weights, version: weightsVersion } = await activeWeights()
  const scored = scoreMatch({
    candidateSkills: skills,
    jobSkills,
    yearsOfExperience: profile.yearsOfExperience,
    experienceYearsMin: job.experienceYearsMin,
    experienceYearsMax: job.experienceYearsMax,
    preferences: { workMode: profile.workPreference, availabilityHours: profile.availabilityHours, locationCity: profile.locationCity },
    jobPreferences: { workMode: job.workMode, employmentType: job.employmentType, locationCity: job.locationCity },
    weights, weightsVersion,
    modelVersion: matchModelVersion(),
  })

  const input: MarketInput = {
    candidateSkills: skills.map((skill) => skill.slug),
    jobSkills: jobSkills.map((skill) => ({
      slug: skill.slug,
      requirement: skill.requirement,
      level: skill.level,
      weight: skill.weight,
    })),
    preferences: {
      workMode: profile.workPreference === 'OPEN' || profile.workPreference === 'FLEXIBLE' ? 'ANY' : profile.workPreference,
      employmentType: 'ANY',
      availabilityHours: profile.availabilityHours,
      targetRole: profile.targetRole,
    },
    source: 'DATABASE_POSTINGS',
    dataAsOf: (job.postedAt ?? new Date()).toISOString(),
  }

  const outcome = await agentRun<MarketInput, MarketOutput>(
    {
      agent: 'MARKET_INTELLIGENCE',
      subjectKey: profile.userId,
      input,
      contract: marketOutputSchema as never,
      schemaVersion: SCHEMA_VERSION,
      guard: (raw, value) => guardMarket(raw, value),
      deterministic: (value) => marketFromScore(scored, jobId, value),
    },
    { userId: profile.userId, candidateProfileId: profileId, organizationId: job.organizationId, jobId },
    {
      inputSummary: { jobId, candidateSkills: input.candidateSkills.length, required: jobSkills.filter((s) => s.requirement === 'REQUIRED').length },
      outputSummary: (value) => ({ score: value.score, gaps: value.gaps.length, live: value.isLiveDemandSignal }),
    },
  )

  outcome.output = { ...marketFromScore(scored, jobId, input), explanation: outcome.output.explanation }
  const stored = await prisma.marketInsight.create({
    data: {
      jobId,
      candidateProfileId: profileId,
      organizationId: job.organizationId,
      aiRunId: outcome.aiRunId,
      source: outcome.output.source,
      isLive: outcome.output.isLiveDemandSignal,
      dataAsOf: new Date(input.dataAsOf),
      score: outcome.output.score,
      components: json(outcome.output.components),
      matched: json(outcome.output.matched),
      gaps: json(outcome.output.gaps),
      explanation: outcome.output.explanation,
      excludedSignals: outcome.output.excludedSignals,
    },
  })

  await recordAudit({
    actor: principal,
    action: 'ai.market_intelligence.run',
    entityType: 'market_insights',
    entityId: stored.id,
    organizationId: job.organizationId,
    metadata: { jobId, mode: outcome.mode, score: outcome.output.score, fallbackReason: outcome.fallbackReason },
  })

  return { insight: stored, outcome, scored }
}

// ---------------------------------------------------------------------------
// Agent 3 — Learning Pathways
// ---------------------------------------------------------------------------

export async function runLearningPathways(principal: Principal, options: { targetJobId?: string | null } = {}) {
  assertPermission(principal, 'candidate.plan.update')
  const profileId = ownProfileId(principal)
  if (!(await hasConsent(principal.userId, 'RULE_BASED_INFERENCE'))) {
    throw new AccessDeniedError('Enable skill-inference consent in Privacy controls before running learning recommendations.')
  }

  const [profile, skills] = await Promise.all([
    prisma.candidateProfile.findUniqueOrThrow({
      where: { id: profileId },
      select: { id: true, userId: true, yearsOfExperience: true, targetRole: true },
    }),
    candidateSkillViews(profileId),
  ])

  const targetJobId = options.targetJobId ?? null
  const job = targetJobId
    ? await prisma.job.findUnique({ where: { id: targetJobId }, select: { id: true, title: true, status: true } })
    : null
  if (targetJobId && (!job || job.status !== 'PUBLISHED')) {
    throw new AccessDeniedError('Choose a published role as the target for a learning pathway.')
  }

  const targets = targetJobId ? await jobSkillViews(targetJobId) : await jobSkillViewsForTopMatches(profileId)
  if (targets.length === 0) throw new AccessDeniedError('There are no role requirements to compare against yet.')

  const analysis = analyseGaps({
    candidateSkills: skills,
    targets,
    yearsOfExperience: profile.yearsOfExperience,
    experienceYearsMin: null,
    contextLabel: job?.title ?? profile.targetRole ?? 'your closest matched roles',
  })

  const gapItems = analysis.gaps
  if (gapItems.length === 0) {
    return {
      plan: null,
      outcome: null,
      gaps: gapItems,
      message: 'No gaps were found against this target, so there is nothing to plan.',
    }
  }

  const gapSlugs = gapItems.map((gap) => gap.slug)
  const catalogueRows = await prisma.learningResource.findMany({
    where: { skill: { slug: { in: gapSlugs } } },
    include: { skill: { select: { slug: true } } },
  })

  const catalogue: PathwayInput['catalogue'] = catalogueRows.map((row) => ({
    id: row.id,
    title: row.title,
    provider: row.provider,
    type: row.type,
    skillSlug: row.skill?.slug ?? null,
    targetLevel: row.targetLevel,
    durationHours: row.durationHours,
    isFree: row.isFree,
    url: row.url,
  }))

  const pathwayInput: PathwayInput = {
    gaps: gapItems.map((gap) => ({
      slug: gap.slug,
      targetLevel: gap.targetLevel,
      currentLevel: gap.currentLevel,
      severity: gap.severity,
      requirement: gap.requirement,
    })),
    catalogue,
    weeklyHours: 5,
  }

  const deterministicPlan = (input: PathwayInput): PathwayOutput => {
    const resources: PlanningResource[] = input.catalogue.map((entry) => ({
      id: entry.id,
      title: entry.title,
      provider: entry.provider,
      type: entry.type,
      format: 'SELF_PACED',
      skillSlug: entry.skillSlug,
      targetLevel: entry.targetLevel,
      durationHours: entry.durationHours,
      isFree: entry.isFree,
      costLabel: null,
      outcome: '',
      url: entry.url,
      demonstration: true,
    }))
    const gaps: GapItem[] = input.gaps.map((gap) => ({
      slug: gap.slug,
      name: gap.slug,
      requirement: gap.requirement,
      targetLevel: gap.targetLevel,
      currentLevel: gap.currentLevel,
      gapPoints: 1,
      severity: gap.severity,
      weight: 1,
      note: `Needs ${gap.targetLevel.toLowerCase()}${gap.currentLevel ? `, currently ${gap.currentLevel.toLowerCase()}` : ', not yet evidenced'}.`,
    }))
    const draft = buildLearningPlan(gaps, resources, input.gaps.length ? 'target role' : 'target role')
    return {
      title: draft.title,
      goal: draft.goal,
      items: draft.items.map((item) => {
        const entry = input.catalogue.find((candidate) => candidate.id === item.resourceId)!
        return {
          catalogueId: entry.id,
          position: item.position,
          closesGapSlug: item.gapSkillSlug ?? gaps[0].slug,
          whyRecommended: item.reason,
          estimatedHours: entry.durationHours,
          url: entry.url,
        }
      }),
      uncoveredGaps: draft.uncoveredGaps.map(nameToSlug(gapSlugs)),
      reassessment: draft.items
        .filter((item) => item.gapSkillSlug)
        .map((item) => ({ slug: item.gapSkillSlug as string, suggestedFormat: 'PRACTICE_PROJECT' as const })),
      totalHours: draft.estimatedHours || 1,
      weeksAtWeeklyHours: draft.weeksAtFiveHours || 1,
      note: draft.summary,
    }
  }

  const outcome = catalogue.length > 0
    ? await agentRun<PathwayInput, PathwayOutput>(
        {
          agent: 'LEARNING_PATHWAYS',
          subjectKey: profile.userId,
          input: pathwayInput,
          contract: pathwayOutputSchema as never,
          schemaVersion: SCHEMA_VERSION,
          guard: (raw, value) => guardPathway(raw, value),
          deterministic: deterministicPlan,
        },
        { userId: profile.userId, candidateProfileId: profileId, jobId: targetJobId },
        { inputSummary: { gaps: pathwayInput.gaps.length, catalogue: catalogue.length }, outputSummary: (value) => ({ steps: value.items.length, uncovered: value.uncoveredGaps.length }) },
      )
    : null

  const plan: PathwayOutput = outcome ? outcome.output : deterministicPlan(pathwayInput)

  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.learningPlan.create({
      data: {
        candidateProfileId: profileId,
        userId: profile.userId,
        title: plan.title,
        goal: plan.goal,
        summary: `${plan.note}${plan.uncoveredGaps.length ? ` Uncovered: ${plan.uncoveredGaps.join(', ')}.` : ''}`,
        status: 'ACTIVE',
        priority: 1,
        targetJobId,
        generatedBy: outcome ? `LEARNING_PATHWAYS_AGENT:${outcome.mode}` : 'PATHWAY_PLANNER_RULES',
      },
    })

    await tx.learningPlanItem.createMany({
      data: plan.items.map((item, index) => ({
        planId: row.id,
        resourceId: item.catalogueId,
        position: index + 1,
        gapSkillSlug: nullableString(item.closesGapSlug),
        note: nullableString(item.whyRecommended),
        status: 'NOT_STARTED',
      })),
    })

    await tx.learningPlan.updateMany({
      where: { candidateProfileId: profileId, targetJobId, status: 'ACTIVE', id: { not: row.id } },
      data: { status: 'ABANDONED' },
    })

    return row
  })

  const withItems = await prisma.learningPlan.findUniqueOrThrow({
    where: { id: created.id },
    include: { items: { include: { resource: true }, orderBy: { position: 'asc' } } },
  })

  await recordAudit({
    actor: principal,
    action: 'ai.learning_pathways.run',
    entityType: 'learning_plans',
    entityId: created.id,
    metadata: {
      mode: outcome?.mode ?? 'DETERMINISTIC',
      steps: plan.items.length,
      uncovered: plan.uncoveredGaps.length,
      fallbackReason: outcome?.fallbackReason ?? 'no-catalogue-or-provider',
    },
  })

  return { plan: withItems, outcome, gaps: gapItems, message: null }
}

async function jobSkillViewsForTopMatches(profileId: string) {
  const matches = await prisma.match.findMany({
    where: { candidateProfileId: profileId, status: 'COMPUTED' },
    orderBy: { score: 'desc' },
    take: 5,
    select: { jobId: true },
  })
  const merged: Awaited<ReturnType<typeof jobSkillViews>> = []
  for (const match of matches) merged.push(...(await jobSkillViews(match.jobId)))
  return merged
}

function nameToSlug(slugs: string[]) {
  return (name: string) => {
    const match = slugs.find((slug) => slug.replace(/-/g, ' ') === name.toLowerCase() || slug === name.toLowerCase())
    return match ?? name
  }
}

// ---------------------------------------------------------------------------
// Agent 4 — Bias Audit
// ---------------------------------------------------------------------------

export async function runBiasAudit(principal: Principal, jobId: string) {
  if (!principal.permissions.includes('admin.job.read') && !principal.permissions.includes('employer.job.read')) {
    throw new AccessDeniedError('This action needs permission to read the role.')
  }

  const job = await prisma.job.findUniqueOrThrow({
    where: { id: jobId },
    include: { organization: { select: { id: true, name: true } } },
  })

  if (principal.role === 'EMPLOYER' && job.organization.id !== principal.organizationId) {
    throw new AccessDeniedError('This role belongs to another organisation.')
  }

  const input: BiasAuditInput = {
    jobId: job.id,
    title: job.title,
    description: job.description,
    responsibilities: job.responsibilities,
    requirementsText: job.requirementsText,
  }

  const deterministic = analysePosting(input)

  const outcome = await agentRun<BiasAuditInput, BiasAuditOutput>(
    {
      agent: 'BIAS_AUDIT',
      subjectKey: `${principal.userId}:${job.id}`,
      input,
      contract: biasAuditOutputSchema as never,
      schemaVersion: SCHEMA_VERSION,
      guard: (raw, value) => guardBiasAudit(raw, value),
      deterministic: analysePosting,
    },
    { userId: principal.userId, organizationId: job.organization.id, jobId: job.id },
    {
      inputSummary: { jobId: job.id, descriptionLength: job.description.length },
      outputSummary: (value) => ({ risk: value.overallRisk, findings: value.findings.length }),
    },
  )

  const model = outcome.output
  // The live review is reconciled against the lexical pass so the screen never
  // shows less than the deterministic engine would have found.
  const merged =
    outcome.mode === 'AI' ? reconcileBias(model, deterministic) : deterministic

  const stored = await prisma.languageReview.create({
    data: {
      jobId: job.id,
      aiRunId: outcome.aiRunId,
      overallRisk: merged.overallRisk,
      findings: json(merged.findings),
      continuityChecks: json(merged.continuityChecks),
      positives: json(merged.positives),
      mode: outcome.mode,
      status: 'OPEN',
    },
  })

  if (merged.reviewRequired) {
    await prisma.reviewTask.create({
      data: {
        kind: 'BIAS_FINDING',
        subjectType: 'language_reviews',
        subjectId: stored.id,
        organizationId: job.organization.id,
        jobId: job.id,
        reason: `Posting review rated ${merged.overallRisk} with ${merged.findings.length} finding(s). A person decides whether the role changes.`,
        payload: json({ mode: outcome.mode, findings: merged.findings.length, continuityChecks: merged.continuityChecks.length }),
        assigneeRole: 'ADMIN',
        createdById: principal.userId,
      },
    })
  }

  await recordAudit({
    actor: principal,
    action: 'ai.bias_audit.run',
    entityType: 'language_reviews',
    entityId: stored.id,
    organizationId: job.organization.id,
    metadata: {
      jobId: job.id,
      mode: outcome.mode,
      risk: merged.overallRisk,
      blocked: outcome.blocked.length,
      fallbackReason: outcome.fallbackReason,
    },
  })

  return { review: stored, output: merged, outcome, reconciledWith: deterministic.findings.length }
}

/** Exposes the typed contracts so the test suite can assert against them. */
export const agentContracts = {
  discovery: discoveryOutputSchema,
  market: marketOutputSchema,
  pathway: pathwayOutputSchema,
  bias: biasAuditOutputSchema,
}

export type { Prisma }
