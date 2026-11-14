import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requirePermission } from '@/lib/authz'
import { prisma } from '@/lib/db'
import { matchForCandidateAndJob } from '@/server/matching'
import { readExplanation } from '@/lib/match-view'
import { ownProfileWhere } from '@/server/candidate'
import { label } from '@/lib/options'
import { formatDate } from '@/lib/utils'
import { JobActions } from '@/components/candidate/job-actions'
import { ActionSubmit } from '@/components/candidate/action-submit'
import { refreshMatchesAction } from '@/server/actions/candidate'
import { DemoBadge, FieldRow, InfoNote, PageHeader, ScoreBar, StatusBadge } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

export const metadata = { title: 'Role detail' }

export default async function CandidateJobDetailPage(props: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await props.params
  const principal = await requirePermission('candidate.match.read')

  const job = await prisma.job.findUnique({
    where: { id: jobId },
    include: {
      organization: {
        select: {
          id: true,
          name: true,
          verificationStatus: true,
          industry: true,
          locationCity: true,
          locationCountry: true,
          flexPolicy: true,
          returnshipNote: true,
          website: true,
        },
      },
      skills: { include: { skill: true }, orderBy: [{ requirement: 'asc' }, { weight: 'desc' }] },
    },
  })

  if (!job || (job.status !== 'PUBLISHED' && job.status !== 'CLOSED')) notFound()

  const [match, profile, application] = await Promise.all([
    principal.candidateProfileId ? matchForCandidateAndJob(principal, jobId) : Promise.resolve(null),
    principal.candidateProfileId
      ? prisma.candidateProfile.findFirst({
          where: ownProfileWhere(principal),
          select: { sharingMode: true, visibleToEmployers: true, yearsOfExperience: true, availabilityHours: true, workPreference: true },
        })
      : Promise.resolve(null),
    principal.candidateProfileId
      ? prisma.application.findUnique({
          where: { candidateProfileId_jobId: { candidateProfileId: principal.candidateProfileId, jobId } },
        })
      : Promise.resolve(null),
  ])

  const explanation = match ? readExplanation(match.explanation) : null

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={job.status === 'PUBLISHED' ? 'Open role' : 'Closed role'}
        title={job.title}
        description={`${job.organization.name} · ${label(job.workMode)} · ${label(job.employmentType)}${
          job.locationCity ? ` · ${job.locationCity}` : ''
        }`}
        actions={
          <>
            <Button variant="outline" nativeButton={false} render={<Link href="/candidate/jobs" />}>
              All recommended roles
            </Button>
            {explanation && job.status === 'PUBLISHED' && (!job.closesAt || job.closesAt > new Date()) ? (
              <JobActions
                jobId={job.id}
                jobTitle={job.title}
                explanation={explanation}
                application={application ? { id: application.id, status: application.status } : null}
                detailHref={`/candidate/jobs/${job.id}`}
              />
            ) : null}
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">What the role asks for</CardTitle>
              <CardDescription className="text-xs">
                Exactly the rows the matcher scored against, with the weight and level the employer set.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {job.skills.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  This role lists no skills, so the matcher stores no score for it — the score would have no requirements
                  to compare against.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Skill</TableHead>
                      <TableHead>Need</TableHead>
                      <TableHead>Level asked</TableHead>
                      <TableHead className="text-right">Weight</TableHead>
                      <TableHead>You hold</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {job.skills.map((row) => {
                      const credit = explanation?.credits.find(
                        (entry) => entry.slug === row.skill.slug && entry.requirement === row.requirement,
                      )
                      return (
                        <TableRow key={row.id}>
                          <TableCell className="align-top">
                            <span className="flex flex-col gap-1">
                              <span className="font-medium">{row.skill.name}</span>
                              <span className="text-[11px] text-muted-foreground">
                                {label(row.skill.category).toLowerCase()}
                                {row.skill.transferable ? ' · transferable' : ''}
                              </span>
                            </span>
                          </TableCell>
                          <TableCell className="align-top">
                            <Badge variant={row.requirement === 'REQUIRED' ? 'default' : 'secondary'} className="text-[10px]">
                              {label(row.requirement).toLowerCase()}
                            </Badge>
                          </TableCell>
                          <TableCell className="align-top text-xs">{label(row.level)}</TableCell>
                          <TableCell className="align-top text-right text-xs tabular-nums">{row.weight}</TableCell>
                          <TableCell className="align-top text-xs">
                            {credit ? (
                              <span className="flex flex-col gap-0.5">
                                {credit.candidateLevel ? label(credit.candidateLevel) : 'not on your inventory'}
                                <span className="text-[11px] text-muted-foreground tabular-nums">
                                  {Math.round(credit.credit * 100)}% covered
                                  {credit.validationStatus ? ` · ${label(credit.validationStatus).toLowerCase()}` : ''}
                                </span>
                              </span>
                            ) : (
                              <span className="text-muted-foreground">no stored score</span>
                            )}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">The role as published</CardTitle>
              {job.postedAt ? (
                <CardDescription className="text-xs">Posted {formatDate(job.postedAt)}</CardDescription>
              ) : null}
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm leading-relaxed">
              <p className="whitespace-pre-line">{job.description}</p>
              {job.responsibilities.length > 0 ? (
                <div>
                  <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Responsibilities</p>
                  <ul className="mt-1 list-disc pl-5">
                    {job.responsibilities.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {job.requirementsText ? (
                <div>
                  <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    Requirements as written
                  </p>
                  <p className="mt-1 whitespace-pre-line">{job.requirementsText}</p>
                </div>
              ) : null}
              <div className="flex flex-wrap gap-1.5">
                {job.flexibleHours ? <DemoBadge text="Flexible hours stated" /> : null}
                {job.returnshipProgram ? <DemoBadge text="Returnship programme" /> : null}
                {job.reEntryFriendly ? <Badge variant="outline">marked re-entry friendly</Badge> : null}
                {job.closesAt ? <span className="text-xs text-muted-foreground">Closes {formatDate(job.closesAt)}</span> : null}
              </div>
            </CardContent>
          </Card>

          {explanation && explanation.gaps.length > 0 ? (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">What would move this score</CardTitle>
                <CardDescription className="text-xs">
                  Derived from the same gap rows the matcher computed — nothing here is a new judgement.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {explanation.gaps.slice(0, 5).map((gap) => (
                  <div key={`${gap.slug}-${gap.requirement}`} className="text-sm">
                    <span className="font-medium">{gap.name}</span>{' '}
                    <span className="text-muted-foreground">
                      — needs {label(gap.requiredLevel).toLowerCase()},{' '}
                      {gap.candidateLevel ? `you hold ${label(gap.candidateLevel).toLowerCase()}` : 'not held'} ·{' '}
                      {label(gap.requirement).toLowerCase()} weight {gap.weight}
                    </span>
                  </div>
                ))}
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/candidate/pathways" />}>
                    Build a pathway for these
                  </Button>
                  <Button variant="ghost" size="sm" className="text-xs" nativeButton={false} render={<Link href="/candidate/gap-report" />}>
                    Gap report against this role
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : null}
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Your match</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {match && explanation ? (
                <>
                  <ScoreBar
                    score={match.score}
                    label="Stored match score"
                    breakdown={[
                      { label: 'Required', value: match.requiredScore },
                      { label: 'Preferred', value: match.preferredScore },
                      { label: 'Evidence', value: match.evidenceScore },
                      { label: 'Constraints', value: match.preferenceScore },
                    ]}
                  />
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    Weights {explanation.weights.required * 100}% required · {explanation.weights.preferred * 100}%
                    preferred · {explanation.weights.evidence * 100}% evidence ·{' '}
                    {explanation.weights.preferences * 100}% constraints ({explanation.weightsVersion}). Those numbers
                    are configurable prototype assumptions for this build, not a validated hiring instrument.
                  </p>
                  <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/candidate/pathways" />}>
                    Recommended next actions
                  </Button>
                </>
              ) : (
                <InfoNote tone="info" title={match ? 'Score stored in an older format' : 'No stored score yet'}>
                  {match
                    ? 'Recompute to get the four-bucket breakdown for this role.'
                    : 'A score appears once the matcher has run against your skills and this role’s requirements.'}
                </InfoNote>
              )}
              <ActionSubmit
                action={refreshMatchesAction}
                label="Recompute my matches"
                pendingLabel="Recomputing…"
                showStatus
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Applying and your identity</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-xs leading-relaxed">
              <dl>
                <FieldRow label="Your sharing mode">{profile ? label(profile.sharingMode) : 'No profile'}</FieldRow>
                <FieldRow label="Visible to employers">{profile?.visibleToEmployers ? 'Yes' : 'No'}</FieldRow>
                <FieldRow label="Application here">{application ? label(application.status) : 'Not applied'}</FieldRow>
              </dl>
              <p className="text-muted-foreground">
                Applying sends your name and contact details to {job.organization.name} and moves your profile out of
                anonymity for them. The other route is approving a disclosure request on the{' '}
                <Link href="/candidate/disclosures" className="underline underline-offset-2">
                  disclosure screen
                </Link>
                . Either way, each later view of your identity is logged.
              </p>
              <p className="text-muted-foreground">
                Employer account: <StatusBadge value={job.organization.verificationStatus} /> — verification means an
                administrator confirmed the organisation exists on this platform. It is not a guarantee about their
                hiring behaviour.
              </p>
              <Button variant="ghost" size="xs" nativeButton={false} render={<Link href="/candidate/profile" />}>
                Change privacy settings
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">{job.organization.name}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-xs leading-relaxed text-muted-foreground">
              <dl>
                <FieldRow label="Industry">{job.organization.industry ?? 'Not stated'}</FieldRow>
                <FieldRow label="Base">
                  {[job.organization.locationCity, job.organization.locationCountry].filter(Boolean).join(', ') || 'Not stated'}
                </FieldRow>
                <FieldRow label="Flexibility">{job.organization.flexPolicy ?? 'Not stated'}</FieldRow>
                <FieldRow label="Return-to-work note">{job.organization.returnshipNote ?? 'Not stated'}</FieldRow>
              </dl>
              {job.organization.website ? (
                <a href={job.organization.website} target="_blank" rel="noreferrer noopener" className="underline underline-offset-2">
                  Organisation website
                </a>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
