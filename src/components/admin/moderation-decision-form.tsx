'use client'

import { useActionState, useId } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { FieldError, FormStatus, restored } from '@/components/forms/form-parts'
import { IDLE_STATE } from '@/lib/action-state'
import { moderateJobAction } from '@/server/actions/admin'

const DECISION_ITEMS = [
  { value: 'PUBLISHED', label: 'Publish — recompute matches' },
  { value: 'REJECTED', label: 'Reject — return to the employer' },
  { value: 'CLOSED', label: 'Close the listing' },
]

/**
 * One moderation decision form per queued role.
 *
 * `publishBlockedReason` is computed by the server from the organisation's real
 * verification status and the role's skill set — it mirrors what `moderateJob`
 * enforces instead of guessing, and the Publish option is disabled with the
 * reason shown when the service would refuse.
 */
export function ModerationDecisionForm({
  jobId,
  jobTitle,
  publishBlockedReason,
}: {
  jobId: string
  jobTitle: string
  publishBlockedReason: string | null
}) {
  const [state, formAction, pending] = useActionState(moderateJobAction.bind(null, jobId), IDLE_STATE)
  const decisionId = useId()
  const noteId = useId()

  return (
    <form action={formAction} className="flex flex-col gap-2.5">
      <FormStatus state={state} />

      <div>
        <Label htmlFor={decisionId} className="mb-1.5 text-xs">
          Decision for “{jobTitle}”
        </Label>
        <Select
          id={decisionId}
          name="decision"
          required
          defaultValue={publishBlockedReason ? 'REJECTED' : 'PUBLISHED'}
          items={DECISION_ITEMS}
        >
          <SelectTrigger className="w-full" aria-invalid={state?.fieldErrors?.decision ? true : undefined}>
            <SelectValue placeholder="Choose a decision" />
          </SelectTrigger>
          <SelectContent>
            {DECISION_ITEMS.map((item) => (
              <SelectItem
                key={item.value}
                value={item.value}
                disabled={item.value === 'PUBLISHED' && Boolean(publishBlockedReason)}
              >
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldError state={state} name="decision" />
      </div>

      {publishBlockedReason ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
          {publishBlockedReason}
        </p>
      ) : (
        <p className="text-xs leading-relaxed text-muted-foreground">
          Publishing needs a reason in the note below. It moves the role to published and recomputes matches for every
          visible candidate profile.
        </p>
      )}

      <div>
        <Label htmlFor={noteId} className="mb-1.5 text-xs">
          Note {publishBlockedReason ? '(optional)' : '(required to publish)'}
        </Label>
        <Textarea
          id={noteId}
          name="note"
          defaultValue={restored(state, 'note')}
          rows={2}
          maxLength={600}
          placeholder="Skills-first wording, no discriminatory criteria, employer contact confirmed."
          aria-describedby={state?.fieldErrors?.note ? 'note-error' : undefined}
          aria-invalid={state?.fieldErrors?.note ? true : undefined}
        />
        <FieldError state={state} name="note" />
      </div>

      <Button type="submit" size="sm" disabled={pending} className="w-fit bg-brand-600 hover:bg-brand-700">
        {pending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
        {pending ? 'Recording' : 'Record decision'}
      </Button>
    </form>
  )
}
