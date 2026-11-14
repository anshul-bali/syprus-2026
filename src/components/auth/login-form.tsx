'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { FieldError, FormStatus, restored } from '@/components/forms/form-parts'
import { PasswordField } from '@/components/forms/password-field'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { loginAction } from '@/server/actions/auth'
import { IDLE_STATE } from '@/lib/action-state'

export function LoginForm({ next, waived = false }: { next?: string; waived?: boolean }) {
  const [state, formAction, pending] = useActionState(loginAction, IDLE_STATE)

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Sign in to SYPRUS</CardTitle>
        <CardDescription>Use the email address you registered with — then enter the code we send you.</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-4">
          {next ? <input type="hidden" name="next" value={next} readOnly /> : null}

          <FormStatus state={state} />

          <div>
            <Label htmlFor="email">Email address</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              defaultValue={restored(state, 'email')}
              aria-describedby={state?.fieldErrors?.email ? 'email-error' : undefined}
              placeholder="you@example.com"
              className="mt-1.5"
            />
            <FieldError state={state} name="email" />
          </div>

          <PasswordField
            id="password"
            name="password"
            label="Password"
            autoComplete="current-password"
            state={state}
          />

          <Button type="submit" disabled={pending} className="w-full bg-brand-600 hover:bg-brand-700">
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            {pending ? 'Signing in' : 'Sign in'}
          </Button>
        </form>

        <p className="mt-4 text-sm text-muted-foreground">
          No account yet?{' '}
          <Link href="/register" className="font-medium text-brand-600 underline-offset-4 hover:underline">
            Create one
          </Link>
        </p>
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          {waived
            ? 'On this server, demonstration addresses open after the password alone — the notice above says so. Any address that could receive mail still gets a six-digit code or a one-time link, and the session opens only once one of them is passed. Five failed password attempts lock the account for 15 minutes. Demonstration sign-in accounts and their password are listed in the project README.'
            : 'After the password, a six-digit code or a one-time link goes to your email address, and the session opens only once you pass one — on every sign-in. Five failed password attempts lock the account for 15 minutes. Demonstration sign-in accounts and their password are listed in the project README.'}
        </p>
      </CardContent>
    </Card>
  )
}
