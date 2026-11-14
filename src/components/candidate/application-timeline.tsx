import { formatDate, formatDateTime } from '@/lib/utils'
import { label } from '@/lib/options'
import { Badge } from '@/components/ui/badge'

/**
 * One application, drawn as the history that is actually stored.
 *
 * The rail is a record, not a forecast: a stage is marked reached only when an
 * event names it, and a stage with no event is labelled as never recorded rather
 * than drawn as passed. Interview dates appear only when an employer entered one.
 */
export type ApplicationEvent = {
  id: string
  fromStatus: string | null
  toStatus: string
  note: string | null
  createdAt: Date
  /** Whose account wrote the row. Only the candidate’s own id is known to this screen. */
  recordedBy: 'you' | 'the employer or a reviewer' | 'the platform'
}

const PROGRESSION = ['SUBMITTED', 'IN_REVIEW', 'SHORTLISTED', 'INTERVIEW_INVITED', 'INTERVIEW_COMPLETED', 'OFFER_EXTENDED', 'HIRED']
const OUTCOMES = ['REJECTED', 'WITHDRAWN']

export function ApplicationTimeline({
  events,
  currentStatus,
  interviewScheduledAt,
  submittedAt,
}: {
  events: ApplicationEvent[]
  currentStatus: string
  interviewScheduledAt: Date | null
  submittedAt: Date
}) {
  const reached = new Set(events.map((event) => event.toStatus))
  const outcome = OUTCOMES.includes(currentStatus) ? currentStatus : null
  const stages = PROGRESSION.filter((stage) => reached.has(stage) || (outcome === null && stage === currentStatus))
  const skipped = PROGRESSION.filter((stage) => !reached.has(stage) && stage !== currentStatus)
  const lastReached = stages[stages.length - 1] ?? null

  return (
    <div className="flex flex-col gap-3">
      <ol className="flex flex-wrap items-stretch gap-1.5" aria-label="Stages recorded for this application">
        {stages.map((stage, index) => {
          const event = events.find((entry) => entry.toStatus === stage)
          const isCurrent = stage === currentStatus
          return (
            <li
              key={stage}
              className={`flex min-w-[7.5rem] flex-1 flex-col gap-0.5 rounded-lg border px-2.5 py-1.5 text-[11px] leading-snug ${
                isCurrent
                  ? 'border-brand-300 bg-brand-50 text-brand-900'
                  : 'border-border/70 bg-muted/30 text-muted-foreground'
              }`}
            >
              <span className="flex items-baseline justify-between gap-1.5">
                <span className="font-medium">{label(stage)}</span>
                {isCurrent ? <Badge variant="outline" className="text-[9px]">now</Badge> : null}
              </span>
              <span className="tabular-nums">{event ? formatDate(event.createdAt) : 'date not recorded'}</span>
              <span>
                {event
                  ? `recorded by ${event.recordedBy}`
                  : index === 0
                    ? `submitted ${formatDate(submittedAt)}`
                    : 'no event on file for this stage'}
              </span>
            </li>
          )
        })}
        {outcome ? (
          <li className="flex min-w-[7.5rem] flex-1 flex-col gap-0.5 rounded-lg border border-rose-200 bg-rose-50/70 px-2.5 py-1.5 text-[11px] leading-snug text-rose-950">
            <span className="font-medium">{label(outcome)}</span>
            <span className="tabular-nums">
              {formatDate(events.find((event) => event.toStatus === outcome)?.createdAt ?? submittedAt)}
            </span>
            <span>
              recorded by {events.find((event) => event.toStatus === outcome)?.recordedBy ?? 'someone on the hiring side'}
            </span>
          </li>
        ) : null}
      </ol>

      {skipped.length > 0 ? (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          No event on file for {skipped.slice(0, 4).map((stage) => label(stage).toLowerCase()).join(', ')}
          {skipped.length > 4 ? ` and ${skipped.length - 4} more` : ''}. A missing stage is not evidence it happened,
          and not evidence it was refused either.
        </p>
      ) : null}

      <ol className="flex flex-col gap-2 border-l-2 border-border/70 pl-3" aria-label="Status events recorded for this application">
        {events.length === 0 ? (
          <li className="text-xs text-muted-foreground">
            Only the submission exists. An employer has not recorded a stage against it.
          </li>
        ) : null}
        {events.map((event) => (
          <li key={event.id} className="text-xs">
            <span className="font-medium">{label(event.toStatus)}</span>
            {event.fromStatus ? (
              <span className="text-muted-foreground"> from {label(event.fromStatus).toLowerCase()}</span>
            ) : null}
            <span className="text-muted-foreground">
              {' '}· {formatDateTime(event.createdAt)} · recorded by {event.recordedBy}
            </span>
            {event.note ? <p className="mt-0.5 leading-relaxed text-muted-foreground">{event.note}</p> : null}
          </li>
        ))}
      </ol>

      {interviewScheduledAt ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-violet-200 bg-violet-50/70 px-3 py-2 text-xs text-violet-950">
          <Badge variant="outline" className="text-[10px]">
            interview
          </Badge>
          Invited for {formatDateTime(interviewScheduledAt)} — the date an employer entered, not a confirmation that
          either of you attended.
        </div>
      ) : reached.has('INTERVIEW_INVITED') ? (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          An interview stage was recorded, but no date was entered with it. The platform does not infer one.
        </p>
      ) : null}

      {lastReached && lastReached !== currentStatus && !outcome ? (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          The most recent stage on file is {label(lastReached).toLowerCase()}. Anything after it has not been recorded
          by anyone, so nothing is drawn for it.
        </p>
      ) : null}
    </div>
  )
}
