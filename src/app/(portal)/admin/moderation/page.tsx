import Link from 'next/link'
import { ShieldCheck } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { DemoBadge, EmptyState, InfoNote, PageHeader, StatusBadge } from '@/components/common'
import { ModerationDecisionForm } from '@/components/admin/moderation-decision-form'
import { cn } from '@/lib/utils'
import { can, requirePermission } from '@/lib/authz'
import { moderationQueue } from '@/server/admin'
import { jobStatusBreakdown, listJobsByStatus } from '@/server/admin-jobs'
import { JOB_STATUSES, label as enumLabel } from '@/lib/options'
import { formatDate, relativeTime } from '@/lib/utils'

export const metadata = { title: 'Role moderation' }

const STATUS_VALUES = JOB_STATUSES as readonly string[]

function salaryRange(min: number | null, max: number | null, currency: string) {
  if (min == null && max == null) return 'Not disclosed'
  if (min != null && max != null) return `${currency} ${min.toLocaleString('en-IN')} – ${max.toLocaleString('en-IN')}`
  if (min != null) return `${currency} ${min.toLocaleString('en-IN')} and up`
  return `Up to ${currency} ${(max as number).toLocaleString('en-IN')}`
}

export default async function AdminModerationPage(props: {
  searchParams: Promise<{ tab?: string; status?: string }>
}) {
  const principal = await requirePermission('admin.job.read')
  const params = await props.searchParams

  const canModerate = can(principal, 'admin.job.moderate')
  const queue = await moderationQueue(principal, 'PENDING_MODERATION')

  const statusFilter = STATUS_VALUES.find((value) => value === params.status)
  const activeTab = params.tab === 'all' ? 'all' : 'queue'
  const [statuses, allJobs] = await Promise.all([
    jobStatusBreakdown(principal),
    listJobsByStatus(principal, { status: statusFilter as (typeof JOB_STATUSES)[number] | undefined, take: 60 }),
  ])

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Administrator"
        title="Role moderation"
        description="Moderation is the only route to published. A role can only go live when its organisation is verified and the role defines the skills it will be matched on."
        actions={
          <Badge variant="secondary" className="bg-brand-50 text-brand-800">
            {queue.length} in queue
          </Badge>
        }
      />

      <Tabs defaultValue={activeTab} className="gap-4">
        <TabsList>
          <TabsTrigger value="queue">
            Awaiting moderation{queue.length > 0 ? ` (${queue.length})` : ''}
          </TabsTrigger>
          <TabsTrigger value="all">All roles by status</TabsTrigger>
        </TabsList>

        <TabsContent value="queue" className="space-y-4 pt-1">
          {!canModerate ? (
            <InfoNote tone="warning" title="Read-only access">
              This account holds <code className="text-xs">admin.job.read</code> but not{' '}
              <code className="text-xs">admin.job.moderate</code>, so no decision buttons are shown.
            </InfoNote>
          ) : null}

          {queue.length === 0 ? (
            <EmptyState
              title="The moderation queue is empty"
              description="Every role currently on the platform has already been decided. New submissions from employers arrive here as they are submitted for review."
              icon={ShieldCheck}
            />
          ) : (
            queue.map((job) => {
              const blockedReason =
                job.organization.verificationStatus !== 'VERIFIED'
                  ? `Publishing is blocked: ${job.organization.name} is ${enumLabel(job.organization.verificationStatus).toLowerCase()}. Verify the organisation first, then publish this role.`
                  : job.skills.length === 0
                    ? 'Publishing is blocked: this role defines no skills, so the matching agent has nothing to score. Ask the employer to add required or preferred skills.'
                    : null

              return (
                <Card key={job.id}>
                  <CardHeader>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <CardTitle className="text-base">{job.title}</CardTitle>
                        <CardDescription>
                          {job.organization.name} · {enumLabel(job.employmentType)} · {enumLabel(job.workMode)} ·{' '}
                          {[job.locationCity, job.locationCountry].filter(Boolean).join(', ') || 'Location not stated'}
                        </CardDescription>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge value={job.status} label={enumLabel(job.status)} />
                        <StatusBadge
                          value={job.organization.verificationStatus}
                          label={`Org ${enumLabel(job.organization.verificationStatus)}`}
                        />
                      </div>
                    </div>
                  </CardHeader>

                  <CardContent className="space-y-4">
                    <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
                      <div>
                        <dt className="text-xs tracking-wide text-muted-foreground uppercase">Pay</dt>
                        <dd className="mt-0.5">{salaryRange(job.salaryMin, job.salaryMax, job.currency)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs tracking-wide text-muted-foreground uppercase">Experience range</dt>
                        <dd className="mt-0.5">
                          {job.experienceYearsMin == null && job.experienceYearsMax == null
                            ? 'No years filter set'
                            : `${job.experienceYearsMin ?? 0}–${job.experienceYearsMax ?? '∞'} years`}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs tracking-wide text-muted-foreground uppercase">Submitted</dt>
                        <dd className="mt-0.5">{relativeTime(job.updatedAt)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs tracking-wide text-muted-foreground uppercase">Closes</dt>
                        <dd className="mt-0.5">{job.closesAt ? formatDate(job.closesAt) : 'No closing date'}</dd>
                      </div>
                    </dl>

                    <div className="flex flex-wrap gap-1.5">
                      {job.reEntryFriendly ? <Badge variant="secondary">Re-entry friendly</Badge> : null}
                      {job.flexibleHours ? <Badge variant="secondary">Flexible hours</Badge> : null}
                      {job.returnshipProgram ? <Badge variant="secondary">Returnship programme</Badge> : null}
                      {!job.reEntryFriendly && !job.flexibleHours && !job.returnshipProgram ? (
                        <Badge variant="outline">No flexibility claims made</Badge>
                      ) : null}
                    </div>

                    <div className="grid gap-4 lg:grid-cols-2">
                      <div className="rounded-lg border border-border/70 p-3.5">
                        <p className="text-xs tracking-wide text-muted-foreground uppercase">Role description on file</p>
                        <div className="mt-2 space-y-2 text-sm leading-relaxed">
                          <p className="line-clamp-6">{job.description}</p>
                          {job.responsibilities.length > 0 ? (
                            <ul className="list-disc space-y-1 pl-5 text-sm">
                              {job.responsibilities.map((line) => (
                                <li key={line}>{line}</li>
                              ))}
                            </ul>
                          ) : null}
                          {job.requirementsText ? (
                            <p className="text-sm text-muted-foreground">{job.requirementsText}</p>
                          ) : null}
                        </div>
                      </div>

                      <div className="rounded-lg border border-border/70 p-3.5">
                        <p className="text-xs tracking-wide text-muted-foreground uppercase">
                          Skill set — {job.skills.length} defined
                        </p>
                        {job.skills.length === 0 ? (
                          <p className="mt-2 text-sm text-muted-foreground">
                            This role declares no skills, so it cannot be matched or scored.
                          </p>
                        ) : (
                          <ul className="mt-2 space-y-1.5">
                            {job.skills.map((skill) => (
                              <li key={skill.id} className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                                <span className="font-medium">{skill.skill.name}</span>
                                <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                                  <span>{enumLabel(skill.requirement)}</span>
                                  <span aria-hidden>·</span>
                                  <span>{enumLabel(skill.level)}</span>
                                  <span aria-hidden>·</span>
                                  <span>weight {skill.weight}/5</span>
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                          Required skills carry {Math.round(0.5 * 100)}% of a match score, preferred skills{' '}
                          {Math.round(0.15 * 100)}%. Career-break length is not part of the score.
                        </p>
                      </div>
                    </div>

                    <Separator />

                    {canModerate ? (
                      <div className="grid gap-4 lg:grid-cols-[minmax(0,24rem)_1fr]">
                        <ModerationDecisionForm
                          jobId={job.id}
                          jobTitle={job.title}
                          publishBlockedReason={blockedReason}
                        />
                        <div className="text-xs leading-relaxed text-muted-foreground lg:pt-2">
                          <p>
                            {job._count.applications} application{job._count.applications === 1 ? '' : 's'} already
                            reference this role.
                          </p>
                          <p className="mt-1">
                            On publish, the matching agent recomputes this role against every visible candidate profile
                            and reports how many profiles were matched; the employer is notified with the same figure.
                            Reject and close both send your note to the organisation unchanged.
                          </p>
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        {job._count.applications} application{job._count.applications === 1 ? '' : 's'} reference this
                        role.
                      </p>
                    )}
                  </CardContent>
                </Card>
              )
            })
          )}
        </TabsContent>

        <TabsContent value="all" className="space-y-4 pt-1">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              nativeButton={false}
              render={<Link href="/admin/moderation?tab=all" />}
              variant={statusFilter ? 'outline' : 'default'}
              size="sm"
              className={cn(!statusFilter && 'bg-brand-600 hover:bg-brand-700')}
            >
              All statuses
            </Button>
            {statuses.map((row) => (
              <Button
                key={row.status}
                nativeButton={false}
                render={<Link href={`/admin/moderation?tab=all&status=${row.status}`} />}
                variant={statusFilter === row.status ? 'default' : 'outline'}
                size="sm"
                className={cn(statusFilter === row.status && 'bg-brand-600 hover:bg-brand-700')}
                aria-current={statusFilter === row.status ? 'true' : undefined}
              >
                {enumLabel(row.status)} ({row.count})
              </Button>
            ))}
          </div>

          {allJobs.length === 0 ? (
            <EmptyState
              title="No roles in this status"
              description="Nothing on the platform currently has that status. Choose another status above."
            />
          ) : (
            <Card>
              <CardContent className="pt-6">
                <Table>
                  <TableCaption>
                    Roles on the platform{statusFilter ? ` with status ${enumLabel(statusFilter)}` : ''}, newest change
                    first, up to 60 rows.
                  </TableCaption>
                  <TableHeader>
                    <TableRow>
                      <TableHead scope="col">Role</TableHead>
                      <TableHead scope="col">Organisation</TableHead>
                      <TableHead scope="col">Status</TableHead>
                      <TableHead scope="col">Skills</TableHead>
                      <TableHead scope="col">Applications</TableHead>
                      <TableHead scope="col">Matches</TableHead>
                      <TableHead scope="col">Last change</TableHead>
                      <TableHead scope="col">Moderation note</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {allJobs.map((job) => (
                      <TableRow key={job.id}>
                        <TableCell>
                          <span className="block font-medium">{job.title}</span>
                          <span className="block text-xs text-muted-foreground">
                            {enumLabel(job.employmentType)} · {enumLabel(job.workMode)}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className="block">{job.organization.name}</span>
                          <StatusBadge
                            value={job.organization.verificationStatus}
                            label={enumLabel(job.organization.verificationStatus)}
                          />
                        </TableCell>
                        <TableCell>
                          <StatusBadge value={job.status} label={enumLabel(job.status)} />
                        </TableCell>
                        <TableCell className="tabular-nums">{job._count.skills}</TableCell>
                        <TableCell className="tabular-nums">{job._count.applications}</TableCell>
                        <TableCell className="tabular-nums">{job._count.matches}</TableCell>
                        <TableCell className="whitespace-nowrap">{relativeTime(job.updatedAt)}</TableCell>
                        <TableCell className="max-w-[16rem] whitespace-normal text-xs leading-relaxed text-muted-foreground">
                          {job.moderationNote ?? <span>No note recorded</span>}
                          {job.moderatedAt ? (
                            <span className="block mt-0.5">Decided {formatDate(job.moderatedAt)}</span>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
              <div className="border-t border-border/70 px-6 py-3">
                <p className="text-xs text-muted-foreground">
                  Counts above include roles created or edited during the demonstration seed, not only real employer
                  activity.
                </p>
              </div>
            </Card>
          )}

          <DemoBadge text="Seeded roles are demonstration listings" />
        </TabsContent>
      </Tabs>
    </div>
  )
}
