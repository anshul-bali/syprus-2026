import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { DemoBadge, InfoNote, PageHeader, ScoreBar, StatusBadge } from '@/components/common'
import { CategoryBarChart, FairnessBandChart } from '@/components/admin/charts'
import { requirePermission } from '@/lib/authz'
import { fairnessReport } from '@/server/admin'
import { DEFAULT_WEIGHTS } from '@/lib/engines/matching'
import { MATCH_EXCLUDED_FIELDS, MATCH_INPUT_FIELDS } from '@/lib/engines/types'
import { formatDateTime } from '@/lib/utils'

export const metadata = { title: 'Fairness monitoring' }

const VERDICT_COPY: Record<string, string> = {
  PASS: 'No measurable penalty was found in the stored scores for this sample.',
  WATCH: 'A small association is visible. Worth re-checking as volume grows.',
  REVIEW: 'A material difference is visible between bands. The skills-first claim needs investigation before more candidates are affected.',
  INSUFFICIENT_DATA: 'Too few stored matches to say anything meaningful about this sample.',
}

function scoreText(value: number | null, digits = 3) {
  return value == null ? '—' : value.toFixed(digits)
}

export default async function AdminFairnessPage() {
  const principal = await requirePermission('admin.fairness.read')
  const { audit, disclosure, governance } = await fairnessReport(principal)

  const chartBands = audit.bands
    .filter((band) => band.key !== 'unknown' && band.meanScore != null)
    .map((band) => ({ band: band.label.split(' ')[0], meanScore: band.meanScore as number }))

  const thinBands = audit.bands.filter((band) => band.sampleCount > 0 && band.sampleCount < 5)
  const unrecorded = audit.bands.find((band) => band.key === 'unknown')
  const consentShare =
    governance.scoredProfileCount > 0 ? governance.optedInProfileCount / governance.scoredProfileCount : null

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Administrator"
        title="Fairness monitoring"
        description="The matching model declares that career-break length is not an input. This screen tests that declaration against the scores the model actually wrote."
        actions={<DemoBadge text="Scores from seeded profiles" />}
      />

      <InfoNote tone="warning" title="Monitoring is not a guarantee">
        <p>
          A clean result means <strong>no penalty was measurable in the consenting sample</strong>. It does not mean bias
          has been eliminated, it is not a legal certification, and it says nothing about decisions employers make after
          they see a score. Career-break length and caregiving status are measured only for profiles that granted research
          consent at policy version {governance.policyVersion}; everyone else is excluded from these figures.
        </p>
      </InfoNote>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">What the sample can and cannot support</CardTitle>
          <CardDescription>
            Every figure on this page rests on the counts below. A band with few matches can produce a mean that moves
            sharply on one new score, and profiles outside the research sample are not represented here at all.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-2">
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Matches per band</p>
              {audit.bands.some((band) => band.sampleCount > 0) ? (
                <CategoryBarChart
                  data={audit.bands
                    .filter((band) => band.sampleCount > 0)
                    .map((band) => ({ label: band.label, count: band.sampleCount }))}
                  label="Stored matches per career-break band"
                  description="Counts of matches behind each band mean. The table further down repeats them beside the means."
                />
              ) : (
                <p className="text-sm text-muted-foreground">No stored match carries a band, so there is nothing to count.</p>
              )}
              <ul className="text-xs leading-relaxed text-muted-foreground">
                {unrecorded && unrecorded.sampleCount > 0 ? (
                  <li>
                    {unrecorded.sampleCount} match{unrecorded.sampleCount === 1 ? '' : 'es'} come from profiles with no
                    career-break length recorded. They are counted here and excluded from every band comparison — missing
                    data, not a zero-length break.
                  </li>
                ) : null}
                {thinBands.length > 0 ? (
                  <li>
                    {thinBands.length} band{thinBands.length === 1 ? ' carries' : 's carry'} fewer than 5 matches (
                    {thinBands.map((band) => `${band.label} · ${band.sampleCount}`).join('; ')}). Their means are shown
                    and marked as indicative.
                  </li>
                ) : null}
                {audit.bands.some((band) => band.sampleCount === 0) ? (
                  <li>
                    {audit.bands.filter((band) => band.sampleCount === 0).length} band
                    {audit.bands.filter((band) => band.sampleCount === 0).length === 1 ? ' has' : 's have'} no matches at
                    all, so no mean is reported for them rather than a zero.
                  </li>
                ) : null}
              </ul>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Who is in the sample</p>
              <div
                role="img"
                aria-label={`Research consent coverage: ${governance.optedInProfileCount} of ${governance.scoredProfileCount} scored profiles are included.`}
                className="flex h-3.5 w-full overflow-hidden rounded-full bg-muted ring-1 ring-border/70"
              >
                <div
                  className="h-full bg-brand-500"
                  style={{ width: `${consentShare == null ? 0 : Math.round(consentShare * 100)}%` }}
                />
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {governance.optedInProfileCount} of {governance.scoredProfileCount} profiles carrying stored matches
                granted research consent
                {consentShare == null ? '' : ` (${Math.round(consentShare * 100)}% of the scored population)`}. The rest
                are excluded from every figure on this page, so this is a sample of the volunteers, not of the platform.
              </p>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Nothing here identifies an individual: bands are reported as counts and means, and no name, handle,
                employer or break date is read into this screen.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">Verdict</CardTitle>
            <StatusBadge value={audit.verdict} label={audit.verdict.replace(/_/g, ' ')} />
          </div>
          <CardDescription>
            {VERDICT_COPY[audit.verdict] ?? 'See the measured figures below.'} Generated {formatDateTime(audit.generatedAt)}
            .
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border border-border bg-muted/30 px-3.5 py-3">
              <dt className="text-xs tracking-wide text-muted-foreground uppercase">Opted-in matches read</dt>
              <dd className="mt-1 text-xl font-semibold tabular-nums">{audit.totals.samples}</dd>
            </div>
            <div className="rounded-lg border border-border bg-muted/30 px-3.5 py-3">
              <dt className="text-xs tracking-wide text-muted-foreground uppercase">Candidates covered</dt>
              <dd className="mt-1 text-xl font-semibold tabular-nums">{audit.totals.candidates}</dd>
            </div>
            <div className="rounded-lg border border-border bg-muted/30 px-3.5 py-3">
              <dt className="text-xs tracking-wide text-muted-foreground uppercase">Roles covered</dt>
              <dd className="mt-1 text-xl font-semibold tabular-nums">{audit.totals.jobs}</dd>
            </div>
            <div className="rounded-lg border border-border bg-muted/30 px-3.5 py-3">
              <dt className="text-xs tracking-wide text-muted-foreground uppercase">Mean score overall</dt>
              <dd className="mt-1 text-xl font-semibold tabular-nums">{scoreText(audit.totals.meanScore, 2)}</dd>
            </div>
          </dl>

          <p className="text-xs leading-relaxed text-muted-foreground" role="status">
            {governance.optedInProfileCount} of {governance.scoredProfileCount} profiles carrying stored matches granted
            research consent. Scores belonging to the remaining profiles were not read into this audit.
          </p>

          <div>
            <h2 className="text-sm font-medium">Reasons the verdict was reached</h2>
            <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-muted-foreground">
              {audit.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </div>

          {audit.caveats.length > 0 ? (
            <div className="rounded-lg border border-border/70 bg-muted/30 px-3.5 py-3">
              <h2 className="text-sm font-medium">Small-sample caveats</h2>
              <ul className="mt-1.5 list-disc space-y-1 pl-5 text-xs leading-relaxed text-muted-foreground">
                {audit.caveats.map((caveat) => (
                  <li key={caveat}>{caveat}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Mean stored score by career-break band</CardTitle>
            <CardDescription>
              Bands with no recorded break length are excluded from the chart and shown in the table below.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {chartBands.length >= 2 ? (
              <FairnessBandChart data={chartBands} label="Mean match score per career-break band" />
            ) : (
              <p className="text-sm text-muted-foreground">
                Fewer than two bands carry a mean score, so there is nothing to plot yet. Read the table.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Associations measured</CardTitle>
            <CardDescription>Pearson correlation and the caregiving comparison, as the audit engine computed them.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg border border-border/70 px-3.5 py-3">
              <p className="text-xs tracking-wide text-muted-foreground uppercase">
                Break length vs score (Pearson r)
              </p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">
                {audit.breakCorrelation.pearsonR == null ? 'Not computable' : audit.breakCorrelation.pearsonR.toFixed(4)}
              </p>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                {audit.breakCorrelation.interpretation}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Computed on {audit.breakCorrelation.pairs} paired observations.
              </p>
            </div>

            <div className="rounded-lg border border-border/70 px-3.5 py-3">
              <p className="text-xs tracking-wide text-muted-foreground uppercase">Caregiving experience comparison</p>
              <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">With caregiving experience</dt>
                  <dd className="tabular-nums">
                    {audit.caregivingComparison.withCaregiving} matches · mean{' '}
                    {scoreText(audit.caregivingComparison.meanWith)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Without</dt>
                  <dd className="tabular-nums">
                    {audit.caregivingComparison.withoutCaregiving} matches · mean{' '}
                    {scoreText(audit.caregivingComparison.meanWithout)}
                  </dd>
                </div>
              </dl>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Difference in means:{' '}
                <span className="font-semibold tabular-nums text-foreground">
                  {audit.caregivingComparison.delta == null
                    ? 'not computable'
                    : `${audit.caregivingComparison.delta > 0 ? '+' : ''}${audit.caregivingComparison.delta.toFixed(4)}`}
                </span>
                . A non-zero delta is not evidence of discrimination: caregiving entries add described work to a profile,
                which changes the skills a candidate holds.
              </p>
            </div>

            <div className="rounded-lg border border-border/70 px-3.5 py-3">
              <p className="text-xs tracking-wide text-muted-foreground uppercase">Spread between band means</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">
                {audit.topBandSpread == null ? 'Not computable' : audit.topBandSpread.toFixed(4)}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Largest gap between any two populated band means. The audit thresholds are 0.12 for watch and 0.20 for
                review, fixed in <code className="text-xs">src/lib/engines/fairness.ts</code>.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Break-band detail</CardTitle>
          <CardDescription>Every band the audit engine populated from stored matches.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableCaption>
              Match-score distribution by career-break band. Sample size is what tells you whether a mean is meaningful.
            </TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Band</TableHead>
                <TableHead scope="col">Matches</TableHead>
                <TableHead scope="col">Mean score</TableHead>
                <TableHead scope="col">Min</TableHead>
                <TableHead scope="col">Max</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {audit.bands.map((band) => (
                <TableRow key={band.key}>
                  <TableCell>
                    <span className="block font-medium">{band.label}</span>
                    {band.sampleCount === 0 ? (
                      <span className="block text-[11px] text-muted-foreground">
                        No match falls in this band — nothing is measured here
                      </span>
                    ) : band.sampleCount < 5 ? (
                      <span className="block text-[11px] text-muted-foreground">
                        Small sample — treat the mean as indicative
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="tabular-nums">{band.sampleCount}</TableCell>
                  <TableCell className="min-w-[10rem]">
                    {band.meanScore == null ? (
                      <span className="text-xs text-muted-foreground">No scores stored</span>
                    ) : (
                      <div className="max-w-[12rem]">
                        <ScoreBar score={band.meanScore} label="Mean match" />
                        <span className="mt-1 block text-[11px] tabular-nums text-muted-foreground">
                          {band.meanScore.toFixed(4)} on the 0–1 scale
                        </span>
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="tabular-nums">{scoreText(band.minScore, 2)}</TableCell>
                  <TableCell className="tabular-nums">{scoreText(band.maxScore, 2)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">What the scoring model reads</CardTitle>
            <CardDescription>
              The complete input list for the weighted coverage model, with the fixed weights it applies.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <ul className="space-y-1.5 text-sm leading-relaxed">
              {MATCH_INPUT_FIELDS.map((field) => (
                <li key={field} className="flex gap-2">
                  <span aria-hidden className="mt-1 size-1.5 shrink-0 rounded-full bg-brand-600" />
                  <span className="capitalize">{field}</span>
                </li>
              ))}
            </ul>
            <dl className="grid grid-cols-2 gap-2 text-xs">
              {(
                [
                  ['Required skills', DEFAULT_WEIGHTS.required],
                  ['Preferred skills', DEFAULT_WEIGHTS.preferred],
                  ['Evidence and assessment', DEFAULT_WEIGHTS.evidence],
                  ['Preferences and constraints', DEFAULT_WEIGHTS.preferences],
                ] as const
              ).map(([name, weight]) => (
                <div key={name} className="rounded-lg border border-border/70 px-3 py-2">
                  <dt className="text-muted-foreground">{name}</dt>
                  <dd className="mt-0.5 text-sm font-semibold tabular-nums">{Math.round(weight * 100)}%</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">What it cannot read</CardTitle>
            <CardDescription>
              These fields are absent from the scorer’s input, which is why a gap in a timeline cannot lower a score
              directly.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5 text-sm leading-relaxed">
              {MATCH_EXCLUDED_FIELDS.map((field) => (
                <li key={field} className="flex gap-2">
                  <span aria-hidden className="mt-1 size-1.5 shrink-0 rounded-full bg-rose-500" />
                  <span className="capitalize">{field}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              Excluding a field from scoring limits what the number can encode. It does not control what a hiring team
              does with a profile once they open it.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Identity disclosure</CardTitle>
          <CardDescription>{disclosure.note}</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-border bg-muted/30 px-3.5 py-3">
              <dt className="text-xs tracking-wide text-muted-foreground uppercase">Anonymised profile reads</dt>
              <dd className="mt-1 text-xl font-semibold tabular-nums">{disclosure.totalViews}</dd>
            </div>
            <div className="rounded-lg border border-border bg-muted/30 px-3.5 py-3">
              <dt className="text-xs tracking-wide text-muted-foreground uppercase">Reads with identity revealed</dt>
              <dd className="mt-1 text-xl font-semibold tabular-nums">{disclosure.identityRevealedViews}</dd>
            </div>
            <div className="rounded-lg border border-border bg-muted/30 px-3.5 py-3">
              <dt className="text-xs tracking-wide text-muted-foreground uppercase">Reveal rate</dt>
              <dd className="mt-1 text-xl font-semibold tabular-nums">
                {disclosure.rate == null ? 'No reads yet' : `${Math.round(disclosure.rate * 100)}%`}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>
    </div>
  )
}
