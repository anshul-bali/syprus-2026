'use client'

import { useActionState, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { FormStatus } from '@/components/forms/form-parts'
import { IDLE_STATE } from '@/lib/action-state'
import { HiddenFields, type ActionFn } from '@/components/candidate/action-form'

/**
 * Destructive-action confirm. `AlertDialogAction` does not auto-close in this
 * kit, so the dialog is controlled and closes only once the server action has
 * reported success.
 */
export function ConfirmAction({
  action,
  triggerLabel,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Keep it',
  triggerVariant = 'ghost',
  triggerSize = 'sm',
  fields,
  triggerClassName,
}: {
  action: ActionFn
  triggerLabel: string
  title: string
  description: string
  confirmLabel: string
  cancelLabel?: string
  triggerVariant?: 'default' | 'outline' | 'secondary' | 'ghost' | 'destructive'
  triggerSize?: 'default' | 'xs' | 'sm' | 'lg' | 'icon' | 'icon-sm'
  fields?: Record<string, string>
  triggerClassName?: string
}) {
  const [open, setOpen] = useState(false)
  const [state, formAction, pending] = useActionState(async (previous: import('@/lib/action-state').ActionState, data: FormData) => {
    const result = await action(previous, data)
    if (result.status === 'success') {
      setOpen(false)
      if (result.message) toast.success(result.message)
    }
    return result
  }, IDLE_STATE)

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger
        render={<Button variant={triggerVariant} size={triggerSize} className={triggerClassName} />}
      >
        {triggerLabel}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia>
            <AlertTriangle className="text-destructive" aria-hidden />
          </AlertDialogMedia>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <form action={formAction} className="flex flex-col gap-3">
          <HiddenFields fields={fields ?? {}} />
          <FormStatus state={state} />
          <AlertDialogFooter>
            <AlertDialogCancel>{cancelLabel}</AlertDialogCancel>
            <AlertDialogAction type="submit" variant="destructive" disabled={pending}>
              {pending ? 'Working…' : confirmLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  )
}
