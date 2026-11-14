'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
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
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import type { EmployerMutationResult } from '@/server/actions/employer'

type ConfirmActionProps = {
  triggerLabel: string
  title: string
  description: string
  confirmLabel: string
  /** A bound `'use server'` action returning a serialisable result. */
  action: () => Promise<EmployerMutationResult | void>
  pendingLabel?: string
  variant?: React.ComponentProps<typeof Button>['variant']
  size?: React.ComponentProps<typeof Button>['size']
  className?: string
}

/**
 * Destructive or irreversible employer actions always go through this: an
 * `AlertDialog` confirmation, the server action inside it, and explicit close
 * control (Base UI's `AlertDialogAction` does not dismiss on its own).
 */
export function ConfirmAction({
  triggerLabel,
  title,
  description,
  confirmLabel,
  action,
  pendingLabel = 'Working',
  variant = 'destructive',
  size = 'sm',
  className,
}: ConfirmActionProps) {
  const [open, setOpen] = useState(false)
  const [pending, start] = useTransition()
  const router = useRouter()

  function run() {
    start(async () => {
      try {
        const result = await action()
        if (!result) {
          setOpen(false)
          router.refresh()
          return
        }
        if (result.ok) {
          toast.success(result.message)
          if (result.navigateTo) {
            setOpen(false)
            router.push(result.navigateTo)
            return
          }
        } else {
          toast.error(result.message)
        }
        setOpen(false)
      } catch {
        toast.error('That action could not be completed. Reload the page and try again.')
        setOpen(false)
      }
    })
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger
        render={<Button variant={variant} size={size} className={className} disabled={pending} />}
      >
        {triggerLabel}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep it</AlertDialogCancel>
          <AlertDialogAction onClick={run} disabled={pending} variant={variant}>
            {pending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
            {pending ? pendingLabel : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
