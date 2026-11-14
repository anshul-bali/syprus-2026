'use client'

import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { FieldError } from '@/components/forms/form-parts'
import type { ActionState } from '@/lib/action-state'

/**
 * A password input with a way to check what was typed.
 *
 * The toggle is the whole point: without it every mistyped character is a
 * rejected submit. It is a `type="button"`, so it can never submit the form it
 * sits in, and it flips the input's `type` rather than moving the value
 * anywhere — nothing about the password is copied into state, a data
 * attribute, or the URL.
 */
export function PasswordField({
  id,
  name,
  label,
  autoComplete,
  state,
  hint,
  required = true,
  minLength,
}: {
  id: string
  name: string
  label: string
  autoComplete: 'new-password' | 'current-password'
  state?: ActionState
  hint?: string
  required?: boolean
  /** Composition rules belong on signup, not on the way back in. */
  minLength?: number
}) {
  const [shown, setShown] = useState(false)
  const describedBy = state?.status === 'error' && state.fieldErrors?.[name] ? `${id}-error` : hint ? `${id}-hint` : undefined

  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <div className="relative mt-1.5">
        <Input
          id={id}
          name={name}
          type={shown ? 'text' : 'password'}
          autoComplete={autoComplete}
          required={required}
          minLength={minLength}
          aria-describedby={describedBy}
          aria-invalid={state?.status === 'error' && Boolean(state.fieldErrors?.[name])}
          className="pr-11"
        />
        <button
          type="button"
          onClick={() => setShown((value) => !value)}
          aria-pressed={shown}
          className="absolute right-1.5 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {shown ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
          <span className="sr-only">{shown ? `Hide the ${label.toLowerCase()}` : `Show the ${label.toLowerCase()}`}</span>
        </button>
      </div>
      <FieldError state={state} name={name} id={id} />
      {hint ? (
        <p id={`${id}-hint`} className="mt-1 text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  )
}
