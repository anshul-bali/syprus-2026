'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { InfoNote } from '@/components/common'
import { ActionForm, SubmitButton } from '@/components/candidate/action-form'
import { CheckboxField, SelectField, TextAreaField, TextField } from '@/components/candidate/field'
import { SHARING_MODES, WORK_PREFERENCES, optionsFor } from '@/lib/options'
import { updateProfileAction } from '@/server/actions/candidate'

export type ProfileFormData = {
  headline: string
  summary: string
  locationCity: string
  locationCountry: string
  workPreference: string
  availabilityHours: string
  targetRole: string
  targetIndustry: string
  careerBreakMonths: string
  breakReason: string
  returnTimeline: string
  yearsOfExperience: string
  educationSummary: string
  sharingMode: string
  visibleToEmployers: boolean
  anonymousSharingGranted: boolean
}

const WORK_ITEMS = optionsFor(WORK_PREFERENCES)
const SHARING_ITEMS = optionsFor(SHARING_MODES)

export function ProfileForm({ values }: { values: ProfileFormData }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Profile fields</CardTitle>
        <CardDescription>
          These are the fields your account is built from. Matching reads skill levels, skill confidence, evidence
          counts, your stated total experience and the role’s published experience range — the fields below named as
          private are not read at all.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ActionForm action={updateProfileAction} className="gap-5">
          {({ state, pending }) => (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField
                  id="headline"
                  label="Headline"
                  state={state}
                  defaultValue={values.headline || undefined}
                  placeholder="Operations coordinator · hybrid · returning after a care period"
                  maxLength={120}
                />
                <TextField
                  id="targetRole"
                  label="Target role"
                  state={state}
                  defaultValue={values.targetRole || undefined}
                  placeholder="Project coordinator"
                  help="Powers recommendations and gap reports."
                />
                <TextField
                  id="locationCity"
                  label="City"
                  state={state}
                  defaultValue={values.locationCity || undefined}
                  help="Only city and country are ever shown to employers."
                />
                <TextField
                  id="locationCountry"
                  label="Country"
                  state={state}
                  defaultValue={values.locationCountry || undefined}
                />
                <TextField
                  id="targetIndustry"
                  label="Target sector"
                  state={state}
                  defaultValue={values.targetIndustry || undefined}
                />
                <SelectField
                  id="workPreference"
                  label="Work preference"
                  items={WORK_ITEMS}
                  required
                  state={state}
                  defaultValue={values.workPreference}
                />
              </div>

              <TextAreaField
                id="summary"
                label="Summary in your own words"
                rows={5}
                state={state}
                defaultValue={values.summary || undefined}
                placeholder="What you have done, what you handled while you were out, and what you want next."
              />

              <div className="grid gap-4 sm:grid-cols-3">
                <TextField
                  id="availabilityHours"
                  label="Hours you can commit per week"
                  type="number"
                  min={0}
                  max={80}
                  state={state}
                  defaultValue={values.availabilityHours || undefined}
                />
                <TextField
                  id="yearsOfExperience"
                  label="Total years of paid experience"
                  type="number"
                  min={0}
                  max={60}
                  step={0.1}
                  state={state}
                  defaultValue={values.yearsOfExperience}
                  help="Recomputed automatically when you add or remove experience entries. Correct it only if the total is wrong."
                />
                <TextField
                  id="returnTimeline"
                  label="Return timeline"
                  state={state}
                  defaultValue={values.returnTimeline || undefined}
                  placeholder="Ready now, within three months…"
                />
              </div>

              <div className="grid gap-4 rounded-lg border border-border/70 bg-muted/25 p-3.5">
                <div className="grid gap-4 sm:grid-cols-2">
                  <TextField
                    id="careerBreakMonths"
                    label="Months since your last paid role"
                    type="number"
                    min={0}
                    max={600}
                    state={state}
                    defaultValue={values.careerBreakMonths || undefined}
                    help="Stored for your own records. It is not an input to matching, scoring or gap analysis."
                  />
                  <TextField
                    id="breakReason"
                    label="Reason for the break (private)"
                    state={state}
                    defaultValue={values.breakReason || undefined}
                    help="Never shown to an employer and never read by an engine."
                  />
                </div>
                <TextAreaField
                  id="educationSummary"
                  label="Education and training"
                  rows={3}
                  state={state}
                  defaultValue={values.educationSummary || undefined}
                  help="Institution names are not read by the matching model."
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <SelectField
                  id="sharingMode"
                  label="How your profile is shared"
                  items={SHARING_ITEMS}
                  required
                  state={state}
                  defaultValue={values.sharingMode}
                  help="Employers never see your name while the mode is anonymous; applying is what discloses it."
                />
                <div className="flex flex-col justify-end gap-2">
                  <CheckboxField
                    name="visibleToEmployers"
                    label="Make my profile discoverable by verified employers"
                    defaultChecked={values.visibleToEmployers}
                    help={
                      values.anonymousSharingGranted
                        ? 'Needs the anonymised profile sharing consent below, which is currently granted.'
                        : 'Needs the “anonymised profile sharing” consent granted first — saving without it is refused and tells you why.'
                    }
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <SubmitButton pending={pending}>Save profile</SubmitButton>
                <span className="text-xs text-muted-foreground">
                  Saving records an audit entry on your account.
                </span>
              </div>

              {!values.anonymousSharingGranted && values.visibleToEmployers ? (
                <InfoNote tone="warning" title="Visibility is refused until sharing consent is granted">
                  Tick “visible to employers” without granting the consent below and the server rejects the save with
                  that message; it does not silently hide you.
                </InfoNote>
              ) : null}
            </>
          )}
        </ActionForm>
      </CardContent>
    </Card>
  )
}
