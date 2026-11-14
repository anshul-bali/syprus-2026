'use client'

import { useActionState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { FieldError, FormStatus, describedBy, restored } from '@/components/forms/form-parts'
import { IDLE_STATE } from '@/lib/action-state'
import { updateOrganizationAction } from '@/server/actions/employer'

export type OrganizationFormValues = {
  name: string
  website: string
  industry: string
  sizeLabel: string
  locationCity: string
  locationCountry: string
  description: string
  flexPolicy: string
  returnshipNote: string
}

/** Employer-facing organisation profile. Verification is not editable here. */
export function OrganizationProfileForm({ values }: { values: OrganizationFormValues }) {
  const [state, formAction, pending] = useActionState(updateOrganizationAction, IDLE_STATE)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Organisation profile</CardTitle>
        <CardDescription>
          What candidates see beside your roles. Keep the flexibility policy and returnship note specific — they are
          the two fields a returning candidate reads first.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-4">
          <FormStatus state={state} />

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="org-name">Organisation name</Label>
              <Input
                id="org-name"
                name="name"
                required
                maxLength={140}
                defaultValue={restored(state, 'name', values.name)}
                className="mt-1.5"
                aria-describedby={describedBy('name', state)}
              />
              <FieldError state={state} name="name" />
            </div>
            <div>
              <Label htmlFor="org-website">Website</Label>
              <Input
                id="org-website"
                name="website"
                type="url"
                maxLength={200}
                defaultValue={restored(state, 'website', values.website)}
                placeholder="https://example.org"
                className="mt-1.5"
                aria-describedby={describedBy('website', state)}
              />
              <FieldError state={state} name="website" />
            </div>
            <div>
              <Label htmlFor="org-industry">Industry</Label>
              <Input
                id="org-industry"
                name="industry"
                maxLength={80}
                defaultValue={restored(state, 'industry', values.industry)}
                className="mt-1.5"
                aria-describedby={describedBy('industry', state)}
              />
              <FieldError state={state} name="industry" />
            </div>
            <div>
              <Label htmlFor="org-size">Size</Label>
              <Input
                id="org-size"
                name="sizeLabel"
                maxLength={60}
                defaultValue={restored(state, 'sizeLabel', values.sizeLabel)}
                placeholder="50–200 people"
                className="mt-1.5"
                aria-describedby={describedBy('sizeLabel', state)}
              />
              <FieldError state={state} name="sizeLabel" />
            </div>
            <div>
              <Label htmlFor="org-city">City</Label>
              <Input
                id="org-city"
                name="locationCity"
                maxLength={80}
                defaultValue={restored(state, 'locationCity', values.locationCity)}
                className="mt-1.5"
                aria-describedby={describedBy('locationCity', state)}
              />
              <FieldError state={state} name="locationCity" />
            </div>
            <div>
              <Label htmlFor="org-country">Country</Label>
              <Input
                id="org-country"
                name="locationCountry"
                maxLength={80}
                defaultValue={restored(state, 'locationCountry', values.locationCountry)}
                className="mt-1.5"
                aria-describedby={describedBy('locationCountry', state)}
              />
              <FieldError state={state} name="locationCountry" />
            </div>
          </div>

          <div>
            <Label htmlFor="org-description">About the organisation</Label>
            <Textarea
              id="org-description"
              name="description"
              rows={4}
              maxLength={1500}
              defaultValue={restored(state, 'description', values.description)}
              className="mt-1.5"
              aria-describedby={describedBy('description', state)}
            />
            <FieldError state={state} name="description" />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="org-flex">Flexibility policy</Label>
              <Textarea
                id="org-flex"
                name="flexPolicy"
                rows={3}
                maxLength={600}
                defaultValue={restored(state, 'flexPolicy', values.flexPolicy)}
                placeholder="Core hours, part-time patterns, remote rules."
                className="mt-1.5"
                aria-describedby={describedBy('flexPolicy', state)}
              />
              <FieldError state={state} name="flexPolicy" />
            </div>
            <div>
              <Label htmlFor="org-returnship">Returnship note</Label>
              <Textarea
                id="org-returnship"
                name="returnshipNote"
                rows={3}
                maxLength={600}
                defaultValue={restored(state, 'returnshipNote', values.returnshipNote)}
                placeholder="How you onboard someone returning after a break."
                className="mt-1.5"
                aria-describedby={describedBy('returnshipNote', state)}
              />
              <FieldError state={state} name="returnshipNote" />
            </div>
          </div>

          <Button type="submit" disabled={pending} className="bg-brand-600 hover:bg-brand-700">
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            {pending ? 'Saving' : 'Save organisation profile'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
