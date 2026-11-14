'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { FieldError, FormStatus } from '@/components/forms/form-parts'
import { InfoNote, ScoreBar, StatusBadge } from '@/components/common'
import { IDLE_STATE } from '@/lib/action-state'
import { label as enumLabel } from '@/lib/options'
import { shortlistCandidateAction } from '@/server/actions/employer'
import { DisclosureRequestButton } from '@/components/employer/disclosure-request-button'
import type { AnonymizedProfile } from '@/server/anonymize'
import type { MatchExplanation } from '@/lib/engines/matching'

/**
 * Anonymised candidate card. Everything on screen already passed through
 * `src/server/anonymize.ts`: the handle, region, durations and skill rows are the
 * only fields the filter publishes, and the dialog lists what was withheld.
 */
export function CandidateMatchCard({
  jobId,
  profile,
  score,
  requiredScore,
  preferredScore,
  preferenceScore,
  evidenceScore,
  explanation,
  applied,
  shortlisted = false,
  existingNote = '',
}: {
  jobId: string
  profile: AnonymizedProfile
  score: number
  requiredScore: number
  preferredScore: number
  preferenceScore: number
  evidenceScore: number
  explanation: MatchExplanation
  applied: boolean
  shortlisted?: boolean
  existingNote?: string
}) {
  const [state, formAction, pending] = useActionState(
    shortlistCandidateAction.bind(null, jobId, profile.candidateProfileId),
    IDLE_STATE,
  )

  const credits = Array.isArray(explanation?.credits) ? explanation.credits : []
  const matched = Array.isArray(explanation?.matched) ? explanation.matched : []
  const gaps = Array.isArray(explanation?.gaps) ? explanation.gaps : []

  return (
    <Card>
      <CardContent className="space-y-3.5 pt-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm font-semibold tracking-tight">{profile.anonymousHandle}</span>
              {profile.identityRevealed ? (
                <Badge variant="secondary">Identity disclosed to your organisation</Badge>
              ) : (
                <Badge variant="outline">Anonymous</Badge>
              )}
              {applied ? <Badge variant="default">Applied</Badge> : null}
            </p>
            {profile.identityRevealed ? <p className="mt-1 text-sm font-medium">{profile.realName} · {profile.email}</p> : null}
            <p className="mt-1 text-sm font-medium">{profile.headline ?? 'Profile text withheld during anonymous review'}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {profile.locationRegion} · {profile.yearsOfExperience} yrs recorded ·{' '}
              {profile.workPreferenceLabel}
              {profile.availabilityHours ? ` · ~${profile.availabilityHours} hrs/week` : ''}
            </p>
          </div>
          <ScoreBar
            score={score}
            label="Weighted rules score"
            breakdown={[
              { label: 'Required', value: requiredScore },
              { label: 'Preferred', value: preferredScore },
              { label: 'Evidence', value: evidenceScore },
              { label: 'Preferences', value: preferenceScore },
            ]}
          />
        </div>

        <ul className="flex flex-wrap gap-1.5">
          {profile.skills.slice(0, 6).map((skill) => (
            <li
              key={skill.slug}
              className="inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-muted/40 px-2 py-1 text-xs"
            >
              <span className="font-medium">{skill.name}</span>
              <span className="text-muted-foreground">{enumLabel(skill.level)}</span>
              <StatusBadge value={skill.validationStatus} label={enumLabel(skill.validationStatus)} />
            </li>
          ))}
          {profile.skills.length === 0 ? (
            <li className="text-xs text-muted-foreground">No skills shared on this profile.</li>
          ) : null}
        </ul>

        <div className="flex flex-wrap items-center gap-2">
          <Dialog>
            <DialogTrigger render={<Button variant="outline" size="sm" />}>
              Why this score
            </DialogTrigger>
            <DialogContent className="max-h-[85dvh] gap-3 overflow-y-auto sm:max-w-2xl">
              <DialogHeader>
                <DialogTitle>Score explanation · {profile.anonymousHandle}</DialogTitle>
                <DialogDescription>
                  Produced by the weighted rules model{explanation?.modelVersion ? ` (${explanation.modelVersion})` : ''}.
                  Skill levels are self-reported or rule-suggested, not verified by AI, and a score is not an offer or a
                  prediction of performance.
                </DialogDescription>
              </DialogHeader>

              {Array.isArray(explanation?.summary) && explanation.summary.length > 0 ? (
                <ul className="list-disc space-y-1 pl-4 text-xs">
                  {explanation.summary.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              ) : null}

              <section aria-labelledby={`${profile.candidateProfileId}-inputs`} className="space-y-1.5">
                <h3 id={`${profile.candidateProfileId}-inputs`} className="text-xs font-medium tracking-wide uppercase">
                  Inputs
                </h3>
                <p className="text-xs text-muted-foreground">
                  Used: {Array.isArray(explanation?.inputsUsed) ? explanation.inputsUsed.join(', ') : '—'}
                </p>
                <p className="text-xs text-muted-foreground">
                  Deliberately excluded: {Array.isArray(explanation?.inputsExcluded) ? explanation.inputsExcluded.join(', ') : '—'}
                </p>
              </section>

              <section aria-labelledby={`${profile.candidateProfileId}-credits`} className="space-y-2">
                <h3 id={`${profile.candidateProfileId}-credits`} className="text-xs font-medium tracking-wide uppercase">
                  Every scored skill row ({credits.length})
                </h3>
                <ul className="divide-y divide-border/60 rounded-md border border-border/60">
                  {credits.map((credit) => (
                    <li key={`${credit.slug}-${credit.requirement}`} className="flex flex-wrap items-center gap-2 px-2.5 py-1.5 text-xs">
                      <span className="min-w-0 flex-1 truncate font-medium">{credit.name}</span>
                      <StatusBadge value={credit.requirement} label={enumLabel(credit.requirement)} />
                      <span className="text-muted-foreground">needs {enumLabel(credit.requiredLevel)}</span>
                      <span className="text-muted-foreground">
                        has {credit.candidateLevel ? enumLabel(credit.candidateLevel) : 'not evidenced'}
                      </span>
                      <span className="tabular-nums">{Math.round(credit.credit * 100)}% credit</span>
                    </li>
                  ))}
                  {credits.length === 0 ? (
                    <li className="px-2.5 py-1.5 text-xs text-muted-foreground">
                      No per-skill breakdown was stored for this match.
                    </li>
                  ) : null}
                </ul>
              </section>

              <div className="grid gap-3 sm:grid-cols-2">
                <section aria-labelledby={`${profile.candidateProfileId}-matched`} className="space-y-1.5">
                  <h3 id={`${profile.candidateProfileId}-matched`} className="text-xs font-medium tracking-wide uppercase">
                    Covered ({matched.length})
                  </h3>
                  <ul className="space-y-1 text-xs">
                    {matched.map((credit) => (
                      <li key={`m-${credit.slug}`} className="flex items-center justify-between gap-2">
                        <span className="truncate">{credit.name}</span>
                        <span className="text-muted-foreground">{Math.round(credit.credit * 100)}%</span>
                      </li>
                    ))}
                    {matched.length === 0 ? <li className="text-muted-foreground">Nothing fully covered yet.</li> : null}
                  </ul>
                </section>
                <section aria-labelledby={`${profile.candidateProfileId}-gaps`} className="space-y-1.5">
                  <h3 id={`${profile.candidateProfileId}-gaps`} className="text-xs font-medium tracking-wide uppercase">
                    Gaps ({gaps.length})
                  </h3>
                  <ul className="space-y-1 text-xs">
                    {gaps.map((credit) => (
                      <li key={`g-${credit.slug}`} className="flex items-center justify-between gap-2">
                        <span className="truncate">{credit.name}</span>
                        <span className="text-muted-foreground">
                          {credit.candidateLevel ? enumLabel(credit.candidateLevel) : 'not evidenced'}
                        </span>
                      </li>
                    ))}
                    {gaps.length === 0 ? <li className="text-muted-foreground">No skill gaps against this role.</li> : null}
                  </ul>
                </section>
              </div>

              <section aria-labelledby={`${profile.candidateProfileId}-history`} className="space-y-1.5">
                <h3 id={`${profile.candidateProfileId}-history`} className="text-xs font-medium tracking-wide uppercase">
                  Experience as published ({profile.experiences.length})
                </h3>
                <ul className="space-y-1.5 text-xs">
                  {profile.experiences.map((item) => (
                    <li key={item.id} className="rounded-md border border-border/60 px-2.5 py-1.5">
                      <p className="font-medium">{item.title}</p>
                      <p className="text-muted-foreground">
                        {item.organizationLabel} · {item.typeLabel} · {item.durationLabel}
                      </p>
                      {item.description ? <p className="mt-1 leading-relaxed">{item.description}</p> : null}
                    </li>
                  ))}
                  {profile.experiences.length === 0 ? (
                    <li className="text-muted-foreground">No experience rows shared.</li>
                  ) : null}
                </ul>
                {profile.educationSummary ? (
                  <p className="text-xs text-muted-foreground">Education: {profile.educationSummary}</p>
                ) : null}
              </section>

              <InfoNote tone="privacy" title="What the anonymisation filter withheld">
                <ul className="list-disc space-y-0.5 pl-4 text-xs">
                  {profile.redactions.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </InfoNote>
            </DialogContent>
          </Dialog>

          {applied ? (
            <Button
              variant="ghost"
              size="sm"
              nativeButton={false}
              render={<Link href="/employer/applications" />}
            >
              View their application
            </Button>
          ) : null}

          <DisclosureRequestButton
            candidateProfileId={profile.candidateProfileId}
            anonymousHandle={profile.anonymousHandle}
            jobId={jobId}
            applied={profile.identityRevealed}
          />
        </div>

        <form action={formAction} className="space-y-2 border-t border-border/60 pt-3">
          <FormStatus state={state} />
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <div>
              <Label htmlFor={`${profile.candidateProfileId}-note`}>
                Shortlist note (private to your organisation)
              </Label>
              <Input
                id={`${profile.candidateProfileId}-note`}
                name="note"
                maxLength={400}
                defaultValue={existingNote}
                placeholder="Why this person is worth a conversation."
                className="mt-1.5"
              />
              <FieldError state={state} name="note" />
            </div>
            <Button type="submit" size="sm" variant={shortlisted ? 'outline' : 'default'} disabled={pending}>
              {pending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
              {shortlisted ? 'Save note' : 'Add to shortlist'}
            </Button>
          </div>
          {shortlisted ? (
            <p className="text-xs text-muted-foreground">Already on your shortlist for this role.</p>
          ) : null}
        </form>
      </CardContent>
    </Card>
  )
}
