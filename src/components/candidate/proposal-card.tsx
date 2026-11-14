'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ShieldQuestion } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { InfoNote, StatusBadge } from '@/components/common'
import { PROFICIENCY_LEVELS, label } from '@/lib/options'
import { formatDate, relativeTime } from '@/lib/utils'
import { ActionForm, HiddenFields, SubmitButton } from '@/components/candidate/action-form'
import { ActionSubmit } from '@/components/candidate/action-submit'
import { SelectField, TextAreaField } from '@/components/candidate/field'
import { decideProposalAction } from '@/server/actions/ai'

/** The serialisable slice of a stored proposal this card renders. */
export type ProposalData = {
  id: string
  skill: { slug: string; name: string; category: string; transferable: boolean }
  proposedLevel: string
  confidence: number
  evidence: { quote: string; context: string }[]
  rationale: string
  requiresHumanReview: boolean
  status: string
  decisionNote: string | null
  createdAt: Date
  origin: { mode: string; label: string; fallbackReason: string | null; runAt: Date }
}

const LEVEL_ITEMS = PROFICIENCY_LEVELS.map((level) => ({ value: level, label: label(level) }))

/**
 * One suggestion and the three ways to answer it. Confirming stores the skill as
 * *you confirmed it* — never as verified — because the only thing that happened
 * is that you agreed with a suggestion.
 */
export function ProposalCard({ proposal }: { proposal: ProposalData }) {
  const [editing, setEditing] = useState(false)
  const open = proposal.status === 'PROPOSED'

  return (
    <Card className={open ? 'border-brand-200' : 'border-border/70 bg-muted/20'}>
      <CardHeader className="pb-2.5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="text-sm">{proposal.skill.name}</CardTitle>
            <CardDescription className="mt-1 text-xs">
              {label(proposal.skill.category).toLowerCase()} · proposed at {label(proposal.proposedLevel).toLowerCase()}
              {proposal.skill.transferable ? ' · transferable' : ''}
            </CardDescription>
          </div>
          <div className="flex flex-col items-end gap-1">
            <StatusBadge value={proposal.status} />
            <span className="text-[11px] text-muted-foreground">{proposal.origin.label}</span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div>
          <div className="flex items-baseline justify-between">
            <span className="text-xs text-muted-foreground">Suggestion confidence</span>
            <span className="text-xs font-semibold tabular-nums">{Math.round(proposal.confidence * 100)}%</span>
          </div>
          <Progress value={Math.round(proposal.confidence * 100)} className="mt-1 h-2" aria-label={`${proposal.skill.name} proposal confidence`} />
        </div>

        <p className="text-sm leading-relaxed">{proposal.rationale}</p>

        <div className="rounded-lg border border-dashed border-border bg-white/60 p-2.5">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            The words this came from
          </p>
          {proposal.evidence.length === 0 ? (
            <p className="mt-1 text-xs text-muted-foreground">No quote was stored with this suggestion.</p>
          ) : null}
          <ul className="mt-1 flex flex-col gap-1.5">
            {proposal.evidence.map((entry, index) => (
              <li key={`${entry.quote}-${index}`} className="text-xs leading-relaxed">
                <span className="italic">“{entry.quote}”</span>
                <span className="text-muted-foreground"> — {entry.context.toLowerCase()}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Produced {relativeTime(proposal.createdAt)} ({formatDate(proposal.createdAt)}) by {proposal.origin.label}
          {proposal.origin.fallbackReason ? ` · that run reported ${proposal.origin.fallbackReason}` : ''}.
        </p>

        {proposal.requiresHumanReview ? (
          <InfoNote tone="warning" title="Flagged for a human look">
            This suggestion came from wording about care or community work. The platform will not mark that as
            professionally verified competence — you can confirm it as your own self-reported claim, or reject it.
          </InfoNote>
        ) : null}

        <Separator />

        {open ? (
          <div className="flex flex-wrap items-center gap-2">
            <ActionSubmit
              action={decideProposalAction}
              fields={{ proposalId: proposal.id, decision: 'CONFIRMED' }}
              label="Yes, that is mine"
              variant="default"
              size="sm"
              showStatus
            />
            <Button variant="outline" size="sm" onClick={() => setEditing((current) => !current)}>
              {editing ? 'Cancel' : 'Change the level first'}
            </Button>
            <ActionSubmit
              action={decideProposalAction}
              fields={{ proposalId: proposal.id, decision: 'REJECTED' }}
              label="Not me — reject"
              variant="ghost"
              size="sm"
              showStatus
            />
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Recorded as {proposal.status.toLowerCase()}
            {proposal.decisionNote ? `: “${proposal.decisionNote}”` : ''}. A suggestion is never changed back here; the
            skills inventory is where you edit or remove what you accepted.{' '}
            <Link href="/candidate/skills" className="underline underline-offset-2">
              Open inventory
            </Link>
          </p>
        )}

        {open && editing ? (
          <ActionForm
            action={decideProposalAction}
            className="gap-3 rounded-lg border border-border/70 bg-muted/30 p-3"
          >
            {({ state, pending }) => (
              <>
                <HiddenFields fields={{ proposalId: proposal.id, decision: 'EDITED' }} />
                <SelectField
                  id={`level-${proposal.id}`}
                  name="level"
                  label="The level you would defend"
                  items={LEVEL_ITEMS}
                  required
                  state={state}
                  defaultValue={proposal.proposedLevel}
                  help="This becomes the stored level on your inventory. Nothing here is checked against an external standard."
                />
                <TextAreaField
                  id={`note-${proposal.id}`}
                  name="note"
                  label="Why you are keeping it (optional)"
                  rows={2}
                  state={state}
                  placeholder="For example: I did this weekly for three years, but never under a deadline from a client."
                />
                <SubmitButton pending={pending} variant="outline" size="sm">
                  Save at that level
                </SubmitButton>
                {state.status === 'error' ? (
                  <p className="text-xs text-destructive" role="alert">
                    {state.message}
                  </p>
                ) : null}
              </>
            )}
          </ActionForm>
        ) : null}
      </CardContent>
    </Card>
  )
}

/** Explanatory strip shown above the inbox so the status words are not guessed. */
export function ProvenanceExplanation() {
  return (
    <div className="flex flex-wrap gap-2 text-[11px]">
      <Badge variant="outline">suggested — the platform proposed it</Badge>
      <Badge variant="outline">you confirmed — you accepted or edited it</Badge>
      <Badge variant="outline">assessment-verified — a question set was passed</Badge>
      <Badge variant="outline">human reviewed — evidence checked on this platform</Badge>
      <Badge variant="outline" className="flex items-center gap-1">
        <ShieldQuestion className="size-3" aria-hidden />
        there is no outside verification in this build
      </Badge>
    </div>
  )
}
