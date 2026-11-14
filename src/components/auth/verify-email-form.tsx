'use client'

import { useActionState } from 'react'
import { Loader2, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { FieldError, FormStatus } from '@/components/forms/form-parts'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { IDLE_STATE } from '@/lib/action-state'
import { cancelVerificationAction, resendVerificationCodeAction, submitVerificationCodeAction } from '@/server/actions/auth'

export type VerifyEmailFormProps = {
  purpose: 'SIGNUP' | 'LOGIN'
  maskedEmail: string
  next: string | null
  /** The code, only when it was never emailed and has to be read off this screen. */
  previewCode: string | null
  /** The matching link, shown under the same demonstration condition. */
  previewLink: string | null
  expiresAtLabel: string
  resendFromLabel: string
  /** The ten minutes ran out while the tab was open. */
  expired: boolean
}

const COPY = {
  SIGNUP: {
    title: 'Confirm your email address',
    description: (masked: string) =>
      `A six-digit code went to ${masked}. Enter it to open the account — until you do, there is nothing to sign in to.`,
    submit: 'Confirm and continue',
  },
  LOGIN: {
    title: 'Confirm it is you',
    description: (masked: string) =>
      `Your password was accepted. A six-digit code went to ${masked}; SYPRUS opens the session only once you enter it.`,
    submit: 'Verify and sign in',
  },
} as const

export function VerifyEmailForm({
  purpose,
  maskedEmail,
  next,
  previewCode,
  previewLink,
  expiresAtLabel,
  resendFromLabel,
  expired,
}: VerifyEmailFormProps) {
  const copy = COPY[purpose]
  const [state, formAction, pending] = useActionState(submitVerificationCodeAction, IDLE_STATE)
  const [resendState, resendAction, resendPending] = useActionState(resendVerificationCodeAction, IDLE_STATE)

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>{copy.title}</CardTitle>
        <CardDescription>
          {previewCode
            ? `Enter the code shown below to verify ${maskedEmail}. This is a screen-only preview; no email was sent.`
            : copy.description(maskedEmail)}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {previewCode ? (
          <div className="rounded-lg border border-dashed border-amber-300 bg-amber-50 px-3.5 py-3 text-sm text-amber-950 dark:border-amber-700/70 dark:bg-amber-950/40 dark:text-amber-100">
            <p className="font-medium">Demonstration delivery — this code was not emailed</p>
            <p className="mt-1 text-xs leading-relaxed">
              Screen-only delivery is active for this verification. This can be used for reserved demonstration
              addresses or explicit preview mode; it does not confirm access to a mailbox.
            </p>
            <p
              id="verification-preview-code"
              className="mt-2 text-2xl font-semibold tracking-[0.3em] tabular-nums select-all"
            >
              {previewCode}
            </p>
            {previewLink ? (
              <p className="mt-2 text-xs leading-relaxed">
                Or{' '}
                <a
                  href={previewLink}
                  referrerPolicy="no-referrer"
                  className="font-medium underline underline-offset-2 hover:no-underline"
                >
                  open the verification link
                </a>{' '}
                that would have been in the mail. It spends this same one use.
              </p>
            ) : null}
          </div>
        ) : null}

        <form action={formAction} className="space-y-4">
          {next ? <input type="hidden" name="next" value={next} readOnly /> : null}

          <FormStatus state={state} />

          <div>
            <Label htmlFor="code">Six-digit code</Label>
            <Input
              id="code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              // Spaces and dashes are allowed here because the server strips them;
              // a strict six-digit pattern would reject a code copied out of a mail
              // client before anyone could read the message that explains it.
              pattern="[0-9\s-]{6,12}"
              maxLength={12}
              required
              placeholder="000000"
              className="mt-1.5 text-center text-lg tracking-[0.35em] tabular-nums"
              aria-describedby={state?.fieldErrors?.code ? 'code-error' : 'code-hint'}
            />
            <FieldError state={state} name="code" />
            <p id="code-hint" className="mt-1.5 text-xs text-muted-foreground">
              {expired ? (
                <>This code expired at {expiresAtLabel}. Ask for a new one below.</>
              ) : (
                <>
                  Spaces and dashes are ignored. This code expires at {expiresAtLabel}; the number of attempts left
                  with it is stated when one is used.
                </>
              )}
            </p>
          </div>

          <Button type="submit" disabled={pending} className="w-full bg-brand-600 hover:bg-brand-700">
            {pending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <ShieldCheck className="size-4" aria-hidden />
            )}
            {pending ? 'Checking the code' : copy.submit}
          </Button>
        </form>

        <form action={resendAction} className="space-y-2">
          <FormStatus state={resendState} />
          <Button type="submit" variant="outline" size="sm" className="w-full" disabled={resendPending}>
            {resendPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            Ask for a new code
          </Button>
          <p className="text-xs leading-relaxed text-muted-foreground">
            A new code retires this one. The pause between codes runs until {resendFromLabel}; if the wait is not over
            the screen says so rather than sending another.
          </p>
        </form>

        {/* A form rather than a link: leaving this screen should also drop the
            ticket it was issued with, and that takes a server action. */}
        <form action={cancelVerificationAction} className="text-sm">
          <p className="text-muted-foreground">
            Not your address?{' '}
            <button
              type="submit"
              className="font-medium text-brand-600 underline-offset-4 hover:underline"
            >
              Go back to sign-in
            </button>
          </p>
        </form>
      </CardContent>
    </Card>
  )
}
