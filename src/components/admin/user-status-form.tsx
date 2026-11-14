'use client'

import { useActionState, useId } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { FieldError, FormStatus, restored } from '@/components/forms/form-parts'
import { ACCOUNT_STATUSES, optionsFor } from '@/lib/options'
import { IDLE_STATE } from '@/lib/action-state'
import { changeUserStatusAction } from '@/server/actions/admin'

const STATUS_ITEMS = optionsFor(ACCOUNT_STATUSES)

/**
 * Per-row account status control. The target user id is bound into the action,
 * never read from a field, and `setUserStatus` refuses to change the acting
 * administrator's own account — the refusal is shown here rather than hidden.
 */
export function UserStatusForm({
  userId,
  currentStatus,
  targetName,
  isSelf,
}: {
  userId: string
  currentStatus: string
  targetName: string
  isSelf: boolean
}) {
  const [state, formAction, pending] = useActionState(changeUserStatusAction.bind(null, userId), IDLE_STATE)
  const statusId = useId()
  const reasonId = useId()

  if (isSelf) {
    return (
      <p className="max-w-[22rem] text-xs leading-relaxed text-muted-foreground">
        This is your own account. The platform will not let you change its status.
      </p>
    )
  }

  return (
    <form action={formAction} className="flex w-[22rem] max-w-full flex-col gap-2">
      <FormStatus state={state} />

      <div>
        <Label htmlFor={statusId} className="mb-1.5 text-xs">
          Set status for {targetName}
        </Label>
        <Select id={statusId} name="status" required defaultValue={currentStatus} items={STATUS_ITEMS}>
          <SelectTrigger className="w-full" aria-invalid={state?.fieldErrors?.status ? true : undefined}>
            <SelectValue placeholder="Choose a status" />
          </SelectTrigger>
          <SelectContent>
            {STATUS_ITEMS.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldError state={state} name="status" />
      </div>

      <div>
        <Label htmlFor={reasonId} className="mb-1.5 text-xs">
          Reason (sent to the account)
        </Label>
        <Input
          id={reasonId}
          name="reason"
          defaultValue={restored(state, 'reason')}
          maxLength={400}
          placeholder="Optional note for the notification"
          aria-describedby={state?.fieldErrors?.reason ? 'reason-error' : undefined}
          aria-invalid={state?.fieldErrors?.reason ? true : undefined}
        />
        <FieldError state={state} name="reason" />
      </div>

      <Button type="submit" size="sm" disabled={pending} className="w-fit bg-brand-600 hover:bg-brand-700">
        {pending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
        {pending ? 'Saving' : 'Apply status'}
      </Button>
    </form>
  )
}
