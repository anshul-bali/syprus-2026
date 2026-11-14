'use server'

import { revalidatePath } from 'next/cache'
import { AccessDeniedError, getPrincipal } from '@/lib/authz'
import { applicationCreateSchema, parseFormData } from '@/lib/validation'
import { errorState, successState, type ActionState } from '@/lib/action-state'
import { applyToJob, withdrawApplication } from '@/server/applications'

export async function applyToJobAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const principal = await getPrincipal()
  if (!principal) return errorState('Your session has ended. Sign in again.')

  const parsed = parseFormData(formData, applicationCreateSchema)
  if (!parsed.ok) return errorState(parsed.error, parsed.fieldErrors, parsed.values)

  try {
    const application = await applyToJob(principal, parsed.data)

    revalidatePath('/candidate/jobs')
    revalidatePath(`/candidate/jobs/${application.jobId}`)
    revalidatePath('/candidate/applications')
    revalidatePath('/candidate')

    return successState(
      `Application submitted (${Math.round((application.matchScoreSnapshot ?? 0) * 100)}% skill match snapshot). Applying is the one action that discloses your name to that organisation.`,
    )
  } catch (error) {
    return errorState(error instanceof AccessDeniedError ? error.message : 'Could not submit that application.')
  }
}

export async function withdrawApplicationAction(
  applicationId: string,
  _prevState: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  const principal = await getPrincipal()
  if (!principal) return errorState('Your session has ended. Sign in again.')

  try {
    await withdrawApplication(principal, applicationId)
    revalidatePath('/candidate/applications')
    revalidatePath('/candidate')
    return successState('Application withdrawn. The role stays in your tracker for reference.')
  } catch (error) {
    return errorState(error instanceof AccessDeniedError ? error.message : 'Could not withdraw that application.')
  }
}
