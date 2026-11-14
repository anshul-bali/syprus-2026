import Link from 'next/link'
import type { JobStatus } from '@/lib/options'
import { requirePermission } from '@/lib/authz'
import { listOrgJobs } from '@/server/jobs'
import { EmptyState, InfoNote, PageHeader, StatusBadge } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { JOB_STATUSES, label as enumLabel } from '@/lib/options'
import { relativeTime } from '@/lib/utils'
import { QueryPicker } from '@/components/employer/filters'
import { JobLifecycleActions } from '@/components/employer/job-lifecycle-actions'
import { isDemonstrationName, readParam } from '../_data/queries'

export const metadata = { title: 'Roles' }

const STATUS_OPTIONS = [
  { value: 'ALL', label: 'All statuses' },
  ...JOB_STATUSES.map((status) => ({ value: status, label: enumLabel(status) })),
]

export default async function EmployerJobsPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const principal = await requirePermission('employer.job.read')
  const params = await props.searchParams
  const rawStatus = readParam(params.status)
  const filterStatus = JOB_STATUSES.includes(rawStatus as JobStatus) ? (rawStatus as JobStatus) : undefined

  const jobs = await listOrgJobs(principal, filterStatus ? { status: filterStatus } : {})

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={principal.organizationName ?? 'Employer portal'}
        title="Roles"
        description="Every role owned by your organisation, with the lifecycle actions the state machine allows. Lifecycle changes are checked again on the server."
        actions={
          <Button nativeButton={false} render={<Link href="/employer/jobs/new" />} className="bg-brand-600 hover:bg-brand-700">
            Draft a role
          </Button>
        }
      />

      {isDemonstrationName(principal.organizationName) ? (
        <InfoNote tone="info" title="Demonstration organisation">
          This account belongs to a seeded demonstration organisation, so the roles below are sample records, not live
          openings.
        </InfoNote>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-[minmax(0,20rem)_auto] sm:items-end">
        <QueryPicker
          id="job-status"
          label="Filter by status"
          param="status"
          value={filterStatus ?? 'ALL'}
          options={STATUS_OPTIONS}
          basePath="/employer/jobs"
          submitLabel="Filter"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {jobs.length} role{jobs.length === 1 ? '' : 's'}
            {filterStatus ? ` in ${enumLabel(filterStatus)}` : ''}
          </CardTitle>
          <CardDescription>
            Required skills are the weighted rows the matching model reads. Matches count the anonymised profiles the
            rules engine scored against this role; applications count only candidates who chose to apply.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {jobs.length === 0 ? (
            <EmptyState
              title={filterStatus ? `No roles are ${enumLabel(filterStatus).toLowerCase()}` : 'No roles yet'}
              image={filterStatus ? undefined : 'employer-role-blueprint'}
              description={
                filterStatus
                  ? 'Clear the filter to see the rest of your roles.'
                  : 'Draft your first role. It stays private to your organisation until an administrator verifies the organisation and publishes the role.'
              }
              action={
                <Button nativeButton={false} render={<Link href="/employer/jobs/new" />} className="bg-brand-600 hover:bg-brand-700">
                  Draft a role
                </Button>
              }
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Role</TableHead>
                  <TableHead scope="col">Required skills</TableHead>
                  <TableHead scope="col">Applications</TableHead>
                  <TableHead scope="col">Scored matches</TableHead>
                  <TableHead scope="col">Updated</TableHead>
                  <TableHead scope="col">Lifecycle</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.map((job) => {
                  const requiredCount = job.skills.filter((row) => row.requirement === 'REQUIRED').length
                  return (
                    <TableRow key={job.id}>
                      <TableCell className="max-w-[22rem]">
                        <Link href={`/employer/jobs/${job.id}`} className="font-medium hover:underline">
                          {job.title}
                        </Link>
                        <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <StatusBadge value={job.status} />
                          {enumLabel(job.workMode)} · {enumLabel(job.employmentType)}
                          {job.locationCity ? ` · ${job.locationCity}` : ''}
                        </span>
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {requiredCount} required
                        <span className="block text-xs text-muted-foreground">
                          {job.skills.length - requiredCount} preferred
                        </span>
                      </TableCell>
                      <TableCell className="tabular-nums">{job._count.applications}</TableCell>
                      <TableCell className="tabular-nums">{job._count.matches}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {relativeTime(job.updatedAt)}
                      </TableCell>
                      <TableCell>
                        <JobLifecycleActions
                          jobId={job.id}
                          status={job.status}
                          title={job.title}
                          verificationStatus={principal.organizationVerification ?? 'PENDING'}
                          dense
                        />
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
