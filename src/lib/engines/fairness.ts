/**
 * Fairness Sentinel engine.
 *
 * The matching model declares that career-break length is not an input. This
 * module checks that declaration against the scores the model actually produced,
 * by measuring the spread of scores across break-length bands and the correlation
 * between break length and score.
 *
 * This is monitoring, not a guarantee. A "pass" means no measurable penalty was
 * found in the current data — it does not mean bias has been eliminated.
 */

export type FairnessSample = {
  score: number
  careerBreakMonths: number | null
  hasCaregivingExperience: boolean
  candidateProfileId: string
  jobId: string
}

export type BandStat = {
  key: string
  label: string
  sampleCount: number
  meanScore: number | null
  minScore: number | null
  maxScore: number | null
}

export type FairnessAudit = {
  generatedAt: string
  totals: {
    samples: number
    candidates: number
    jobs: number
    meanScore: number | null
  }
  bands: BandStat[]
  breakCorrelation: { pearsonR: number | null; interpretation: string; pairs: number }
  caregivingComparison: {
    withCaregiving: number
    withoutCaregiving: number
    meanWith: number | null
    meanWithout: number | null
    delta: number | null
  }
  topBandSpread: number | null
  verdict: 'PASS' | 'WATCH' | 'REVIEW' | 'INSUFFICIENT_DATA'
  reasons: string[]
  caveats: string[]
}

const BANDS: { key: string; label: string; test: (months: number | null) => boolean }[] = [
  { key: 'none', label: 'No career break recorded', test: (m) => m === 0 },
  { key: '1-6', label: '1–6 months', test: (m) => m != null && m >= 1 && m <= 6 },
  { key: '7-12', label: '7–12 months', test: (m) => m != null && m >= 7 && m <= 12 },
  { key: '13-24', label: '13–24 months', test: (m) => m != null && m >= 13 && m <= 24 },
  { key: '25-48', label: '2–4 years', test: (m) => m != null && m >= 25 && m <= 48 },
  { key: '49+', label: 'More than 4 years', test: (m) => m != null && m > 48 },
  { key: 'unknown', label: 'Break length not recorded', test: (m) => m == null },
]

function mean(values: number[]) {
  if (values.length === 0) return null
  return Number((values.reduce((total, value) => total + value, 0) / values.length).toFixed(4))
}

function pearson(pairs: [number, number][]): number | null {
  const n = pairs.length
  if (n < 3) return null
  const sumX = pairs.reduce((total, pair) => total + pair[0], 0)
  const sumY = pairs.reduce((total, pair) => total + pair[1], 0)
  const sumXY = pairs.reduce((total, pair) => total + pair[0] * pair[1], 0)
  const sumX2 = pairs.reduce((total, pair) => total + pair[0] ** 2, 0)
  const sumY2 = pairs.reduce((total, pair) => total + pair[1] ** 2, 0)

  const numerator = n * sumXY - sumX * sumY
  const denominator = Math.sqrt((n * sumX2 - sumX ** 2) * (n * sumY2 - sumY ** 2))
  if (denominator === 0) return null
  return Number((numerator / denominator).toFixed(4))
}

export function auditFairness(samples: FairnessSample[]): FairnessAudit {
  const reasons: string[] = []
  const caveats: string[] = []

  const bands: BandStat[] = BANDS.map((band) => {
    const inBand = samples.filter((sample) => band.test(sample.careerBreakMonths))
    const scores = inBand.map((sample) => sample.score)
    return {
      key: band.key,
      label: band.label,
      sampleCount: inBand.length,
      meanScore: mean(scores),
      minScore: scores.length ? Number(Math.min(...scores).toFixed(4)) : null,
      maxScore: scores.length ? Number(Math.max(...scores).toFixed(4)) : null,
    }
  })

  const populated = bands.filter((band) => band.key !== 'unknown' && band.meanScore != null)
  const bandMeans = populated.map((band) => band.meanScore as number)
  const topBandSpread = bandMeans.length >= 2 ? Number((Math.max(...bandMeans) - Math.min(...bandMeans)).toFixed(4)) : null

  const correlationPairs = samples
    .filter((sample) => sample.careerBreakMonths != null)
    .map((sample) => [sample.careerBreakMonths as number, sample.score] as [number, number])
  const pearsonR = pearson(correlationPairs)

  const withCaregiving = samples.filter((sample) => sample.hasCaregivingExperience)
  const withoutCaregiving = samples.filter((sample) => !sample.hasCaregivingExperience)
  const meanWith = mean(withCaregiving.map((sample) => sample.score))
  const meanWithout = mean(withoutCaregiving.map((sample) => sample.score))
  const delta = meanWith != null && meanWithout != null ? Number((meanWith - meanWithout).toFixed(4)) : null

  if (samples.length < 20) {
    reasons.push('Fewer than 20 stored matches — treat every figure below as indicative only.')
  }

  if (pearsonR == null) {
    reasons.push('Not enough paired data to measure the break-length/score relationship.')
  } else if (Math.abs(pearsonR) > 0.15) {
    reasons.push(`Score and break length correlate at r=${pearsonR}. Investigate the inputs behind this.`)
  } else if (Math.abs(pearsonR) > 0.08) {
    reasons.push(`Weak association between score and break length (r=${pearsonR}); worth re-checking as volume grows.`)
  } else {
    reasons.push(`No measurable association between score and break length (r=${pearsonR}).`)
  }

  if (delta != null && Math.abs(delta) > 0.1) {
    reasons.push(`Candidates with caregiving experience score ${delta > 0 ? 'higher' : 'lower'} by ${Math.abs(delta).toFixed(2)} on average.`)
  } else if (delta != null) {
    reasons.push(`Caregiving-experience difference is small (${delta > 0 ? '+' : ''}${delta.toFixed(3)}).`)
  }

  if (topBandSpread != null && topBandSpread > 0.12) {
    reasons.push(`Band means spread ${topBandSpread.toFixed(2)} between break-length groups — above the 0.12 watch threshold.`)
  } else if (topBandSpread != null) {
    reasons.push(`Band means stay within ${topBandSpread.toFixed(2)} of each other.`)
  }

  for (const band of populated) {
    if (band.sampleCount < 5) {
      caveats.push(`${band.label}: only ${band.sampleCount} match${band.sampleCount === 1 ? '' : 'es'} stored.`)
    }
  }

  let verdict: FairnessAudit['verdict']
  if (samples.length < 10) verdict = 'INSUFFICIENT_DATA'
  else if (
    (pearsonR != null && Math.abs(pearsonR) > 0.15) ||
    (topBandSpread != null && topBandSpread > 0.2) ||
    (delta != null && Math.abs(delta) > 0.15)
  )
    verdict = 'REVIEW'
  else if (
    (pearsonR != null && Math.abs(pearsonR) > 0.08) ||
    (topBandSpread != null && topBandSpread > 0.12) ||
    (delta != null && Math.abs(delta) > 0.1) ||
    samples.length < 20
  )
    verdict = 'WATCH'
  else verdict = 'PASS'

  return {
    generatedAt: new Date().toISOString(),
    totals: {
      samples: samples.length,
      candidates: new Set(samples.map((sample) => sample.candidateProfileId)).size,
      jobs: new Set(samples.map((sample) => sample.jobId)).size,
      meanScore: mean(samples.map((sample) => sample.score)),
    },
    bands,
    breakCorrelation: {
      pearsonR,
      pairs: correlationPairs.length,
      interpretation:
        pearsonR == null
          ? 'Not computable from the stored matches.'
          : Math.abs(pearsonR) <= 0.08
            ? 'Near zero, consistent with break length being unused by the model.'
            : Math.abs(pearsonR) <= 0.15
              ? 'Small association; monitor.'
              : 'Material association; the skills-first claim needs investigation.',
    },
    caregivingComparison: {
      withCaregiving: withCaregiving.length,
      withoutCaregiving: withoutCaregiving.length,
      meanWith,
      meanWithout,
      delta,
    },
    topBandSpread,
    verdict,
    reasons,
    caveats,
  }
}

export const FAIRNESS_ENGINE_NAME = 'Fairness Sentinel Agent'
export const FAIRNESS_ENGINE_MODE = 'DESCRIPTIVE_STATISTICS'
