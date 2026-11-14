import Link from 'next/link'
import { Briefcase, CalendarClock, Inbox, ShieldCheck, Users } from 'lucide-react'
import { requirePermission } from '@/lib/authz'
import { getOrganization } from '@/server/accounts'
import { listOrgJobs } from '@/server/jobs'
import { organizationApplications } from '@/server/applications'
import { DemoBadge, EmptyState, ErrorState, FieldRow, InfoNote, PageHeader, StatCard, StatusBadge, SummaryCard } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { JOB_STATUSES, APPLICATION_STATUSES, label as enumLabel } from '@/lib/options'
import { formatDate, relativeTime } from '@/lib/utils'
import { isDemonstrationName, profileViewCount, readParam, recentProfileViews, shortlistCounts, shortlistedProfileIds, stageHistory } from './_data/queries'
import { CategoryBarChart } from '@/components/admin/charts'
import { JobLifecycleActions } from '@/components/employer/job-lifecycle-actions'

export const metadata = { title: 'Hiring overview' }

const OPEN_STAGES = new Set(['SUBMITTED', 'IN_REVIEW', 'SHORTLISTED', 'INTERVIEW_INVITED', 'INTERVIEW_COMPLETED', 'OFFER_EXTENDED'])

export default async function EmployerOverviewPage(props: { searchParams: Promise<{ job?: string }> }) {
  const principal = await requirePermission('employer.job.read')
  const params = await props.searchParams
  if (!principal.organizationId) {
    return (
      <div className="space-y-6">
        <PageHeader title="Hiring overview" description="Roles, candidates and pipeline for your organisation." />
        <ErrorState
          title="No organisation is attached to this account"
          description="Employer screens read data through the organisation on your account. Ask an administrator to attach this account to an organisation."
        />
      </div>
    )
  }
  const organizationId = principal.organizationId

  const [organization, jobs, allApplications, views, shortlisted, viewCount] = await Promise.all([
    getOrganization(principal),
    listOrgJobs(principal),
    organizationApplications(principal),
    recentProfileViews(organizationId, 8),
    shortlistedProfileIds(organizationId),
    profileViewCount(organizationId),
  ])

  /** A role filter narrows the pipeline view; it never widens what is readable. */
  const selectedJob = readParam(params.job)
  const jobFilter = jobs.find((job) => job.id === selectedJob)?.id ?? null
  const jobFilterTitle = jobFilter ? (jobs.find((job) => job.id === jobFilter)?.title ?? null) : null
  const applications = jobFilter ? allApplications.filter((row) => row.jobId === jobFilter) : allApplications
  const history = await stageHistory(organizationId, jobFilter, 30)
  const shortlistByJob = await shortlistCounts(organizationId, jobFilter)

  const verified = organization.verificationStatus === 'VERIFIED'
  const jobTitleById = new Map(jobs.map((job) => [job.id, job.title]))
  const filterTargets = jobs
    .filter((job) => allApplications.some((row) => row.jobId === job.id))
    .map((job) => ({ id: job.id, title: job.title }))

  const roleCountByStatus = JOB_STATUSES.map((status) => ({
    status,
    count: jobs.filter((job) => job.status === status).length,
  })).filter((row) => row.count > 0)

  const stageCountByStatus = APPLICATION_STATUSES.map((status) => ({
    status,
    count: applications.filter((application) => application.status === status).length,
  }))

  const drafts = jobs.filter((job) => job.status === 'DRAFT' || job.status === 'REJECTED')
  const awaitingModeration = jobs.filter((job) => job.status === 'PENDING_MODERATION')
  const published = jobs.filter((job) => job.status === 'PUBLISHED')
  const openApplications = applications.filter((application) => OPEN_STAGES.has(application.status))
  const needsProfileDetail = !organization.description || !organization.flexPolicy

  const nextActions: { label: string; href: string; hint: string }[] = []
  if (!verified) {
    nextActions.push({
      label: 'Prepare a draft role',
      href: '/employer/jobs/new',
      hint: 'Drafting works while verification is pending — drafts stay inside your organisation.',
    })
  }
  if (drafts.length > 0 && verified) {
    nextActions.push({
      label: `Submit ${drafts.length} draft role${drafts.length === 1 ? '' : 's'} for moderation`,
      href: '/employer/jobs?status=DRAFT',
      hint: 'Nothing reaches candidates until an administrator publishes the role.',
    })
  }
  if (awaitingModeration.length > 0) {
    nextActions.push({
      label: `${awaitingModeration.length} role${awaitingModeration.length === 1 ? '' : 's'} awaiting moderation`,
      href: '/employer/jobs?status=PENDING_MODERATION',
      hint: 'You will be notified as soon as a decision is recorded.',
    })
  }
  const waitingForReview = applications.filter(
    (application) => application.status === 'SUBMITTED' || application.status === 'IN_REVIEW',
  )
  if (waitingForReview.length > 0) {
    nextActions.push({
      label: `Move ${waitingForReview.length} application${waitingForReview.length === 1 ? '' : 's'} forward`,
      href: '/employer/applications',
      hint: 'Interview invitations need a date and time before they can be sent.',
    })
  }
  if (published.length > 0) {
    nextActions.push({
      label: 'Review anonymised candidates',
      href: '/employer/candidates',
      hint: 'Capability profiles, with names, employers and dates withheld.',
    })
  }
  if (shortlisted.size > 0) {
    nextActions.push({
      label: `Work your shortlist (${shortlisted.size} candidate${shortlisted.size === 1 ? '' : 's'})`,
      href: '/employer/shortlist',
      hint: 'Notes stay private to your organisation.',
    })
  }
  if (needsProfileDetail) {
    nextActions.push({
      label: 'Complete the organisation profile',
      href: '/employer/profile',
      hint: 'Flexibility policy and returnship note are the fields returning candidates read first.',
    })
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={principal.organizationName ?? 'Employer portal'}
        title="Hiring overview"
        description="Roles, anonymised candidate views and pipeline movement for your organisation. Match scores come from a weighted rules model, not an AI assessment."
        actions={
          <Button nativeButton={false} render={<Link href="/employer/jobs/new" />} className="bg-brand-600 hover:bg-brand-700">
            <Briefcase className="size-4" aria-hidden />
            Draft a role
          </Button>
        }
      />

      {!verified ? (
        <InfoNote tone="warning" title={`${organization.name} is ${enumLabel(organization.verificationStatus)} for verification`}>
          Roles cannot reach candidates until an administrator verifies this organisation. You can still create and edit
          drafts, and review nothing of candidates yet, because no role of yours is published. An administrator decides
          the verification status — this screen cannot change it.
        </InfoNote>
      ) : (
        <InfoNote tone="success" title="Organisation verified">
          Published roles are visible to candidates who match them. Verification was recorded on{' '}
          {formatDate(organization.verifiedAt)}.
        </InfoNote>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Roles" value={jobs.length} hint={`${published.length} published`} icon={Briefcase} />
        <StatCard
          label="Awaiting moderation"
          value={awaitingModeration.length}
          hint="Administrator queue"
          tone="warning"
          icon={ShieldCheck}
        />
        <StatCard
          label="Open applications"
          value={openApplications.length}
          hint={`${applications.length} in total`}
          icon={Inbox}
        />
        <StatCard
          label="Anonymised profile views"
          value={viewCount}
          hint={`Showing the ${views.length} most recent`}
          tone="neutral"
          icon={Users}
        />
      </div>

      {filterTargets.length > 1 ? (
        <nav className="flex flex-wrap items-center gap-1.5" aria-label="Filter the pipeline by role">
          <span className="mr-1 text-xs text-muted-foreground">Pipeline for</span>
          <Button variant={jobFilter === null ? 'default' : 'outline'} size="xs" nativeButton={false} render={<Link href="/employer" />}>
            All roles
            <span className="ml-1.5 tabular-nums opacity-80">{allApplications.length}</span>
          </Button>
          {filterTargets.map((job) => (
            <Button
              key={job.id}
              variant={jobFilter === job.id ? 'default' : 'outline'}
              size="xs"
              aria-pressed={jobFilter === job.id}
              nativeButton={false}
              render={<Link href={`/employer?job=${job.id}`} />}
            >
              {job.title}
              <span className="ml-1.5 tabular-nums opacity-80">
                {allApplications.filter((row) => row.jobId === job.id).length}
              </span>
            </Button>
          ))}
          {jobFilterTitle ? (
            <span className="text-[11px] text-muted-foreground">
              showing {applications.length} application{applications.length === 1 ? '' : 's'} on {jobFilterTitle}
            </span>
          ) : null}
        </nav>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <SummaryCard title="Roles by status" description="Every role belongs to your organisation only. Not affected by the pipeline filter above.">
          {roleCountByStatus.length === 0 ? (
            <EmptyState
              title="No roles yet"
              description="Draft a role to begin. A draft is private to your organisation until moderation."
              action={
                <Button nativeButton={false} render={<Link href="/employer/jobs/new" />} className="bg-brand-600 hover:bg-brand-700">
                  Draft a role
                </Button>
              }
            />
          ) : (
            <>
              <CategoryBarChart
                data={roleCountByStatus.map((row) => ({ label: enumLabel(row.status), count: row.count }))}
                label="Roles by status"
                description="Bars are the same figures as the list below."
              />
              <dl className="mt-2 divide-y divide-border/60">
                {roleCountByStatus.map((row) => (
                  <FieldRow key={row.status} label={enumLabel(row.status)}>
                    <span className="flex items-center gap-2">
                      <StatusBadge value={row.status} />
                      <span className="font-medium tabular-nums">{row.count}</span>
                    </span>
                  </FieldRow>
                ))}
                <FieldRow label="Total roles">
                  <span className="font-medium tabular-nums">{jobs.length}</span>
                </FieldRow>
              </dl>
            </>
          )}
        </SummaryCard>

        <SummaryCard
          title="Applications by stage"
          description="Where each application stands right now. A stage is a current state, so one application is counted once."
        >
          {applications.length === 0 ? (
            <EmptyState
              title="No applications yet"
              description="Applications arrive once a role is published and a candidate chooses to apply with explicit identity consent, or approves a disclosure request."
            />
          ) : (
            <>
              <CategoryBarChart
                data={stageCountByStatus
                  .filter((row) => row.count > 0)
                  .map((row) => ({ label: enumLabel(row.status), count: row.count }))}
                label="Applications by stage"
                description="Bars are the same figures as the list below, in the same order."
              />
              <dl className="mt-2 divide-y divide-border/60">
                {stageCountByStatus
                  .filter((row) => row.count > 0)
                  .map((row) => (
                    <FieldRow key={row.status} label={enumLabel(row.status)}>
                      <span className="flex items-center gap-2">
                        <StatusBadge value={row.status} />
                        <span className="font-medium tabular-nums">{row.count}</span>
                      </span>
                    </FieldRow>
                  ))}
              </dl>
              <p className="mt-2 text-[11px] text-muted-foreground tabular-nums">
                {stageCountByStatus.reduce((total, row) => total + row.count, 0)} counted from{' '}
                {applications.length} application{applications.length === 1 ? '' : 's'} on this view — the two agree
                because each application holds one stage.
              </p>
            </>
          )}
        </SummaryCard>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Stage history against current stage</CardTitle>
          <CardDescription>
            Status events are the record of movement. “Ever reached” counts distinct applications that passed a stage at
            any time; “moved in 30 days” counts the events recorded since {formatDate(history.windowStart)}. Neither is a
            conversion rate — a rate needs a denominator this platform does not have, because a candidate can withdraw,
            a role can close, and an application can stall without any event being written.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {history.firstEventAt === null ? (
            <p className="rounded-lg border border-dashed border-border bg-muted/30 px-3 py-4 text-sm text-muted-foreground">
              No status event has been recorded on this {jobFilterTitle ? 'role' : 'organisation'} yet, so there is no
              progression to chart. The stage counts above are the whole of what is known.
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <caption className="sr-only">
                    For each stage: how many applications have ever reached it, and how many moves into it were recorded
                    in the last 30 days.
                  </caption>
                  <thead className="bg-muted/50 text-[11px] uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th scope="col" className="px-2 py-1.5 font-medium">Stage</th>
                      <th scope="col" className="px-2 py-1.5 text-right font-medium">Ever reached</th>
                      <th scope="col" className="px-2 py-1.5 text-right font-medium">Moved in 30 days</th>
                    </tr>
                  </thead>
                  <tbody>
                    {APPLICATION_STATUSES.map((status) => {
                      const ever = history.everReached.find((row) => row.status === status)?.applications ?? 0
                      const moved = history.movedByStage.find((row) => row.status === status)?.count ?? 0
                      return (
                        <tr key={status} className="border-t border-border/60">
                          <th scope="row" className="px-2 py-1.5 text-left font-medium">
                            {enumLabel(status)}
                          </th>
                          <td className="px-2 py-1.5 text-right tabular-nums">{ever}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{moved}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-col gap-2">
                <CategoryBarChart
                  data={history.everReached.map((row) => ({ label: enumLabel(row.status), count: row.applications }))}
                  label="Applications that have ever reached a stage"
                  color="var(--color-teal-600, oklch(0.6 0.12 195))"
                  description="Each bar counts distinct applications that passed through that stage at some point — the same application is counted at every stage it reached, so the bars do not sum to the number of applications."
                />
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  {history.totalEvents} move{history.totalEvents === 1 ? '' : 's'} recorded in the last 30 days, the
                  first event on file dated {formatDate(history.firstEventAt)}.
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Shortlist coverage</CardTitle>
          <CardDescription>
            {principal.permissions.includes('employer.shortlist.manage')
              ? 'How many candidates each role has shortlisted. Opening a shortlist shows anonymised handles and the notes your organisation wrote — never a name, unless the candidate applied.'
              : 'Your account can see that shortlists exist, but opening them needs the shortlist permission. Ask an administrator if you need it.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {shortlistByJob.size === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing is shortlisted{jobFilterTitle ? ' on this role' : ' yet'}.</p>
          ) : (
            <ul className="divide-y divide-border/60">
              {[...shortlistByJob.entries()].map(([jobId, bucket]) => (
                <li key={jobId} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <span className="min-w-0">
                    <span className="font-medium">{jobTitleById.get(jobId) ?? 'A role you no longer list'}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {bucket.entries} shortlisted candidate{bucket.entries === 1 ? '' : 's'} across{' '}
                      {bucket.lists.size} list{bucket.lists.size === 1 ? '' : 's'}
                    </span>
                  </span>
                  {principal.permissions.includes('employer.shortlist.manage') ? (
                    <Button variant="outline" size="xs" nativeButton={false} render={<Link href={`/employer/shortlist?jobId=${jobId}`} />}>
                      Compare them
                    </Button>
                  ) : (
                    <Badge variant="outline" className="text-[10px]">
                      comparison not permitted for this account
                    </Badge>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            Roles needing attention
            {isDemonstrationName(organization.name) ? <DemoBadge /> : null}
          </CardTitle>
          <CardDescription>
            Drafts and rejected roles, with the lifecycle action the state machine allows. {awaitingModeration.length}{' '}
            role{awaitingModeration.length === 1 ? ' is' : 's are'} currently in the administrator moderation queue —
            they stay hidden from candidates until a decision is recorded.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {drafts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No drafts or rejected roles right now.</p>
          ) : (
            drafts.slice(0, 5).map((job) => (
              <div key={job.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/70 p-3">
                <div className="min-w-0">
                  <Link href={`/employer/jobs/${job.id}`} className="text-sm font-medium hover:underline">
                    {job.title}
                  </Link>
                  <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <StatusBadge value={job.status} />
                    {job.skills.length} skill row{job.skills.length === 1 ? '' : 's'} · updated {relativeTime(job.updatedAt)}
                  </p>
                </div>
                <JobLifecycleActions
                  jobId={job.id}
                  status={job.status}
                  title={job.title}
                  verificationStatus={organization.verificationStatus}
                  dense
                />
              </div>
            ))
          )}
          <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/employer/jobs" />}>
            All roles
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent anonymised profile views</CardTitle>
            <CardDescription>
              Your team opened these capability profiles while browsing matched candidates. Views are recorded against
              the anonymous handle; a name appears only when the candidate applies.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {views.length === 0 ? (
              <p className="text-sm text-muted-foreground">No profile views recorded yet.</p>
            ) : (
              <ul className="divide-y divide-border/60">
                {views.map((view) => (
                  <li key={view.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                    <span className="min-w-0">
                      <span className="font-mono text-xs font-semibold">{view.anonymousHandle}</span>
                      <span className="mt-0.5 block text-xs leading-snug break-words text-muted-foreground [overflow-wrap:anywhere]">
                        {view.headline ?? 'No headline shared'}
                        {view.jobId
                          ? jobTitleById.get(view.jobId)
                            ? ` · ${jobTitleById.get(view.jobId)}`
                            : ' · on a role you no longer list'
                          : ' · not tied to a role'}
                      </span>
                    </span>
                    <span className="flex items-center gap-2 text-xs text-muted-foreground">
                      {view.scoreSeen != null ? `${Math.round(view.scoreSeen * 100)}% rules score` : null}
                      {view.revealedIdentity ? <StatusBadge value="VERIFIED" label="Identity disclosed" /> : null}
                      {relativeTime(view.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarClock className="size-4" aria-hidden />
              Next actions
            </CardTitle>
            <CardDescription>Derived from the real state of your roles and pipeline.</CardDescription>
          </CardHeader>
          <CardContent>
            {nextActions.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing is blocked. Published roles are live and no application is waiting on you.
              </p>
            ) : (
              <ul className="space-y-2.5">
                {nextActions.map((action) => (
                  <li key={action.href}>
                    <Link
                      href={action.href}
                      className="block rounded-lg border border-border/70 px-3 py-2.5 transition-colors hover:border-brand-200 hover:bg-brand-50/40 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      <span className="text-sm font-medium">{action.label}</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">{action.hint}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
