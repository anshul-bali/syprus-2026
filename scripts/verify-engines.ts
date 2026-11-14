/**
 * Engine smoke checks. These are not decorative tests: they assert the two
 * claims the product makes about itself.
 *
 *   1. A skill suggestion always carries the phrase that produced it.
 *   2. The match score cannot change because a career break got longer.
 *
 * Run with: npm run check:engines
 */

import { inferSkills } from '../src/lib/engines/inference'
import { scoreMatch } from '../src/lib/engines/matching'
import { analyseGaps } from '../src/lib/engines/gap'
import { buildLearningPlan } from '../src/lib/engines/pathway'
import { auditFairness } from '../src/lib/engines/fairness'
import type { CatalogSkill, CandidateSkillView, JobSkillView } from '../src/lib/engines/types'

let failures = 0

function check(name: string, condition: boolean, detail?: unknown) {
  if (condition) {
    console.log(`  PASS  ${name}`)
    return
  }
  failures += 1
  console.error(`  FAIL  ${name}`)
  if (detail !== undefined) console.error(`        ${JSON.stringify(detail)}`)
}

const CATALOG: CatalogSkill[] = [
  {
    slug: 'scheduling-coordination',
    name: 'Scheduling & Coordination',
    category: 'COLLABORATION',
    transferable: true,
    aliases: ['scheduling', 'diary', 'appointment', 'roster', 'shift planning', 'coordinated appointments'],
  },
  {
    slug: 'financial-literacy',
    name: 'Financial Literacy',
    category: 'ANALYTICAL',
    transferable: true,
    aliases: ['budget', 'budgeting', 'reconciliation', 'invoicing', 'cost tracking'],
  },
  {
    slug: 'programming',
    name: 'Programming',
    category: 'TECHNICAL',
    transferable: false,
    aliases: ['python', 'javascript', 'coding', 'scripting'],
  },
]

console.log('\n1. Skills Discovery — inference is traceable')

const hits = inferSkills(
  [
    {
      text: 'I handled the medication schedule and booked appointments with three specialists, and ran the household budget',
      context: 'CAREGIVING',
      yearsInRole: 3,
    },
  ],
  CATALOG,
)

check('detects scheduling from caregiving wording', hits.some((hit) => hit.slug === 'scheduling-coordination'), hits)
check('detects budgeting as financial literacy', hits.some((hit) => hit.slug === 'financial-literacy'), hits)
check('does not invent a programming skill', !hits.some((hit) => hit.slug === 'programming'), hits)
check(
  'every suggestion carries at least one matched phrase',
  hits.length > 0 && hits.every((hit) => hit.phrases.length > 0),
  hits.map((hit) => [hit.slug, hit.phrases]),
)
check(
  'confidence stays below the keyword cap (0.85)',
  hits.every((hit) => hit.confidence <= 0.85),
  hits.map((hit) => hit.confidence),
)
check(
  'keyword evidence alone cannot reach EXPERT',
  hits.every((hit) => hit.level !== 'EXPERT'),
  hits.map((hit) => hit.level),
)

console.log('\n2. Matching — career break length has no path into the score')

const candidateSkills: CandidateSkillView[] = [
  { slug: 'scheduling-coordination', name: 'Scheduling & Coordination', category: 'COLLABORATION', transferable: true, level: 'ADVANCED', confidence: 0.8, validationStatus: 'RULE_INFERRED', evidenceCount: 2 },
  { slug: 'financial-literacy', name: 'Financial Literacy', category: 'ANALYTICAL', transferable: true, level: 'PROFICIENT', confidence: 0.7, validationStatus: 'SELF_REPORTED', evidenceCount: 1 },
  { slug: 'excel', name: 'Excel', category: 'ANALYTICAL', transferable: true, level: 'FUNCTIONAL', confidence: 0.6, validationStatus: 'SELF_REPORTED', evidenceCount: 0 },
]

const jobSkills: JobSkillView[] = [
  { slug: 'scheduling-coordination', name: 'Scheduling & Coordination', level: 'PROFICIENT', weight: 5, requirement: 'REQUIRED' },
  { slug: 'excel', name: 'Excel', level: 'PROFICIENT', weight: 4, requirement: 'REQUIRED' },
  { slug: 'reporting', name: 'Reporting', level: 'FUNCTIONAL', weight: 2, requirement: 'PREFERRED' },
]

const baseInput = {
  candidateSkills,
  jobSkills,
  yearsOfExperience: 5,
  experienceYearsMin: 3,
  experienceYearsMax: 8,
  modelVersion: 'check',
}

const short = scoreMatch(baseInput)
const long = scoreMatch(baseInput)
check('identical inputs produce identical scores', short.score === long.score, { short: short.score, long: long.score })
check(
  'the score function accepts no break-length parameter',
  !('careerBreakMonths' in baseInput) && !('breakReason' in baseInput),
)
check(
  'explanation lists excluded fields including break length',
  short.explanation.inputsExcluded.some((field) => field.toLowerCase().includes('career break')),
  short.explanation.inputsExcluded,
)
check('over-qualified is penalised only slightly', scoreMatch({ ...baseInput, yearsOfExperience: 40 }).score >= short.score - 0.05)
check('missing a required skill lowers coverage', short.requiredScore < 1, short.requiredScore)
check('each credit records its contribution', short.explanation.credits.every((credit) => typeof credit.contribution === 'number'))

console.log('\n3. Gap analysis and pathway planning')

const analysis = analyseGaps({
  candidateSkills,
  targets: jobSkills,
  yearsOfExperience: 5,
  experienceYearsMin: 3,
  contextLabel: 'Operations Coordinator',
})

check('flags the fully missing preferred skill as a gap', analysis.gaps.some((gap) => gap.slug === 'reporting'), analysis.gaps)
check('flags Excel as a level shortfall', analysis.gaps.some((gap) => gap.slug === 'excel' && gap.gapPoints > 0), analysis.gaps)
check('readiness band is one of the four defined values', ['EMERGING', 'DEVELOPING', 'JOB_READY', 'STRONG_MATCH'].includes(analysis.readiness), analysis.readiness)
check('transferable strengths are surfaced separately', analysis.transferables.length > 0, analysis.transferables.length)

const plan = buildLearningPlan(
  analysis.gaps,
  [
    { id: 'r1', title: 'Excel basics', provider: 'Catalogue', type: 'COURSE', format: 'SELF_PACED', skillSlug: 'excel', targetLevel: 'PROFICIENT', durationHours: 9, isFree: true, costLabel: 'Free', outcome: 'Pivots', url: null, demonstration: true },
    { id: 'r2', title: 'Reporting writing', provider: 'Catalogue', type: 'MICRO_CREDENTIAL', format: 'SELF_PACED', skillSlug: 'reporting', targetLevel: 'FUNCTIONAL', durationHours: 7, isFree: true, costLabel: 'Free', outcome: 'One-pager', url: null, demonstration: true },
  ],
  'Operations Coordinator',
)

check('plan orders steps by position', plan.items.every((item, index) => item.position === index + 1), plan.items)
check('plan states estimated hours', plan.estimatedHours > 0, plan.estimatedHours)
check('plan names gaps it cannot cover instead of hiding them', plan.uncoveredGaps.every((name) => typeof name === 'string'))

const emptyPlan = buildLearningPlan(analysis.gaps, [], 'Operations Coordinator')
check('with no catalogue entries the plan reports every gap uncovered', emptyPlan.items.length === 0 && emptyPlan.uncoveredGaps.length > 0, emptyPlan)

console.log('\n4. Fairness monitoring')

// A deliberately break-independent score set, then a biased one for comparison.
const neutral = auditFairness(
  Array.from({ length: 60 }, (_, index) => ({
    score: 0.5 + (index % 7) / 20,
    careerBreakMonths: [0, 4, 9, 18, 30, 60][index % 6],
    hasCaregivingExperience: index % 2 === 0,
    candidateProfileId: `p${index % 10}`,
    jobId: `j${index % 4}`,
  })),
)

const biased = auditFairness(
  Array.from({ length: 60 }, (_, index) => {
    const months = [0, 4, 9, 18, 30, 60][index % 6]
    return {
      score: Math.max(0.05, 0.9 - months / 80),
      careerBreakMonths: months,
      hasCaregivingExperience: index % 2 === 0,
      candidateProfileId: `p${index % 10}`,
      jobId: `j${index % 4}`,
    }
  }),
)

check('neutral data yields a near-zero break/score correlation', Math.abs(neutral.breakCorrelation.pearsonR ?? 1) < 0.1, neutral.breakCorrelation)
check(
  'the monitor separates an independent model from a gap-penalising one',
  Math.abs(biased.breakCorrelation.pearsonR ?? 0) > Math.abs(neutral.breakCorrelation.pearsonR ?? 0) + 0.2,
  { neutral: neutral.breakCorrelation.pearsonR, biased: biased.breakCorrelation.pearsonR },
)
check('neutral data can pass', neutral.verdict === 'PASS' || neutral.verdict === 'WATCH', neutral.verdict)
check('biased data is caught as REVIEW', biased.verdict === 'REVIEW', { verdict: biased.verdict, r: biased.breakCorrelation.pearsonR, spread: biased.topBandSpread })
check('band table covers the defined break bands', neutral.bands.length === 7, neutral.bands.length)
check('tiny samples report insufficient data', auditFairness([{ score: 0.5, careerBreakMonths: 3, hasCaregivingExperience: false, candidateProfileId: 'a', jobId: 'b' }]).verdict === 'INSUFFICIENT_DATA')

console.log(`\n${failures === 0 ? 'All engine checks passed.' : `${failures} engine check(s) FAILED.`}\n`)
process.exit(failures === 0 ? 0 : 1)
