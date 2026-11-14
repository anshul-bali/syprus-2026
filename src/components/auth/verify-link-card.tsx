'use client'

import { useEffect, useRef, useActionState } from 'react'
import { Loader2, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { FormStatus } from '@/components/forms/form-parts'
import { IDLE_STATE } from '@/lib/action-state'
import { confirmVerificationLinkAction } from '@/server/actions/auth'

/**
 * The landing point of the link in a verification email.
 *
 * The link itself is a GET, so nothing is redeemed by opening it: this screen
 * posts the token to a server action, which is what spends it and opens the
 * session. It submits itself so one click on the email is genuinely enough, and
 * the button stays visible for anyone running without JavaScript.
 */
export function VerifyLinkCard({ token, next }: { token: string; next: string | null }) {
  const [state, formAction, pending] = useActionState(confirmVerificationLinkAction, IDLE_STATE)
  const form = useRef<HTMLFormElement>(null)
  const submitted = useRef(false)

  useEffect(() => {
    // Once only: a rejected token must not bounce the browser in a loop.
    if (submitted.current) return
    submitted.current = true
    form.current?.requestSubmit()
  }, [])

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Confirm this sign-in</CardTitle>
        <CardDescription>
          You opened a verification link. Confirming it is the only thing this link does, and it works once.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form ref={form} action={formAction} className="space-y-4">
          {/* The token is what the action spends. It is already in the URL the
              person clicked; nothing else on this screen repeats it. */}
          <input type="hidden" name="token" value={token} readOnly />
          {next ? <input type="hidden" name="next" value={next} readOnly /> : null}

          <FormStatus state={state} />

          <Button type="submit" disabled={pending} className="w-full bg-brand-600 hover:bg-brand-700">
            {pending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <ShieldCheck className="size-4" aria-hidden />
            )}
            {pending ? 'Confirming' : 'Confirm and continue'}
          </Button>
        </form>

        <p className="text-xs leading-relaxed text-muted-foreground">
          If this is not your device or not your address, do not confirm it — sign in again and change your password.
        </p>
      </CardContent>
    </Card>
  )
}
