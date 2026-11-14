'use server'

/**
 * Identity disclosure actions. A request never reveals anything; only the
 * candidate's decision does, and both sides of that exchange are audited.
 */

import { revalidatePath } from 'next/cache'
import { AccessDeniedError, getPrincipal } from '@/lib/authz'
import { errorState, successState, type ActionState } from '@/lib/action-state'
import { decideDisclosure, requestIdentityDisclosure, withdrawDisclosureRequest, revokeDisclosure } from '@/server/disclosure'

function message(error: unknown, fallback: string) {
  return error instanceof AccessDeniedError ? error.message : fallback
}

export async function requestDisclosureAction(
  prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const principal = await getPrincipal()
  if (!principal) return errorState('Your session has ended. Sign in again.')

  const candidateProfileId = String(formData.get('candidateProfileId') ?? '')
  const jobId = String(formData.get('jobId') ?? '')
  const reason = String(formData.get('reason') ?? '')

  if (!candidateProfileId) return errorState('No candidate was named for this request.')

  try {
    const result = await requestIdentityDisclosure(principal, {
      candidateProfileId,
      jobId: jobId || null,
      reason,
    })
    revalidatePath('/employer/candidates')
    revalidatePath('/candidate/disclosures')
    return successState(result.message)
  } catch (error) {
    return errorState(message(error, 'Could not send that request.'), {
      reason: error instanceof AccessDeniedError ? error.message : 'Too short.',
    })
  }
}

export async function decideDisclosureAction(
  prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const principal = await getPrincipal()
  if (!principal) return errorState('Your session has ended. Sign in again.')

  const requestId = String(formData.get('requestId') ?? '')
  const decision = String(formData.get('decision') ?? '')
  const note = String(formData.get('note') ?? '')

  if (!requestId) return errorState('That request could not be identified.')
  if (decision !== 'APPROVED' && decision !== 'DECLINED') {
    return errorState('Choose either share or decline — nothing was recorded.')
  }

  try {
    const view = await decideDisclosure(principal, { requestId, decision, note: note || null })
    revalidatePath('/candidate/disclosures')
    revalidatePath('/candidate/notifications')
    revalidatePath('/employer/candidates')
    return successState(
      decision === 'APPROVED'
        ? `Shared with ${view.organizationName}. Every view of your identity is logged.`
        : 'Declined. Your profile stays anonymous to that organisation.',
    )
  } catch (error) {
    return errorState(message(error, 'Could not record that decision.'))
  }
}

export async function withdrawDisclosureAction(
  prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const principal = await getPrincipal()
  if (!principal) return errorState('Your session has ended. Sign in again.')

  const requestId = String(formData.get('requestId') ?? '')
  if (!requestId) return errorState('That request could not be identified.')

  try {
    await withdrawDisclosureRequest(principal, requestId)
    revalidatePath('/employer/candidates')
    revalidatePath('/candidate/disclosures')
    return successState('Request withdrawn. The candidate will see it as withdrawn, not pending.')
  } catch (error) {
    return errorState(message(error, 'Could not withdraw that request.'))
  }
}

export async function revokeDisclosureAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const principal = await getPrincipal()
  if (!principal) return errorState('Your session has ended. Sign in again.')
  try {
    await revokeDisclosure(principal, String(formData.get('requestId') ?? ''))
    revalidatePath('/candidate/disclosures')
    revalidatePath('/employer/candidates')
    return successState('Disclosure grant withdrawn. Active applications are separate grants; withdraw those too if you want to stop all identity sharing with this organisation.')
  } catch (error) {
    return errorState(message(error, 'Could not withdraw that grant.'))
  }
}
