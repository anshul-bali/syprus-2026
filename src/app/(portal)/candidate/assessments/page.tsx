import Link from 'next/link'
import { requirePermission } from '@/lib/authz'
import { listAvailableAssessments, attemptsForProfile } from '@/server/ai/assessments'
import { formatDateTime } from '@/lib/utils'
import { label } from '@/lib/options'
import { ActionSubmit } from '@/components/candidate/action-submit'
import { startAssessmentAction } from '@/server/actions/ai'
import { DemoBadge, EmptyState, InfoNote, PageHeader, StatCard, StatusBadge } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export const metadata = { title: 'Practice assessments' }

export default async function CandidateAssessmentsPage() {
  const principal = await requirePermission('candidate.skills.read')

  if (!principal.candidateProfileId) {
    return (
      <div className="space-y-6">
        <PageHeader eyebrow="Agent 1" title="Practice assessments" description="No candidate profile is attached to this account." />
        <EmptyState
          title="Onboarding comes first"
          description="Assessment attempts are recorded against a candidate profile."
          action={
            <Button className="bg-brand-600 hover:bg-brand-700" nativeButton={false} render={<Link href="/candidate/onboarding" />}>
              Start onboarding
            </Button>
          }
        />
      </div>
    )
  }

  const [assessments, attempts] = await Promise.all([
    listAvailableAssessments(principal),
    attemptsForProfile(principal, principal.candidateProfileId),
  ])

  const passedCount = assessments.filter((assessment) => assessment.passed).length
  const verified = assessments.filter((assessment) => assessment.passed).length

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Agent 1"
        title="Practice assessments"
        description="Question sets written for this platform. Passing one moves a skill to assessment-verified — a stronger claim than self-reported, but still nothing an outside body attested to."
        actions={
          <>
            <Button variant="outline" nativeButton={false} render={<Link href="/candidate/skills" />}>
              Skills inventory
            </Button>
            <Button variant="ghost" nativeButton={false} render={<Link href="/candidate/graph" />}>
              See them on the graph
            </Button>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Question sets available" value={assessments.length} hint={`${passedCount} passed at least once`} />
        <StatCard label="Attempts recorded" value={attempts.length} hint="Every try is kept, not just the best" tone="neutral" />
        <StatCard label="Assessment-verified skills" value={verified} hint="Set by passing, never by ticking a course" tone="positive" />
      </div>

      {assessments.length === 0 ? (
        <EmptyState
          title="No question sets are published in this build"
          description="The assessment tables exist and the scoring path is wired, but a question set has to be authored. Until one exists, skills can only be self-reported, confirmed by you, or human-reviewed."
          action={
            <Button variant="outline" nativeButton={false} render={<Link href="/candidate/suggestions" />}>
              Work through suggestions instead
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {assessments.map((assessment) => (
            <Card key={assessment.id} className={assessment.passed ? 'border-emerald-200' : undefined}>
              <CardHeader className="pb-2.5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <CardTitle className="text-sm">{assessment.title}</CardTitle>
                    <CardDescription className="mt-1 text-xs">
                      {assessment.skillName} · {label(assessment.category).toLowerCase()} · {assessment.questionCount}{' '}
                      question(s) · pass {Math.round(assessment.passMark * 100)}%
                    </CardDescription>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    {assessment.passed ? <StatusBadge value="PASS" label="passed" /> : null}
                    {assessment.demonstration ? <DemoBadge text="Illustrative set" /> : null}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <p className="text-xs leading-relaxed text-muted-foreground">{assessment.instructions}</p>

                <div className="flex flex-wrap items-center gap-2 text-xs">
                  {assessment.skillOnProfile ? (
                    <Badge variant="outline">already on your inventory</Badge>
                  ) : (
                    <Badge variant="secondary">not on your inventory</Badge>
                  )}
                  <span className="text-muted-foreground">
                    {assessment.attempts === 0
                      ? 'no attempts yet'
                      : `${assessment.attempts} attempt(s), best ${Math.round((assessment.bestScore ?? 0) * 100)}%`}
                  </span>
                </div>

                <div className="flex flex-wrap gap-2">
                  <ActionSubmit
                    action={startAssessmentAction}
                    fields={{ assessmentId: assessment.id }}
                    label={assessment.attempts === 0 ? 'Start this assessment' : 'Take it again'}
                    pendingLabel="Opening…"
                    variant={assessment.passed ? 'outline' : 'default'}
                    size="sm"
                    showStatus
                  />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {attempts.length > 0 ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Your attempts</CardTitle>
            <CardDescription className="text-xs">
              Kept per try, so a later reviewer can see a trend rather than only the best number.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {attempts.slice(0, 10).map((attempt) => (
              <div key={attempt.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-2 text-xs last:border-0">
                <span className="min-w-0">
                  <Link href={`/candidate/assessments/${attempt.id}`} className="font-medium hover:underline">
                    {attempt.assessment.title}
                  </Link>
                  <span className="ml-1.5 text-muted-foreground">{attempt.assessment.skill.name}</span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="tabular-nums">{Math.round(attempt.score * 100)}%</span>
                  <StatusBadge value={attempt.passed ? 'PASS' : 'WATCH'} />
                  <span className="text-muted-foreground">
                    {attempt.completedAt ? formatDateTime(attempt.completedAt) : 'started, not finished'}
                  </span>
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <InfoNote tone="privacy" title="What passing does and does not mean">
        Passing sets the skill to assessment-verified and adds an evidence row quoting your score. That is a claim about
        this platform’s own question set — it is not a certificate, an invigilated exam, or employer verification, and
        the screens say so in those words.
      </InfoNote>
    </div>
  )
}
