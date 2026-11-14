'use server'

/**
 * Actions for the four agents' screens: the suggestion inbox, assessments,
 * evidence uploads, orchestration, the review queue, the bias audit and the
 * weight editor. Each one re-resolves the principal and hands the work to the
 * service that owns the rule; none of them repeats a business check.
 */

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { AccessDeniedError, getPrincipal, type Principal } from '@/lib/authz'
import { errorState, successState, type ActionState } from '@/lib/action-state'
import { decideProposal, addOwnSkill } from '@/server/ai/proposals'
import { startAttempt, submitAttempt } from '@/server/ai/assessments'
import { saveEvidenceUpload, removeUpload, decideUpload } from '@/server/ai/uploads'
import { runOrchestration } from '@/server/ai/orchestration'
import { runBiasAudit, runLearningPathways, compareStoredPostings, runSkillsDiscovery } from '@/server/ai/agents'
import { decideReviewTask } from '@/server/review'
import { reapplyWeights, saveWeightProfile } from '@/server/weights'

function reason(error: unknown, fallback: string) {
  return error instanceof AccessDeniedError ? error.message : fallback
}

async function session(): Promise<Principal | { state: ActionState }> {
  const principal = await getPrincipal()
  if (!principal) return { state: errorState('Your session has ended. Sign in again.') }
  return principal
}

function failed(value: Principal | { state: ActionState }): value is { state: ActionState } {
  return 'state' in value
}

// ---------------------------------------------------------------------------
// Agent 1 — Skills Discovery
// ---------------------------------------------------------------------------

export async function runDiscoveryAction(
  _prevState: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  const principal = await session()
  if (failed(principal)) return principal.state

  try {
    const result = await runSkillsDiscovery(principal)
    for (const path of ['/candidate/suggestions', '/candidate/onboarding', '/candidate']) {
      revalidatePath(path)
    }
    return successState(
      result.created > 0
        ? `${result.created} suggestion(s) waiting for your decision${
            result.skipped ? `, ${result.skipped} already on your inventory were left alone` : ''
          } (${result.mode === 'AI' ? 'from the model reading your own wording' : 'from the keyword rule engine'}).`
        : `Nothing new came from your wording (${
            result.mode === 'AI' ? 'model pass' : 'rule engine pass'
          }).${result.fallbackReason ? ` ${result.fallbackNote}` : ''}`,
    )
  } catch (error) {
    return errorState(reason(error, 'Skill suggestions could not be produced.'))
  }
}

export async function decideProposalAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const principal = await session()
  if (failed(principal)) return principal.state

  const proposalId = String(formData.get('proposalId') ?? '')
  const decision = String(formData.get('decision') ?? '')
  const level = String(formData.get('level') ?? '')
  const note = String(formData.get('note') ?? '')

  if (!proposalId) return errorState('That suggestion could not be identified.')
  if (!['CONFIRMED', 'EDITED', 'REJECTED'].includes(decision)) {
    return errorState('Confirm it, edit the level, or reject it — nothing else was recorded.')
  }

  try {
    const result = await decideProposal(principal, {
      proposalId,
      decision: decision as 'CONFIRMED' | 'EDITED' | 'REJECTED',
      level: level || undefined,
      note: note || null,
    })
    for (const path of ['/candidate/suggestions', '/candidate/skills', '/candidate/graph', '/candidate']) {
      revalidatePath(path)
    }
    return successState(
      result.status === 'REJECTED'
        ? `Rejected “${result.skillName}”. It stays off your inventory, and the suggestion keeps its record as rejected.`
        : result.status === 'EDITED'
          ? `“${result.skillName}” added at the level you set, marked as confirmed by you.`
          : `“${result.skillName}” added to your inventory as confirmed by you — not as verified.`,
    )
  } catch (error) {
    return errorState(reason(error, 'Could not record that decision.'))
  }
}

export async function addOwnSkillAction(prevState: ActionState, formData: FormData): Promise<ActionState> {
  const principal = await session()
  if (failed(principal)) return principal.state

  const skillSlug = String(formData.get('skillSlug') ?? '')
  const level = String(formData.get('level') ?? 'FUNCTIONAL')
  const note = String(formData.get('note') ?? '')
  if (!skillSlug) return errorState('Choose a skill from the catalogue first.', { skillSlug: 'Required.' })

  try {
    await addOwnSkill(principal, { skillSlug, level, note: note || null })
    revalidatePath('/candidate/suggestions')
    revalidatePath('/candidate/skills')
    revalidatePath('/candidate/graph')
    return successState('Skill added to your inventory as self-reported, with the note you gave attached as evidence.')
  } catch (error) {
    return errorState(reason(error, 'Could not add that skill.'))
  }
}

// ---------------------------------------------------------------------------
// Agent 1 — assessments
// ---------------------------------------------------------------------------

export async function startAssessmentAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const principal = await session()
  if (failed(principal)) return principal.state

  const assessmentId = String(formData.get('assessmentId') ?? '')
  if (!assessmentId) return errorState('No assessment was selected.')

  let attemptId: string
  try {
    const attempt = await startAttempt(principal, assessmentId)
    attemptId = attempt.attemptId
    revalidatePath('/candidate/assessments')
  } catch (error) {
    return errorState(reason(error, 'Could not open that assessment.'))
  }
  redirect(`/candidate/assessments/${attemptId}`)
}

export async function submitAssessmentAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const principal = await session()
  if (failed(principal)) return principal.state

  const attemptId = String(formData.get('attemptId') ?? '')
  if (!attemptId) return errorState('That attempt could not be identified.')

  const responses: { questionId: string; selectedIndex: number }[] = []
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith('answer:')) continue
    const index = Number(value)
    if (!Number.isInteger(index)) continue
    responses.push({ questionId: key.slice('answer:'.length), selectedIndex: index })
  }
  if (responses.length === 0) return errorState('Nothing was answered.')

  try {
    const result = await submitAttempt(principal, { attemptId, responses })
    for (const path of ['/candidate/assessments', '/candidate/skills', '/candidate/graph', '/candidate']) {
      revalidatePath(path)
    }
    return {
      status: 'success',
      message: result.passed
        ? `Passed with ${result.correct}/${result.total}. That skill is now marked assessment-verified on your inventory.`
        : `${result.correct}/${result.total} — below the ${Math.round(result.passMark * 100)}% pass mark, so nothing on your inventory changed.`,
      values: { score: result.score, passed: result.passed },
    }
  } catch (error) {
    return errorState(reason(error, 'Could not score that attempt.'))
  }
}

// ---------------------------------------------------------------------------
// Agent 1 — evidence uploads
// ---------------------------------------------------------------------------

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024

export async function uploadEvidenceAction(prevState: ActionState, formData: FormData): Promise<ActionState> {
  const principal = await session()
  if (failed(principal)) return principal.state

  const candidateSkillId = String(formData.get('candidateSkillId') ?? '')
  const file = formData.get('file')

  if (!(file instanceof File)) return errorState('Choose a PDF, image or WebP file to attach.')
  if (file.size === 0) return errorState('That file is empty.')
  if (file.size > MAX_UPLOAD_BYTES) {
    return errorState(`That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 5 MB.`)
  }

  try {
    const bytes = new Uint8Array(await file.arrayBuffer())
    const receipt = await saveEvidenceUpload(principal, {
      candidateSkillId: candidateSkillId || null,
      filename: file.name,
      mimeType: file.type,
      bytes,
    })
    revalidatePath('/candidate/evidence')
    revalidatePath('/candidate/skills')
    return successState(
      `Stored “${receipt.filename}” (${(receipt.sizeBytes / 1024).toFixed(0)} KB) as ${receipt.status.toLowerCase()}. It is queued for a reviewer; uploading it does not verify anything.`,
    )
  } catch (error) {
    return errorState(reason(error, 'Could not store that file.'))
  }
}

export async function removeUploadAction(prevState: ActionState, formData: FormData): Promise<ActionState> {
  const principal = await session()
  if (failed(principal)) return principal.state

  const uploadId = String(formData.get('uploadId') ?? '')
  if (!uploadId) return errorState('That document could not be identified.')

  try {
    await removeUpload(principal, uploadId)
    revalidatePath('/candidate/evidence')
    return successState('Document removed.')
  } catch (error) {
    return errorState(reason(error, 'Could not remove that document.'))
  }
}

// ---------------------------------------------------------------------------
// Orchestration + agents 2–4 triggers
// ---------------------------------------------------------------------------

export async function runOrchestrationAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const principal = await session()
  if (failed(principal)) return principal.state

  const targetJobId = String(formData.get('targetJobId') ?? '')
  const profileId = String(formData.get('profileId') ?? '')

  try {
    const result = await runOrchestration(principal, {
      targetJobId: targetJobId || null,
      profileId: profileId || undefined,
    })
    for (const path of ['/candidate', '/candidate/suggestions', '/candidate/pathways', '/candidate/jobs', '/admin/engines']) {
      revalidatePath(path)
    }
    const stopped = result.steps.find((step) => step.status === 'FAILED')
    if (stopped) {
      return errorState(
        `Workflow stopped at ${stopped.label.toLowerCase()}: ${
          stopped.fallbackReason ?? 'the step failed'
        }. Steps that already succeeded kept their results.`,
      )
    }
    return successState(
      result.message ??
        `${result.steps.length} step(s) ${result.status.toLowerCase()}: ${result.steps
          .map((step) => `${step.label} ${step.produced}`)
          .join(', ')} — ran in ${result.mode.toLowerCase()} mode.`,
    )
  } catch (error) {
    return errorState(reason(error, 'The workflow could not start.'))
  }
}

export async function runBiasAuditAction(prevState: ActionState, formData: FormData): Promise<ActionState> {
  const principal = await session()
  if (failed(principal)) return principal.state

  const jobId = String(formData.get('jobId') ?? '')
  if (!jobId) return errorState('No role was selected.')

  try {
    const result = await runBiasAudit(principal, jobId)
    revalidatePath(`/employer/jobs/${jobId}`)
    revalidatePath('/admin/review')
    return successState(
      `Language review stored (${result.outcome.mode === 'AI' ? 'model pass' : 'rule engine pass'}): ${
        result.output.findings.length
      } finding(s), risk ${result.output.overallRisk.toLowerCase()}. Nothing about the posting was changed.`,
    )
  } catch (error) {
    return errorState(reason(error, 'The language review could not run.'))
  }
}

export async function runMarketCheckAction(prevState: ActionState, formData: FormData): Promise<ActionState> {
  const principal = await session()
  if (failed(principal)) return principal.state

  const jobId = String(formData.get('jobId') ?? '')
  if (!jobId) return errorState('No role was selected.')

  try {
    const insight = await compareStoredPostings(principal, jobId)
    revalidatePath(`/employer/jobs/${jobId}`)
    return successState(`Stored-posting skill overlap: ${Math.round(insight.score * 100)}%. This compares role requirements in the database, not candidates or live market demand.`)
  } catch (error) {
    return errorState(reason(error, 'The comparison could not run.'))
  }
}

export async function runPathwayAgentAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const principal = await session()
  if (failed(principal)) return principal.state

  const targetJobId = String(formData.get('targetJobId') ?? '')

  try {
    const result = await runLearningPathways(principal, { targetJobId: targetJobId || null })
    revalidatePath('/candidate/pathways')
    revalidatePath('/candidate/notifications')
    return successState(
      result.message ??
        `${result.plan?.items.length ?? 0} step(s) written${
          result.gaps.length ? `, from ${result.gaps.length} gap(s) the analysis found` : ''
        } (${result.outcome?.mode === 'AI' ? 'model reasoning over catalogue items' : 'rule planner'}).`,
    )
  } catch (error) {
    return errorState(reason(error, 'The pathway agent could not run.'))
  }
}

// ---------------------------------------------------------------------------
// Admin — review queue and weights
// ---------------------------------------------------------------------------

export async function decideUploadAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const principal = await session()
  if (failed(principal)) return principal.state

  const uploadId = String(formData.get('uploadId') ?? '')
  const decision = String(formData.get('decision') ?? '')
  const note = String(formData.get('note') ?? '')

  if (!uploadId) return errorState('That document could not be identified.')
  if (decision !== 'ACCEPTED' && decision !== 'REJECTED') {
    return errorState('Choose accept or reject.')
  }

  try {
    const result = await decideUpload(principal, { uploadId, decision, note })
    revalidatePath('/admin/review')
    revalidatePath('/candidate/evidence')
    return successState(
      result.status === 'ACCEPTED'
        ? 'Document accepted. The skill it supports is marked human-reviewed — the strongest claim this platform can record.'
        : 'Document rejected and the skill marked disputed, with your note kept.',
    )
  } catch (error) {
    return errorState(reason(error, 'Could not record that decision.'))
  }
}

export async function decideReviewTaskAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const principal = await session()
  if (failed(principal)) return principal.state

  const taskId = String(formData.get('taskId') ?? '')
  const status = String(formData.get('status') ?? '')
  const note = String(formData.get('note') ?? '')

  if (!taskId) return errorState('That review task could not be identified.')
  if (!['APPROVED', 'REJECTED', 'DEFERRED'].includes(status)) {
    return errorState('Choose approve, reject or defer.')
  }
  if (note.trim().length < 10) {
    return errorState('Write at least 10 characters of justification — it becomes the record.', { note: 'Too short.' })
  }

  try {
    await decideReviewTask(principal, { taskId, status: status as 'APPROVED' | 'REJECTED' | 'DEFERRED', note })
    revalidatePath('/admin/review')
    revalidatePath('/admin/engines')
    return successState(`Task marked ${status.toLowerCase()}.`)
  } catch (error) {
    return errorState(reason(error, 'Could not record that decision.'))
  }
}

export async function saveWeightsAction(prevState: ActionState, formData: FormData): Promise<ActionState> {
  const principal = await session()
  if (failed(principal)) return principal.state

  const number = (key: string) => {
    const value = formData.get(key)
    return typeof value === 'string' && value.trim() ? Number(value) / 100 : NaN
  }
  const input = {
    version: String(formData.get('version') ?? '').trim(),
    label: String(formData.get('label') ?? '').trim(),
    required: number('required'),
    preferred: number('preferred'),
    evidence: number('evidence'),
    preferences: number('preferences'),
    activate: formData.get('activate') === 'on',
    note: String(formData.get('note') ?? '') || null,
  }

  if (!input.version || !input.label) {
    return errorState('A weight set needs both a version tag and a label.', {
      ...(input.version ? {} : { version: 'Required.' }),
      ...(input.label ? {} : { label: 'Required.' }),
    })
  }

  try {
    const saved = await saveWeightProfile(principal, input)
    revalidatePath('/admin/weights')
    return successState(
      `Stored ${saved.version}${saved.active ? ' and made it active' : ''}. Scores already written keep the version that produced them until you reapply.`,
    )
  } catch (error) {
    return errorState(reason(error, 'That weight set was rejected.'))
  }
}

export async function reapplyWeightsAction(_prevState: ActionState, _formData: FormData): Promise<ActionState> {
  const principal = await session()
  if (failed(principal)) return principal.state

  try {
    const result = await reapplyWeights(principal)
    for (const path of ['/candidate/jobs', '/employer/candidates', '/admin/fairness', '/admin/weights']) {
      revalidatePath(path)
    }
    return successState(
      `Recomputed every scored profile under the active weight set — ${result} profile(s) rewritten.`,
    )
  } catch (error) {
    return errorState(reason(error, 'Recomputation failed.'))
  }
}
