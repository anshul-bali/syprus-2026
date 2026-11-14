import Link from 'next/link'
import { requirePermission } from '@/lib/authz'
import { listOrgJobs } from '@/server/jobs'
import { candidatesForJob } from '@/server/matching'
import { shortlistedProfileIds, readParam, readScoreFloor } from '../_data/queries'
import type { MatchExplanation } from '@/lib/engines/matching'
import { EmptyState, InfoNote, PageHeader, StatusBadge } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { CandidateMatchCard } from '@/components/employer/candidate-match-card'
import { MatchScoreFilter, QueryPicker } from '@/components/employer/filters'

export const metadata = { title: 'Anonymised candidates' }

export default async function EmployerCandidatesPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const principal = await requirePermission('employer.candidate.anonymous.read')
  const searchParams = await props.searchParams
  const minScore = readScoreFloor(searchParams.minScore)

  const jobs = await listOrgJobs(principal)
  const published = jobs.filter((job) => job.status === 'PUBLISHED')
  const requestedJobId = readParam(searchParams.jobId)

  // A stale or foreign role reference is dropped rather than trusted; the loader
  // below would also refuse it, but the picker should not show a broken choice.
  const selected =
    published.find((job) => job.id === requestedJobId) ?? published[0] ?? null

  const matches = selected
    ? await candidatesForJob(principal, selected.id, { minScore, take: 40 })
    : []
  const shortlisted =
    principal.organizationId && principal.permissions.includes('employer.shortlist.manage')
      ? await shortlistedProfileIds(principal.organizationId)
      : new Set<string>()

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={principal.organizationName ?? 'Employer portal'}
        title="Anonymised candidates"
        description="Capability profiles matched to your published roles by the weighted rules model, published through the anonymisation filter."
        actions={
          <Button variant="outline" nativeButton={false} render={<Link href="/employer/jobs" />}>
            Your roles
          </Button>
        }
      />

      <InfoNote tone="privacy" title="What is withheld, and why">
        Names, contact details, employer names, calendar dates and career-break length are removed by design. You see an
        anonymous handle, the skills on file and duration-based history. A candidate’s identity appears only when they
        apply to one of your roles with explicit consent, or approve your disclosure request for a limited period —
        browsing this list reveals nothing more, and every view you take here is recorded against the handle.
      </InfoNote>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
        <QueryPicker
          id="candidate-job"
          label="Role to review matches for"
          param="jobId"
          value={selected?.id ?? null}
          options={published.map((job) => ({
            value: job.id,
            label: `${job.title} · ${job._count.matches} scored`,
          }))}
          basePath="/employer/candidates"
          otherParams={minScore ? { minScore: String(Math.round(minScore * 100)) } : {}}
          placeholder={published.length ? 'Choose a published role' : 'No published role yet'}
          submitLabel="Show matches"
          helpText={
            published.length
              ? 'Only published roles are scored, because a draft or paused role cannot reach candidates.'
              : undefined
          }
        />
        {selected ? (
          <MatchScoreFilter
            minScore={minScore}
            basePath="/employer/candidates"
            otherParams={{ jobId: selected.id }}
          />
        ) : null}
      </div>

      {published.length === 0 ? (
        <EmptyState
          title="No published role to browse matches for"
          image="candidate-search"
          description="Matches are only scored against published roles. Draft a role, submit it for moderation, and anonymised profiles appear here once it is live."
          action={
            <Button nativeButton={false} render={<Link href="/employer/jobs/new" />} className="bg-brand-600 hover:bg-brand-700">
              Draft a role
            </Button>
          }
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              {selected ? selected.title : 'Choose a role'}
              {selected ? <StatusBadge value={selected.status} /> : null}
              <span className="text-sm font-normal text-muted-foreground">
                · {matches.length} profile{matches.length === 1 ? '' : 's'} visible
                {minScore ? ` above ${Math.round(minScore * 100)}%` : ''}
              </span>
            </CardTitle>
            <CardDescription>
              Ordered by the weighted rules score against the skill rows on the role. A score is an explanation of skill
              coverage, not a verified assessment or a prediction.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {matches.length === 0 ? (
              <EmptyState
                title="No visible matched profile for this score floor"
                description="Either no shared profile clears the threshold, or candidates have not made their profile visible. Lower the floor, or widen the skill rows on the role."
                action={
                  minScore ? (
                    <Button variant="outline" nativeButton={false} render={<Link href="/employer/candidates" />}>
                      Clear the score floor
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <div className="grid gap-4 xl:grid-cols-2">
                {matches.map((match) => (
                  <CandidateMatchCard
                    key={match.matchId}
                    jobId={selected!.id}
                    profile={match.profile}
                    score={match.score}
                    requiredScore={match.requiredScore}
                    preferredScore={match.preferredScore}
                    preferenceScore={match.preferenceScore}
                    evidenceScore={match.evidenceScore}
                    explanation={match.explanation as unknown as MatchExplanation}
                    applied={match.applied}
                    shortlisted={shortlisted.has(match.profile.candidateProfileId)}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
