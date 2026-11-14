'use client'

import { useActionState, useId } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { FieldError, FormStatus, restored } from '@/components/forms/form-parts'
import { ORG_VERIFICATION_STATUSES, optionsFor } from '@/lib/options'
import { IDLE_STATE } from '@/lib/action-state'
import { setOrganizationVerificationAction } from '@/server/actions/admin'

const DECISION_ITEMS = optionsFor(ORG_VERIFICATION_STATUSES)

/**
 * Verification decision. The note is required by `orgVerificationSchema` because
 * the service forwards it to the organisation verbatim, and a non-VERIFIED
 * decision pauses that organisation's published roles.
 */
export function OrganizationVerificationForm({
  organizationId,
  organizationName,
  currentStatus,
  roleCount,
}: {
  organizationId: string
  organizationName: string
  currentStatus: string
  roleCount: number
}) {
  const [state, formAction, pending] = useActionState(
    setOrganizationVerificationAction.bind(null, organizationId),
    IDLE_STATE,
  )
  const decisionId = useId()
  const noteId = useId()

  return (
    <form action={formAction} className="flex flex-col gap-2.5">
      <FormStatus state={state} />

      <div>
        <Label htmlFor={decisionId} className="mb-1.5 text-xs">
          Decision for {organizationName}
        </Label>
        <Select id={decisionId} name="decision" required defaultValue={currentStatus} items={DECISION_ITEMS}>
          <SelectTrigger className="w-full" aria-invalid={state?.fieldErrors?.decision ? true : undefined}>
            <SelectValue placeholder="Choose a decision" />
          </SelectTrigger>
          <SelectContent>
            {DECISION_ITEMS.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
                {item.value === 'VERIFIED' ? ' — roles may be published' : ' — published roles are paused'}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldError state={state} name="decision" />
      </div>

      <div>
        <Label htmlFor={noteId} className="mb-1.5 text-xs">
          Note (required, shown to the organisation)
        </Label>
        <Textarea
          id={noteId}
          name="note"
          defaultValue={restored(state, 'note')}
          required
          rows={2}
          maxLength={600}
          placeholder="Company registry checked; website and hiring contact confirmed."
          aria-describedby={state?.fieldErrors?.note ? 'note-error' : undefined}
          aria-invalid={state?.fieldErrors?.note ? true : undefined}
        />
        <FieldError state={state} name="note" />
      </div>

      <p className="text-xs leading-relaxed text-muted-foreground">
        {roleCount > 0
          ? `This organisation has ${roleCount} role${roleCount === 1 ? '' : 's'} on the platform. Rejected or pending moves any of them that are currently published to paused, so they stop reaching candidates.`
          : 'This organisation has no roles on the platform yet, so no listing can be affected.'}
      </p>

      <Button type="submit" size="sm" disabled={pending} className="w-fit bg-brand-600 hover:bg-brand-700">
        {pending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
        {pending ? 'Saving' : 'Record decision'}
      </Button>
    </form>
  )
}
