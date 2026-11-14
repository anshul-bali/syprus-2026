import Link from 'next/link'
import { requireOrgJob } from '@/lib/authz'
import { prisma } from '@/lib/db'
import { candidatesForJob, jobSkillSummary } from '@/server/matching'
import { getJobForEmployer } from '@/server/jobs'
import { organizationApplications, shortlistForJob } from '@/server/applications'
import type { MatchExplanation } from '@/lib/engines/matching'
import { DemoBadge, EmptyState, FieldRow, InfoNote, PageHeader, StatusBadge } from '@/components/common'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { APPLICATION_STATUSES, label as enumLabel } from '@/lib/options'
import { formatDate, formatDateTime, relativeTime } from '@/lib/utils'
import { loadCatalogSkills } from '@/server/skill-catalog'
import { JobForm } from '@/components/employer/job-form'
import { JobLifecycleActions } from '@/components/employer/job-lifecycle-actions'
import { CandidateMatchCard } from '@/components/employer/candidate-match-card'
import { ApplicationStatusForm } from '@/components/employer/application-status-form'
import { MatchScoreFilter } from '@/components/employer/filters'
import { PostingReviewPanel } from '@/components/employer/posting-review'
import { isDemonstrationName, jobToFormValues, nextStagesFor, readParam, readScoreFloor } from '../../_data/queries'

export const metadata = { title: 'Role detail' }

function salaryLabel(min: number | null, max: number | null, currency: string) {
  if (min == null && max == null) return 'Not published'
  const format = (value: number) => `${currency} ${value.toLocaleString('en-IN')}`
  if (min != null && max != null) return `${format(min)} – ${format(max)}`
  return min != null ? `From ${format(min)}` : `Up to ${format(max as number)}`
}

export default async function JobDetailPage(props: {
  params: Promise<{ jobId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { jobId } = await props.params
  const searchParams = await props.searchParams
  const minScore = readScoreFloor(searchParams.minScore)
  const justCreated = readParam(searchParams.created)

  const { principal } = await requireOrgJob(jobId, 'employer.job.read')
  const canShortlist = principal.permissions.includes('employer.shortlist.manage')

  const [detail, skills, matches, applications, catalog, shortlistEntries, languageReviews, marketInsights] =
    await Promise.all([
      getJobForEmployer(principal, jobId),
      jobSkillSummary(jobId),
      candidatesForJob(principal, jobId, { minScore, take: 40 }),
      organizationApplications(principal, { jobId }),
      loadCatalogSkills(),
      canShortlist ? shortlistForJob(principal, jobId) : Promise.resolve([]),
      prisma.languageReview.findMany({
        where: { jobId },
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: { aiRun: { select: { provider: true, model: true, fallbackReason: true } } },
      }),
      prisma.marketInsight.findMany({
        where: { jobId, organizationId: principal.organizationId, candidateProfileId: null },
        orderBy: { createdAt: 'desc' },
        take: 3,
      }),
    ])

  const shortlistByProfile = new Map(shortlistEntries.map((entry) => [entry.candidateProfileId, entry]))
  const verified = detail.organization.verificationStatus
  const stageCounts = APPLICATION_STATUSES.map((status) => ({
    status,
    count: applications.filter((application) => application.status === status).length,
  })).filter((row) => row.count > 0)

  const requiredSkills = skills.filter((skill) => skill.requirement === 'REQUIRED')

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={`${detail.organization.name} · role`}
        title={detail.title}
        description={`${enumLabel(detail.workMode)} · ${enumLabel(detail.employmentType)} · ${
          detail.locationCity ?? 'Location not shared'
        }`}
        actions={
          <>
            <Button variant="outline" nativeButton={false} render={<Link href="/employer/jobs" />}>
              All roles
            </Button>
            <Dialog>
              <DialogTrigger render={<Button className="bg-brand-600 hover:bg-brand-700" />}>Edit role</DialogTrigger>
              <DialogContent className="max-h-[90dvh] gap-3 overflow-y-auto sm:max-w-3xl">
                <DialogHeader>
                  <DialogTitle>Edit {detail.title}</DialogTitle>
                  <DialogDescription>
                    Saving a published role sends it back to the moderation queue, because candidates must see exactly
                    what an administrator approved.
                  </DialogDescription>
                </DialogHeader>
                <JobForm
                  mode="update"
                  jobId={detail.id}
                  catalog={catalog}
                  values={jobToFormValues(detail)}
                  verificationStatus={verified}
                  moderationNote={detail.moderationNote}
                />
              </DialogContent>
            </Dialog>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge value={detail.status} />
        <span className="text-xs text-muted-foreground">
          Updated {relativeTime(detail.updatedAt)} · created {formatDate(detail.createdAt)}
        </span>
        {isDemonstrationName(detail.organization.name) ? <DemoBadge /> : null}
        {detail.reEntryFriendly ? <Badge variant="secondary">Open to career re-entry</Badge> : null}
        {detail.flexibleHours ? <Badge variant="secondary">Flexible hours</Badge> : null}
        {detail.returnshipProgram ? <Badge variant="secondary">Returnship</Badge> : null}
      </div>

      {justCreated ? (
        <InfoNote tone="success" title="Draft created">
          This role is a draft, visible only inside your organisation. Use <strong>Submit for moderation</strong> below
          to queue it for an administrator. Once the role is published, matched anonymised profiles appear on the
          Matched candidates tab.
        </InfoNote>
      ) : null}

      {verified !== 'VERIFIED' ? (
        <InfoNote tone="warning" title="Organisation verification is pending">
          {detail.organization.name} has not been verified by an administrator, so this role cannot be submitted for
          moderation or resumed, and it cannot reach candidates. Drafts and edits stay available to you in the meantime.
        </InfoNote>
      ) : null}

      {detail.moderationNote ? (
        <InfoNote tone="info" title="Moderator note">
          {detail.moderationNote} · decided {formatDate(detail.moderatedAt)}
        </InfoNote>
      ) : null}

      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border/70 bg-muted/20 p-3">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Lifecycle</p>
        <JobLifecycleActions
          jobId={detail.id}
          status={detail.status}
          title={detail.title}
          verificationStatus={verified}
        />
        <p className="text-xs text-muted-foreground">
          {detail._count.applications} application{detail._count.applications === 1 ? '' : 's'} ·{' '}
          {detail._count.matches} scored match{detail._count.matches === 1 ? '' : 'es'}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">The role as published</CardTitle>
            <CardDescription>What a candidate sees once an administrator publishes the role.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm leading-relaxed">{detail.description}</p>
            {detail.responsibilities.length > 0 ? (
              <div>
                <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Responsibilities</p>
                <ul className="mt-1.5 list-disc space-y-1 pl-4 text-sm">
                  {detail.responsibilities.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {detail.requirementsText ? (
              <div>
                <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  Additional requirements
                </p>
                <p className="mt-1.5 text-sm leading-relaxed">{detail.requirementsText}</p>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Terms</CardTitle>
            <CardDescription>Filters candidates use when deciding to apply.</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="divide-y divide-border/60">
              <FieldRow label="Salary">{salaryLabel(detail.salaryMin, detail.salaryMax, detail.currency)}</FieldRow>
              <FieldRow label="Experience range">
                {detail.experienceYearsMin == null && detail.experienceYearsMax == null
                  ? 'Not stated — the model uses a neutral experience score'
                  : `${detail.experienceYearsMin ?? 0}–${detail.experienceYearsMax ?? 'any'} years`}
              </FieldRow>
              <FieldRow label="Work mode">{enumLabel(detail.workMode)}</FieldRow>
              <FieldRow label="Employment type">{enumLabel(detail.employmentType)}</FieldRow>
              <FieldRow label="Location">
                {[detail.locationCity, detail.locationCountry].filter(Boolean).join(', ') || 'Not shared'}
              </FieldRow>
              <FieldRow label="Applications close">{formatDate(detail.closesAt, 'No closing date')}</FieldRow>
              <FieldRow label="First published">{formatDate(detail.postedAt, 'Not published yet')}</FieldRow>
            </dl>
          </CardContent>
        </Card>
      </div>

      <PostingReviewPanel
        jobId={detail.id}
        reviews={languageReviews.map((review) => ({
          id: review.id,
          overallRisk: review.overallRisk,
          mode: review.mode,
          status: review.status,
          findings: (review.findings ?? []) as never,
          continuityChecks: (review.continuityChecks ?? []) as never,
          positives: (review.positives ?? []) as string[],
          createdAt: review.createdAt,
          aiRun: review.aiRun
            ? {
                provider: review.aiRun.provider,
                model: review.aiRun.model,
                fallbackReason: review.aiRun.fallbackReason,
              }
            : null,
        }))}
        insights={marketInsights.map((insight) => ({
          id: insight.id,
          source: insight.source,
          isLive: insight.isLive,
          score: insight.score,
          dataAsOf: insight.dataAsOf,
          explanation: insight.explanation,
          excludedSignals: insight.excludedSignals,
          createdAt: insight.createdAt,
        }))}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Skill rows the matching model reads ({requiredSkills.length} required ·{' '}
            {skills.length - requiredSkills.length} preferred)
          </CardTitle>
          <CardDescription>
            Weight 1–5 sets how much each row counts inside its required or preferred bucket. Nothing here is a proxy
            for a credential check.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {skills.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No skills defined yet, so no candidate can be matched to this role. Edit the role and add at least one.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Skill</TableHead>
                  <TableHead scope="col">Need</TableHead>
                  <TableHead scope="col">Level</TableHead>
                  <TableHead scope="col">Weight</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {skills.map((skill) => (
                  <TableRow key={`${skill.slug}-${skill.requirement}`}>
                    <TableCell className="font-medium">{skill.name}</TableCell>
                    <TableCell>
                      <StatusBadge value={skill.requirement} />
                    </TableCell>
                    <TableCell>{enumLabel(skill.level)}</TableCell>
                    <TableCell className="tabular-nums">{skill.weight}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Tabs defaultValue="matches">
        <TabsList className="w-full justify-start sm:w-auto">
          <TabsTrigger value="matches">Matched candidates ({matches.length})</TabsTrigger>
          <TabsTrigger value="applications">Applications ({applications.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="matches" className="space-y-4 pt-2">
          <InfoNote tone="privacy" title="You are reviewing capability, not a timeline">
            Profiles below were produced by the anonymisation filter: names, employer names, calendar dates and career-break
            length are withheld, and identity appears only after the candidate applies to your organisation or approves a
            disclosure request. Scores are the
            weighted rules result for the skill rows above — skills are not verified by SYPRUS, and a score is not a
            promise of performance.
          </InfoNote>

          <MatchScoreFilter minScore={minScore} basePath={`/employer/jobs/${jobId}`} />

          {matches.length === 0 ? (
            <EmptyState
              title={
                minScore
                  ? `No visible profile clears ${Math.round(minScore * 100)}% on this role`
                  : 'No matched profiles visible yet'
              }
              description={
                detail.status !== 'PUBLISHED'
                  ? 'Matches are only scored against published roles. Submit this role for moderation, then check again once it is live.'
                  : 'Candidates can only appear here when their profile is shared, their skills are on file and the role is published. Lower the score floor to widen the set.'
              }
              action={
                minScore ? (
                  <Button variant="outline" nativeButton={false} render={<Link href={`/employer/jobs/${jobId}`} />}>
                    Clear the score floor
                  </Button>
                ) : (
                  <Button variant="outline" nativeButton={false} render={<Link href="/employer/candidates" />}>
                    Browse candidates
                  </Button>
                )
              }
            />
          ) : (
            <div className="grid gap-4 xl:grid-cols-2">
              {matches.map((match) => {
                const entry = shortlistByProfile.get(match.profile.candidateProfileId)
                return (
                  <CandidateMatchCard
                    key={match.matchId}
                    jobId={jobId}
                    profile={match.profile}
                    score={match.score}
                    requiredScore={match.requiredScore}
                    preferredScore={match.preferredScore}
                    preferenceScore={match.preferenceScore}
                    evidenceScore={match.evidenceScore}
                    explanation={match.explanation as unknown as MatchExplanation}
                    applied={match.applied}
                    shortlisted={Boolean(entry)}
                    existingNote={entry?.note ?? ''}
                  />
                )
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="applications" className="space-y-4 pt-2">
          {applications.length === 0 ? (
            <EmptyState
              title="No applications to this role"
              description="An application arrives only when a candidate chooses to apply and ticks the identity-consent control, which is one of the two moments their identity is disclosed to your organisation."
              action={
                <Button variant="outline" nativeButton={false} render={<Link href="/employer/applications" />}>
                  All applications
                </Button>
              }
            />
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                {stageCounts.map((row) => (
                  <Badge key={row.status} variant="secondary" className="gap-1.5">
                    {enumLabel(row.status)} <span className="tabular-nums">{row.count}</span>
                  </Badge>
                ))}
              </div>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Pipeline for this role</CardTitle>
                  <CardDescription>
                    Only the stages the transition table allows from the current status are offered. Moving a stage
                    notifies the candidate and writes an audit entry.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {applications.map((application) => (
                    <div key={application.id} className="space-y-2 rounded-lg border border-border/70 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="flex flex-wrap items-center gap-2 text-sm">
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
                        <p className="text-xs text-muted-foreground">
                          Applied {formatDate(application.createdAt)} · updated {relativeTime(application.updatedAt)} ·
                          rules score at apply time{' '}
                          {application.matchScoreSnapshot == null
                            ? 'not recorded'
                            : `${Math.round(application.matchScoreSnapshot * 100)}%`}
                        </p>
                      </div>
                      <ApplicationStatusForm
                        applicationId={application.id}
                        currentStatus={application.status}
                        candidateHandle={application.candidateProfile.anonymousHandle}
                        jobTitle={detail.title}
                        allowed={nextStagesFor(application.status, principal.permissions)}
                      />
                    </div>
                  ))}
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
