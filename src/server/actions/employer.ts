'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { AccessDeniedError, assertPermission, getPrincipal, type Principal } from '@/lib/authz'
import { errorState, successState, type ActionState } from '@/lib/action-state'
import { label as enumLabel } from '@/lib/options'
import { restorableValues, applicationStatusSchema, jobSchema, organizationSchema, parseFormData, shortlistSchema } from '@/lib/validation'
import { createJob, setJobLifecycle, updateJob, type JobLifecycleAction } from '@/server/jobs'
import {
  removeShortlistEntry,
  shortlistCandidate,
  updateApplicationStatus,
} from '@/server/applications'
import { updateOrganization } from '@/server/accounts'

/**
 * Thin server-action layer for the employer portal. Every function does three
 * things and nothing else: resolve the DB-backed principal, validate the payload
 * with the foundation schemas, then call the existing service. Tenancy, the job
 * state machine, the verification gate, the pipeline transition table, the
 * anonymisation filter and the audit trail all stay in `src/server/*`.
 */

export type EmployerMutationResult = {
  ok: boolean
  message: string
  /** Set when the caller should navigate, e.g. after a draft is deleted. */
  navigateTo?: string
}

const LIFECYCLE_ACTIONS: JobLifecycleAction[] = ['SUBMIT', 'PAUSE', 'RESUME', 'CLOSE', 'DELETE']

const LIFECYCLE_SUCCESS: Record<JobLifecycleAction, string> = {
  SUBMIT: 'Submitted for moderation. An administrator reviews the role before candidates can see it.',
  PAUSE: 'Role paused. It is hidden from candidates and stops collecting applications.',
  RESUME: 'Role is live again.',
  CLOSE: 'Role closed. Candidates still in the pipeline were notified.',
  DELETE: 'Draft role deleted.',
}

/** Only our own guard messages are surfaced verbatim; anything else is generic. */
function friendly(error: unknown, fallback: string) {
  if (error instanceof AccessDeniedError) return error.message
  console.error('[employer-action]', error)
  return fallback
}

const noSession = 'Your session has ended. Sign in again to continue.'

async function employerSession(): Promise<Principal | null> {
  return getPrincipal()
}

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

export async function createJobAction(prevState: ActionState, formData: FormData): Promise<ActionState> {
  const principal = await employerSession()
  if (!principal) return errorState(noSession)

  // `jobSchema` accepts the `skills` field as a JSON string, so the whole
  // payload — including the repeating skill rows — is validated here server-side.
  const parsed = parseFormData(formData, jobSchema)
  if (!parsed.ok) return errorState(parsed.error, parsed.fieldErrors, parsed.values)

  let jobId: string
  try {
    const job = await createJob(principal, parsed.data)
    jobId = job.id
  } catch (error) {
    return errorState(friendly(error, 'Could not create the role.'), {}, restorableValues(formData))
  }

  revalidatePath('/employer/jobs')
  revalidatePath('/employer')
  // A new role is a draft, so land the reviewer on it with moderation offered next.
  redirect(`/employer/jobs/${jobId}?created=1`)
}

export async function updateJobAction(
  jobId: string,
  prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const principal = await employerSession()
  if (!principal) return errorState(noSession)

  const parsed = parseFormData(formData, jobSchema)
  if (!parsed.ok) return errorState(parsed.error, parsed.fieldErrors, parsed.values)

  try {
    const job = await updateJob(principal, jobId, parsed.data)
    revalidatePath('/employer/jobs')
    revalidatePath('/employer')
    revalidatePath(`/employer/jobs/${jobId}`)
    return successState(
      job.status === 'PENDING_MODERATION'
        ? 'Role saved. Because it was published, it has gone back into the moderation queue.'
        : 'Role saved.',
    )
  } catch (error) {
    return errorState(friendly(error, 'Could not save the role.'), {}, restorableValues(formData))
  }
}

export async function runJobLifecycleAction(
  jobId: string,
  action: string,
): Promise<EmployerMutationResult> {
  const principal = await employerSession()
  if (!principal) return { ok: false, message: noSession }
  if (!LIFECYCLE_ACTIONS.includes(action as JobLifecycleAction)) {
    return { ok: false, message: 'That lifecycle action is not recognised.' }
  }

  const lifecycle = action as JobLifecycleAction
  try {
    // Closing is its own authority in the permission catalogue.
    if (lifecycle === 'CLOSE') assertPermission(principal, 'employer.job.close')
    const result = await setJobLifecycle(principal, jobId, lifecycle)

    revalidatePath('/employer/jobs')
    revalidatePath('/employer')
    revalidatePath(`/employer/jobs/${jobId}`)
    revalidatePath('/employer/candidates')

    return {
      ok: true,
      message: LIFECYCLE_SUCCESS[lifecycle],
      navigateTo: result.deleted ? '/employer/jobs' : undefined,
    }
  } catch (error) {
    return { ok: false, message: friendly(error, 'That change could not be applied to the role.') }
  }
}

// ---------------------------------------------------------------------------
// Shortlist
// ---------------------------------------------------------------------------

/** Note-only validation; the role and profile references arrive bound, not from the form. */
const shortlistNoteSchema = shortlistSchema.omit({ jobId: true, candidateProfileId: true })

export async function shortlistCandidateAction(
  jobId: string,
  candidateProfileId: string,
  prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const principal = await employerSession()
  if (!principal) return errorState(noSession)

  const parsed = parseFormData(formData, shortlistNoteSchema)
  if (!parsed.ok) return errorState(parsed.error, parsed.fieldErrors, parsed.values)

  try {
    await shortlistCandidate(principal, { jobId, candidateProfileId, note: parsed.data.note })
    revalidatePath('/employer/shortlist')
    revalidatePath('/employer/jobs')
    revalidatePath(`/employer/jobs/${jobId}`)
    return successState('Saved to your shortlist for this role.')
  } catch (error) {
    return errorState(friendly(error, 'Could not shortlist that candidate.'))
  }
}

export async function removeShortlistEntryAction(entryId: string): Promise<EmployerMutationResult> {
  const principal = await employerSession()
  if (!principal) return { ok: false, message: noSession }

  try {
    await removeShortlistEntry(principal, entryId)
    revalidatePath('/employer/shortlist')
    return { ok: true, message: 'Removed from the shortlist.' }
  } catch (error) {
    return { ok: false, message: friendly(error, 'Could not remove that shortlist entry.') }
  }
}

// ---------------------------------------------------------------------------
// Applications
// ---------------------------------------------------------------------------

const statusFieldsSchema = applicationStatusSchema.omit({ applicationId: true })

export async function updateApplicationStatusAction(
  applicationId: string,
  prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const principal = await employerSession()
  if (!principal) return errorState(noSession)

  const parsed = parseFormData(formData, statusFieldsSchema)
  if (!parsed.ok) return errorState(parsed.error, parsed.fieldErrors, parsed.values)

  try {
    const updated = await updateApplicationStatus(principal, { applicationId, ...parsed.data })
    revalidatePath('/employer/applications')
    revalidatePath('/employer')
    revalidatePath('/employer/shortlist')
    revalidatePath(`/employer/jobs/${updated.jobId}`)
    return successState(
      updated.status === 'INTERVIEW_INVITED'
        ? 'Interview invitation sent to the candidate.'
        : `Application moved to ${enumLabel(updated.status)}.`,
    )
  } catch (error) {
    return errorState(friendly(error, 'Could not move that application forward.'))
  }
}

// ---------------------------------------------------------------------------
// Organisation
// ---------------------------------------------------------------------------

export async function updateOrganizationAction(
  prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const principal = await employerSession()
  if (!principal) return errorState(noSession)

  const parsed = parseFormData(formData, organizationSchema)
  if (!parsed.ok) return errorState(parsed.error, parsed.fieldErrors, parsed.values)

  try {
    await updateOrganization(principal, parsed.data)
    revalidatePath('/employer/profile')
    revalidatePath('/employer')
    revalidatePath('/employer/jobs')
    return successState('Organisation profile saved.')
  } catch (error) {
    return errorState(friendly(error, 'Could not save the organisation profile.'), {}, restorableValues(formData))
  }
}
