'use server'

import { revalidatePath } from 'next/cache'
import { label as enumLabel } from '@/lib/options'
import { AccessDeniedError, getPrincipal } from '@/lib/authz'
import { errorState, successState, type ActionState } from '@/lib/action-state'
import {
  jobModerationSchema,
  orgVerificationSchema,
  parseFormData,
  userStatusSchema,
} from '@/lib/validation'
import { moderateJob } from '@/server/admin'
import { setOrganizationVerification, setUserStatus } from '@/server/accounts'

/**
 * Server actions for the administrator portal.
 *
 * Each one resolves the principal from the database, lets the existing service
 * assert the permission and write the audit entry, then revalidates the affected
 * routes. Service errors (including `AccessDeniedError`) are surfaced verbatim —
 * a rejected mutation is never reported as a success.
 *
 * Ids arrive through `.bind`, so they are never trusted from a hidden field.
 */

function describeError(error: unknown, fallback: string) {
  if (error instanceof AccessDeniedError) return error.message
  if (error instanceof Error && error.message) return error.message
  return fallback
}

export async function changeUserStatusAction(
  userId: string,
  prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const principal = await getPrincipal()
  if (!principal) return errorState('Your session has ended. Sign in again.')

  formData.set('userId', userId)
  const parsed = parseFormData(formData, userStatusSchema)
  if (!parsed.ok) return errorState(parsed.error, parsed.fieldErrors, parsed.values)

  try {
    const updated = await setUserStatus(principal, parsed.data)
    revalidatePath('/admin/users')
    revalidatePath('/admin')
    return successState(`${updated.name} is now “${enumLabel(updated.status)}”. The account was notified.`)
  } catch (error) {
    return errorState(describeError(error, 'Could not change that account status.'))
  }
}

export async function setOrganizationVerificationAction(
  organizationId: string,
  prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const principal = await getPrincipal()
  if (!principal) return errorState('Your session has ended. Sign in again.')

  formData.set('organizationId', organizationId)
  const parsed = parseFormData(formData, orgVerificationSchema)
  if (!parsed.ok) return errorState(parsed.error, parsed.fieldErrors, parsed.values)

  try {
    await setOrganizationVerification(principal, parsed.data)
    revalidatePath('/admin/organisations')
    revalidatePath('/admin/moderation')
    revalidatePath('/admin')
    return successState(
      parsed.data.decision === 'VERIFIED'
        ? 'Organisation verified. Its roles can now be published from the moderation queue.'
        : 'Decision recorded. Any published roles for this organisation were paused.',
    )
  } catch (error) {
    return errorState(describeError(error, 'Could not record that verification decision.'))
  }
}

export async function moderateJobAction(
  jobId: string,
  prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const principal = await getPrincipal()
  if (!principal) return errorState('Your session has ended. Sign in again.')

  formData.set('jobId', jobId)
  const parsed = parseFormData(formData, jobModerationSchema)
  if (!parsed.ok) return errorState(parsed.error, parsed.fieldErrors, parsed.values)

  try {
    const outcome = await moderateJob(principal, parsed.data)
    revalidatePath('/admin/moderation')
    revalidatePath('/admin')
    revalidatePath('/admin/reporting')

    if (outcome.status === 'PUBLISHED') {
      return successState(
        `Published. The matching agent recomputed scores for ${outcome.profilesMatched} candidate profile${
          outcome.profilesMatched === 1 ? '' : 's'
        }.`,
      )
    }
    return successState(`Role ${enumLabel(outcome.status).toLowerCase()}. The organisation was notified.`)
  } catch (error) {
    return errorState(describeError(error, 'Could not record that moderation decision.'))
  }
}
