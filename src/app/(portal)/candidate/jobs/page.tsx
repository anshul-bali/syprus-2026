import Link from 'next/link'
import { RefreshCw } from 'lucide-react'
import { requirePermission } from '@/lib/authz'
import { label } from '@/lib/options'
import { recommendedJobs } from '@/server/matching'
import { publishedJobs } from '@/server/jobs'
import { ownProfileWhere } from '@/server/candidate'
import { prisma } from '@/lib/db'
import { readExplanation, STALE_EXPLANATION_NOTE } from '@/lib/match-view'
import { JobActions } from '@/components/candidate/job-actions'
import { ActionSubmit } from '@/components/candidate/action-submit'
import { refreshMatchesAction } from '@/server/actions/candidate'
import { DemoBadge, EmptyState, InfoNote, PageHeader, ScoreBar, StatusBadge } from '@/components/common'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

export const metadata = { title: 'Recommended roles' }

export default async function CandidateJobsPage(props: {
  searchParams?: Promise<{ q?: string; min?: string }>
}) {
  const principal = await requirePermission('candidate.match.read')
  const params = await props.searchParams
  const search = typeof params?.q === 'string' ? params.q.trim().slice(0, 120) || undefined : undefined
  const minimum = Number(params?.min)
  const minScore = Number.isFinite(minimum) && minimum > 0 ? Math.min(1, minimum / 100) : undefined

  if (!principal.candidateProfileId) {
    return (
      <div className="space-y-6">
        <PageHeader eyebrow="Roles" title="Recommended roles" description="No candidate profile is attached to this account yet." />
        <EmptyState
          title="Onboarding comes first"
          description="Recommendations compare your skills against published role requirements."
          action={
            <Button className="bg-brand-600 hover:bg-brand-700" nativeButton={false} render={<Link href="/candidate/onboarding" />}>
              Start onboarding
            </Button>
          }
        />
      </div>
    )
  }

  const profile = await prisma.candidateProfile.findFirst({
    where: ownProfileWhere(principal),
    select: { sharingMode: true, visibleToEmployers: true, targetRole: true, yearsOfExperience: true },
  })

  const [matches, everything] = await Promise.all([
    recommendedJobs(principal, { limit: 24, minScore, search }),
    publishedJobs({ search, take: 40 }),
  ])

  const matchedJobIds = new Set(matches.map((entry) => entry.job.id))
  const unmatched = everything.filter((job) => !matchedJobIds.has(job.id))

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Roles"
        title="Recommended roles"
        description="Ordered by the weighted rule model’s stored score. A score is a coverage measure between your inventory and their list of skills — it is not a prediction that you will be shortlisted."
        actions={
          <>
            <Button variant="outline" nativeButton={false} render={<Link href="/candidate/gap-report" />}>
              Skill gaps
            </Button>
            <ActionSubmit
              action={refreshMatchesAction}
              label="Recompute my matches"
              pendingLabel="Recomputing…"
              variant="outline"
              size="sm"
              showStatus={false}
            />
          </>
        }
      />

      <div className="flex flex-wrap items-end gap-3">
        <form className="flex flex-wrap items-end gap-2" action="/candidate/jobs">
          <div className="flex flex-col gap-1">
            <label htmlFor="q" className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Search published roles
            </label>
            <Input id="q" name="q" defaultValue={search ?? ''} placeholder="title, team or city" className="w-56" />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="min" className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Minimum match %
            </label>
            <Input id="min" name="min" type="number" min={0} max={100} step={5} defaultValue={params?.min ?? ''} className="w-28" />
          </div>
          <Button type="submit" variant="outline" size="sm">
            Apply filters
          </Button>
          {search || params?.min ? (
            <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/candidate/jobs" />}>
              Clear
            </Button>
          ) : null}
        </form>
        <p className="text-xs text-muted-foreground">
          {matches.length} scored role(s){unmatched.length > 0 ? ` · ${unmatched.length} published without a stored score yet` : ''}
        </p>
      </div>

      {profile && !profile.visibleToEmployers ? (
        <InfoNote tone="privacy" title="You are currently hidden from employers">
          Your sharing mode is {label(profile.sharingMode).toLowerCase()} and “visible to employers” is off, so no
          organisation can read your profile even at these scores. Change that on the privacy screen.
          <span className="ml-1">
            <Link href="/candidate/profile" className="underline underline-offset-2">
              Profile and privacy
            </Link>
          </span>
        </InfoNote>
      ) : null}

      {matches.length === 0 ? (
        <EmptyState
          title={search || params?.min ? 'Nothing survives those filters' : 'No stored match scores for this profile'}
          description={
            search || params?.min
              ? 'Widen the search or lower the minimum match — the underlying roles may exist without a score above that line.'
              : 'Matches are computed against published roles whenever your skills change. If you have skills and roles exist, recomputing fills this list.'
          }
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <ActionSubmit
                action={refreshMatchesAction}
                label="Recompute matches now"
                pendingLabel="Recomputing…"
                className="bg-brand-600 hover:bg-brand-700"
              />
              <Button variant="outline" nativeButton={false} render={<Link href="/candidate/skills" />}>
                Check the skills behind them
              </Button>
            </div>
          }
        />
      ) : null}

      <div className="flex flex-col gap-4">
        {matches.map((entry) => {
          const explanation = readExplanation(entry.explanation)
          const job = entry.job
          return (
            <Card key={entry.matchId} className={explanation ? undefined : 'border-dashed'}>
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <CardTitle className="text-base">
                      <Link href={`/candidate/jobs/${job.id}`} className="hover:underline">
                        {job.title}
                      </Link>
                    </CardTitle>
                    <CardDescription className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                      {job.organization.name}
                      <StatusBadge value={job.organization.verificationStatus} />
                      {label(job.workMode)} · {label(job.employmentType)}
                      {job.locationCity ? ` · ${job.locationCity}` : ''}
                      {job.salaryMin ? ` · ${salaryLabel(job.salaryMin, job.salaryMax, job.currency)}` : ''}
                      {job.returnshipProgram ? <DemoBadge text="Returnship programme" /> : null}
                    </CardDescription>
                  </div>
                  <div className="w-full shrink-0 sm:w-64">
                    {explanation ? (
                      <ScoreBar
                        score={entry.score}
                        label="Match"
                        breakdown={[
                          { label: 'Required', value: entry.requiredScore },
                          { label: 'Preferred', value: entry.preferredScore },
                          { label: 'Evidence', value: entry.evidenceScore },
                          { label: 'Constraints', value: entry.preferenceScore },
                        ]}
                      />
                    ) : (
                      <p className="text-xs text-muted-foreground">{STALE_EXPLANATION_NOTE}</p>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {explanation ? (
                  <>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <CreditGroup title="Covered required" items={explanation.matched.filter((credit) => credit.requirement === 'REQUIRED')} tone="strong" />
                      <CreditGroup title="Missing required" items={explanation.missingRequired} tone="weak" />
                      <CreditGroup title="Preferred held" items={explanation.matchedPreferred} tone="ok" />
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span>
                        Evidence strength for the skills this role asks for:{' '}
                        <span className="font-medium tabular-nums text-foreground">
                          {Math.round(entry.evidenceScore * 100)}%
                        </span>
                      </span>
                      <span aria-hidden>·</span>
                      <span>
                        {explanation.evidenceSummary.assessed} assessed, {explanation.evidenceSummary.confirmed} confirmed
                        by you, {explanation.evidenceSummary.reported} self-reported
                      </span>
                    </div>

                    <p className="text-xs leading-relaxed">
                      <span className="font-medium">Why this rank:</span> {explanation.summary[0]}{' '}
                      {explanation.summary[1]}
                    </p>

                    {explanation.gaps.length > 0 ? (
                      <p className="text-xs leading-relaxed">
                        <span className="font-medium">Next learning actions:</span> close{' '}
                        {explanation.gaps
                          .slice(0, 2)
                          .map((gap) => `${gap.name} (needs ${label(gap.requiredLevel).toLowerCase()})`)
                          .join(' and ')}
                        .{' '}
                        <Link href="/candidate/pathways" className="underline underline-offset-2">
                          Build the pathway
                        </Link>
                      </p>
                    ) : (
                      <p className="text-xs leading-relaxed">
                        <span className="font-medium">Next learning action:</span> nothing is missing against this role,
                        so deepen evidence instead — an assessment raises the evidence bucket.{' '}
                        <Link href="/candidate/assessments" className="underline underline-offset-2">
                          Assessments
                        </Link>
                      </p>
                    )}

                    <p className="text-xs leading-relaxed text-muted-foreground">
                      <span className="font-medium text-foreground">Eligibility and consent:</span>{' '}
                      {profile?.visibleToEmployers
                        ? `visible to employers as ${label(profile.sharingMode).toLowerCase()}`
                        : 'currently hidden from employers'}{' '}
                      · your sharing mode decides whether applying is even possible, and applying is what discloses your
                      identity to this organisation.
                    </p>
                  </>
                ) : null}

                <div className="flex flex-wrap items-center gap-2">
                  {explanation ? (
                    <JobActions
                      jobId={job.id}
                      jobTitle={job.title}
                      explanation={explanation}
                      application={entry.application ? { id: entry.application.id, status: entry.application.status } : null}
                      detailHref={`/candidate/jobs/${job.id}`}
                    />
                  ) : (
                    <Button variant="outline" size="sm" nativeButton={false} render={<Link href={`/candidate/jobs/${job.id}`} />}>
                      <RefreshCw className="size-3.5" aria-hidden />
                      Open the role
                    </Button>
                  )}
                  <span className="text-[11px] text-muted-foreground">
                    scored {new Date(entry.computedAt).toLocaleDateString()} · weights {explanation?.weightsVersion ?? 'unknown'}
                  </span>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {unmatched.length > 0 ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Other published roles without a stored score</CardTitle>
            <CardDescription className="text-xs">
              These exist but have no match row for you yet — recomputing at the top of this screen scores them.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {unmatched.slice(0, 12).map((job) => (
              <div key={job.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-2 text-sm last:border-0">
                <Link href={`/candidate/jobs/${job.id}`} className="font-medium hover:underline">
                  {job.title}
                </Link>
                <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {job.organization.name}
                  <StatusBadge value={job.organization.verificationStatus} />
                  {label(job.workMode)}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <InfoNote tone="info" title="Ranking is a coverage order">
        Roles are listed highest score first. Nothing in that order comes from a model’s impression of you, from your
        career break, or from how long an employer has been on the platform.
      </InfoNote>
    </div>
  )
}

function salaryLabel(min: number | null, max: number | null, currency: string) {
  if (min == null && max == null) return 'Not published'
  const format = (value: number) => `${currency} ${value.toLocaleString('en-IN')}`
  if (min != null && max != null) return `${format(min)} – ${format(max)}`
  return min != null ? `From ${format(min)}` : `Up to ${format(max as number)}`
}

function CreditGroup({
  title,
  items,
  tone,
}: {
  title: string
  items: { slug: string; name: string; requiredLevel: string; candidateLevel: string | null; credit: number }[]
  tone: 'strong' | 'weak' | 'ok'
}) {
  const classes = {
    strong: 'border-emerald-200 bg-emerald-50/60',
    weak: 'border-rose-200 bg-rose-50/50',
    ok: 'border-brand-200 bg-brand-50/50',
  }[tone]

  return (
    <div className={`rounded-lg border p-2.5 ${classes}`}>
      <p className="text-[11px] font-medium tracking-wide uppercase">{title}</p>
      {items.length === 0 ? (
        <p className="mt-1 text-[11px] text-muted-foreground">None.</p>
      ) : (
        <ul className="mt-1 flex flex-col gap-1">
          {items.slice(0, 4).map((item) => (
            <li key={`${item.slug}-${item.requiredLevel}`} className="text-[11.5px] leading-snug">
              <Badge variant="outline" className="mr-1 align-middle text-[10px]">
                {Math.round(item.credit * 100)}%
              </Badge>
              {item.name}
            </li>
          ))}
          {items.length > 4 ? <li className="text-[11px] text-muted-foreground">+{items.length - 4} more</li> : null}
        </ul>
      )}
    </div>
  )
}
