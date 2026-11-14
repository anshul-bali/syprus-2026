'use client'

import { useActionState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { FieldError, FormStatus, restored } from '@/components/forms/form-parts'
import { IDLE_STATE } from '@/lib/action-state'
import { label as enumLabel } from '@/lib/options'
import { updateApplicationStatusAction } from '@/server/actions/employer'

/**
 * Row-level pipeline control. `allowed` is the legal next-stage list the server
 * derived from `EMPLOYER_TRANSITIONS`, already narrowed by the permissions this
 * account holds, so no dead button is offered. The interview slot is always
 * shown because the service refuses an invitation without a date.
 */
export function ApplicationStatusForm({
  applicationId,
  currentStatus,
  candidateHandle,
  jobTitle,
  allowed,
}: {
  applicationId: string
  currentStatus: string
  candidateHandle: string
  jobTitle: string
  allowed: { value: string; label: string }[]
}) {
  const [state, formAction, pending] = useActionState(
    updateApplicationStatusAction.bind(null, applicationId),
    IDLE_STATE,
  )

  if (allowed.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        {enumLabel(currentStatus)} is a final stage — no further move is available for this application.
      </p>
    )
  }

  return (
    <form action={formAction} className="space-y-2">
      <FormStatus state={state} />
      <div className="grid gap-3 sm:grid-cols-[minmax(0,11rem)_minmax(0,12rem)_minmax(0,1fr)] sm:items-end">
        <div>
          <Label id={`${applicationId}-status-label`}>Move to</Label>
          <Select name="status" items={allowed} required defaultValue={null}>
            <SelectTrigger
              id={`${applicationId}-status`}
              className="mt-1.5 w-full"
              aria-labelledby={`${applicationId}-status-label`}
            >
              <SelectValue placeholder="Choose the next stage" />
            </SelectTrigger>
            <SelectContent>
              {allowed.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldError state={state} name="status" />
        </div>

        <div>
          <Label htmlFor={`${applicationId}-interview`}>Interview slot (invitations)</Label>
          <Input
            id={`${applicationId}-interview`}
            name="interviewScheduledAt"
            type="datetime-local"
            step={300}
            className="mt-1.5"
          />
          <FieldError state={state} name="interviewScheduledAt" />
        </div>

        <div>
          <Label htmlFor={`${applicationId}-note`}>Note sent to the candidate (optional)</Label>
          <Input id={`${applicationId}-note`} name="note" defaultValue={restored(state, 'note')} maxLength={600} className="mt-1.5" />
          <FieldError state={state} name="note" />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={pending} size="sm" className="bg-brand-600 hover:bg-brand-700">
          {pending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
          {pending ? 'Saving' : 'Update stage'}
        </Button>
        <p className="text-xs text-muted-foreground">
          {candidateHandle} · {jobTitle} · currently {enumLabel(currentStatus)}
        </p>
      </div>
    </form>
  )
}
