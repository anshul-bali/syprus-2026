'use client'

import { AlertCircle, CheckCircle2 } from 'lucide-react'
import type { ActionState } from '@/lib/action-state'

/** Inline status band for a server-action-backed form. */
export function FormStatus({ state }: { state: ActionState | undefined }) {
  if (!state || state.status === 'idle') return null

  if (state.status === 'success') {
    return (
      <div
        role="status"
        className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-900"
      >
        <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>{state.message}</span>
      </div>
    )
  }

  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3.5 py-2.5 text-sm text-destructive"
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{state.message}</span>
    </div>
  )
}

/** Field-level error text, wired to the names used in each Zod schema. */
export function FieldError({ state, name, id = name }: { state: ActionState | undefined; name: string; id?: string }) {
  const message = state?.status === 'error' ? state.fieldErrors?.[name] : undefined
  if (!message) return null
  return (
    <p id={`${id}-error`} role="alert" className="mt-1 text-xs font-medium text-destructive">
      {message}
    </p>
  )
}

export function describedBy(name: string, state: ActionState | undefined, id = name) {
  return state?.status === 'error' && state.fieldErrors?.[name] ? `${id}-error` : undefined
}

/**
 * What an input should hold after a failed submit.
 *
 * React resets uncontrolled form fields when a server action returns, so without
 * this a rejected submission clears the whole form and the person retypes
 * everything to fix one field. The submitted value comes first; the stored record
 * (or nothing) is the fallback. Secrets are never in `state.values` — see
 * `restorableValues`.
 */
export function restored(state: ActionState | undefined, name: string, fallback?: string | number) {
  const value = state?.values?.[name]
  if (typeof value === 'string') return value
  return fallback === undefined ? undefined : String(fallback)
}
