'use client'

import { useMemo, useState } from 'react'
import { Plus, Search, ShieldQuestion } from 'lucide-react'
import { toast } from 'sonner'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { ScrollArea } from '@/components/ui/scroll-area'
import { StatusBadge } from '@/components/common'
import { EVIDENCE_TYPES, PROFICIENCY_LEVELS, label, optionsFor } from '@/lib/options'
import { ActionForm, HiddenFields, SubmitButton } from '@/components/candidate/action-form'
import { SelectField, TextAreaField, TextField } from '@/components/candidate/field'
import { ConfirmAction } from '@/components/candidate/confirm-action'
import {
  addEvidenceAction,
  removeEvidenceAction,
  removeSkillAction,
  upsertSkillAction,
} from '@/server/actions/candidate'

export type SkillEvidenceData = {
  id: string
  type: string
  description: string
  url: string | null
}

export type SkillRowData = {
  id: string
  slug: string
  name: string
  category: string
  transferable: boolean
  level: string
  confidence: number
  validationStatus: string
  source: string
  note: string | null
  evidence: SkillEvidenceData[]
}

export type CatalogSkillData = {
  slug: string
  name: string
  category: string
  transferable: boolean
}

const LEVEL_ITEMS = optionsFor(PROFICIENCY_LEVELS)
const EVIDENCE_ITEMS = optionsFor(EVIDENCE_TYPES)
const STATUS_ITEMS = [
  { value: 'SELF_REPORTED', label: 'Self reported — I state this myself' },
  { value: 'DISPUTED', label: 'Disputed — flag that this claim is wrong' },
]

export function SkillsBoard({ skills, catalog }: { skills: SkillRowData[]; catalog: CatalogSkillData[] }) {
  const evidenced = skills.filter((skill) => skill.evidence.length > 0).length

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {skills.length} skill{skills.length === 1 ? '' : 's'} on file · {evidenced} with evidence
        </p>
        <SkillFormDialog catalog={catalog} />
      </div>

      <ValidationLegend />

      <ul className="grid gap-4 lg:grid-cols-2">
        {skills.map((skill) => (
          <li key={skill.id}>
            <SkillCard skill={skill} catalog={catalog} />
          </li>
        ))}
      </ul>
    </div>
  )
}

function ValidationLegend() {
  const rows: { status: string; text: string }[] = [
    {
      status: 'SELF_REPORTED',
      text: 'You stated the level yourself. It starts at 0.6 confidence and evidence raises it.',
    },
    {
      status: 'RULE_INFERRED',
      text: 'Proposed by the keyword rule that read your own wording, with the matching phrase stored as evidence. Editing or saving such an entry converts it to self reported.',
    },
    {
      status: 'HR_REVIEWED',
      text: 'Set by a reviewer on the platform. A profile owner cannot set it, and the form blocks the attempt.',
    },
  ]

  return (
    <div className="grid gap-3 rounded-xl border border-border/70 bg-muted/25 p-4 sm:grid-cols-3">
      {rows.map((row) => (
        <div key={row.status} className="flex flex-col gap-1.5">
          <StatusBadge value={row.status} />
          <p className="text-xs leading-relaxed text-muted-foreground">{row.text}</p>
        </div>
      ))}
      <p className="text-xs leading-relaxed text-muted-foreground sm:col-span-3">
        Inference here is keyword matching against a curated taxonomy and its aliases — not verification, and not an
        assessment of aptitude. The optional Skill suggestions agent can ask a language model the same question when AI
        is enabled for this deployment; what it returns is a proposal labelled with the engine that wrote it, and it
        becomes a skill only if you accept it.
      </p>
    </div>
  )
}

function SkillCard({ skill, catalog }: { skill: SkillRowData; catalog: CatalogSkillData[] }) {
  const percent = Math.round(skill.confidence * 100)

  return (
    <Card className="h-full">
      <CardHeader className="gap-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="text-[15px] leading-snug">{skill.name}</CardTitle>
            <CardDescription className="mt-1 flex flex-wrap items-center gap-2 text-xs">
              <Badge variant="secondary" className="bg-brand-50 text-brand-800">
                {label(skill.category)}
              </Badge>
              <span>{label(skill.level)}</span>
              <span aria-hidden>·</span>
              <span>{skill.transferable ? 'Transferable' : 'Role-specific'}</span>
              <span aria-hidden>·</span>
              <span>source {skill.source.toLowerCase()}</span>
            </CardDescription>
          </div>
          <StatusBadge value={skill.validationStatus} />
        </div>
        <div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs font-medium text-muted-foreground">Confidence</span>
            <span className="text-sm font-semibold tabular-nums">{percent}%</span>
          </div>
          <Progress value={percent} className="mt-1 h-2" aria-label={`${skill.name} confidence ${percent} percent`} />
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-3.5">
        {skill.note ? (
          <div className="rounded-lg border border-dashed border-brand-200 bg-brand-50/50 px-3 py-2.5">
            <p className="text-[11px] font-medium tracking-wide text-brand-700 uppercase">Why this is here</p>
            <p className="mt-1 text-xs leading-relaxed text-brand-900">{skill.note}</p>
          </div>
        ) : null}

        <div>
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Evidence ({skill.evidence.length})
          </p>
          {skill.evidence.length === 0 ? (
            <p className="mt-1.5 text-sm text-muted-foreground">
              No evidence yet. Attaching any proof raises this skill’s confidence.
            </p>
          ) : (
            <ul className="mt-1.5 flex flex-col gap-2">
              {skill.evidence.map((entry) => (
                <li key={entry.id} className="rounded-lg border border-border/70 bg-card px-3 py-2">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs leading-relaxed">{entry.description}</p>
                    <ConfirmAction
                      action={removeEvidenceAction.bind(null, entry.id)}
                      triggerLabel="Remove"
                      triggerVariant="ghost"
                      triggerSize="xs"
                      triggerClassName="shrink-0 text-muted-foreground"
                      title="Delete this evidence?"
                      description="The skill stays on your profile; only this piece of proof is removed, and the evidence count and confidence are recalculated."
                      confirmLabel="Delete evidence"
                      cancelLabel="Keep it"
                    />
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <StatusBadge value={entry.type} />
                    <span className="text-[11px] text-muted-foreground">{label(entry.type)}</span>
                    {entry.url ? (
                      <a
                        href={entry.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="text-[11px] underline underline-offset-2"
                      >
                        Open link
                      </a>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <EvidenceFormDialog candidateSkillId={skill.id} skillName={skill.name} />
          <SkillFormDialog catalog={catalog} skill={skill} />
          <ConfirmAction
            action={removeSkillAction.bind(null, skill.id)}
            triggerLabel="Remove skill"
            triggerVariant="ghost"
            triggerClassName="text-xs text-destructive hover:text-destructive"
            title={`Remove ${skill.name}?`}
            description="It leaves your inventory, your capability graph and every match score computed against it. Evidence attached to it is deleted too."
            confirmLabel="Remove skill"
            cancelLabel="Keep it"
          />
        </div>
      </CardContent>
    </Card>
  )
}

export function SkillFormDialog({ catalog, skill }: { catalog: CatalogSkillData[]; skill?: SkillRowData }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [slug, setSlug] = useState(skill?.slug ?? '')

  const matches = useMemo(() => {
    const term = query.trim().toLowerCase()
    const pool = skill
      ? catalog.filter((entry) => entry.slug === skill.slug)
      : term.length === 0
        ? catalog.slice(0, 16)
        : catalog.filter(
            (entry) =>
              entry.name.toLowerCase().includes(term) ||
              entry.category.toLowerCase().includes(term) ||
              entry.slug.includes(term),
          )
    return pool.slice(0, 50)
  }, [catalog, query, skill])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            variant={skill ? 'ghost' : 'default'}
            size="sm"
            className={skill ? 'text-xs' : 'bg-brand-600 hover:bg-brand-700'}
          />
        }
      >
        {skill ? (
          'Edit skill'
        ) : (
          <>
            <Plus className="size-4" aria-hidden />
            Add a skill
          </>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{skill ? `Edit ${skill.name}` : 'Add a skill to your inventory'}</DialogTitle>
          <DialogDescription>
            Choose the skill from the catalogue, state the level you would defend in an interview, and say why in the
            note. Your note is shown as your own claim, never as verification.
          </DialogDescription>
        </DialogHeader>

        <ActionForm
          action={upsertSkillAction}
          className="gap-4"
          onSuccess={(message) => {
            setOpen(false)
            toast.success(message ?? 'Skill saved.')
          }}
        >
          {({ state, pending }) => (
            <>
              <HiddenFields fields={slug ? { skillSlug: slug } : {}} />

              <div className="flex flex-col gap-2">
                <Label htmlFor="skill-search" className="text-[13px] font-medium">
                  {skill ? 'Catalogue skill' : 'Search the skill catalogue'}
                  {skill ? null : <span className="ml-1 text-brand-700">*</span>}
                </Label>
                <div className="relative">
                  <Search
                    className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
                    aria-hidden
                  />
                  <Input
                    id="skill-search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={`${catalog.length} catalogue skills — try “scheduling”, “excel”, “stakeholder”`}
                    className="w-full pl-8"
                    disabled={Boolean(skill)}
                    aria-describedby="skill-picker-help"
                  />
                </div>
                {state.status === 'error' && state.fieldErrors?.skillSlug ? (
                  <p id="skill-slug-error" role="alert" className="text-xs font-medium text-destructive">
                    {state.fieldErrors.skillSlug}
                  </p>
                ) : null}
                <p id="skill-picker-help" className="text-xs text-muted-foreground">
                  {skill
                    ? 'The skill itself is fixed while editing — save to change its level, status and note. To record a different skill, remove this one and add the other.'
                    : 'Pick the closest catalogue skill. Names are fixed so the same skill cannot be duplicated.'}
                </p>

                <ScrollArea className="max-h-56 rounded-lg border border-border/70">
                  <RadioGroup
                    value={slug}
                    onValueChange={(next) => setSlug(String(next ?? ''))}
                    className="gap-0 p-2"
                    aria-label="Catalogue skill"
                  >
                    {matches.length === 0 ? (
                      <p className="px-1 py-2 text-sm text-muted-foreground">
                        No catalogue skill matches “{query}”. Try a broader word.
                      </p>
                    ) : null}
                    {matches.map((entry) => (
                      <label
                        key={entry.slug}
                        htmlFor={`skill-${entry.slug}`}
                        className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-accent"
                      >
                        <RadioGroupItem id={`skill-${entry.slug}`} value={entry.slug} />
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate text-sm">{entry.name}</span>
                          <span className="text-[11px] text-muted-foreground">
                            {label(entry.category)} · {entry.transferable ? 'transferable' : 'role-specific'}
                          </span>
                        </span>
                      </label>
                    ))}
                  </RadioGroup>
                </ScrollArea>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <SelectField
                  id="level"
                  label="Level"
                  items={LEVEL_ITEMS}
                  required
                  state={state}
                  defaultValue={skill?.level ?? 'FUNCTIONAL'}
                  help="Developing to Expert. Evidence raises confidence, never the level by itself."
                />
                <SelectField
                  id="validationStatus"
                  label="Validation status"
                  items={STATUS_ITEMS}
                  required
                  state={state}
                  defaultValue={skill?.validationStatus === 'DISPUTED' ? 'DISPUTED' : 'SELF_REPORTED'}
                  help={
                    skill?.validationStatus === 'RULE_INFERRED'
                      ? 'This entry was suggested by the keyword rule. Saving it converts the entry to self reported — accept it as yours or remove it.'
                      : 'Rule-inferred and reviewed statuses are set by the engine or a reviewer, not here.'
                  }
                />
              </div>

              <TextAreaField
                id="note"
                label="Why this skill belongs on your profile"
                rows={3}
                state={state}
                defaultValue={skill?.note ?? undefined}
                placeholder="What you handled, for whom, at what scale."
              />

              <SubmitButton pending={pending}>{skill ? 'Save changes' : 'Add skill'}</SubmitButton>
            </>
          )}
        </ActionForm>
      </DialogContent>
    </Dialog>
  )
}

export function EvidenceFormDialog({ candidateSkillId, skillName }: { candidateSkillId: string; skillName: string }) {
  const [open, setOpen] = useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" className="text-xs" />}>
        <ShieldQuestion className="size-3.5" aria-hidden />
        Add evidence
      </DialogTrigger>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Evidence for {skillName}</DialogTitle>
          <DialogDescription>
            A certification, a project artefact, an assessment result, a review, or the described outcome of an
            experience. Evidence raises confidence inside your own inventory — it is not third-party verification.
          </DialogDescription>
        </DialogHeader>
        <ActionForm
          action={addEvidenceAction}
          className="gap-4"
          onSuccess={(message) => {
            setOpen(false)
            toast.success(message ?? 'Evidence attached.')
          }}
        >
          {({ state, pending }) => (
            <>
              <HiddenFields fields={{ candidateSkillId }} />
              <SelectField
                id="type"
                label="Evidence type"
                items={EVIDENCE_ITEMS}
                required
                state={state}
                defaultValue="EXPERIENCE_DESCRIPTION"
              />
              <TextAreaField
                id="description"
                label="What is the evidence?"
                rows={4}
                required
                state={state}
                placeholder="Describe the artefact, result or responsibility this points to."
              />
              <TextField id="url" label="Link" state={state} placeholder="https:// — portfolio, certificate, report" />
              <SubmitButton pending={pending}>Attach evidence</SubmitButton>
            </>
          )}
        </ActionForm>
      </DialogContent>
    </Dialog>
  )
}
