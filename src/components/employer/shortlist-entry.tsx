'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { FieldError, FormStatus } from '@/components/forms/form-parts'
import { StatusBadge } from '@/components/common'
import { ConfirmAction } from '@/components/employer/confirm-action'
import { ApplicationStatusForm } from '@/components/employer/application-status-form'
import { IDLE_STATE } from '@/lib/action-state'
import { relativeTime } from '@/lib/utils'
import { removeShortlistEntryAction, shortlistCandidateAction } from '@/server/actions/employer'

/**
 * One shortlist row. Removing an entry is destructive, so it goes through a
 * confirmation dialog whose server action is closed over inside this client
 * component rather than passed down from the page.
 */
export function ShortlistEntry({
  jobId,
  jobTitle,
  entryId,
  candidateProfileId,
  anonymousHandle,
  headline,
  yearsOfExperience,
  note,
  addedAt,
  application,
  allowedStages,
}: {
  jobId: string
  jobTitle: string
  entryId: string
  candidateProfileId: string
  anonymousHandle: string
  headline: string | null
  yearsOfExperience: number
  note: string | null
  addedAt: Date
  application: { id: string; status: string } | null
  allowedStages: { value: string; label: string }[]
}) {
  const [state, formAction, pending] = useActionState(
    shortlistCandidateAction.bind(null, jobId, candidateProfileId),
    IDLE_STATE,
  )

  return (
    <Card>
      <CardContent className="space-y-3 pt-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs font-semibold">{anonymousHandle}</span>
              {application ? (
                <StatusBadge value={application.status} />
              ) : (
                <StatusBadge value="PENDING" label="No application yet" />
              )}
            </p>
            <p className="mt-1 text-sm font-medium">{headline ?? 'No headline shared'}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {yearsOfExperience} yrs recorded · shortlisted {relativeTime(addedAt)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" nativeButton={false} render={<Link href={`/employer/candidates?jobId=${jobId}`} />}>
              Open anonymised profile list
            </Button>
            <ConfirmAction
              triggerLabel="Remove from shortlist"
              title="Remove this shortlist entry?"
              description={`The note for ${anonymousHandle} on this role is deleted. The candidate’s own profile is untouched, and you can shortlist them again.`}
              confirmLabel="Remove entry"
              pendingLabel="Removing"
              variant="destructive"
              size="sm"
              action={() => removeShortlistEntryAction(entryId)}
            />
          </div>
        </div>

        <form action={formAction} className="space-y-2 border-t border-border/60 pt-3">
          <FormStatus state={state} />
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <div>
              <Label htmlFor={`note-${entryId}`}>Shortlist note (private to your organisation)</Label>
              <Input
                id={`note-${entryId}`}
                name="note"
                maxLength={400}
                defaultValue={note ?? ''}
                placeholder="Why this person is worth a conversation."
                className="mt-1.5"
              />
              <FieldError state={state} name="note" />
            </div>
            <Button type="submit" size="sm" variant="outline" disabled={pending}>
              {pending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
              {note ? 'Save note' : 'Add note'}
            </Button>
          </div>
        </form>

        {application ? (
          <div className="space-y-2 rounded-lg bg-muted/40 p-3">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Invite to interview
            </p>
            <p className="text-xs text-muted-foreground">
              This candidate has applied to this role, so their identity is disclosed to your organisation. An
              invitation is a pipeline move and needs an interview date and time.
            </p>
            <ApplicationStatusForm
              applicationId={application.id}
              currentStatus={application.status}
              candidateHandle={anonymousHandle}
              jobTitle={jobTitle}
              allowed={allowedStages}
            />
          </div>
        ) : (
          <p className="rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            No application on this role yet, so there is nothing to advance: their identity stays withheld until they
            apply. Keep the note here and revisit once an application arrives.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
