import Link from 'next/link'
import { requirePermission } from '@/lib/authz'
import { organizationApplications } from '@/server/applications'
import { listOrgJobs } from '@/server/jobs'
import {
  APPLICATION_STATUS_OPTIONS,
  nextStagesFor,
  readParam,
  readStatusFilter,
} from '../_data/queries'
import { EmptyState, InfoNote, PageHeader, StatusBadge } from '@/components/common'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ApplicationStatusForm } from '@/components/employer/application-status-form'
import { QueryPicker } from '@/components/employer/filters'
import { APPLICATION_STATUSES, label as enumLabel } from '@/lib/options'
import { formatDate, formatDateTime, relativeTime } from '@/lib/utils'

export const metadata = { title: 'Applications' }

export default async function EmployerApplicationsPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const principal = await requirePermission('employer.application.read')
  const searchParams = await props.searchParams
  const statusFilter = readStatusFilter(searchParams.status)
  const jobFilter = readParam(searchParams.jobId)

  const [applications, jobs] = await Promise.all([
    organizationApplications(principal),
    listOrgJobs(principal),
  ])

  const jobById = new Map(jobs.map((job) => [job.id, job]))
  const stageCounts = APPLICATION_STATUSES.map((status) => ({
    status,
    count: applications.filter((application) => application.status === status).length,
  }))
  const rows = applications.filter((application) => {
    if (statusFilter && application.status !== statusFilter) return false
    if (jobFilter && application.jobId !== jobFilter) return false
    return true
  })

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={principal.organizationName ?? 'Employer portal'}
        title="Applications"
        description="Every application to a role owned by your organisation, with the pipeline moves your permissions allow."
        actions={
          <Button variant="outline" nativeButton={false} render={<Link href="/employer/jobs" />}>
            Your roles
          </Button>
        }
      />

      <InfoNote tone="info" title="Identity is disclosed by the application itself">
        A row appears here only because a candidate chose to apply and consented to identity disclosure, which is one of
        the two routes by which their name reaches
        your organisation under their own consent. The handle stays the reference on screen so your shortlist, matches
        and pipeline all line up. Moves follow the transition table, notify the candidate and write an audit entry.
      </InfoNote>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pipeline stages</CardTitle>
          <CardDescription>{applications.length} application records in total.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {stageCounts.map((row) => (
            <Badge key={row.status} variant={row.status === statusFilter ? 'default' : 'secondary'} className="gap-1.5">
              {enumLabel(row.status)} <span className="tabular-nums">{row.count}</span>
            </Badge>
          ))}
        </CardContent>
      </Card>

      <div className="grid gap-3 lg:grid-cols-2">
        <QueryPicker
          id="application-status"
          label="Filter by stage"
          param="status"
          value={statusFilter ?? 'ALL'}
          options={[{ value: 'ALL', label: 'All stages' }, ...APPLICATION_STATUS_OPTIONS]}
          basePath="/employer/applications"
          otherParams={jobFilter ? { jobId: jobFilter } : {}}
          submitLabel="Filter"
        />
        <QueryPicker
          id="application-job"
          label="Filter by role"
          param="jobId"
          value={jobFilter ?? 'ALL'}
          options={[
            { value: 'ALL', label: 'All roles' },
            ...jobs.map((job) => ({ value: job.id, label: `${job.title} · ${enumLabel(job.status)}` })),
          ]}
          basePath="/employer/applications"
          otherParams={statusFilter ? { status: statusFilter } : {}}
          submitLabel="Filter"
        />
      </div>

      {applications.length === 0 ? (
        <EmptyState
          title="No applications yet"
          description="Applications arrive when a candidate applies to one of your published roles. Nothing here can be triggered by you."
          action={
            <Button nativeButton={false} render={<Link href="/employer/jobs/new" />} className="bg-brand-600 hover:bg-brand-700">
              Draft a role
            </Button>
          }
        />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No application matches this filter"
          description="Clear the stage or role filter to see the rest of the pipeline."
          action={
            <Button variant="outline" nativeButton={false} render={<Link href="/employer/applications" />}>
              Clear filters
            </Button>
          }
        />
      ) : (
        <div className="space-y-3">
          {rows.map((application) => (
            <Card key={application.id}>
              <CardContent className="space-y-3 pt-5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-semibold">
                        {application.candidateProfile.anonymousHandle}
                      </span>
                      <StatusBadge value={application.status} />
                      {application.interviewScheduledAt ? (
                        <span className="text-xs text-muted-foreground">
                          Interview {formatDateTime(application.interviewScheduledAt)}
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-1 text-sm">
                      {application.candidateProfile.headline ?? 'No headline shared'}
                    </p>
                  </div>
                  <div className="text-right text-xs text-muted-foreground">
                    <Link
                      href={`/employer/jobs/${application.jobId}`}
                      className="font-medium text-foreground hover:underline"
                    >
                      {application.job.title}
                    </Link>
                    <p>Applied {formatDate(application.createdAt)}</p>
                    <p>Updated {relativeTime(application.updatedAt)}</p>
                    <p>
                      Role status:{' '}
                      {jobById.get(application.jobId)
                        ? enumLabel(jobById.get(application.jobId)!.status)
                        : 'unknown'}
                    </p>
                  </div>
                </div>

                {application.coverLetter ? (
                  <p className="rounded-md bg-muted/50 px-3 py-2 text-xs leading-relaxed">
                    {application.coverLetter}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">No cover note was included.</p>
                )}

                <ApplicationStatusForm
                  applicationId={application.id}
                  currentStatus={application.status}
                  candidateHandle={application.candidateProfile.anonymousHandle}
                  jobTitle={application.job.title}
                  allowed={nextStagesFor(application.status, principal.permissions)}
                />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
