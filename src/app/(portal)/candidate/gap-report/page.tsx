import Link from 'next/link'
import { prisma } from '@/lib/db'
import { requirePermission } from '@/lib/authz'
import { parseStoredReport, storedGapReports } from '@/server/gap'
import { publishedJobs } from '@/server/jobs'
import { LEVEL_VALUES } from '@/lib/engines/types'
import { EXPERIENCE_FIT_ASSUMPTION, GAP_READINESS_WEIGHTS } from '@/lib/engines/gap'
import { label } from '@/lib/options'
import { formatDate } from '@/lib/utils'
import { GapTargetForm } from '@/components/candidate/gap-pathway-forms'
import { PathwayChart, type GapLevelDatum } from '@/components/candidate/pathway-chart'
import { ContributionBreakdown } from '@/components/data/contribution-breakdown'
import { EmptyState, InfoNote, PageHeader, ScoreBar, StatusBadge } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

export const metadata = { title: 'Skill gaps' }

export default async function CandidateGapReportPage() {
  const principal = await requirePermission('candidate.gap.read')

  if (!principal.candidateProfileId) {
    return (
      <div className="space-y-6">
        <PageHeader eyebrow="Analysis" title="Skill gaps" description="No candidate profile is attached to this account yet." />
        <EmptyState
          title="Onboarding comes first"
          description="A gap report compares stored skills against stored role requirements."
          action={
            <Button className="bg-brand-600 hover:bg-brand-700" nativeButton={false} render={<Link href="/candidate/onboarding" />}>
              Start onboarding
            </Button>
          }
        />
      </div>
    )
  }

  const [reports, jobs, skillCount] = await Promise.all([
    storedGapReports(principal, 10),
    publishedJobs({ take: 60 }),
    prisma.candidateSkill.count({ where: { candidateProfileId: principal.candidateProfileId } }),
  ])

  const options = [{ value: 'AUTO', label: `Automatic — my closest matched roles (${jobs.length} published roles exist)` }].concat(
    jobs.map((job) => ({ value: job.id, label: `${job.title} — ${job.organization.name}` })),
  )

  const latest = reports[0] ? parseStoredReport(reports[0]) : null

  const chartData: GapLevelDatum[] = latest
    ? latest.gaps.slice(0, 10).map((gap) => ({
        name: gap.name,
        current: gap.currentLevel ? LEVEL_VALUES[gap.currentLevel] : 0,
        target: LEVEL_VALUES[gap.targetLevel],
        currentLevel: gap.currentLevel,
        targetLevel: gap.targetLevel,
        severity: gap.severity,
        requirement: gap.requirement,
        weight: gap.weight,
        gapPoints: gap.gapPoints,
      }))
    : []

  /** Readiness arithmetic, straight from the stored components and the engine's weights. */
  const readinessRows = latest
    ? [
        {
          key: 'coverage',
          label: 'Required + preferred coverage',
          value: latest.scores.coverage,
          weight: latest.scores.weights?.coverage ?? GAP_READINESS_WEIGHTS.coverage,
          contribution: latest.scores.coverage * (latest.scores.weights?.coverage ?? GAP_READINESS_WEIGHTS.coverage) * 100,
          note: 'Weighted share of the target’s skills you already hold at the level it asks for.',
        },
        {
          key: 'evidence',
          label: 'Evidence quality',
          value: latest.scores.evidenceQuality,
          weight: latest.scores.weights?.evidenceQuality ?? GAP_READINESS_WEIGHTS.evidenceQuality,
          contribution:
            latest.scores.evidenceQuality * (latest.scores.weights?.evidenceQuality ?? GAP_READINESS_WEIGHTS.evidenceQuality) * 100,
          note: 'Mean confidence and evidence count across every skill on your inventory.',
        },
        {
          key: 'experience',
          label: 'Experience fit',
          value: latest.scores.experienceFit,
          weight: latest.scores.weights?.experienceFit ?? GAP_READINESS_WEIGHTS.experienceFit,
          contribution:
            latest.scores.experienceFit * (latest.scores.weights?.experienceFit ?? GAP_READINESS_WEIGHTS.experienceFit) * 100,
          ...(latest.scores.experienceStated === true
            ? {}
            : {
                missing: true,
                note: `This report compares no published experience range, so the engine substituted its neutral ${EXPERIENCE_FIT_ASSUMPTION} placeholder. That is assumed data, not a measurement of you.`,
              }),
        },
      ]
    : []

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Analysis"
        title="Skill gaps"
        description="A distance measure between what your inventory says you hold and what a role says it needs. It is computed from stored levels and weights — it does not judge your potential, and a gap is not a disqualification."
        actions={
          <>
            <Button variant="outline" nativeButton={false} render={<Link href="/candidate/skills" />}>
              Skills inventory
            </Button>
            <Button className="bg-brand-600 hover:bg-brand-700" nativeButton={false} render={<Link href="/candidate/pathways" />}>
              Learning pathways
            </Button>
          </>
        }
      />

      {skillCount === 0 ? (
        <EmptyState
          title="An empty inventory makes every skill look like a gap"
          description="Add the skills you would defend in an interview, or let onboarding propose some from your own wording. The report is only meaningful once it has something to compare."
          action={
            <Button className="bg-brand-600 hover:bg-brand-700" nativeButton={false} render={<Link href="/candidate/skills" />}>
              Add a skill
            </Button>
          }
        />
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        {latest ? (
          <Card className={latest.readiness === 'STRONG_MATCH' ? 'border-emerald-200 bg-emerald-50/40' : undefined}>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <CardTitle className="text-base">
                    {latest.targetJobTitle ?? `Against ${latest.scores.contextLabel ?? 'your matched roles'}`}
                  </CardTitle>
                  <CardDescription className="mt-1 text-xs">
                    Run {formatDate(latest.createdAt)} · readiness band {label(latest.readiness)}
                  </CardDescription>
                </div>
                <StatusBadge value={latest.readiness} />
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <ScoreBar score={latest.readinessScore} label="Readiness for this target" />
              <p className="text-xs leading-relaxed text-muted-foreground">{latest.scores.note}</p>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                That percentage is the sum of three weighted components —{' '}
                {Math.round(GAP_READINESS_WEIGHTS.coverage * 100)}% coverage,{' '}
                {Math.round(GAP_READINESS_WEIGHTS.evidenceQuality * 100)}% evidence quality,{' '}
                {Math.round(GAP_READINESS_WEIGHTS.experienceFit * 100)}% experience fit. Each component is scored 0–100
                on its own; only the weighted part lands in the total.
              </p>

              <div>
                <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  Gaps ({latest.gaps.length})
                </p>
                <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                  {latest.gaps.filter((gap) => gap.requirement === 'REQUIRED').length} of these gaps are against skills
                  the target marks <span className="font-medium">required</span>,{' '}
                  {latest.gaps.filter((gap) => gap.requirement === 'PREFERRED').length} against skills it marks{' '}
                  <span className="font-medium">preferred</span>.{' '}
                  {latest.gaps.length === 0
                    ? 'Nothing is missing on the stored comparison — the levels line up.'
                    : `${latest.gaps.filter((gap) => gap.currentLevel === null).length} of them have no level recorded on your profile at all, and those are counted from zero: that is missing data, not a measured low level.`}
                </p>
                {latest.gaps.length === 0 ? (
                  <p className="mt-2 text-sm">
                    Nothing missing against this target. That means the stored levels line up — not that a hiring
                    manager has agreed.
                  </p>
                ) : (
                  <Table className="mt-2">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Skill</TableHead>
                        <TableHead>Needed</TableHead>
                        <TableHead>You hold</TableHead>
                        <TableHead className="text-right">Weight /5</TableHead>
                        <TableHead className="text-right">Gap steps</TableHead>
                        <TableHead>Why it matters</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {latest.gaps.map((gap) => (
                        <TableRow key={`${gap.slug}-${gap.requirement}`}>
                          <TableCell className="align-top">
                            <span className="flex flex-col gap-1">
                              <span className="font-medium">{gap.name}</span>
                              <span className="text-[11px] text-muted-foreground">
                                {label(gap.requirement)} · {label(gap.severity)}
                              </span>
                            </span>
                          </TableCell>
                          <TableCell className="align-top text-xs">{label(gap.targetLevel)}</TableCell>
                          <TableCell className="align-top text-xs">
                            {gap.currentLevel ? (
                              label(gap.currentLevel)
                            ) : (
                              <span className="font-medium text-amber-800">missing</span>
                            )}
                          </TableCell>
                          <TableCell className="align-top text-right text-xs tabular-nums">{gap.weight}/5</TableCell>
                          <TableCell className="align-top text-right text-xs tabular-nums">{gap.gapPoints}</TableCell>
                          <TableCell className="align-top text-xs leading-relaxed text-muted-foreground">{gap.note}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <StrengthList title={`Strengths (${latest.strengths.length})`} items={latest.strengths} />
                <StrengthList title={`Transferable skills (${latest.transferables.length})`} items={latest.transferables} />
              </div>

              {latest.targetJobId ? (
                <Button variant="outline" size="sm" nativeButton={false} render={<Link href={`/candidate/jobs/${latest.targetJobId}`} />}>
                  Read the target role
                </Button>
              ) : null}
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">No gap report on file</CardTitle>
              <CardDescription>
                Pick a role on the right, or leave it automatic and the engine will compare your inventory against the
                union of the skills in the roles you currently match best.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <InfoNote tone="info" title="What it reads and what it ignores">
                The engine reads stored skill levels, requirement weights and evidence counts. It does not read
                career-break length, break reason, age or employer names.
              </InfoNote>
            </CardContent>
          </Card>
        )}

        <GapTargetForm options={options} />
      </div>

      {latest ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">How this readiness number was built</CardTitle>
            <CardDescription className="text-xs">
              The same three stored components, their engine weights and what each one added. A component’s own
              percentage and its contribution to the total are different figures, and both are shown.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ContributionBreakdown
              title="Readiness components"
              rows={readinessRows}
              total={latest.readinessScore * 100}
              totalLabel="Readiness"
            />
          </CardContent>
        </Card>
      ) : null}

      {latest && chartData.length > 0 ? (
        <PathwayChart
          data={chartData}
          contextLabel={latest.targetJobTitle ?? latest.scores.contextLabel ?? 'the selected target'}
          contextKind={latest.targetJobId ? 'role' : 'union'}
        />
      ) : null}

      {reports.length > 1 ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Earlier reports</CardTitle>
            <CardDescription className="text-xs">
              Every run is stored, so a change in readiness is a fact you can point at rather than a feeling.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Run</TableHead>
                  <TableHead>Target</TableHead>
                  <TableHead>Band</TableHead>
                  <TableHead className="text-right">Readiness</TableHead>
                  <TableHead className="text-right">Gaps</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reports.map((report) => (
                  <TableRow key={report.id}>
                    <TableCell className="text-xs">{formatDate(report.createdAt)}</TableCell>
                    <TableCell className="text-xs">{report.targetJob?.title ?? 'Automatic (matched roles)'}</TableCell>
                    <TableCell>
                      <StatusBadge value={report.readiness} />
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">{Math.round(report.readinessScore * 100)}%</TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {((report.gaps ?? []) as unknown[]).length}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      <InfoNote tone="privacy" title="A gap is a distance, not a verdict">
        Gap points come from the difference between the level a role asks for and the level you stated, weighted by how
        the role marked that skill. Nothing here has been assessed by a person, and no employer sees this screen.
      </InfoNote>
    </div>
  )
}

function StrengthList({
  title,
  items,
}: {
  title: string
  items: { slug: string; name: string; level: string; confidence: number; evidenceCount: number; transferable: boolean; source: string }[]
}) {
  return (
    <div className="rounded-lg border border-border/70 bg-muted/25 p-3">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</p>
      {items.length === 0 ? (
        <p className="mt-1.5 text-xs text-muted-foreground">None recorded for this target.</p>
      ) : (
        <ul className="mt-1.5 flex flex-col gap-1.5">
          {items.slice(0, 8).map((item) => (
            <li key={item.slug} className="text-xs leading-relaxed">
              <span className="font-medium">{item.name}</span>{' '}
              <span className="text-muted-foreground">
                — {label(item.level)} · {Math.round(item.confidence * 100)}% confidence · {item.evidenceCount} evidence
                {item.transferable ? ' · transferable' : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
