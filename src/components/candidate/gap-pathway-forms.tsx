'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ActionForm, SubmitButton } from '@/components/candidate/action-form'
import { CheckboxField, SelectField } from '@/components/candidate/field'
import { generateGapReportAction, generatePathwayAction } from '@/server/actions/candidate'

export type TargetOption = { value: string; label: string }

/** Role picker that drives the gap engine: one chosen role, or the automatic union. */
export function GapTargetForm({ options }: { options: TargetOption[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Run a gap report</CardTitle>
        <CardDescription>
          The engine compares your skills inventory against the required and preferred skills of one role, or against
          the union of the roles you already match best. It is a rule-based comparison of stored levels — not an
          assessment of your potential.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ActionForm action={generateGapReportAction} className="gap-4">
          {({ state, pending }) => (
            <>
              <SelectField
                id="targetJobId"
                label="Target role"
                items={options}
                required
                state={state}
                defaultValue="AUTO"
                help="Choosing a role you cannot reach yet is fine — the report is a distance measure, not a gate."
              />
              <SubmitButton pending={pending}>Generate report</SubmitButton>
            </>
          )}
        </ActionForm>
      </CardContent>
    </Card>
  )
}

/** Pathway generator. `force` rebuilds a plan you have already worked through. */
export function PathwayGeneratorForm({ options }: { options: TargetOption[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Create or refresh a pathway</CardTitle>
        <CardDescription>
          A fresh gap analysis runs first, then the planner picks catalogue resources in severity order. If the
          catalogue holds nothing for a gap, the plan says so instead of inventing a course.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ActionForm action={generatePathwayAction} className="gap-4">
          {({ state, pending }) => (
            <>
              <SelectField
                id="targetJobId"
                label="Target role"
                items={options}
                required
                state={state}
                defaultValue="AUTO"
                help="Leave the automatic choice to plan against your closest matched roles."
              />
              <CheckboxField
                name="force"
                label="Rebuild even if an untouched plan already exists for this target"
                help="Tick this to start the steps again from “not started”."
              />
              <SubmitButton pending={pending}>Build pathway</SubmitButton>
            </>
          )}
        </ActionForm>
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          Building a pathway stores a plan, retires older plans for the same target and sends you a notification.
        </p>
      </CardContent>
    </Card>
  )
}
