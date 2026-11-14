import Link from 'next/link'
import { requirePermission } from '@/lib/authz'
import { listOrgJobs } from '@/server/jobs'
import { shortlistForJob } from '@/server/applications'
import {
  nextStagesFor,
  organizationApplicationsForProfiles,
  readParam,
} from '../_data/queries'
import { EmptyState, InfoNote, PageHeader, StatusBadge } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { QueryPicker } from '@/components/employer/filters'
import { ShortlistEntry } from '@/components/employer/shortlist-entry'
import { label as enumLabel } from '@/lib/options'

export const metadata = { title: 'Shortlist' }

export default async function EmployerShortlistPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const principal = await requirePermission('employer.shortlist.manage')
  const searchParams = await props.searchParams
  const requestedJobId = readParam(searchParams.jobId)

  const jobs = await listOrgJobs(principal)
  // Scoped to this organisation, so a foreign role reference simply does not match.
  const selected = jobs.find((job) => job.id === requestedJobId) ?? jobs[0] ?? null

  const entries = selected ? await shortlistForJob(principal, selected.id) : []
  const applications =
    selected && principal.organizationId
      ? await organizationApplicationsForProfiles(
          principal.organizationId,
          entries.map((entry) => entry.candidateProfileId),
        )
      : []

  const applicationForRole = new Map(
    applications.filter((application) => application.jobId === selected?.id).map((application) => [application.candidateProfileId, application]),
  )
  const appliedAnywhere = new Set(applications.map((application) => application.candidateProfileId))

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={principal.organizationName ?? 'Employer portal'}
        title="Shortlist"
        description="Candidates you flagged on a role, with the private notes you added and the pipeline move each one allows."
        actions={
          <Button variant="outline" nativeButton={false} render={<Link href="/employer/candidates" />}>
            Browse candidates
          </Button>
        }
      />

      <InfoNote tone="privacy" title="Shortlisting does not reveal anything">
        Adding someone to a shortlist keeps their profile anonymous — it is an internal note in your organisation, not a
        contact. Their name, employers and dates appear to you only if they apply to one of your roles, and the flags
        below tell you whether that has happened.
      </InfoNote>

      {jobs.length === 0 ? (
        <EmptyState
          title="No roles to shortlist against"
          description="Shortlist entries are always tied to one of your roles. Draft a role first."
          action={
            <Button nativeButton={false} render={<Link href="/employer/jobs/new" />} className="bg-brand-600 hover:bg-brand-700">
              Draft a role
            </Button>
          }
        />
      ) : (
        <>
          <QueryPicker
            id="shortlist-job"
            label="Role"
            param="jobId"
            value={selected?.id ?? null}
            options={jobs.map((job) => ({
              value: job.id,
              label: `${job.title} · ${enumLabel(job.status)}`,
            }))}
            basePath="/employer/shortlist"
            submitLabel="Show shortlist"
            placeholder="Choose a role"
          />

          <Card>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                {selected ? selected.title : 'No role selected'}
                {selected ? <StatusBadge value={selected.status} /> : null}
                <span className="text-sm font-normal text-muted-foreground">
                  · {entries.length} shortlisted candidate{entries.length === 1 ? '' : 's'}
                </span>
              </CardTitle>
              <CardDescription>
                {selected
                  ? `Entries were added while reviewing matched candidates for this role. Notes stay inside ${principal.organizationName ?? 'your organisation'}.`
                  : 'Choose a role to see its shortlist.'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {entries.length === 0 ? (
                <EmptyState
                  title="Nothing shortlisted on this role yet"
                  description="Open the matched candidates for this role and use Add to shortlist with a note. Entries appear here with the pipeline move they allow."
                  action={
                    <Button
                      variant="outline"
                      nativeButton={false}
                      render={<Link href={`/employer/jobs/${selected?.id ?? ''}`} />}
                    >
                      Review matched candidates
                    </Button>
                  }
                />
              ) : (
                entries.map((entry) => {
                  const application = applicationForRole.get(entry.candidateProfileId) ?? null
                  return (
                    <ShortlistEntry
                      key={entry.id}
                      jobId={selected!.id}
                      jobTitle={selected!.title}
                      entryId={entry.id}
                      candidateProfileId={entry.candidateProfileId}
                      anonymousHandle={entry.candidateProfile.anonymousHandle}
                      headline={entry.candidateProfile.headline}
                      yearsOfExperience={entry.candidateProfile.yearsOfExperience}
                      note={entry.note}
                      addedAt={entry.createdAt}
                      application={application ? { id: application.id, status: application.status } : null}
                      allowedStages={application ? nextStagesFor(application.status, principal.permissions) : []}
                    />
                  )
                })
              )}
            </CardContent>
          </Card>

          {entries.length > 0 ? (
            <p className="text-xs text-muted-foreground">
              {appliedAnywhere.size} of {entries.length} shortlisted handle
              {appliedAnywhere.size === 1 ? '' : 's'} consented to identity disclosure with your organisation; the rest
              stay anonymous.
            </p>
          ) : null}
        </>
      )}
    </div>
  )
}
