'use client'

import { useEffect, useRef, useActionState } from 'react'
import Link from 'next/link'
import { CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FormStatus } from '@/components/forms/form-parts'
import { IDLE_STATE, type ActionState } from '@/lib/action-state'
import { cn } from '@/lib/utils'

/** Signature of every candidate server action wired to `useActionState`. */
export type ActionFn = (prevState: ActionState, formData: FormData) => Promise<ActionState>

export type FormContext = { state: ActionState; pending: boolean }

/**
 * One place that binds a server action to `useActionState`, renders the status
 * band and hands `pending` down so submit buttons can disable themselves.
 */
export function ActionForm({
  action,
  className,
  children,
  withStatus = true,
  onSuccess,
}: {
  action: ActionFn
  className?: string
  children: (context: FormContext) => React.ReactNode
  withStatus?: boolean
  /** Used by dialogs to close themselves once the server reports success. */
  onSuccess?: (message?: string) => void
}) {
  const [state, formAction, pending] = useActionState(action, IDLE_STATE)
  const successHandler = useRef(onSuccess)
  useEffect(() => {
    successHandler.current = onSuccess
  }, [onSuccess])

  useEffect(() => {
    if (state.status === 'success') successHandler.current?.(state.message)
  }, [state])

  return (
    <form action={formAction} className={cn('flex flex-col gap-3', className)}>
      {withStatus ? <FormStatus state={state} /> : null}
      {children({ state, pending })}
    </form>
  )
}

export function SubmitButton({
  pending,
  children,
  className,
  variant = 'default',
  size = 'default',
  disabled,
}: {
  pending: boolean
  children: React.ReactNode
  className?: string
  variant?: 'default' | 'outline' | 'secondary' | 'ghost' | 'destructive' | 'link'
  size?: 'default' | 'xs' | 'sm' | 'lg' | 'icon' | 'icon-sm'
  disabled?: boolean
}) {
  return (
    <Button
      type="submit"
      variant={variant}
      size={size}
      disabled={disabled || pending}
      className={variant === 'default' ? cn('bg-brand-600 hover:bg-brand-700', className) : className}
    >
      {pending ? 'Saving…' : children}
    </Button>
  )
}

/** Success hint that carries the candidate to the screen the mutation affected. */
export function SuccessLink({ state, href, children }: { state: ActionState; href: string; children: React.ReactNode }) {
  if (state.status !== 'success') return null
  return (
    <p className="flex flex-wrap items-center gap-2 text-xs text-emerald-800">
      <CheckCircle2 className="size-3.5" aria-hidden />
      <Link href={href} className="font-medium underline underline-offset-2">
        {children}
      </Link>
    </p>
  )
}

export function HiddenFields({ fields }: { fields: Record<string, string> }) {
  return (
    <>
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} readOnly />
      ))}
    </>
  )
}
