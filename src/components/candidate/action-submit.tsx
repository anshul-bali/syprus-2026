'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import { FormStatus } from '@/components/forms/form-parts'
import { IDLE_STATE } from '@/lib/action-state'
import { HiddenFields, type ActionFn } from '@/components/candidate/action-form'
import { cn } from '@/lib/utils'

/**
 * Single-click server mutation with no text fields of its own — re-running the
 * matching engine, marking everything read. The inline status band carries the
 * engine's own wording, so a button never reports a result it did not produce.
 */
export function ActionSubmit({
  action,
  label,
  fields,
  variant = 'outline',
  size = 'sm',
  className,
  formClassName = 'flex flex-col gap-2',
  showStatus = true,
  pendingLabel = 'Working…',
  disabled,
}: {
  action: ActionFn
  label: string
  fields?: Record<string, string>
  variant?: 'default' | 'outline' | 'secondary' | 'ghost' | 'destructive'
  size?: 'default' | 'xs' | 'sm' | 'lg' | 'icon' | 'icon-sm'
  className?: string
  formClassName?: string
  showStatus?: boolean
  pendingLabel?: string
  disabled?: boolean
}) {
  const [state, formAction, pending] = useActionState(action, IDLE_STATE)

  return (
    <form action={formAction} className={formClassName}>
      <HiddenFields fields={fields ?? {}} />
      <Button
        type="submit"
        variant={variant}
        size={size}
        disabled={disabled || pending}
        className={cn(variant === 'default' && 'bg-brand-600 hover:bg-brand-700', className)}
      >
        {pending ? pendingLabel : label}
      </Button>
      {showStatus ? <FormStatus state={state} /> : null}
    </form>
  )
}
