import Link from 'next/link'
import { requirePermission } from '@/lib/authz'
import { candidateApplications } from '@/server/applications'
import { formatDate, relativeTime } from '@/lib/utils'
import { withdrawApplicationAction } from '@/server/actions/applications'
import { ConfirmAction } from '@/components/candidate/confirm-action'
import { ApplicationTimeline } from '@/components/candidate/application-timeline'
import { EmptyState, InfoNote, PageHeader, StatCard, StatusBadge } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export const metadata = { title: 'Applications' }

const LIVE_STATUSES = new Set(['SUBMITTED', 'IN_REVIEW', 'SHORTLISTED', 'INTERVIEW_INVITED', 'OFFER_EXTENDED'])

export default async function CandidateApplicationsPage() {
  const principal = await requirePermission('candidate.application.read')

  if (!principal.candidateProfileId) {
    return (
      <div className="space-y-6">
        <PageHeader eyebrow="Pipeline" title="Applications" description="No candidate profile is attached to this account yet." />
        <EmptyState
          title="Nothing to track yet"
          description="Applications appear here once you have applied to a published role."
          action={
            <Button className="bg-brand-600 hover:bg-brand-700" nativeButton={false} render={<Link href="/candidate/jobs" />}>
              Browse recommended roles
            </Button>
          }
        />
      </div>
    )
  }

  const applications = await candidateApplications(principal)

  const active = applications.filter((entry) => entry.status !== 'WITHDRAWN' && entry.status !== 'REJECTED')
  const inDepth = applications.filter((entry) =>
    ['SHORTLISTED', 'INTERVIEW_INVITED', 'OFFER_EXTENDED', 'HIRED'].includes(entry.status),
  )
  const withdrawn = applications.filter((entry) => entry.status === 'WITHDRAWN')

  /** Grouped so a closed application cannot look like one still moving. */
  const groups = [
    {
      key: 'Still with a hiring team',
      hint: 'An employer can change these at any time; you see the change, not a prediction of it.',
      items: active.filter((entry) => LIVE_STATUSES.has(entry.status)),
    },
    {
      key: 'Decided',
      hint: 'Closed by the organisation. Kept here because the history is yours too.',
      items: applications.filter((entry) => ['REJECTED', 'HIRED'].includes(entry.status)),
    },
    {
      key: 'Withdrawn by you',
      hint: 'Recorded when you withdrew, with the reason you gave.',
      items: withdrawn,
    },
  ].filter((group) => group.items.length > 0)

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Pipeline"
        title="Applications"
        description="Status changes an employer records, with the time they recorded them. The platform does not chase a hiring team on your behalf and cannot know anything that happened outside it."
        actions={
          <>
            <Button variant="outline" nativeButton={false} render={<Link href="/candidate/jobs" />}>
              Recommended roles
            </Button>
            <Button variant="ghost" nativeButton={false} render={<Link href="/candidate/notifications" />}>
              Notifications
            </Button>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Submitted here" value={applications.length} hint="Including closed and withdrawn" tone="neutral" />
        <StatCard label="Still live" value={active.filter((entry) => LIVE_STATUSES.has(entry.status)).length} hint="Not decided yet" />
        <StatCard label="Shortlisted or further" value={inDepth.length} hint="Employer-recorded stages" tone="positive" />
        <StatCard label="Withdrawn by you" value={withdrawn.length} hint="Kept for reference" tone="neutral" />
      </div>

      {applications.length === 0 ? (
        <EmptyState
          title="No applications yet"
          image="applications-organised"
          description="Applying is the action that tells an organisation who you are, so it is a decision rather than a default. Roles you match are listed with the calculation behind each score."
          action={
            <Button className="bg-brand-600 hover:bg-brand-700" nativeButton={false} render={<Link href="/candidate/jobs" />}>
              See the roles you match
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-6">
          {groups.map((group) => (
            <section key={group.key} className="flex flex-col gap-3">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <h2 className="text-sm font-semibold">{group.key}</h2>
                <span className="text-xs text-muted-foreground tabular-nums">{group.items.length}</span>
                <p className="w-full text-[11px] leading-relaxed text-muted-foreground">{group.hint}</p>
              </div>

              {group.items.map((application) => (
            <Card key={application.id} className={application.status === 'WITHDRAWN' ? 'opacity-80' : undefined}>
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <CardTitle className="text-base">
                      <Link href={`/candidate/jobs/${application.jobId}`} className="hover:underline">
                        {application.job.title}
                      </Link>
                    </CardTitle>
                    <CardDescription className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                      {application.job.organization.name}
                      <StatusBadge value={application.job.organization.verificationStatus} />
                      applied {formatDate(application.createdAt)} · updated {relativeTime(application.updatedAt)}
                    </CardDescription>
                  </div>
                  <div className="flex flex-col items-end gap-1.5">
                    <StatusBadge value={application.status} />
                    {application.matchScoreSnapshot != null ? (
                      <span className="text-xs text-muted-foreground tabular-nums">
                        scored {Math.round(application.matchScoreSnapshot * 100)}% when you applied
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">no score snapshot</span>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <ApplicationTimeline
                  currentStatus={application.status}
                  submittedAt={application.createdAt}
                  interviewScheduledAt={application.interviewScheduledAt}
                  events={application.statusEvents.map((event) => ({
                    id: event.id,
                    fromStatus: event.fromStatus,
                    toStatus: event.toStatus,
                    note: event.note,
                    createdAt: event.createdAt,
                    recordedBy:
                      event.actorUserId == null
                        ? ('the platform' as const)
                        : event.actorUserId === principal.userId
                          ? ('you' as const)
                          : ('the employer or a reviewer' as const),
                  }))}
                />

                {application.coverLetter ? (
                  <details className="text-xs">
                    <summary className="cursor-pointer font-medium">The note you sent</summary>
                    <p className="mt-1.5 whitespace-pre-line leading-relaxed text-muted-foreground">
                      {application.coverLetter}
                    </p>
                  </details>
                ) : null}

                {LIVE_STATUSES.has(application.status) ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <ConfirmAction
                      action={withdrawApplicationAction.bind(null, application.id)}
                      triggerLabel="Withdraw application"
                      title={`Withdraw your application to ${application.job.title}?`}
                      description="The employer sees the withdrawal in their pipeline. Withdrawing does not un-send the identity you disclosed by applying."
                      confirmLabel="Withdraw it"
                      triggerVariant="outline"
                    />
                    <span className="text-[11px] text-muted-foreground">
                      Source: {application.source.toLowerCase()}
                    </span>
                  </div>
                ) : (
                  <p className="text-[11px] text-muted-foreground">
                    This one is closed, so there is nothing left to withdraw.
                  </p>
                )}
              </CardContent>
            </Card>
              ))}
            </section>
          ))}
        </div>
      )}

      <InfoNote tone="privacy" title="What applying disclosed">
        Applying revealed your name and contact details to that organisation and moved your profile out of anonymity
        for them. Separate disclosure requests you approved are listed on the{' '}
        <Link href="/candidate/disclosures" className="underline underline-offset-2">
          disclosure screen
        </Link>
        .
      </InfoNote>
    </div>
  )
}
