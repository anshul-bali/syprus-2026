import Link from 'next/link'
import {
  ArrowRight,
  Bell,
  BookOpenCheck,
  Briefcase,
  CheckCircle2,
  Circle,
  GitBranch,
  MessagesSquare,
  ScanSearch,
  ShieldCheck,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { EmptyState, InfoNote, PageHeader, ScoreBar, StatCard, StatusBadge, DemoBadge } from '@/components/common'
import { requirePermission } from '@/lib/authz'
import { getCandidateOverview } from '@/server/candidate'
import { formatDate, relativeTime, toPercent } from '@/lib/utils'
import { label } from '@/lib/options'

export const metadata = { title: 'Dashboard' }

/** Where a candidate actually goes to clear each outstanding checklist item. */
const NEXT_STEP_HREFS: Record<string, string> = {
  headline: '/candidate/profile',
  summary: '/candidate/profile',
  location: '/candidate/profile',
  target: '/candidate/profile',
  consent: '/candidate/profile',
  experiences: '/candidate/experiences',
  break: '/candidate/onboarding',
  skills: '/candidate/skills',
  evidence: '/candidate/skills',
}

const NEXT_STEP_LABELS: Record<string, string> = {
  headline: 'Add your headline',
  summary: 'Write your summary',
  location: 'Add your location',
  target: 'Name your target role',
  consent: 'Choose your sharing consent',
  experiences: 'Record an experience',
  break: 'Continue onboarding',
  skills: 'Open skills inventory',
  evidence: 'Attach evidence',
}

export default async function CandidateDashboard() {
  const principal = await requirePermission('candidate.profile.read')
  const overview = await getCandidateOverview(principal.userId)

  if (!overview) {
    return (
      <div className="space-y-6">
        <PageHeader title="Your dashboard" description="Everything starts from one profile record." />
        <EmptyState
          title="No candidate profile yet"
          description="This account has no profile attached. Sign out and register as a candidate, or contact an administrator."
          action={
            <Button className="bg-brand-600 hover:bg-brand-700" nativeButton={false} render={<Link href="/register?role=candidate" />} />
          }
        />
      </div>
    )
  }

  const { profile, checklist, applicationTotal, unreadNotifications, consent } = overview
  const firstName = principal.name.split(' ')[0]
  const evidencedSkills = profile.skills.filter((skill) => skill.evidenceCount > 0).length
  const inferred = profile.skills.filter((skill) => skill.validationStatus === 'RULE_INFERRED').length
  const isFresh = profile.skills.length === 0 && profile.experiences.length === 0
  const activePlan = profile.learningPlans[0] ?? null
  const nextStep = activePlan?.items.find((item) => item.status !== 'COMPLETED' && item.status !== 'SKIPPED') ?? null
  const latestReport = profile.gapReports[0] ?? null
  const sharingGranted = consent.get('ANONYMIZED_PROFILE_SHARING')?.granted ?? false
  const outstanding = checklist.items.filter((item) => !item.done)
  const isComplete = outstanding.length === 0
  const nextGap = outstanding[0] ?? null

  const pipeline = profile.applications.reduce<Record<string, number>>((accumulator, application) => {
    accumulator[application.status] = (accumulator[application.status] ?? 0) + 1
    return accumulator
  }, {})

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Candidate portal"
        title={`Welcome back, ${firstName}`}
        description={
          profile.headline ??
          'This dashboard is built from what you have recorded: experiences, skills with evidence, matches, plans and applications.'
        }
        actions={
          <>
            <Button variant="outline" nativeButton={false} render={<Link href="/candidate/skills" />}>
              Skills inventory
            </Button>
            <Button className="bg-brand-600 hover:bg-brand-700" nativeButton={false} render={<Link href="/candidate/jobs" />}>
              Recommended roles
            </Button>
          </>
        }
      />

      {!profile.onboardingComplete ? (
        <Card className="border-brand-300 bg-brand-50/60">
          <CardHeader>
            <div className="flex items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-600 text-primary-foreground">
                <MessagesSquare className="size-5" aria-hidden />
              </span>
              <div className="min-w-0">
                <CardTitle className="text-base">Continue onboarding</CardTitle>
                <CardDescription className="mt-1 leading-relaxed">
                  The conversation asks about your last paid role, what you handled during your break, and what you
                  want next. Every answer writes real records — experiences, skills with evidence, profile fields and
                  consent decisions — and you can leave and resume at any point.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-3">
            <Button className="bg-brand-600 hover:bg-brand-700" nativeButton={false} render={<Link href="/candidate/onboarding" />}>
              Resume the conversation
              <ArrowRight className="size-4" aria-hidden />
            </Button>
            <p className="text-xs text-muted-foreground">
              Break length and reason are stored for your records only. They are not inputs to matching.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {isFresh ? (
        <EmptyState
          title="Your profile is empty — start with your own words"
          description="No résumé is needed. The onboarding conversation turns what you describe into skills with evidence, and each suggestion can be accepted, edited or removed."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button className="bg-brand-600 hover:bg-brand-700" nativeButton={false} render={<Link href="/candidate/onboarding" />}>
                Start onboarding
              </Button>
              <Button variant="outline" nativeButton={false} render={<Link href="/candidate/experiences" />}>
                Add an experience yourself
              </Button>
            </div>
          }
        />
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Profile completion"
          value={toPercent(checklist.percent / 100)}
          hint={`${checklist.items.filter((item) => item.done).length} of ${checklist.items.length} steps done`}
          icon={CheckCircle2}
        />
        <StatCard
          label="Skills on file"
          value={profile.skills.length}
          hint={`${evidencedSkills} with evidence · ${inferred} suggested by the rule`}
          tone="positive"
          icon={GitBranch}
        />
        <StatCard
          label="Applications"
          value={applicationTotal}
          hint={applicationTotal === 0 ? 'Nothing submitted yet' : `Latest update ${relativeTime(profile.applications[0]?.updatedAt)}`}
          tone="neutral"
          icon={Briefcase}
        />
        <StatCard
          label="Unread notifications"
          value={unreadNotifications}
          hint={unreadNotifications === 0 ? 'All caught up' : 'Interview invites and match news land here'}
          tone={unreadNotifications > 0 ? 'warning' : 'neutral'}
          icon={Bell}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.05fr_0.95fr]">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{isComplete ? 'Your profile is complete' : 'What is still missing'}</CardTitle>
            <CardDescription>
              {isComplete
                ? `All ${checklist.items.length} checklist items are recorded. Completion describes your own records — it never weights a career break, and it is not shown to employers.`
                : 'Completion is a checklist of your own records. It never weights a career break, and it is not shown to employers.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className="text-xs leading-snug font-medium text-muted-foreground">Profile completion</span>
                <span className="text-sm font-semibold tabular-nums">{checklist.percent}%</span>
              </div>
              <Progress value={checklist.percent} className="mt-1.5 h-2.5" aria-label="Profile completion" />
            </div>
            {isComplete ? (
              <p
                role="status"
                className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm leading-relaxed text-emerald-900"
              >
                Nothing is outstanding. The next useful move is looking at the roles your skills already reach, or
                checking exactly what employers are allowed to see.
              </p>
            ) : null}
            <ul role="list" className="grid gap-1.5 sm:grid-cols-2">
              {checklist.items.map((item) => (
                <li key={item.key} role="listitem" className="flex items-start gap-2 text-sm">
                  {item.done ? (
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden />
                  ) : (
                    <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground/60" aria-hidden />
                  )}
                  <span className="min-w-0">
                    <span className="sr-only">{item.done ? 'Done: ' : 'Not done: '}</span>
                    <span className={item.done ? 'text-muted-foreground' : 'font-medium'}>{item.label}</span>
                    {!item.done ? <span className="block text-xs leading-snug text-muted-foreground">{item.hint}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
            {!isComplete && nextGap ? (
              <div className="rounded-lg border border-dashed border-brand-200 bg-brand-50/50 px-3 py-2.5">
                <p className="text-[11px] font-medium tracking-wide text-brand-700 uppercase">Next step</p>
                <p className="mt-1 text-sm leading-snug">{nextGap.label}</p>
                <p className="mt-1 text-xs leading-snug text-muted-foreground">{nextGap.hint}</p>
                <Button size="sm" className="mt-2.5 bg-brand-600 hover:bg-brand-700" nativeButton={false} render={<Link href={NEXT_STEP_HREFS[nextGap.key] ?? '/candidate/profile'} />}>
                  <ArrowRight className="size-4" aria-hidden />
                  {NEXT_STEP_LABELS[nextGap.key] ?? 'Open profile and privacy'}
                </Button>
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {isComplete ? (
                <Button size="sm" className="bg-brand-600 hover:bg-brand-700" nativeButton={false} render={<Link href="/candidate/jobs" />}>
                  <ScanSearch className="size-4" aria-hidden />
                  Recommended roles
                </Button>
              ) : null}
              <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/candidate/profile" />}>
                <ShieldCheck className="size-4" aria-hidden />
                Profile and privacy
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-2">
                <CardTitle className="text-base">Top recommended roles</CardTitle>
                <DemoBadge text="Seeded roles" />
              </div>
              <CardDescription>Scores come from the weighted rule model. Open any role for the skill-by-skill breakdown.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {profile.matches.length === 0 ? (
                <>
                  <p className="text-sm text-muted-foreground">
                    Nothing has been scored yet. Matching needs at least one skill on your profile and at least one
                    published role.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" className="bg-brand-600 hover:bg-brand-700" nativeButton={false} render={<Link href="/candidate/skills" />}>
                      Add skills
                    </Button>
                    <Button size="sm" variant="outline" nativeButton={false} render={<Link href="/candidate/jobs" />}>
                      <ScanSearch className="size-4" aria-hidden />
                      Browse published roles
                    </Button>
                  </div>
                </>
              ) : (
                profile.matches.slice(0, 3).map((match) => (
                  <div key={match.id} className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <Link href={`/candidate/jobs/${match.job.id}`} className="text-sm font-medium hover:underline">
                          {match.job.title}
                        </Link>
                        <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                          {match.job.organization.name}
                          <StatusBadge value={match.job.organization.verificationStatus} />
                          <span aria-hidden>·</span>
                          {label(match.job.workMode)}
                        </p>
                      </div>
                      <span className="shrink-0 text-sm font-semibold tabular-nums">{Math.round(match.score * 100)}%</span>
                    </div>
                    <ScoreBar
                      score={match.score}
                      label="Skill match"
                      breakdown={[
                        { label: 'Required', value: match.requiredScore },
                        { label: 'Preferred', value: match.preferredScore },
                        { label: 'Evidence', value: match.evidenceScore },
                        { label: 'Preferences', value: match.preferenceScore },
                      ]}
                    />
                    <Separator />
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Application pipeline</CardTitle>
              <CardDescription>
                {applicationTotal} application{applicationTotal === 1 ? '' : 's'} on record.
                {Object.keys(pipeline).length > 0
                  ? ` ${Object.entries(pipeline)
                      .map(([status, count]) => `${label(status)} ${count}`)
                      .join(' · ')}.`
                  : ''}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2.5">
              {profile.applications.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No applications yet. Applying is the action that discloses your identity to one organisation.
                </p>
              ) : (
                profile.applications.slice(0, 4).map((application) => (
                  <div key={application.id} className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm leading-snug">{application.job.title}</p>
                      <p className="text-xs text-muted-foreground">Updated {relativeTime(application.updatedAt)}</p>
                    </div>
                    <StatusBadge value={application.status} />
                  </div>
                ))
              )}
              <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/candidate/applications" />}>
                Open tracker
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <BookOpenCheck className="size-4 text-brand-600" aria-hidden />
              Active pathway
            </CardTitle>
            <CardDescription>
              {activePlan ? activePlan.title : 'No learning pathway built yet.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {activePlan ? (
              <>
                <p className="text-sm">
                  <span className="font-medium tabular-nums">
                    {activePlan.items.filter((item) => item.status === 'COMPLETED').length}/{activePlan.items.length}
                  </span>{' '}
                  steps completed · {activePlan.goal}
                </p>
                {nextStep ? (
                  <div className="rounded-lg border border-dashed border-brand-200 bg-brand-50/50 px-3 py-2.5">
                    <p className="text-[11px] font-medium tracking-wide text-brand-700 uppercase">Next step</p>
                    <p className="mt-1 text-sm leading-snug">{nextStep.resource.title}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {nextStep.resource.provider} · {label(nextStep.resource.type)}
                      {nextStep.resource.durationHours ? ` · ${nextStep.resource.durationHours} hrs` : ''}
                      {nextStep.gapSkillSlug ? ` · targets ${nextStep.gapSkillSlug.replace(/-/g, ' ')}` : ''}
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-emerald-800">Every step on this pathway is done or skipped.</p>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                Run a gap report first — the planner only picks catalogue resources for gaps the analysis actually
                found.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/candidate/pathways" />}>
                {activePlan ? 'Open pathway' : 'Build a pathway'}
              </Button>
              <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/candidate/gap-report" />}>
                Skill gaps
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Latest readiness</CardTitle>
            <CardDescription>
              {latestReport
                ? `Generated ${formatDate(latestReport.createdAt)} by the rule-based gap analysis.`
                : 'No gap report generated yet.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {latestReport ? (
              <>
                <div className="flex items-center justify-between gap-2">
                  <StatusBadge value={latestReport.readiness} />
                  <span className="text-sm font-semibold tabular-nums">{Math.round(latestReport.readinessScore * 100)}%</span>
                </div>
                <ScoreBar
                  score={latestReport.readinessScore}
                  label="Readiness score"
                  breakdown={[]}
                />
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Readiness is coverage, evidence quality and experience fit weighted 60/22/18. It is a description of
                  stored levels, not a prediction that you will be hired.
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                Pick a target role and the engine compares your inventory against its required and preferred skills.
              </p>
            )}
            <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/candidate/gap-report" />}>
              {latestReport ? 'Open gap report' : 'Generate a gap report'}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Bell className="size-4 text-brand-600" aria-hidden />
              Notifications
            </CardTitle>
            <CardDescription>
              {unreadNotifications === 0 ? 'Nothing unread.' : `${unreadNotifications} unread.`}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2.5">
            <InfoNote tone={sharingGranted ? 'privacy' : 'warning'} title={sharingGranted ? 'Anonymised sharing is on' : 'Anonymised sharing is off'}>
              {sharingGranted
                ? 'Verified employers can browse your handle, skills and durations. Your name is disclosed only when you apply.'
                : 'You are invisible to employer browse. Switch it on any time under Profile and privacy.'}
            </InfoNote>
            <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/candidate/notifications" />}>
              All notifications
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Badge variant="outline">Scores: deterministic engine</Badge>
        <span>
          Match percentages here are calculated from published weights, and every score lists the fields it read and
          refused to read. Skills are never described as verified. Suggestions on the skill-suggestions screen trace
          back to your own wording, and each one says whether a keyword rule or an optional language model produced it.
        </span>
      </div>
    </div>
  )
}
