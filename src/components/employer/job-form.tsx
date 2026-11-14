'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { FieldError, FormStatus, describedBy, restored } from '@/components/forms/form-parts'
import { JobSkillsEditor, type JobSkillDraft } from '@/components/employer/job-skills-editor'
import {
  EMPLOYMENT_TYPES,
  WORK_MODES,
  optionsFor,
  type EmploymentType,
  type WorkMode,
} from '@/lib/options'
import { IDLE_STATE } from '@/lib/action-state'
import { createJobAction, updateJobAction } from '@/server/actions/employer'
import type { CatalogSkill } from '@/lib/engines/types'

export type JobFormValues = {
  title: string
  description: string
  responsibilities: string
  requirementsText: string
  locationCity: string
  locationCountry: string
  workMode: WorkMode
  employmentType: EmploymentType
  salaryMin: string
  salaryMax: string
  experienceYearsMin: string
  experienceYearsMax: string
  reEntryFriendly: boolean
  flexibleHours: boolean
  returnshipProgram: boolean
  closesAt: string
  skills: JobSkillDraft[]
}

const WORK_MODE_ITEMS = optionsFor(WORK_MODES)
const EMPLOYMENT_ITEMS = optionsFor(EMPLOYMENT_TYPES)

export const EMPTY_JOB: JobFormValues = {
  title: '',
  description: '',
  responsibilities: '',
  requirementsText: '',
  locationCity: '',
  locationCountry: '',
  workMode: 'HYBRID',
  employmentType: 'FULL_TIME',
  salaryMin: '',
  salaryMax: '',
  experienceYearsMin: '',
  experienceYearsMax: '',
  reEntryFriendly: true,
  flexibleHours: false,
  returnshipProgram: false,
  closesAt: '',
  skills: [],
}

/**
 * One form for both create and edit. `createJobAction` / `updateJobAction` re-run
 * `jobSchema` server-side, including the JSON `skills` payload emitted by the
 * editor, so nothing here is trusted.
 */
export function JobForm({
  mode,
  jobId,
  values = EMPTY_JOB,
  catalog,
  verificationStatus,
  moderationNote,
}: {
  mode: 'create' | 'update'
  jobId?: string
  values?: JobFormValues
  catalog: CatalogSkill[]
  verificationStatus: string
  moderationNote?: string | null
}) {
  const action = mode === 'create' ? createJobAction : updateJobAction.bind(null, jobId as string)
  const [state, formAction, pending] = useActionState(action, IDLE_STATE)
  const prefix = mode

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{mode === 'create' ? 'Draft a role' : 'Edit role'}</CardTitle>
        <CardDescription>
          {mode === 'create'
            ? 'New roles are saved as drafts. A draft is visible only to your organisation until an administrator publishes it.'
            : 'Saving keeps the role in its current lifecycle state. Editing a published role sends it back to moderation.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-5">
          <FormStatus state={state} />

          <div>
            <Label htmlFor={`${prefix}-title`}>Role title</Label>
            <Input
              id={`${prefix}-title`}
              name="title"
              required
              maxLength={140}
              defaultValue={restored(state, 'title', values.title)}
              placeholder="Operations Coordinator"
              className="mt-1.5"
              aria-describedby={describedBy('title', state)}
            />
            <FieldError state={state} name="title" />
          </div>

          <div>
            <Label htmlFor={`${prefix}-description`}>What the role does</Label>
            <Textarea
              id={`${prefix}-description`}
              name="description"
              required
              rows={5}
              maxLength={6000}
              defaultValue={restored(state, 'description', values.description)}
              placeholder="Describe the role, the team and the outcomes that matter in the first six months."
              className="mt-1.5"
              aria-describedby={describedBy('description', state)}
            />
            <FieldError state={state} name="description" />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor={`${prefix}-responsibilities`}>Responsibilities (one per line)</Label>
              <Textarea
                id={`${prefix}-responsibilities`}
                name="responsibilities"
                rows={4}
                defaultValue={restored(state, 'responsibilities', values.responsibilities)}
                placeholder={'Run the weekly stock reconciliation\nCoordinate three delivery partners'}
                className="mt-1.5"
                aria-describedby={describedBy('responsibilities', state)}
              />
              <FieldError state={state} name="responsibilities" />
            </div>
            <div>
              <Label htmlFor={`${prefix}-requirements`}>Additional requirements (optional)</Label>
              <Textarea
                id={`${prefix}-requirements`}
                name="requirementsText"
                rows={4}
                defaultValue={restored(state, 'requirementsText', values.requirementsText)}
                placeholder="Shift patterns, on-call expectations, tooling."
                className="mt-1.5"
                aria-describedby={describedBy('requirementsText', state)}
              />
              <FieldError state={state} name="requirementsText" />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <Label id={`${prefix}-workmode-label`}>Work mode</Label>
              <Select
                name="workMode"
                items={WORK_MODE_ITEMS}
                required
                defaultValue={restored(state, 'workMode', values.workMode)}
              >
                <SelectTrigger className="mt-1.5 w-full" aria-labelledby={`${prefix}-workmode-label`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WORK_MODE_ITEMS.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldError state={state} name="workMode" />
            </div>

            <div>
              <Label id={`${prefix}-employment-label`}>Employment type</Label>
              <Select
                name="employmentType"
                items={EMPLOYMENT_ITEMS}
                required
                defaultValue={restored(state, 'employmentType', values.employmentType)}
              >
                <SelectTrigger className="mt-1.5 w-full" aria-labelledby={`${prefix}-employment-label`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EMPLOYMENT_ITEMS.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldError state={state} name="employmentType" />
            </div>

            <div>
              <Label htmlFor={`${prefix}-city`}>Location city</Label>
              <Input
                id={`${prefix}-city`}
                name="locationCity"
                maxLength={80}
                defaultValue={restored(state, 'locationCity', values.locationCity)}
                className="mt-1.5"
                aria-describedby={describedBy('locationCity', state)}
              />
              <FieldError state={state} name="locationCity" />
            </div>

            <div>
              <Label htmlFor={`${prefix}-country`}>Location country</Label>
              <Input
                id={`${prefix}-country`}
                name="locationCountry"
                maxLength={80}
                defaultValue={restored(state, 'locationCountry', values.locationCountry)}
                className="mt-1.5"
                aria-describedby={describedBy('locationCountry', state)}
              />
              <FieldError state={state} name="locationCountry" />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <div>
              <Label htmlFor={`${prefix}-salary-min`}>Salary from (₹/year)</Label>
              <Input
                id={`${prefix}-salary-min`}
                name="salaryMin"
                type="number"
                min={0}
                step={1000}
                inputMode="numeric"
                defaultValue={restored(state, 'salaryMin', values.salaryMin)}
                className="mt-1.5"
                aria-describedby={describedBy('salaryMin', state)}
              />
              <FieldError state={state} name="salaryMin" />
            </div>
            <div>
              <Label htmlFor={`${prefix}-salary-max`}>Salary to (₹/year)</Label>
              <Input
                id={`${prefix}-salary-max`}
                name="salaryMax"
                type="number"
                min={0}
                step={1000}
                inputMode="numeric"
                defaultValue={restored(state, 'salaryMax', values.salaryMax)}
                className="mt-1.5"
                aria-describedby={describedBy('salaryMax', state)}
              />
              <FieldError state={state} name="salaryMax" />
            </div>
            <div>
              <Label htmlFor={`${prefix}-exp-min`}>Experience from (years)</Label>
              <Input
                id={`${prefix}-exp-min`}
                name="experienceYearsMin"
                type="number"
                min={0}
                max={50}
                step={0.5}
                defaultValue={restored(state, 'experienceYearsMin', values.experienceYearsMin)}
                className="mt-1.5"
                aria-describedby={describedBy('experienceYearsMin', state)}
              />
              <FieldError state={state} name="experienceYearsMin" />
            </div>
            <div>
              <Label htmlFor={`${prefix}-exp-max`}>Experience to (years)</Label>
              <Input
                id={`${prefix}-exp-max`}
                name="experienceYearsMax"
                type="number"
                min={0}
                max={50}
                step={0.5}
                defaultValue={restored(state, 'experienceYearsMax', values.experienceYearsMax)}
                className="mt-1.5"
                aria-describedby={describedBy('experienceYearsMax', state)}
              />
              <FieldError state={state} name='experienceYearsMax' />
            </div>
            <div>
              <Label htmlFor={`${prefix}-closes`}>Applications close (optional)</Label>
              <Input
                id={`${prefix}-closes`}
                name="closesAt"
                type="date"
                defaultValue={restored(state, 'closesAt', values.closesAt)}
                className="mt-1.5"
                aria-describedby={describedBy('closesAt', state)}
              />
              <FieldError state={state} name="closesAt" />
            </div>
          </div>

          <fieldset className="grid gap-3 rounded-lg border border-border/70 p-3 sm:grid-cols-3">
            <legend className="px-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Hiring stance
            </legend>
            <div className="flex items-start gap-2">
              <Checkbox id={`${prefix}-reentry`} name="reEntryFriendly" defaultChecked={values.reEntryFriendly} className="mt-0.5" />
              <Label htmlFor={`${prefix}-reentry`} className="text-sm font-normal">
                Open to career re-entry
              </Label>
            </div>
            <div className="flex items-start gap-2">
              <Checkbox id={`${prefix}-flexible`} name="flexibleHours" defaultChecked={values.flexibleHours} className="mt-0.5" />
              <Label htmlFor={`${prefix}-flexible`} className="text-sm font-normal">
                Flexible hours
              </Label>
            </div>
            <div className="flex items-start gap-2">
              <Checkbox id={`${prefix}-returnship`} name="returnshipProgram" defaultChecked={values.returnshipProgram} className="mt-0.5" />
              <Label htmlFor={`${prefix}-returnship`} className="text-sm font-normal">
                Structured returnship
              </Label>
            </div>
          </fieldset>

          <JobSkillsEditor
            catalog={catalog}
            initial={values.skills}
            idPrefix={prefix}
          />

          {moderationNote ? (
            <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
              Moderator note: {moderationNote}
            </p>
          ) : null}

          {verificationStatus !== 'VERIFIED' && mode === 'create' ? (
            <p className="text-xs text-muted-foreground">
              Your organisation is awaiting verification. Drafting is allowed, and the draft stays private to your
              organisation until an administrator verifies the organisation and publishes the role.
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={pending} className="bg-brand-600 hover:bg-brand-700">
              {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              {pending
                ? 'Saving'
                : mode === 'create'
                  ? 'Create draft role'
                  : 'Save changes'}
            </Button>
            {mode === 'create' ? (
              <Button variant="outline" nativeButton={false} render={<Link href="/employer/jobs" />}>
                Back to roles
              </Button>
            ) : null}
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
