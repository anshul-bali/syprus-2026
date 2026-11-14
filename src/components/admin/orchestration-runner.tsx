'use client'

import { toast } from 'sonner'
import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ActionForm, SubmitButton } from '@/components/candidate/action-form'
import { SelectField } from '@/components/candidate/field'
import { InfoNote } from '@/components/common'
import { runOrchestrationAction } from '@/server/actions/ai'

/**
 * The workflow trigger. Running it performs real model calls (or the rule
 * engines when a provider is unavailable) and writes the same rows the candidate
 * screens read.
 */
export function OrchestrationRunner({
  profiles,
  jobs,
  isAdmin = false,
}: {
  profiles: { value: string; label: string }[]
  jobs: { value: string; label: string }[]
  isAdmin?: boolean
}) {
  if (profiles.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Workflow</CardTitle>
          <CardDescription className="text-xs">
            No candidate profile exists to run the workflow for yet.
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Run the workflow</CardTitle>
        <CardDescription className="text-xs">
          Skills Discovery → matching → Learning Pathways, in that order. Each step writes its own row, and a failed
          step stops the run rather than continuing on stale numbers.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ActionForm
          action={runOrchestrationAction}
          className="gap-4"
          onSuccess={(message) => toast.success(message ?? 'Workflow finished.')}
        >
          {({ state, pending }) => (
            <>
              {isAdmin ? (
                <SelectField
                  id="profileId"
                  label="Candidate profile"
                  items={profiles}
                  required
                  state={state}
                  help="Only an administrator can run this for someone else; a candidate always runs it for themselves."
                />
              ) : null}
              {jobs.length > 0 ? (
                <SelectField
                  id="targetJobId"
                  label="Target role"
                  items={[{ value: '', label: 'Automatic — closest matched roles' }, ...jobs]}
                  state={state}
                  defaultValue=""
                  help="The gap analysis and the pathway both aim at this role."
                />
              ) : null}
              <div className="flex flex-wrap items-center gap-3">
                <SubmitButton pending={pending}>Run all steps</SubmitButton>
                <span className="text-xs text-muted-foreground">
                  Costs tokens against the provider’s per-minute window; queued steps run sequentially.
                </span>
              </div>
              {state.status === 'error' ? (
                <p className="text-xs text-destructive" role="alert">
                  {state.message}
                </p>
              ) : null}
              {state.status === 'success' && !isAdmin ? (
                <div className="flex flex-wrap gap-2 text-xs">
                  <Link href="/candidate/pathways" className="underline underline-offset-2">
                    See the pathway it built
                  </Link>
                  <Link href="/candidate/suggestions" className="underline underline-offset-2">
                    See the suggestions
                  </Link>
                </div>
              ) : null}
            </>
          )}
        </ActionForm>

        <InfoNote tone="info" title="Capability graph needs no step">
          The graph is generated from the rows these steps write, so it updates as soon as the page reloads. Nothing
          caches a picture of it.
        </InfoNote>
      </CardContent>
    </Card>
  )
}
