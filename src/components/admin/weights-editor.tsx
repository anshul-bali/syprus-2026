'use client'

import { toast } from 'sonner'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { InfoNote } from '@/components/common'
import { ActionForm, SubmitButton } from '@/components/candidate/action-form'
import { TextField } from '@/components/candidate/field'
import { reapplyWeightsAction, saveWeightsAction } from '@/server/actions/ai'
import { ActionSubmit } from '@/components/candidate/action-submit'

export type WeightValues = {
  version: string
  label: string
  required: number
  preferred: number
  evidence: number
  preferences: number
}

/**
 * The matching weights are configuration, not code. Editing them writes a new
 * versioned profile; stored scores keep the version that produced them until an
 * administrator recomputes.
 */
export function WeightEditor({ defaults, activeVersion }: { defaults: WeightValues; activeVersion: string }) {
  const asPercent = (value: number) => String(Math.round(value * 100))

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Save a weight set</CardTitle>
        <CardDescription className="text-xs">
          Enter whole percentages that add to 100. The platform refuses a set that does not sum to 1.00 and refuses to
          make required-skill coverage anything below 30%, because then it would no longer be a skills-first match.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ActionForm
          action={saveWeightsAction}
          className="gap-4"
          onSuccess={(message) => toast.success(message ?? 'Weight set stored.')}
        >
          {({ state, pending }) => (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField
                  id="version"
                  label="Version tag"
                  required
                  state={state}
                  defaultValue={`${activeVersion}-alt`}
                  help="Short, unique, and quoted on every score computed with it."
                />
                <TextField
                  id="label"
                  label="Human label"
                  required
                  state={state}
                  defaultValue="Prototype weights — skills-first"
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-4">
                <TextField
                  id="required"
                  label="Required skills %"
                  type="number"
                  required
                  min={0}
                  max={100}
                  state={state}
                  defaultValue={asPercent(defaults.required)}
                />
                <TextField
                  id="preferred"
                  label="Preferred skills %"
                  type="number"
                  required
                  min={0}
                  max={100}
                  state={state}
                  defaultValue={asPercent(defaults.preferred)}
                />
                <TextField
                  id="evidence"
                  label="Evidence strength %"
                  type="number"
                  required
                  min={0}
                  max={100}
                  state={state}
                  defaultValue={asPercent(defaults.evidence)}
                />
                <TextField
                  id="preferences"
                  label="Constraints %"
                  type="number"
                  required
                  min={0}
                  max={100}
                  state={state}
                  defaultValue={asPercent(defaults.preferences)}
                />
              </div>

              <TextField
                id="note"
                label="Why this set exists"
                state={state}
                defaultValue="Administrative adjustment recorded for review."
              />

              <div className="flex items-start gap-2.5">
                <Checkbox id="activate" name="activate" defaultChecked />
                <Label htmlFor="activate" className="text-[13px]">
                  Make this the active set immediately
                  <span className="mt-0.5 block text-xs text-muted-foreground">
            Scores already stored keep their own version tag, so an audit can still tell which assumption produced
            a number.
                  </span>
                </Label>
              </div>

              <SubmitButton pending={pending}>Save weight set</SubmitButton>
              {state.status === 'error' ? (
                <p className="text-xs text-destructive" role="alert">
                  {state.message}
                </p>
              ) : null}
            </>
          )}
        </ActionForm>

        <div className="flex flex-wrap items-center gap-3 border-t border-border/60 pt-3">
          <ActionSubmit
            action={reapplyWeightsAction}
            label="Recompute every score with the active set"
            pendingLabel="Recomputing…"
            variant="outline"
            size="sm"
          />
          <span className="text-xs text-muted-foreground">
            Runs the same deterministic engine the candidate screens use, for every profile that holds skills.
          </span>
        </div>

        <InfoNote tone="warning" title="Prototype assumption, not a validated instrument">
          These weights were chosen to express a skills-first ordering for an MVP. They have not been validated against
          hiring outcomes, and changing them does not make the model fair — it changes arithmetic. Keep the fairness
          monitor beside this screen when a set is adjusted.
        </InfoNote>
      </CardContent>
    </Card>
  )
}

export function ActiveWeightReadout({ values, version, source }: { values: WeightValues; version: string; source: string }) {
  const rows = [
    { label: 'Required skill coverage', value: values.required },
    { label: 'Preferred skill coverage', value: values.preferred },
    { label: 'Evidence and assessment strength', value: values.evidence },
    { label: 'Candidate preferences and constraints', value: values.preferences },
  ]
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Active weights</CardTitle>
        <CardDescription className="text-xs">
          {version} · read from {source}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-3 text-sm">
            <span>{row.label}</span>
            <span className="tabular-nums font-medium">{Math.round(row.value * 100)}%</span>
          </div>
        ))}
        <div className="mt-1 border-t border-border/60 pt-2">
          <p className="text-xs text-muted-foreground">
            Sum {Math.round((rows.reduce((total, row) => total + row.value, 0) + Number.EPSILON) * 100)}%. A category
            with no data hands its weight to the categories that have data, so a role without preferred skills is not
            flattered by an empty bucket.
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
