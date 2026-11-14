'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Info, Send } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'
import { InfoNote, ScoreBar, StatusBadge } from '@/components/common'
import { ContributionBreakdown } from '@/components/data/contribution-breakdown'
import { label } from '@/lib/options'
import type { MatchExplanation, SkillCredit } from '@/lib/engines/matching'
import { ActionForm, HiddenFields, SubmitButton } from '@/components/candidate/action-form'
import { CheckboxField, TextAreaField } from '@/components/candidate/field'
import { applyToJobAction } from '@/server/actions/applications'

export type ApplicationSnapshot = { id: string; status: string } | null

/**
 * The two candidate-side controls on a recommended role: open the full
 * calculation the matching model produced, or apply.
 */
export function JobActions({
  jobId,
  jobTitle,
  explanation,
  application,
  detailHref,
  compact = false,
}: {
  jobId: string
  jobTitle: string
  explanation: MatchExplanation
  application: ApplicationSnapshot
  detailHref: string
  compact?: boolean
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <ExplanationDialog explanation={explanation} jobTitle={jobTitle} />
      {application ? (
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            Already applied
            <StatusBadge value={application.status} />
          </span>
          <Button variant="outline" size="sm" className="text-xs" nativeButton={false} render={<Link href="/candidate/applications" />}>
            Track it
          </Button>
        </div>
      ) : (
        <ApplyDialog jobId={jobId} jobTitle={jobTitle} detailHref={detailHref} compact={compact} />
      )}
    </div>
  )
}

function ApplyDialog({
  jobId,
  jobTitle,
  detailHref,
  compact,
}: {
  jobId: string
  jobTitle: string
  detailHref: string
  compact: boolean
}) {
  const [open, setOpen] = useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button size="sm" className={compact ? 'text-xs' : 'bg-brand-600 hover:bg-brand-700'} />
        }
      >
        <Send className="size-3.5" aria-hidden />
        Apply
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Apply to {jobTitle}</DialogTitle>
          <DialogDescription>
            Applying is one of the two ways your name and contact details reach an organisation — the other is
            approving a disclosure request. Until you apply or approve, this employer sees only your anonymous handle
            and your skills.
          </DialogDescription>
        </DialogHeader>
        <ActionForm
          action={applyToJobAction}
          className="gap-4"
          onSuccess={(message) => {
            setOpen(false)
            toast.success(message ?? 'Application submitted.')
          }}
        >
          {({ state, pending }) => (
            <>
              <HiddenFields fields={{ jobId }} />
              <TextAreaField
                id="coverLetter"
                label="Note to the hiring team"
                rows={6}
                state={state}
                placeholder="Which of your skills map to what they need, and what you want next. Optional — the skills-first review starts from your inventory."
              />
              <CheckboxField name="identityConsent" label="I consent to share my name, email and profile text with this organisation." help="Withdrawing the application stops this grant; it cannot erase what was already read." />
              <div className="flex flex-wrap items-center gap-3">
                <SubmitButton pending={pending}>Submit application</SubmitButton>
                <Button variant="ghost" size="sm" className="text-xs" nativeButton={false} render={<Link href={detailHref} />}>
                  Read the full role first
                </Button>
              </div>
            </>
          )}
        </ActionForm>
        <InfoNote tone="privacy" title="What this discloses">
          Your name, email and the experience descriptions on your profile become visible to this organisation, and each
          later view of your identity is logged. Withdrawing the application does not un-send what they have already
          read.
        </InfoNote>
      </DialogContent>
    </Dialog>
  )
}

function ExplanationDialog({ explanation, jobTitle }: { explanation: MatchExplanation; jobTitle: string }) {
  // The four buckets, in the units the model actually stores: a 0–1 category
  // score, the normalised weight it was multiplied by, and the points that
  // product added to a 0–100 total.
  const hasRequired = explanation.credits.some((credit) => credit.requirement === 'REQUIRED')
  const hasPreferred = explanation.credits.some((credit) => credit.requirement === 'PREFERRED')
  const evidenceCounted = Object.values(explanation.evidenceSummary).reduce((total, value) => total + value, 0)
  const constraintsStated = explanation.preferenceChecks.filter((check) => check.fit != null).length
  const total = explanation.calculation.reduce((sum, line) => sum + line.contribution, 0) * 100

  const rows = explanation.calculation.map((line) => {
    const redistributed = line.weight !== (explanation.weights[line.key] ?? 0)
    const missing =
      (line.key === 'required' && !hasRequired) ||
      (line.key === 'preferred' && !hasPreferred) ||
      (line.key === 'evidence' && evidenceCounted === 0) ||
      (line.key === 'preferences' && constraintsStated === 0)
    return {
      key: line.key,
      label: line.label,
      value: line.raw,
      weight: line.weight,
      contribution: line.contribution * 100,
      ...(missing ? { missing: true } : {}),
      note: `${line.note}${redistributed ? ` Weight shows ${Math.round(line.weight * 100)}% because an empty category handed its nominal ${Math.round((explanation.weights[line.key] ?? 0) * 100)}% to the categories that have data.` : ''}`,
    }
  })

  return (
    <Dialog>
      <DialogTrigger render={<Button variant="outline" size="sm" className="text-xs" />}>
        <Info className="size-3.5" aria-hidden />
        Why this score
      </DialogTrigger>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Match explanation · {jobTitle}</DialogTitle>
          <DialogDescription>
            Weighted rule model {explanation.modelVersion}, weights {explanation.weightsVersion}. Every number below is
            that model’s own output — no AI judgement of you is involved.
          </DialogDescription>
        </DialogHeader>

        <ul className="flex flex-col gap-1.5 text-sm leading-relaxed">
          {explanation.summary.map((line) => (
            <li key={line} className="rounded-lg border border-border/70 bg-muted/30 px-3 py-2">
              {line}
            </li>
          ))}
        </ul>

        <Separator />

        <div>
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">The calculation</p>
          <ContributionBreakdown
            className="mt-2"
            title="Match score components"
            rows={rows}
            total={total}
            totalLabel="Match score"
          />
          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">{explanation.formula}</p>
        </div>

        <InfoNote tone="warning" title="Prototype weights, not a validated instrument">
          {explanation.assumptionNote}
        </InfoNote>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3">
            <p className="text-xs font-medium tracking-wide uppercase">Matched required skills</p>
            <CreditLines items={explanation.matched.filter((credit) => credit.requirement === 'REQUIRED')} />
          </div>
          <div className="rounded-lg border border-rose-200 bg-rose-50/60 p-3">
            <p className="text-xs font-medium tracking-wide uppercase">Missing required skills</p>
            <CreditLines items={explanation.missingRequired} />
          </div>
          <div className="rounded-lg border border-brand-200 bg-brand-50/60 p-3">
            <p className="text-xs font-medium tracking-wide uppercase">Matched preferred skills</p>
            <CreditLines items={explanation.matchedPreferred} />
          </div>
          <div className="rounded-lg border border-border/70 bg-muted/30 p-3">
            <p className="text-xs font-medium tracking-wide uppercase">Strength of the evidence behind them</p>
            <ul className="mt-1.5 grid grid-cols-2 gap-1 text-xs">
              <li>Assessed ×{explanation.evidenceSummary.assessed}</li>
              <li>Human reviewed ×{explanation.evidenceSummary.reviewed}</li>
              <li>You confirmed ×{explanation.evidenceSummary.confirmed}</li>
              <li>Self-reported ×{explanation.evidenceSummary.reported}</li>
              <li>Suggested ×{explanation.evidenceSummary.suggested}</li>
              <li>Disputed ×{explanation.evidenceSummary.disputed}</li>
            </ul>
            <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
              Counted only across the skills this role asks for, and normalised into the {explanation.calculation.find((line) => line.key === 'evidence')?.raw.toFixed(2)}{' '}
              evidence figure above.
            </p>
          </div>
        </div>

        <div>
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Constraints checked ({explanation.preferenceChecks.length})
          </p>
          <ul className="mt-1.5 flex flex-col gap-1.5">
            {explanation.preferenceChecks.map((check) => (
              <li key={check.label} className="rounded-lg border border-border/70 bg-card px-2.5 py-1.5 text-xs">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="font-medium">{check.label}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {check.fit == null ? 'not stated — excluded' : `${Math.round(check.fit * 100)}%`}
                  </span>
                </span>
                <p className="mt-0.5 leading-relaxed text-muted-foreground">{check.note}</p>
              </li>
            ))}
          </ul>
        </div>

        <Separator />

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Read by the model</p>
            <ul className="mt-1.5 list-disc pl-4 text-xs leading-relaxed text-muted-foreground">
              {explanation.inputsUsed.map((input) => (
                <li key={input}>{input}</li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-xs font-medium tracking-wide text-emerald-800 uppercase">Never read</p>
            <ul className="mt-1.5 list-disc pl-4 text-xs leading-relaxed text-emerald-900">
              {explanation.inputsExcluded.map((input) => (
                <li key={input}>{input}</li>
              ))}
            </ul>
          </div>
        </div>

        {explanation.missingRequired.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/candidate/pathways" />}>
              Close these gaps
            </Button>
            <Button variant="ghost" size="sm" className="text-xs" nativeButton={false} render={<Link href="/candidate/gap-report" />}>
              Full gap report
            </Button>
          </div>
        ) : null}

        <InfoNote tone="info" title="Skills-first, concretely">
          The score above is built only from the fields in “Read by the model”. Career-break length, break reason, age,
          caregiving status and employer names are not parameters of the function that produced it.
        </InfoNote>
      </DialogContent>
    </Dialog>
  )
}

function CreditLines({ items }: { items: SkillCredit[] }) {
  if (items.length === 0) {
    return <p className="mt-1.5 text-xs text-muted-foreground">Nothing in this group.</p>
  }
  return (
    <ul className="mt-1.5 flex flex-col gap-1.5">
      {items.map((item) => (
        <li key={`${item.slug}-${item.requirement}`} className="text-xs leading-relaxed">
          <span className="font-medium">{item.name}</span>{' '}
          <span className="text-muted-foreground">
            — needs {label(item.requiredLevel)},{' '}
            {item.candidateLevel ? `held at ${label(item.candidateLevel)}` : 'not held'} · {Math.round(item.credit * 100)}%
            covered
            {item.validationStatus ? ` · ${label(item.validationStatus).toLowerCase()}` : ''}
          </span>
        </li>
      ))}
    </ul>
  )
}

/** Compact score header used on the recommended-role cards. */
export function MatchSummary({ explanation, score }: { explanation: MatchExplanation; score: number }) {
  return (
    <ScoreBar
      score={score}
      label="Match"
      breakdown={[
        { label: 'Required', value: explanation.calculation.find((line) => line.key === 'required')?.raw ?? 0 },
        { label: 'Preferred', value: explanation.calculation.find((line) => line.key === 'preferred')?.raw ?? 0 },
        { label: 'Evidence', value: explanation.calculation.find((line) => line.key === 'evidence')?.raw ?? 0 },
        { label: 'Constraints', value: explanation.calculation.find((line) => line.key === 'preferences')?.raw ?? 0 },
      ]}
    />
  )
}

export function CreditBadge({ credit }: { credit: SkillCredit }) {
  return (
    <Badge variant={credit.status === 'COVERED' ? 'default' : credit.status === 'PARTIAL' ? 'secondary' : 'outline'}>
      {credit.name}
    </Badge>
  )
}
