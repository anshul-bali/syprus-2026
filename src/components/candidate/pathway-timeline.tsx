import { Check, Clock, Link2, SkipForward } from 'lucide-react'
import { PlanItemStatus } from '@/components/candidate/plan-item-status'
import { DemoBadge } from '@/components/common'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { label } from '@/lib/options'
import { formatDateTime } from '@/lib/utils'

/**
 * The pathway as a sequence: what the catalogue holds, what the candidate has
 * recorded, and what comes next. Every figure is read off stored rows —
 * durations come from the catalogue entry, dates from the moment a status was
 * recorded, and a step with no link says so instead of pointing somewhere plausible.
 */
export type PathwayStep = {
  id: string
  position: number
  status: string
  completedAt: Date | null
  note: string | null
  gapSkillName: string | null
  resource: {
    title: string
    provider: string
    type: string
    url: string | null
    durationHours: number | null
    isFree: boolean
    costLabel: string | null
    outcome: string | null
    demonstration: boolean
  }
}

const STATUS_TONE: Record<string, string> = {
  COMPLETED: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  IN_PROGRESS: 'border-brand-200 bg-brand-50 text-brand-700',
  SKIPPED: 'border-border bg-muted text-muted-foreground',
  NOT_STARTED: 'border-border bg-card text-muted-foreground',
}

function hours(value: number | null) {
  return value == null ? null : `${value}h`
}

export function PathwayTimeline({
  steps,
  planId,
  active = true,
}: {
  steps: PathwayStep[]
  planId: string
  /** A retired plan still shows its record, but it is not offering a next step. */
  active?: boolean
}) {
  const completed = steps.filter((step) => step.status === 'COMPLETED')
  const inProgress = steps.filter((step) => step.status === 'IN_PROGRESS')
  const skipped = steps.filter((step) => step.status === 'SKIPPED')
  const notStarted = steps.filter((step) => step.status === 'NOT_STARTED')
  const nextStep = steps.find((step) => step.status === 'IN_PROGRESS') ?? steps.find((step) => step.status === 'NOT_STARTED')

  const cataloguedHours = steps.reduce((total, step) => total + (step.resource.durationHours ?? 0), 0)
  const recordedHours = completed.reduce((total, step) => total + (step.resource.durationHours ?? 0), 0)
  const unknownDuration = steps.filter((step) => step.resource.durationHours == null).length
  const unlinked = steps.filter((step) => !step.resource.url).length

  const tally = [
    { key: 'COMPLETED', count: completed.length },
    { key: 'IN_PROGRESS', count: inProgress.length },
    { key: 'SKIPPED', count: skipped.length },
    { key: 'NOT_STARTED', count: notStarted.length },
  ].filter((entry) => entry.count > 0)

  return (
    <div className="flex flex-col gap-3">
      <div
        role="img"
        aria-label={`Progress across ${steps.length} recorded steps: ${tally.map((entry) => `${entry.count} ${label(entry.key).toLowerCase()}`).join(', ')}.`}
        className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted ring-1 ring-border/70"
      >
        {tally.map((entry) => (
          <div
            key={entry.key}
            className={
              entry.key === 'COMPLETED'
                ? 'h-full bg-emerald-500'
                : entry.key === 'IN_PROGRESS'
                  ? 'h-full bg-brand-500'
                  : entry.key === 'SKIPPED'
                    ? 'h-full bg-muted-foreground/35'
                    : 'h-full bg-border'
            }
            style={{ width: `${(entry.count / steps.length) * 100}%` }}
          />
        ))}
      </div>

      <p className="text-xs leading-relaxed text-muted-foreground">
        {completed.length} of {steps.length} steps recorded as complete
        {inProgress.length > 0 ? `, ${inProgress.length} in progress` : ''}
        {skipped.length > 0 ? `, ${skipped.length} skipped by you` : ''}.{' '}
        {recordedHours} of {cataloguedHours} catalogued hours sit behind you.
        {unknownDuration > 0
          ? ` ${unknownDuration} step${unknownDuration === 1 ? '' : 's'} have no duration in the catalogue, so they are counted as zero rather than guessed.`
          : ''}
        {unlinked > 0
          ? ` ${unlinked} step${unlinked === 1 ? '' : 's'} store no link — the title and provider are all the platform has.`
          : ''}
      </p>

      {active && nextStep ? (
        <div className="rounded-xl border border-brand-200 bg-brand-50/60 px-3 py-2.5">
          <p className="text-[11px] font-medium tracking-wide text-brand-700 uppercase">Next action</p>
          <p className="mt-1 text-sm leading-relaxed">
            Step {nextStep.position} — <span className="font-medium">{nextStep.resource.title}</span>
            <span className="text-muted-foreground">
              {` · ${nextStep.resource.provider}`}
              {nextStep.resource.durationHours != null ? ` · ~${nextStep.resource.durationHours}h` : ' · no duration in the catalogue'}
              {nextStep.gapSkillName ? ` · toward ${nextStep.gapSkillName}` : ''}
            </span>
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button variant="outline" size="xs" nativeButton={false} render={<a href={`#plan-${planId}-step-${nextStep.position}`} />}>
              <Clock className="size-3.5" aria-hidden />
              Go to this step
            </Button>
            {nextStep.resource.url ? (
              <Button
                className="bg-brand-600 hover:bg-brand-700"
                size="xs"
                nativeButton={false}
                render={<a href={nextStep.resource.url} target="_blank" rel="noreferrer noopener" />}
              >
                <Link2 className="size-3.5" aria-hidden />
                Open the resource
              </Button>
            ) : (
              <span className="text-[11px] leading-relaxed text-muted-foreground">
                No link is stored for this catalogue entry.
              </span>
            )}
          </div>
        </div>
      ) : active ? (
        <p className="rounded-xl border border-emerald-200 bg-emerald-50/60 px-3 py-2.5 text-sm leading-relaxed">
          Every step on this plan carries a status. That is your own record — the platform has not verified any of it
          against the external course.
        </p>
      ) : null}

      <ol className="flex flex-col gap-2.5">
        {steps.map((step) => {
          const isNext = active && nextStep?.id === step.id
          return (
            <li
              key={step.id}
              id={`plan-${planId}-step-${step.position}`}
              className="scroll-mt-24 rounded-xl border border-border/70 bg-muted/20 p-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    <span
                      className={`mr-1.5 inline-flex size-5 items-center justify-center rounded-full text-[11px] tabular-nums ring-1 ${STATUS_TONE[step.status] ?? ''}`}
                      aria-hidden
                    >
                      {step.position}
                    </span>
                    {step.resource.url ? (
                      <a
                        href={step.resource.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="underline decoration-brand-300 underline-offset-2 hover:decoration-brand-600"
                      >
                        {step.resource.title}
                      </a>
                    ) : (
                      step.resource.title
                    )}
                    {isNext ? <span className="ml-1.5 text-[11px] font-medium text-brand-700">next</span> : null}
                  </p>
                  <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                    <Badge variant="outline" className="text-[10px]">
                      {label(step.resource.type).toLowerCase()}
                    </Badge>
                    {step.resource.provider}
                    {step.gapSkillName ? ` · for ${step.gapSkillName}` : ''}
                    {step.resource.durationHours != null
                      ? ` · ~${hours(step.resource.durationHours)} estimated`
                      : ' · no duration recorded'}
                    <span>{step.resource.isFree ? 'free' : (step.resource.costLabel ?? 'cost varies')}</span>
                    {step.resource.demonstration ? <DemoBadge text="Illustrative entry" /> : null}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1.5">
                  <PlanItemStatus itemId={step.id} current={step.status} />
                  <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    {step.status === 'COMPLETED' ? (
                      <Check className="size-3 text-emerald-600" aria-hidden />
                    ) : step.status === 'SKIPPED' ? (
                      <SkipForward className="size-3" aria-hidden />
                    ) : null}
                    {step.status === 'COMPLETED' && step.completedAt
                      ? `you recorded this ${formatDateTime(step.completedAt)}`
                      : label(step.status).toLowerCase()}
                  </span>
                </div>
              </div>
              {step.note ? (
                <p className="mt-2 text-xs leading-relaxed">
                  <span className="font-medium">Why this step:</span> {step.note}
                </p>
              ) : null}
              {step.resource.outcome ? (
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  <span className="font-medium text-foreground">Stated outcome:</span> {step.resource.outcome}
                </p>
              ) : (
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  The catalogue holds no stated outcome for this entry.
                </p>
              )}
            </li>
          )
        })}
      </ol>
    </div>
  )
}
