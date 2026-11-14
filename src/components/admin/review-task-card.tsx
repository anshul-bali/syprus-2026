'use client'

import Link from 'next/link'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { InfoNote, StatusBadge } from '@/components/common'
import { ActionForm, HiddenFields } from '@/components/candidate/action-form'
import { TextAreaField } from '@/components/candidate/field'
import { decideReviewTaskAction } from '@/server/actions/ai'
import { formatDateTime, relativeTime } from '@/lib/utils'
import { label } from '@/lib/options'

export type ReviewTaskData = {
  id: string
  kind: string
  kindLabel: string
  status: string
  subjectType: string
  subjectId: string
  reason: string
  payload: unknown
  organizationName: string | null
  anonymousHandle: string | null
  jobTitle: string | null
  createdAt: Date
  decidedAt: Date | null
  decidedByName: string | null
  decisionNote: string | null
  assigneeRole: string
}

/**
 * One queued item and the human decision on it. The model or rule engine that
 * raised it is named, the note is mandatory, and closing the task never changes
 * the underlying record — it only records what a person decided.
 */
export function ReviewTaskCard({
  task,
  payloadLines,
}: {
  task: ReviewTaskData
  payloadLines: { label: string; value: string }[]
}) {
  const open = task.status === 'OPEN'

  return (
    <Card className={open ? 'border-amber-200' : 'border-border/70 bg-muted/20'}>
      <CardHeader className="pb-2.5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="text-sm">{task.kindLabel}</CardTitle>
            <CardDescription className="mt-1 text-xs">
              {task.organizationName ? `${task.organizationName} · ` : ''}
              {task.jobTitle ? `${task.jobTitle} · ` : ''}
              {task.anonymousHandle ? `${task.anonymousHandle} · ` : ''}
              queued {relativeTime(task.createdAt)}
            </CardDescription>
          </div>
          <div className="flex flex-col items-end gap-1">
            <StatusBadge value={task.status} />
            <Badge variant="outline" className="text-[10px]">
              for {label(task.assigneeRole).toLowerCase()}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm leading-relaxed">{task.reason}</p>

        {payloadLines.length > 0 ? (
          <dl className="grid gap-1.5 rounded-lg border border-border/70 bg-white/60 p-2.5 text-[11.5px] sm:grid-cols-2">
            {payloadLines.map((line) => (
              <div key={line.label} className="min-w-0">
                <dt className="truncate text-muted-foreground">{line.label}</dt>
                <dd className="break-words font-medium">{line.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}

        {!open ? (
          <p className="text-xs leading-relaxed text-muted-foreground">
            {label(task.status)} by {task.decidedByName ?? 'an account no longer present'} on{' '}
            {task.decidedAt ? formatDateTime(task.decidedAt) : '—'}
            {task.decisionNote ? `: “${task.decisionNote}”` : ''}.
          </p>
        ) : (
          <ActionForm
            action={decideReviewTaskAction}
            className="gap-3"
            onSuccess={(message) => toast.success(message ?? 'Decision recorded.')}
          >
            {({ state, pending }) => (
              <>
                <HiddenFields fields={{ taskId: task.id }} />
                <TextAreaField
                  id={`note-${task.id}`}
                  name="note"
                  label="Your justification (kept with the decision)"
                  rows={3}
                  required
                  state={state}
                  placeholder="What you checked, what you concluded, and what happens to the person or role affected."
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="submit"
                    name="status"
                    value="APPROVED"
                    size="sm"
                    disabled={pending}
                    className="bg-brand-600 text-white hover:bg-brand-700"
                  >
                    Approve
                  </Button>
                  <Button type="submit" name="status" value="REJECTED" size="sm" variant="outline" disabled={pending}>
                    Reject
                  </Button>
                  <Button type="submit" name="status" value="DEFERRED" size="sm" variant="ghost" disabled={pending}>
                    Defer
                  </Button>
                  {state.status === 'error' ? (
                    <span className="text-xs text-destructive" role="alert">
                      {state.message}
                    </span>
                  ) : null}
                </div>
              </>
            )}
          </ActionForm>
        )}

        <div className="flex flex-wrap gap-2 text-[11px]">
          <span className="text-muted-foreground">
            subject {task.subjectType} <span className="font-mono">{task.subjectId.slice(0, 12)}…</span>
          </span>
          {task.jobTitle ? (
            <Button variant="ghost" size="xs" className="text-[11px]" nativeButton={false} render={<Link href="/admin/moderation" />}>
              Role moderation
            </Button>
          ) : null}
        </div>
      </CardContent>

      {open ? (
        <div className="border-t border-border/60 px-6 py-3">
          <InfoNote tone="warning" title="A model cannot clear its own flag">
            Approving here records that a person reviewed the item. It does not change the posting, the shortlist or the
            candidate’s skills — those keep their own screens and their own audit entries.
          </InfoNote>
        </div>
      ) : null}
    </Card>
  )
}
