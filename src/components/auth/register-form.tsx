'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { FieldError, FormStatus, restored } from '@/components/forms/form-parts'
import { PasswordField } from '@/components/forms/password-field'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { ActionState } from '@/lib/action-state'
import { IDLE_STATE } from '@/lib/action-state'
import { registerCandidateAction, registerEmployerAction } from '@/server/actions/auth'

function PasswordFields({ state, idPrefix }: { state: ActionState; idPrefix: string }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <PasswordField
        id={`${idPrefix}-password`}
        name="password"
        label="Password"
        autoComplete="new-password"
        state={state}
        minLength={8}
        hint="At least 8 characters, with a letter and a number. Use the eye to check what you typed."
      />
      <PasswordField
        id={`${idPrefix}-confirm-password`}
        name="confirmPassword"
        label="Confirm password"
        autoComplete="new-password"
        state={state}
        minLength={8}
      />
    </div>
  )
}

function SubmitButton({ pending, label }: { pending: boolean; label: string }) {
  return (
    <Button type="submit" disabled={pending} className="w-full bg-brand-600 hover:bg-brand-700">
      {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
      {pending ? 'Creating account' : label}
    </Button>
  )
}

function ConfirmationNote({ waived, what }: { waived: boolean; what: 'account' | 'organisation' }) {
  return (
    <p className="text-xs leading-relaxed text-muted-foreground">
      {waived
        ? `The ${what} is written. On this server a demonstration address opens straight away — the notice above says so — while any address that could receive mail still has to pass a code or a link.`
        : `The ${what} is written, but nothing opens until the address is confirmed with the six-digit code or the one-time link sent to it.`}
    </p>
  )
}

function CandidateForm({ waived }: { waived: boolean }) {
  const [state, formAction, pending] = useActionState(registerCandidateAction, IDLE_STATE)

  return (
    <form action={formAction} className="space-y-4">
      <FormStatus state={state} />

      <div>
        <Label htmlFor="candidate-name">Full name</Label>
        <Input
          id="candidate-name"
          name="name"
          required
          autoComplete="name"
          defaultValue={restored(state, 'name')}
          className="mt-1.5"
        />
        <FieldError state={state} name="name" />
      </div>

      <div>
        <Label htmlFor="candidate-email">Email address</Label>
        <Input
          id="candidate-email"
          name="email"
          type="email"
          required
          autoComplete="email"
          defaultValue={restored(state, 'email')}
          className="mt-1.5"
          placeholder="you@example.com"
        />
        <FieldError state={state} name="email" />
      </div>

      <PasswordFields state={state} idPrefix="candidate" />

      <div className="flex items-start gap-2.5 rounded-lg border border-border bg-muted/40 p-3.5">
        <Checkbox
          key={`core-consent-${state.status}-${state.values?.coreConsent ?? 'off'}`}
          id="core-consent"
          name="coreConsent"
          defaultChecked={state.values?.coreConsent === 'on'}
          className="mt-0.5"
          required
        />
        <Label htmlFor="core-consent" className="text-sm font-normal leading-relaxed">
          I agree that SYPRUS may process the information I enter in order to build my profile. Further consents — skill
          suggestions, employer visibility and contact — are asked separately and can be withdrawn at any time.
        </Label>
      </div>
      <FieldError state={state} name="coreConsent" />

      <SubmitButton pending={pending} label="Create candidate account" />
      <ConfirmationNote waived={waived} what="account" />
    </form>
  )
}

function EmployerForm({ waived }: { waived: boolean }) {
  const [state, formAction, pending] = useActionState(registerEmployerAction, IDLE_STATE)

  return (
    <form action={formAction} className="space-y-4">
      <FormStatus state={state} />

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="employer-name">Your name</Label>
          <Input
            id="employer-name"
            name="name"
            required
            autoComplete="name"
            defaultValue={restored(state, 'name')}
            className="mt-1.5"
          />
          <FieldError state={state} name="name" />
        </div>
        <div>
          <Label htmlFor="employer-email">Work email</Label>
          <Input
            id="employer-email"
            name="email"
            type="email"
            required
            autoComplete="email"
            defaultValue={restored(state, 'email')}
            className="mt-1.5"
            placeholder="recruiter@company.com"
          />
          <FieldError state={state} name="email" />
        </div>
      </div>

      <div>
        <Label htmlFor="organization-name">Organisation name</Label>
        <Input
          id="organization-name"
          name="organizationName"
          required
          defaultValue={restored(state, 'organizationName')}
          className="mt-1.5"
        />
        <FieldError state={state} name="organizationName" />
        <p className="mt-1 text-xs text-muted-foreground">
          New organisations start as pending. An administrator must verify the organisation before its roles reach
          candidates.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="industry">Sector</Label>
          <Input
            id="industry"
            name="industry"
            defaultValue={restored(state, 'industry')}
            className="mt-1.5"
            placeholder="Healthcare"
          />
          <FieldError state={state} name="industry" />
        </div>
        <div>
          <Label htmlFor="size-label">Team or company size</Label>
          <Input
            id="size-label"
            name="sizeLabel"
            defaultValue={restored(state, 'sizeLabel')}
            className="mt-1.5"
            placeholder="50–200 people"
          />
          <FieldError state={state} name="sizeLabel" />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="org-city">City</Label>
          <Input
            id="org-city"
            name="locationCity"
            defaultValue={restored(state, 'locationCity')}
            className="mt-1.5"
          />
          <FieldError state={state} name="locationCity" />
        </div>
        <div>
          <Label htmlFor="org-country">Country</Label>
          <Input
            id="org-country"
            name="locationCountry"
            defaultValue={restored(state, 'locationCountry')}
            className="mt-1.5"
          />
          <FieldError state={state} name="locationCountry" />
        </div>
      </div>

      <div>
        <Label htmlFor="org-website">Website</Label>
        <Input
          id="org-website"
          name="website"
          type="url"
          defaultValue={restored(state, 'website')}
          className="mt-1.5"
          placeholder="https://example.com"
        />
        <FieldError state={state} name="website" />
      </div>

      <PasswordFields state={state} idPrefix="employer" />

      <div className="flex items-start gap-2.5 rounded-lg border border-border bg-muted/40 p-3.5">
        <Checkbox
          key={`recruitment-consent-${state.status}-${state.values?.recruitmentConsent ?? 'off'}`}
          id="recruitment-consent"
          name="recruitmentConsent"
          defaultChecked={state.values?.recruitmentConsent === 'on'}
          className="mt-0.5"
          required
        />
        <Label htmlFor="recruitment-consent" className="text-sm font-normal leading-relaxed">
          I confirm I am authorised to recruit for this organisation and will evaluate candidates against the skills
          defined for the role.
        </Label>
      </div>
      <FieldError state={state} name="recruitmentConsent" />

      <SubmitButton pending={pending} label="Register organisation" />
      <ConfirmationNote waived={waived} what="organisation" />
    </form>
  )
}

export function RegisterForm({
  defaultRole,
  onRoleChange,
  waived = false,
}: {
  defaultRole: 'candidate' | 'employer'
  onRoleChange?: (role: 'candidate' | 'employer') => void
  waived?: boolean
}) {
  return (
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <CardTitle>Create your SYPRUS account</CardTitle>
        <CardDescription>
          Candidates build a skills inventory and get matched on capability. Employers define the skills a role needs
          and review anonymised candidates.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs
          defaultValue={defaultRole}
          onValueChange={(value) => {
            if (value === 'employer') onRoleChange?.('employer')
            else if (value === 'candidate') onRoleChange?.('candidate')
          }}
        >
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="candidate">Returning to work</TabsTrigger>
            <TabsTrigger value="employer">Hiring</TabsTrigger>
          </TabsList>
          <TabsContent value="candidate" className="pt-2">
            <CandidateForm waived={waived} />
          </TabsContent>
          <TabsContent value="employer" className="pt-2">
            <EmployerForm waived={waived} />
          </TabsContent>
        </Tabs>

        <p className="mt-5 text-sm text-muted-foreground">
          Already registered?{' '}
          <Link href="/login" className="font-medium text-brand-600 underline-offset-4 hover:underline">
            Sign in
          </Link>
        </p>
      </CardContent>
    </Card>
  )
}
