import Link from 'next/link'
import { Briefcase, CalendarClock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState, InfoNote, PageHeader, StatusBadge } from '@/components/common'
import { ExperienceForm } from '@/components/candidate/experience-form'
import { ConfirmAction } from '@/components/candidate/confirm-action'
import { requirePermission } from '@/lib/authz'
import { prisma } from '@/lib/db'
import { consentMap, ownProfileWhere } from '@/server/candidate'
import { formatDate, formatMonths } from '@/lib/utils'
import { label } from '@/lib/options'
import { removeExperienceAction } from '@/server/actions/candidate'

export const metadata = { title: 'Experience' }

function durationInMonths(start: Date | null, end: Date | null, ongoing: boolean) {
  if (!start) return null
  const effectiveEnd = ongoing ? new Date() : end
  if (!effectiveEnd) return null
  return Math.max(0, Math.round((effectiveEnd.getTime() - start.getTime()) / (1000 * 60 * 60 * 24 * 30.44)))
}

export default async function CandidateExperiencesPage() {
  const principal = await requirePermission('candidate.experience.manage')
  if (!principal.candidateProfileId) {
    return (
      <div className="space-y-6">
        <PageHeader title="Experience" description="No candidate profile is attached to this account yet." />
        <EmptyState
          title="Start with onboarding"
          description="Onboarding creates the profile that experience entries attach to."
          action={
            <Button className="bg-brand-600 hover:bg-brand-700" nativeButton={false} render={<Link href="/candidate/onboarding" />} />
          }
        />
      </div>
    )
  }

  const [profile, consent] = await Promise.all([
    prisma.candidateProfile.findFirst({
      where: ownProfileWhere(principal),
      include: {
        experiences: {
          orderBy: { createdAt: 'desc' },
          include: { _count: { select: { evidence: true } } },
        },
      },
    }),
    consentMap(principal.userId),
  ])

  if (!profile) return null

  const experiences = profile.experiences
  const inferenceGranted = consent.get('RULE_BASED_INFERENCE')?.granted ?? false
  const caregivingCount = experiences.filter((entry) => entry.isCaregiving).length

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Records"
        title="Experience"
        description="Paid work, freelance, volunteering, community leadership, study — and caregiving. Every entry is an input to your skills inventory and to the experience total used by matching."
        actions={
          <>
            <Button variant="outline" nativeButton={false} render={<Link href="/candidate/skills" />}>
              Skills inventory
            </Button>
            <Button variant="ghost" nativeButton={false} render={<Link href="/candidate/profile" />}>
              Profile and privacy
            </Button>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="flex items-start gap-3 pt-5">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700">
              <Briefcase className="size-4.5" aria-hidden />
            </span>
            <div>
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Entries</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{experiences.length}</p>
              <p className="mt-1 text-xs text-muted-foreground">{caregivingCount} recorded as caregiving</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-start gap-3 pt-5">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-emerald-50 text-emerald-700">
              <CalendarClock className="size-4.5" aria-hidden />
            </span>
            <div>
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Paid experience used by matching</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{profile.yearsOfExperience} yrs</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Paid, freelance, internship and business entries only, pro-rated by stated hours per week.
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-2 pt-5">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">What employers may see</p>
            <p className="text-sm leading-relaxed">
              Under anonymised sharing an employer sees durations and skill evidence, not your calendar dates or
              organisation names.
            </p>
            <p className="text-xs text-muted-foreground">
              Break length is never part of a score, even when recorded here.
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_400px]">
        <div className="space-y-4">
          {experiences.length === 0 ? (
            <EmptyState
              title="No experience entries yet"
              description="Add your most recent paid role, then anything you handled during the break — caregiving, volunteering, freelance work or study all count as experience here."
              action={
                <Button className="bg-brand-600 hover:bg-brand-700" nativeButton={false} render={<Link href="/candidate/onboarding" />}>
                  Answer the onboarding questions instead
                </Button>
              }
            />
          ) : (
            <ul className="flex flex-col gap-4">
              {experiences.map((entry) => {
                const months = durationInMonths(entry.startDate, entry.endDate, entry.ongoing)
                return (
                  <li key={entry.id}>
                    <Card>
                      <CardHeader className="pb-3">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <CardTitle className="text-[15px] leading-snug">{entry.title}</CardTitle>
                            <CardDescription className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                              <Badge variant="secondary" className="bg-brand-50 text-brand-800">
                                {label(entry.type)}
                              </Badge>
                              {entry.organization ? <span>{entry.organization}</span> : null}
                              {entry.isCaregiving ? <StatusBadge value="CAREGIVING" label="Caregiving" /> : null}
                            </CardDescription>
                          </div>
                          <ConfirmAction
                            action={removeExperienceAction.bind(null, entry.id)}
                            triggerLabel="Remove"
                            triggerVariant="ghost"
                            triggerSize="xs"
                            triggerClassName="text-destructive hover:text-destructive"
                            title={`Remove “${entry.title}”?`}
                            description="Skill entries that were inferred only from this description are pruned too. Skills you added by hand stay on your profile."
                            confirmLabel="Remove entry"
                            cancelLabel="Keep it"
                          />
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-2.5">
                        <dl className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
                          <div className="flex gap-1.5">
                            <dt className="font-medium text-foreground">Period</dt>
                            <dd>
                              {entry.startDate ? formatDate(entry.startDate) : 'Start not set'} →{' '}
                              {entry.ongoing ? 'ongoing' : entry.endDate ? formatDate(entry.endDate) : 'not set'}
                            </dd>
                          </div>
                          <div className="flex gap-1.5">
                            <dt className="font-medium text-foreground">Duration</dt>
                            <dd>{months === null ? 'Not dated' : formatMonths(months)}</dd>
                          </div>
                          {entry.hoursPerWeek ? (
                            <div className="flex gap-1.5">
                              <dt className="font-medium text-foreground">Hours</dt>
                              <dd>{entry.hoursPerWeek} per week</dd>
                            </div>
                          ) : null}
                          <div className="flex gap-1.5">
                            <dt className="font-medium text-foreground">Evidence drawn</dt>
                            <dd>{entry._count.evidence} skill evidence record{entry._count.evidence === 1 ? '' : 's'}</dd>
                          </div>
                        </dl>
                        <p className="text-sm leading-relaxed">{entry.description}</p>
                        {entry.achievements ? (
                          <p className="rounded-lg border border-dashed border-border bg-muted/25 px-3 py-2 text-xs leading-relaxed">
                            <span className="font-medium">Achievements:</span> {entry.achievements}
                          </p>
                        ) : null}
                      </CardContent>
                    </Card>
                  </li>
                )
              })}
            </ul>
          )}

          <InfoNote tone="info" title="Dates are yours alone">
            Calendar dates never reach an employer view. The anonymisation filter replaces them with durations of
            responsibility, and the reason for a break is not read by any engine.
          </InfoNote>
        </div>

        <div className="space-y-4">
          <ExperienceForm />
          {!inferenceGranted ? (
            <InfoNote tone="warning" title="Skill suggestions are switched off">
              Your rule-based inference consent is not granted, so saving an experience will not propose skills. You can
              still add each skill yourself on the skills inventory, or turn suggestions back on under Profile and
              privacy.
            </InfoNote>
          ) : (
            <InfoNote tone="privacy" title="How suggestions are produced">
              A keyword rule matches your description against the curated taxonomy and its aliases, then stores the
              phrase that triggered each proposal as evidence. Nothing is verified, and you can delete any suggestion.
            </InfoNote>
          )}
        </div>
      </div>
    </div>
  )
}
