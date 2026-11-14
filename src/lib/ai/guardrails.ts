import { normalizeForMatching } from '@/lib/engines/inference'
import {
  assistantOutputSchema,
  biasAuditOutputSchema,
  discoveryOutputSchema,
  marketOutputSchema,
  pathwayOutputSchema,
  type AssistantInput,
  type AssistantOutput,
  type BiasAuditInput,
  type BiasAuditOutput,
  type DiscoveryInput,
  type DiscoveryOutput,
  type MarketInput,
  type MarketOutput,
  type PathwayInput,
  type PathwayOutput,
} from './schemas'

/**
 * Guardrails between a model reply and the database.
 *
 * The provider contract asks for structured JSON, but a well-formed reply is not
 * necessarily a truthful one. These rules refuse the specific failure modes that
 * matter here: invented skills, invented evidence quotes, invented course links,
 * invented "live demand", care work overstated as verified competence, and any
 * attempt to infer protected characteristics.
 */

export class GuardrailViolation extends Error {
  readonly rule: string
  readonly detail: string

  constructor(rule: string, detail: string) {
    super(detail)
    this.name = 'GuardrailViolation'
    this.rule = rule
    this.detail = detail
  }
}

export type BlockedItem = { rule: string; detail: string }

export type GuardrailResult<T> = {
  output: T
  blocked: BlockedItem[]
  warnings: BlockedItem[]
}

const WORK_CONTEXTS = new Set(['WORK'])

const LEVEL_RANK = ['DEVELOPING', 'FUNCTIONAL', 'PROFICIENT', 'ADVANCED', 'EXPERT'] as const

function capLevel(level: (typeof LEVEL_RANK)[number], maxIndex: number) {
  return LEVEL_RANK[Math.min(LEVEL_RANK.indexOf(level), maxIndex)]
}

function verbatimQuote(quote: string, sources: string[]) {
  const needle = normalizeForMatching(quote)
  if (needle.length < 3) return false
  return sources.some((source) => normalizeForMatching(source).includes(needle))
}

// ---------------------------------------------------------------------------
// Agent 1 — Skills Discovery
// ---------------------------------------------------------------------------

/**
 * Proposals must resolve to a real taxonomy skill and must quote the candidate.
 * Evidence from non-work contexts is capped so caregiving is never presented as
 * professionally verified competence, and is flagged for human review.
 */
export function guardDiscovery(
  raw: unknown,
  input: DiscoveryInput,
  parse: (value: unknown) => DiscoveryOutput = (value) => discoveryOutputSchema.parse(value),
): GuardrailResult<DiscoveryOutput> {
  const output = parse(raw)
  const blocked: BlockedItem[] = []
  const warnings: BlockedItem[] = []

  const bySlug = new Map(input.taxonomy.map((entry) => [entry.slug, entry]))
  const textByContext = new Map<string, string[]>()
  for (const block of input.blocks) {
    const list = textByContext.get(block.context) ?? []
    list.push(block.text)
    textByContext.set(block.context, list)
  }
  const allText = input.blocks.map((block) => block.text)
  const existing = new Set(input.existingSlugs)

  const proposals: DiscoveryOutput['proposals'] = []

  for (const proposal of output.proposals) {
    const entry = bySlug.get(proposal.slug)
    if (!entry) {
      blocked.push({
        rule: 'unknown-skill',
        detail: `Model proposed “${proposal.slug}”, which is not in the platform skill taxonomy.`,
      })
      continue
    }

    const validQuotes = proposal.evidence.filter((item) => {
      const sources = textByContext.get(item.context) ?? allText
      return verbatimQuote(item.quote, sources)
    })

    if (validQuotes.length === 0) {
      blocked.push({
        rule: 'unquoted-evidence',
        detail: `Model proposed “${proposal.slug}” without an evidence phrase present in the candidate's own text.`,
      })
      continue
    }

    const contexts = new Set(validQuotes.map((item) => item.context))
    const hasWorkEvidence = [...contexts].some((context) => WORK_CONTEXTS.has(context))

    // Care, community and study evidence is valuable but cannot establish
    // professional depth: cap at PROFICIENT and require human review.
    let cappedLevel = proposal.level
    let requiresHumanReview = proposal.requiresHumanReview
    if (!hasWorkEvidence) {
      cappedLevel = capLevel(proposal.level, 2)
      requiresHumanReview = true
      warnings.push({
        rule: 'non-work-evidence',
        detail: `“${entry.name}” rests on non-work evidence, so the level is capped and a person should confirm it.`,
      })
    }

    if (existing.has(proposal.slug)) {
      warnings.push({ rule: 'already-held', detail: `“${entry.name}” is already on the profile; suggestion ignored.` })
      continue
    }

    proposals.push({
      slug: entry.slug,
      // Category and transferability come from the taxonomy, never from the model.
      category: entry.category,
      level: cappedLevel,
      confidence: Math.min(proposal.confidence, 0.9),
      evidence: validQuotes.slice(0, 4),
      rationale: proposal.rationale,
      professionallyVerified: false,
      requiresHumanReview,
    })
  }

  return {
    output: {
      proposals,
      unresolved: output.unresolved.filter((item) => verbatimQuote(item.quote, allText)),
      assessmentSuggestions: output.assessmentSuggestions.filter((item) => bySlug.has(item.slug)),
      summary: output.summary,
    },
    blocked,
    warnings,
  }
}

// ---------------------------------------------------------------------------
// Agent 2 — Market Intelligence
// ---------------------------------------------------------------------------

export const MANDATED_EXCLUSIONS = [
  'career-gap length',
  'caregiving status',
  'age',
  'gender',
  'marital status',
  'ethnicity or nationality',
]

export function guardMarket(
  raw: unknown,
  input: MarketInput,
  parse: (value: unknown) => MarketOutput = (value) => marketOutputSchema.parse(value),
): GuardrailResult<MarketOutput> {
  const output = parse(raw)
  const blocked: BlockedItem[] = []
  const warnings: BlockedItem[] = []

  const known = new Set([...input.candidateSkills, ...input.jobSkills.map((skill) => skill.slug)])

  const matched = output.matched.filter((item) => {
    if (known.has(item.slug)) return true
    blocked.push({ rule: 'unknown-skill', detail: `Match breakdown referenced unknown skill “${item.slug}”.` })
    return false
  })
  const gaps = output.gaps.filter((item) => {
    if (known.has(item.slug)) return true
    blocked.push({ rule: 'unknown-skill', detail: `Gap list referenced unknown skill “${item.slug}”.` })
    return false
  })

  // The model may not claim a live demand signal it did not receive.
  let isLive = output.isLiveDemandSignal
  if (input.source !== 'LIVE_PROVIDER' && isLive) {
    isLive = false
    blocked.push({
      rule: 'fabricated-market-signal',
      detail: 'Model claimed live market demand while the requirement set came from internal postings.',
    })
  }

  const excluded = new Set([...output.excludedSignals, ...MANDATED_EXCLUSIONS])

  return {
    output: {
      ...output,
      matched,
      gaps,
      isLiveDemandSignal: isLive,
      source: input.source,
      excludedSignals: [...excluded].slice(0, 12),
    },
    blocked,
    warnings,
  }
}

// ---------------------------------------------------------------------------
// Agent 3 — Learning Pathways
// ---------------------------------------------------------------------------

/**
 * Recommendations may only reference catalogue entries that exist, and links are
 * copied from the catalogue record — a URL produced by the model is discarded
 * rather than shown, because a plausible-but-wrong link is worse than none.
 */
export function guardPathway(
  raw: unknown,
  input: PathwayInput,
  parse: (value: unknown) => PathwayOutput = (value) => pathwayOutputSchema.parse(value),
): GuardrailResult<PathwayOutput> {
  const output = parse(raw)
  const blocked: BlockedItem[] = []
  const warnings: BlockedItem[] = []

  const catalogueById = new Map(input.catalogue.map((entry) => [entry.id, entry]))
  const gapBySlug = new Map(input.gaps.map((gap) => [gap.slug, gap]))

  const seen = new Set<string>()
  const items: PathwayOutput['items'] = []

  for (const item of output.items) {
    const entry = catalogueById.get(item.catalogueId)
    if (!entry) {
      blocked.push({
        rule: 'invented-resource',
        detail: `Model recommended “${item.catalogueId}”, which is not in the learning catalogue.`,
      })
      continue
    }
    if (seen.has(entry.id)) {
      warnings.push({ rule: 'duplicate-resource', detail: `“${entry.title}” was recommended twice; kept the first.` })
      continue
    }
    if (!gapBySlug.has(item.closesGapSlug)) {
      blocked.push({
        rule: 'unknown-gap',
        detail: `Step claimed to close “${item.closesGapSlug}”, which is not a reported gap.`,
      })
      continue
    }
    if (entry.skillSlug && entry.skillSlug !== item.closesGapSlug) {
      warnings.push({
        rule: 'skill-mismatch',
        detail: `“${entry.title}” is catalogued for ${entry.skillSlug}, not ${item.closesGapSlug}; relabelled to the catalogue.`,
      })
    }

    seen.add(entry.id)
    items.push({
      catalogueId: entry.id,
      position: items.length + 1,
      closesGapSlug: entry.skillSlug ?? item.closesGapSlug,
      whyRecommended: item.whyRecommended,
      // Effort is only reported where the catalogue supports it.
      estimatedHours: entry.durationHours,
      url: entry.url,
    })
  }

  const covered = new Set(items.map((item) => item.closesGapSlug))
  const uncovered = input.gaps.filter((gap) => !covered.has(gap.slug)).map((gap) => gap.slug)
  const totalHours = items.reduce((total, item) => total + (item.estimatedHours ?? 0), 0)

  if (items.length === 0) {
    throw new GuardrailViolation(
      'no-valid-resources',
      'Every recommended learning step was rejected by the guardrails, so the deterministic planner will be used instead.',
    )
  }

  return {
    output: {
      title: output.title,
      goal: output.goal,
      items,
      uncoveredGaps: uncovered,
      reassessment: output.reassessment.filter((item) => gapBySlug.has(item.slug)),
      totalHours: totalHours || 1,
      weeksAtWeeklyHours: Math.max(1, Math.ceil(totalHours / input.weeklyHours)),
      note:
        uncovered.length > 0
          ? `${output.note} Uncovered gaps stay open: ${uncovered.join(', ')}.`
          : output.note,
    },
    blocked,
    warnings,
  }
}

// ---------------------------------------------------------------------------
// Agent 4 — Bias Audit
// ---------------------------------------------------------------------------

const BIAS_DISCLAIMER =
  'Automated language review for human decision-making. It does not certify a posting as bias-free and does not infer any protected characteristic about any person.'

export function guardBiasAudit(
  raw: unknown,
  input: BiasAuditInput,
  parse: (value: unknown) => BiasAuditOutput = (value) => biasAuditOutputSchema.parse(value),
): GuardrailResult<BiasAuditOutput> {
  const output = parse(raw)
  const blocked: BlockedItem[] = []
  const warnings: BlockedItem[] = []

  // Any attempt to name protected characteristics is refused outright, and the
  // rest of the reply is discarded rather than partially trusted.
  if (output.protectedCharacteristicsInferred.length > 0) {
    throw new GuardrailViolation(
      'protected-characteristic-inference',
      'The model attempted to infer protected characteristics. The whole reply was discarded and no finding was stored.',
    )
  }

  const source = [input.title, input.description, input.requirementsText ?? '', ...input.responsibilities].join('\n')

  const findings = output.findings.filter((finding) => {
    if (verbatimQuote(finding.excerpt, [source])) return true
    blocked.push({
      rule: 'unquoted-excerpt',
      detail: `Finding in category ${finding.category} quoted text not present in the posting: “${finding.excerpt.slice(0, 60)}”.`,
    })
    return false
  })

  const continuityChecks = output.continuityChecks.filter((check) => {
    if (verbatimQuote(check.requirement, [source])) return true
    blocked.push({ rule: 'unquoted-excerpt', detail: `Continuity check referenced text absent from the posting.` })
    return false
  })

  if (findings.length === 0 && continuityChecks.length === 0 && output.positives.length === 0) {
    warnings.push({ rule: 'empty-review', detail: 'The review produced no quotable observations; treat as unusable.' })
  }

  return {
    output: {
      ...output,
      findings,
      continuityChecks,
      // Fixed wording, so a model cannot soften or overstate the guarantee.
      disclaimer: BIAS_DISCLAIMER,
      reviewRequired: findings.some((finding) => finding.severity !== 'LOW') || output.reviewRequired,
    },
    blocked,
    warnings,
  }
}

/**
 * Sona is allowed to phrase; it is not allowed to source. Anything it states
 * with a number has to trace back to a fact the server actually read, and the
 * claims this product has promised never to make are refused here rather than
 * filtered by wording alone.
 */
export function guardAssistant(
  raw: unknown,
  input: AssistantInput,
  parse: (value: unknown) => AssistantOutput = (value) => assistantOutputSchema.parse(value),
): GuardrailResult<AssistantOutput> {
  const output = parse(raw)
  const blocked: BlockedItem[] = []
  const warnings: BlockedItem[] = []

  const lower = output.answer.toLowerCase()

  const overstated = [
    /\b(verified|confirmed|validated) by (an? )?(employer|employers|recruiter|recruiters|syprus|our team)\b/,
    /\b(professionally|independently) verified\b/,
    /\b(guarantee|guaranteed|guarantees|assure|assured)\b[^.]{0,40}\b(job|jobs|offer|interview|placement|hire|hired|hiring)\b/,
    /\byou (will|are going to|will definitely) be (hired|interviewed)\b/,
    /\bthis platform predicts\b/,
  ].find((pattern) => pattern.test(lower))
  if (overstated) {
    throw new GuardrailViolation(
      'assistant-overstatement',
      'Sona phrased an outcome this platform does not claim. The reply was replaced by the deterministic answer.',
    )
  }

  // Naming a characteristic *about the person* is refused; explaining that the
  // engine ignores those fields is a normal, correct answer.
  const characteristic = [
    /\byour age is\b/,
    /\byou are (married|single|divorced|pregnant|disabled)\b/,
    /\byour (religion|caste|ethnicity|nationality) is\b/,
    /\bsince you (are|have) (a )?(child|children|disability)\b/,
  ].find((pattern) => pattern.test(lower))
  if (characteristic) {
    throw new GuardrailViolation(
      'protected-characteristic-inference',
      'Sona attempted to attribute a protected characteristic to this account. The whole reply was discarded.',
    )
  }

  const factIds = new Set(input.facts.map((fact) => fact.id))
  const citations = output.citations.filter((id) => {
    if (factIds.has(id)) return true
    blocked.push({ rule: 'unknown-citation', detail: `Cited fact "${id.slice(0, 40)}" was never supplied to the model.` })
    return false
  })

  const grounded = citations
    .map((id) => input.facts.find((fact) => fact.id === id))
    .filter((fact): fact is AssistantInput['facts'][number] => Boolean(fact))
  const haystack = `${grounded.map((fact) => `${fact.label} ${fact.value}`).join(' ')} ${input.question}`
  const numbers = [...output.answer.matchAll(/\d+(?:[.,]\d+)?%?/g)].map((match) => match[0])
  const unattributed = numbers.filter((token) => {
    const bare = token.replace(/[.,]/g, '').replace('%', '')
    if (Number(bare) <= 12) return false // list positions and small counts are not claims about records
    return !haystack.replace(/[.,]/g, '').includes(bare)
  })
  if (unattributed.length > 0) {
    throw new GuardrailViolation(
      'unattributed-figure',
      `Sona stated figure(s) not present in this account's stored records (${unattributed.slice(0, 3).join(', ')}). The deterministic answer was used instead.`,
    )
  }

  if (input.facts.length > 0 && citations.length === 0 && numbers.length > 0) {
    warnings.push({ rule: 'unreferenced-figure', detail: 'The answer quoted a figure without citing the fact it came from.' })
  }

  const standardCaveat = 'Sona is an automated assistant. It reads only the records stored on this account, and its wording is not a verification, an assessment result, or a hiring decision.'
  const caveats = [...new Set([standardCaveat, ...output.caveats])].slice(0, 4)

  return {
    output: { ...output, citations, caveats },
    blocked,
    warnings,
  }
}

export function guardrailSummary(results: GuardrailResult<unknown>[]) {
  return {
    blocked: results.flatMap((result) => result.blocked),
    warnings: results.flatMap((result) => result.warnings),
    blockedCount: results.reduce((total, result) => total + result.blocked.length, 0),
  }
}
