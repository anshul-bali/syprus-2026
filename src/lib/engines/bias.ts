import type { BiasAuditInput, BiasAuditOutput, BiasFinding } from '@/lib/ai/schemas'

/**
 * Deterministic posting review — the fallback that runs when no live model is
 * available, and the reference the model's output is compared against.
 *
 * It is a lexical review, not a judgement about people: it reports phrases in
 * the posting that tend to discourage or exclude a returning candidate, quotes
 * them verbatim, and proposes a rewrite that keeps the actual requirement.
 */

type Pattern = {
  category: BiasFinding['category']
  severity: BiasFinding['severity']
  test: RegExp
  why: string
  suggestion: string
  /** Optional replacement offered to the human reviewer. */
  rewrite?: string
}

const PATTERNS: Pattern[] = [
  {
    category: 'CAREER_CONTINUITY',
    severity: 'HIGH',
    test: /\b(no career gaps?|career gap[s]? (will )?(not|be) ?dis?c?ard|uninterrupted (career|employment|work) history|continuous(ly)? employed|gap[- ]free|must not have (any )?breaks?)\b/i,
    why: 'Explicitly penalises a break in service, which screens out returning carers regardless of capability.',
    suggestion: 'State the capability needed and how it will be assessed, not whether the timeline is unbroken.',
    rewrite: 'Demonstrated capability in the listed skills, evidenced by any mix of paid, freelance, community or caring work.',
  },
  {
    category: 'CAREER_CONTINUITY',
    severity: 'MEDIUM',
    test: /\b(recent graduate|only considered if you (graduated|finished) in|must have (worked|been employed) in the last \d+ (month|year)s?)\b/i,
    why: 'Recency-of-experience rules act as a proxy for a career break without naming a job requirement.',
    suggestion: 'Replace recency with a currency requirement you can test, such as a portfolio piece or a short task.',
    rewrite: 'Current working knowledge of the listed tools, demonstrated in a short practical exercise.',
  },
  {
    category: 'TENURE_THRESHOLD',
    severity: 'HIGH',
    test: /\b(exactly|minimum of|at least)\s+(\d{1,2})\+?\s*(?:\d+\s*)?years? of\b[^.]{0,40}(continuous|uninterrupted|in the same|consecutive)\b/i,
    why: 'Consecutive-year thresholds in one setting measure the shape of a CV rather than the skill.',
    suggestion: 'Express the threshold as total exposure to the activity, aggregated across all settings.',
    rewrite: 'Demonstrated depth in the activity, accumulated across any combination of roles.',
  },
  {
    category: 'TENURE_THRESHOLD',
    severity: 'MEDIUM',
    test: /\b\d{1,2}\+?\s*years?( of)? (hands[- ]on |practical )?(experience|work)\b/i,
    why: 'Years-of-experience is a weak proxy for capability and disproportionately filters returners.',
    suggestion: 'Keep the skill and the level required; make years optional or drop them entirely.',
    rewrite: 'Working ability at the level described, evidenced by outcomes you can point to.',
  },
  {
    category: 'EXCLUSIONARY_LANGUAGE',
    severity: 'HIGH',
    test: /\b(young|youthful|energetic|vibrant|digital native|fresh|hungry|work hard play hard)\b/i,
    why: 'Age-coded and lifestyle-coded wording signals a preferred life stage rather than a job requirement.',
    suggestion: 'Describe the pace or the tools neutrally.',
    rewrite: 'Comfortable working at a fast, self-directed pace.',
  },
  {
    category: 'CULTURE_FIT_VAGUENESS',
    severity: 'MEDIUM',
    test: /\bculture fit|cultural fit|fit with our (team )?vibe|not a fit for how we work\b/i,
    why: 'Unspecified fit criteria are unassessable by a candidate and are a documented route for biased screening.',
    suggestion: 'List the observable behaviours that matter and how they are evaluated.',
    rewrite: 'Ways of working we will assess: giving direct feedback, raising blockers early, documenting decisions.',
  },
  {
    category: 'LOGISTICS_BARRIER',
    severity: 'MEDIUM',
    test: /\b(immediate joining|immediate start|must start today|no notice period|available (only )?(full[- ]time |5 days a week )?(immediately|right away))\b/i,
    why: 'Immediate-start demands assume no caring or notice constraints, which rarely suits a returner.',
    suggestion: 'State a realistic start window or say it is negotiable.',
    rewrite: 'Start date within eight weeks, negotiable around caring responsibilities.',
  },
  {
    category: 'LOGISTICS_BARRIER',
    severity: 'MEDIUM',
    test: /\b(5 (full )?days a week onsite|must be in (the )?office (every day|full time|5 days)|no flexibility)\b/i,
    why: 'Rigid onsite presence excludes people whose availability is shaped by caregiving, without a stated business need.',
    suggestion: 'Explain why the presence is needed, or offer a core-hours alternative.',
    rewrite: 'Onsite for our two core collaboration days; the rest flexible.',
  },
  {
    category: 'UNNECESSARY_CREDENTIAL',
    severity: 'MEDIUM',
    test: /\b(only|must hold|mandatory)\b[^.]{0,30}(degree|bachelor|graduate|from (an )?(iit|nit|iv[a-z]*|top|elite|premier) (universit|college|institute))\b/i,
    why: 'Institution or credential filters screen on background rather than on the skills the role uses.',
    suggestion: 'Keep a credential only where it is legally required; otherwise describe the skill and test it.',
    rewrite: 'Evidence of the required skill — a certification, portfolio or work sample is accepted in place of a degree.',
  },
  {
    category: 'BIASED_TONE',
    severity: 'LOW',
    test: /\b(seasoned|senior[- ]level polish|corporate grooming|polished professional presence|never been out of the game)\b/i,
    why: 'Phrases of this kind describe presentation norms rather than performance.',
    suggestion: 'Say what the role actually needs the person to produce.',
    rewrite: 'Able to write clearly for an executive audience.',
  },
]

const POSITIVE_MARKERS: { test: RegExp; note: string }[] = [
  { test: /\breturnship\b/i, note: 'Names a return-to-work programme, which measurably widens the applicant pool.' },
  { test: /\b(re[- ]?entry|returning to work|career break)\b/i, note: 'Explicitly welcomes people returning after a break.' },
  { test: /\b(flexible hours|job share|part time considered|4[- ]day week)\b/i, note: 'Offers schedule flexibility rather than assuming availability.' },
  { test: /\b(mentor|buddy|pairing|structured onboarding)\b/i, note: 'Signals support in the first weeks.' },
  { test: /\b(skills[- ]based assessment|practical task|work sample)\b/i, note: 'Assesses capability directly instead of inferring it from a CV.' },
]

/**
 * Requirements that are commonly written as continuity demands but genuinely are
 * requirements — surfaced so a reviewer does not over-edit them away.
 */
const LEGITIMATE_EXCLUSIONS: { test: RegExp; note: string }[] = [
  { test: /\b(driving licence|valid visa|security clearance|right to work|police check)\b/i, note: 'A legal or regulatory precondition; keep it.' },
  { test: /\b(on[- ]call|rotational shift|night shift)\b/i, note: 'If genuinely required, state it plainly rather than hiding it in "flexibility".' },
]

function excerptAround(source: string, match: RegExpMatchArray): string {
  const start = Math.max(0, (match.index ?? 0) - 40)
  const end = Math.min(source.length, (match.index ?? 0) + match[0].length + 60)
  const slice = source.slice(start, end).replace(/\s+/g, ' ').trim()
  return slice.length > 300 ? slice.slice(0, 297).concat('…') : slice
}

export function analysePosting(input: BiasAuditInput): BiasAuditOutput {
  const body = [input.description, input.requirementsText ?? '', ...input.responsibilities].join('\n')

  const findings: BiasFinding[] = []
  for (const pattern of PATTERNS) {
    const matches = [...body.matchAll(new RegExp(pattern.test.source, pattern.test.flags.includes('g') ? pattern.test.flags : `${pattern.test.flags}g`))]
    for (const match of matches.slice(0, 2)) {
      findings.push({
        category: pattern.category,
        severity: pattern.severity,
        excerpt: excerptAround(body, match),
        whyItMayExclude: pattern.why,
        suggestion: pattern.suggestion,
        rewrite: pattern.rewrite ?? null,
      })
    }
  }

  const continuityChecks = findings
    .filter((finding) => finding.category === 'CAREER_CONTINUITY' || finding.category === 'TENURE_THRESHOLD')
    .map((finding) => ({
      requirement: finding.excerpt,
      isLikelyUnnecessary: finding.severity === 'HIGH',
      reason: `${finding.whyItMayExclude} Proposed alternative: ${finding.suggestion}`,
      suggestedRewrite: finding.rewrite,
    }))

  const positives = POSITIVE_MARKERS.filter((marker) => marker.test.test(body)).map((marker) => marker.note)
  const legitimate = LEGITIMATE_EXCLUSIONS.filter((marker) => marker.test.test(body)).map((marker) => marker.note)

  const high = findings.filter((finding) => finding.severity === 'HIGH').length
  const medium = findings.filter((finding) => finding.severity === 'MEDIUM').length
  const overallRisk = high >= 2 ? 'HIGH' : high === 1 || medium >= 3 ? 'MEDIUM' : 'LOW'

  // Lexical review findings are merged with the "keep this" notes so a reviewer
  // sees both sides of the same posting.
  const mergedPositives = [...positives, ...legitimate].slice(0, 10)

  return {
    overallRisk,
    findings: findings.slice(0, 25),
    continuityChecks,
    positives: mergedPositives,
    protectedCharacteristicsInferred: [],
    reviewRequired: overallRisk !== 'LOW',
    disclaimer:
      'Deterministic lexical review of posting text, used when no live model is available. It flags language that tends to discourage returning candidates; it does not assess people and cannot certify a posting as bias-free.',
  }
}

/**
 * Blends a model review with the deterministic pass. A finding is kept when the
 * lexical pass also found it, or when the model supplied a verbatim excerpt the
 * posting actually contains (enforced upstream in guardBiasAudit).
 */
export function reconcileBias(model: BiasAuditOutput, deterministic: BiasAuditOutput): BiasAuditOutput {
  const knownExcerpts = new Set(deterministic.findings.map((finding) => finding.excerpt.toLowerCase()))
  const modelExtras = model.findings.filter((finding) => !knownExcerpts.has(finding.excerpt.toLowerCase()))

  return {
    overallRisk: model.overallRisk,
    findings: [...deterministic.findings, ...modelExtras].slice(0, 25),
    continuityChecks: model.continuityChecks.length >= deterministic.continuityChecks.length
      ? model.continuityChecks
      : deterministic.continuityChecks,
    positives: [...new Set([...deterministic.positives, ...model.positives])].slice(0, 10),
    protectedCharacteristicsInferred: [],
    reviewRequired: model.reviewRequired || deterministic.reviewRequired,
    disclaimer: model.disclaimer,
  }
}
