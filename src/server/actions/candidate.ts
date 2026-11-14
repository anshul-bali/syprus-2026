'use server'

/**
 * Thin server-action layer over the candidate services.
 *
 * Nothing here re-implements business rules: the action re-resolves the
 * principal, validates the payload with the shared Zod schemas, calls the
 * service (which asserts the permission and the row ownership) and turns the
 * outcome into an `ActionState` the client form can render.
 */

import { revalidatePath } from 'next/cache'
import { AccessDeniedError, getPrincipal, type Principal } from '@/lib/authz'
import { policyVersion } from '@/lib/env'
import { errorState, successState, type ActionState } from '@/lib/action-state'
import { restorableValues, candidateProfileSchema, candidateSkillSchema, consentToggleSchema, experienceSchema, parseFormData, planItemStatusSchema, skillEvidenceSchema } from '@/lib/validation'
import {
  addEvidence,
  addExperience,
  addSkill,
  consentMap,
  refreshProfileCompletion,
  removeEvidence,
  removeExperience,
  removeSkill,
  setConsent,
  updateProfile,
} from '@/server/candidate'
import { generateGapReport } from '@/server/gap'
import { generateLearningPlan, setPlanItemStatus } from '@/server/pathway'
import { computeMatchesForProfile } from '@/server/matching'

type SessionResult = { ok: true; principal: Principal } | { ok: false; state: ActionState }

async function session(): Promise<SessionResult> {
  const principal = await getPrincipal()
  if (!principal) return { ok: false, state: errorState('Your session has ended. Sign in again.') }
  return { ok: true, principal }
}

/** AccessDeniedError carries the reason the service already wrote for the user. */
function failureMessage(error: unknown, fallback: string) {
  if (error instanceof AccessDeniedError) return error.message
  return fallback
}

function revalidateCandidate(screens: string[]) {
  for (const screen of new Set(['/candidate', ...screens])) revalidatePath(screen)
}

// ---------------------------------------------------------------------------
// Experience
// ---------------------------------------------------------------------------

export async function addExperienceAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const sessionResult = await session()
  if (!sessionResult.ok) return sessionResult.state

  const parsed = parseFormData(formData, experienceSchema)
  if (!parsed.ok) return errorState(parsed.error, parsed.fieldErrors, parsed.values)

  try {
    const result = await addExperience(sessionResult.principal, parsed.data)
    await refreshProfileCompletion(sessionResult.principal.candidateProfileId as string)

    const suggestions = result.inferred.length
    const message = result.inferenceSkipped
      ? `Experience saved. No skills were suggested — rule-based inference consent is off, so only skills you add yourself appear.`
      : suggestions > 0
        ? `Experience saved. ${suggestions} skill${suggestions === 1 ? '' : 's'} suggested from your wording — review them.`
        : 'Experience saved. No new skill suggestions came from that description.'

    revalidateCandidate(['/candidate/experiences', '/candidate/skills', '/candidate/graph'])
    return suggestions > 0 && !result.inferenceSkipped
      ? { status: 'success', message, values: { notice: 'inferred-skills' } }
      : successState(message)
  } catch (error) {
    return errorState(failureMessage(error, 'Could not save that experience.'), {}, restorableValues(formData))
  }
}

export async function removeExperienceAction(
  experienceId: string,
  _prevState: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  const sessionResult = await session()
  if (!sessionResult.ok) return sessionResult.state

  try {
    const result = await removeExperience(sessionResult.principal, experienceId)
    await refreshProfileCompletion(sessionResult.principal.candidateProfileId as string)
    revalidateCandidate(['/candidate/experiences', '/candidate/skills', '/candidate/graph'])
    return successState(
      result.pruned > 0
        ? `Experience removed, and ${result.pruned} skill suggestion${result.pruned === 1 ? '' : 's'} that only pointed at it removed too.`
        : 'Experience removed.',
    )
  } catch (error) {
    return errorState(failureMessage(error, 'Could not remove that experience.'))
  }
}

// ---------------------------------------------------------------------------
// Skills and evidence
// ---------------------------------------------------------------------------

export async function upsertSkillAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const sessionResult = await session()
  if (!sessionResult.ok) return sessionResult.state

  const parsed = parseFormData(formData, candidateSkillSchema)
  if (!parsed.ok) return errorState(parsed.error, parsed.fieldErrors, parsed.values)

  try {
    const record = await addSkill(sessionResult.principal, parsed.data)
    await refreshProfileCompletion(sessionResult.principal.candidateProfileId as string)
    revalidateCandidate(['/candidate/skills', '/candidate/graph', '/candidate/jobs'])
    return successState(
      `Skill saved${record.note ? ` — ${record.note}` : ''}. Self-declared skills start at 0.6 confidence; evidence raises it.`,
    )
  } catch (error) {
    return errorState(failureMessage(error, 'Could not save that skill.'))
  }
}

export async function removeSkillAction(
  candidateSkillId: string,
  _prevState: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  const sessionResult = await session()
  if (!sessionResult.ok) return sessionResult.state

  try {
    await removeSkill(sessionResult.principal, candidateSkillId)
    await refreshProfileCompletion(sessionResult.principal.candidateProfileId as string)
    revalidateCandidate(['/candidate/skills', '/candidate/graph', '/candidate/jobs'])
    return successState('Skill removed from your inventory.')
  } catch (error) {
    return errorState(failureMessage(error, 'Could not remove that skill.'))
  }
}

export async function addEvidenceAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const sessionResult = await session()
  if (!sessionResult.ok) return sessionResult.state

  const parsed = parseFormData(formData, skillEvidenceSchema)
  if (!parsed.ok) return errorState(parsed.error, parsed.fieldErrors, parsed.values)

  try {
    await addEvidence(sessionResult.principal, parsed.data)
    revalidateCandidate(['/candidate/skills', '/candidate/graph', '/candidate/gap-report'])
    return successState('Evidence attached. Documented proof raises confidence — it is not an outside verification.')
  } catch (error) {
    return errorState(failureMessage(error, 'Could not attach that evidence.'))
  }
}

export async function removeEvidenceAction(
  evidenceId: string,
  _prevState: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  const sessionResult = await session()
  if (!sessionResult.ok) return sessionResult.state

  try {
    await removeEvidence(sessionResult.principal, evidenceId)
    revalidateCandidate(['/candidate/skills', '/candidate/graph', '/candidate/gap-report'])
    return successState('Evidence removed.')
  } catch (error) {
    return errorState(failureMessage(error, 'Could not remove that evidence.'))
  }
}

// ---------------------------------------------------------------------------
// Profile and consent
// ---------------------------------------------------------------------------

export async function updateProfileAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const sessionResult = await session()
  if (!sessionResult.ok) return sessionResult.state

  const parsed = parseFormData(formData, candidateProfileSchema)
  if (!parsed.ok) return errorState(parsed.error, parsed.fieldErrors, parsed.values)

  try {
    await updateProfile(sessionResult.principal, parsed.data)
  } catch (error) {
    // Surfaced rather than swallowed: visibility needs the sharing consent.
    return errorState(failureMessage(error, 'Could not save your profile.'), {}, restorableValues(formData))
  }

  const checklist = await refreshProfileCompletion(sessionResult.principal.candidateProfileId as string)
  revalidateCandidate(['/candidate', '/candidate/profile', '/candidate/jobs'])
  return successState(`Profile saved. Completion is now ${checklist?.percent ?? 0}%.`)
}

export async function setConsentAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const sessionResult = await session()
  if (!sessionResult.ok) return sessionResult.state
  const principal = sessionResult.principal

  const parsed = parseFormData(formData, consentToggleSchema)
  if (!parsed.ok) return errorState(parsed.error, parsed.fieldErrors, parsed.values)

  const current = await consentMap(principal.userId)
  const existing = current.get(parsed.data.type)
  if (existing && existing.granted === parsed.data.granted) {
    return successState(`That decision is already recorded as ${parsed.data.granted ? 'granted' : 'withdrawn'}.`)
  }

  try {
    await setConsent(principal, parsed.data)
  } catch (error) {
    return errorState(failureMessage(error, 'Could not record that consent.'))
  }

  revalidateCandidate(['/candidate', '/candidate/profile', '/candidate/skills', '/candidate/graph'])
  return successState(
    parsed.data.granted
      ? `${parsed.data.type.replace(/_/g, ' ').toLowerCase()} recorded as granted at policy version ${policyVersion()}.`
      : `${parsed.data.type.replace(/_/g, ' ').toLowerCase()} withdrawn at policy version ${policyVersion()}.`,
  )
}

// ---------------------------------------------------------------------------
// Gap reports, pathways, matches
// ---------------------------------------------------------------------------

export async function generateGapReportAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const sessionResult = await session()
  if (!sessionResult.ok) return sessionResult.state

  const raw = formData.get('targetJobId')
  const targetJobId = typeof raw === 'string' && raw.trim() && raw !== 'AUTO' ? raw.trim() : null

  try {
    const report = await generateGapReport(sessionResult.principal, { targetJobId })
    revalidateCandidate(['/candidate/gap-report', '/candidate', '/candidate/pathways'])
    return {
      status: 'success',
      message: `Readiness ${report.readiness.toLowerCase().replace(/_/g, ' ')} (${Math.round(report.readinessScore * 100)}%) against ${
        report.targetJobTitle ?? report.analysis.contextLabel
      }. ${report.analysis.gaps.length} gap${report.analysis.gaps.length === 1 ? '' : 's'} found.`,
      values: { notice: 'gap-report-generated' },
    }
  } catch (error) {
    return errorState(failureMessage(error, 'Could not run the gap analysis. Add a few skills first.'))
  }
}

export async function generatePathwayAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const sessionResult = await session()
  if (!sessionResult.ok) return sessionResult.state

  const raw = formData.get('targetJobId')
  const targetJobId = typeof raw === 'string' && raw.trim() && raw !== 'AUTO' ? raw.trim() : null
  const force = formData.get('force') != null

  try {
    const result = await generateLearningPlan(sessionResult.principal, { targetJobId, force })
    revalidateCandidate(['/candidate/pathways', '/candidate', '/candidate/gap-report'])
    return successState(
      result.regenerated
        ? `Pathway built: ${result.plan.items.length} step${result.plan.items.length === 1 ? '' : 's'} from the catalogue.`
        : 'Your existing active pathway for this target is shown below — nothing had to be regenerated.',
    )
  } catch (error) {
    return errorState(failureMessage(error, 'Could not build a pathway. Run a gap report first.'))
  }
}

export async function setPlanItemStatusAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const sessionResult = await session()
  if (!sessionResult.ok) return sessionResult.state

  const parsed = parseFormData(formData, planItemStatusSchema)
  if (!parsed.ok) return errorState(parsed.error, parsed.fieldErrors, parsed.values)

  try {
    await setPlanItemStatus(sessionResult.principal, {
      itemId: parsed.data.itemId,
      status: parsed.data.status,
      note: parsed.data.note ?? null,
    })
    revalidateCandidate(['/candidate/pathways', '/candidate/skills'])
    return successState(
      parsed.data.status === 'COMPLETED'
        ? 'Step completed. Evidence was added to the skill it targeted.'
        : `Step marked ${parsed.data.status.replace(/_/g, ' ').toLowerCase()}.`,
    )
  } catch (error) {
    return errorState(failureMessage(error, 'Could not update that step.'))
  }
}

export async function refreshMatchesAction(
  _prevState: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  const sessionResult = await session()
  if (!sessionResult.ok) return sessionResult.state
  const profileId = sessionResult.principal.candidateProfileId
  if (!profileId) return errorState('No candidate profile is attached to this account.')

  try {
    const outcome = await computeMatchesForProfile(profileId)
    revalidateCandidate(['/candidate/jobs', '/candidate', '/candidate/gap-report'])
    return successState(
      outcome.written > 0
        ? `Re-scored your skills against ${outcome.processed} published roles; ${outcome.written} match rows written, ${outcome.cleared} stale cleared.`
        : 'No roles could be scored yet — the matching engine needs at least one skill on your profile.',
    )
  } catch (error) {
    return errorState(failureMessage(error, 'Could not re-run matching right now.'))
  }
}
