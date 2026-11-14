'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { InfoNote } from '@/components/common'
import { ActionForm, SubmitButton, SuccessLink } from '@/components/candidate/action-form'
import { CheckboxField, SelectField, TextAreaField, TextField } from '@/components/candidate/field'
import { EXPERIENCE_TYPES, optionsFor } from '@/lib/options'
import { addExperienceAction } from '@/server/actions/candidate'

const TYPE_ITEMS = optionsFor(EXPERIENCE_TYPES)

export function ExperienceForm() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Add an experience</CardTitle>
        <CardDescription>
          Paid work, freelance, volunteering, community leadership, studying — and caregiving all count here. The
          description is read by a rule-based keyword engine that can suggest skills; it never verifies anything.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ActionForm action={addExperienceAction} className="gap-4">
          {({ state, pending }) => (
            <div className="flex flex-col gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <SelectField
                  id="type"
                  label="Kind of experience"
                  items={TYPE_ITEMS}
                  required
                  state={state}
                  defaultValue="PAID_EMPLOYMENT"
                  help="Caregiving entries are labelled as caregiving and carry their own evidence."
                />
                <TextField
                  id="hoursPerWeek"
                  label="Hours per week"
                  type="number"
                  min={1}
                  max={100}
                  state={state}
                  help="Part-time work is pro-rated when your total experience is computed."
                />
              </div>

              <TextField id="title" label="Title" required state={state} placeholder="Operations coordinator" />
              <TextField
                id="organization"
                label="Organisation"
                state={state}
                placeholder="Employer, client, group or “household”"
              />

              <TextAreaField
                id="description"
                label="What did the work involve?"
                required
                rows={5}
                state={state}
                placeholder="Duties, tools, people you coordinated, budgets you handled, outcomes you owned."
                help="Write it in your own words. Suggestions trace back to the exact phrases used here."
              />
              <TextAreaField
                id="achievements"
                label="Achievements worth naming"
                rows={3}
                state={state}
                placeholder="Something that changed because of this work."
              />

              <div className="grid gap-4 sm:grid-cols-2">
                <TextField id="startDate" label="Start date" type="date" state={state} />
                <TextField id="endDate" label="End date" type="date" state={state} />
              </div>

              <div className="grid gap-3 rounded-lg border border-border/70 bg-muted/30 p-3.5 sm:grid-cols-2">
                <CheckboxField
                  name="ongoing"
                  label="I am still doing this"
                  help="Leave the end date blank and tick this."
                />
                <CheckboxField
                  name="isCaregiving"
                  label="Count this as caregiving or household responsibility"
                  help="Care work is recorded as experience, not as a gap."
                />
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <SubmitButton pending={pending}>Save experience</SubmitButton>
                {state.values?.notice === 'inferred-skills' ? (
                  <SuccessLink state={state} href="/candidate/skills">
                    Review the suggested skills
                  </SuccessLink>
                ) : null}
              </div>
            </div>
          )}
        </ActionForm>

        <div className="mt-4">
          <InfoNote tone="privacy" title="Consent gates the suggestions">
            Skill suggestions only run while rule-based inference consent is granted under Profile and privacy. With it
            off, nothing is inferred and you add every skill yourself.
          </InfoNote>
        </div>
      </CardContent>
    </Card>
  )
}
