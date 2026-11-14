'use server'

/**
 * Capability graph mutations.
 *
 * Each one re-resolves the principal and writes through `src/server/graph.ts`,
 * which refuses node keys that are not on the caller's own graph. Nothing here
 * edits skills or evidence directly — those keep their own audited actions.
 */

import { revalidatePath } from 'next/cache'
import { getPrincipal } from '@/lib/authz'
import { errorState, successState, type ActionState } from '@/lib/action-state'
import { AccessDeniedError } from '@/lib/authz'
import { resetGraphLayout, resetGraphNode, saveGraphNodeEdit } from '@/server/graph'

function message(error: unknown, fallback: string) {
  return error instanceof AccessDeniedError ? error.message : fallback
}

export type GraphMoveResult = { ok: boolean; error?: string }

/** Called on drag end. Position only — it must not clear a stored note. */
export async function moveGraphNodeAction(
  nodeKey: string,
  position: { x: number; y: number },
): Promise<GraphMoveResult> {
  const principal = await getPrincipal()
  if (!principal) return { ok: false, error: 'Your session has ended. Sign in again.' }
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) {
    return { ok: false, error: 'That position is not usable.' }
  }
  if (Math.abs(position.x) > 6000 || Math.abs(position.y) > 6000) {
    return { ok: false, error: 'That position is outside the graph.' }
  }

  try {
    await saveGraphNodeEdit(principal, { nodeKey, position })
    return { ok: true }
  } catch (error) {
    return { ok: false, error: message(error, 'Could not save that position.') }
  }
}

export async function editGraphNodeAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const principal = await getPrincipal()
  if (!principal) return errorState('Your session has ended. Sign in again.')

  const nodeKey = String(formData.get('nodeKey') ?? '')
  const label = String(formData.get('labelOverride') ?? '').trim()
  const note = String(formData.get('note') ?? '').trim()

  if (!nodeKey) return errorState('That node could not be identified.')
  if (label.length > 60) return errorState('A graph label has to stay under 60 characters.', { labelOverride: 'Too long.' })
  if (note.length > 400) return errorState('A graph note has to stay under 400 characters.', { note: 'Too long.' })

  try {
    await saveGraphNodeEdit(principal, { nodeKey, labelOverride: label, note })
    revalidatePath('/candidate/graph')
    return successState('Saved on the graph. The underlying skill record is unchanged.')
  } catch (error) {
    return errorState(message(error, 'Could not save that node.'))
  }
}

export async function hideGraphNodeAction(nodeKey: string): Promise<GraphMoveResult> {
  const principal = await getPrincipal()
  if (!principal) return { ok: false, error: 'Your session has ended. Sign in again.' }
  try {
    await saveGraphNodeEdit(principal, { nodeKey, hidden: true })
    revalidatePath('/candidate/graph')
    return { ok: true }
  } catch (error) {
    return { ok: false, error: message(error, 'Could not hide that node.') }
  }
}

export async function resetGraphNodeAction(prevState: ActionState, formData: FormData): Promise<ActionState> {
  const principal = await getPrincipal()
  if (!principal) return errorState('Your session has ended. Sign in again.')
  const nodeKey = String(formData.get('nodeKey') ?? '')
  if (!nodeKey) return errorState('That node could not be identified.')

  try {
    await resetGraphNode(principal, nodeKey)
    revalidatePath('/candidate/graph')
    return successState('Node back where the generator put it.')
  } catch (error) {
    return errorState(message(error, 'Could not reset that node.'))
  }
}

export async function resetGraphLayoutAction(
  _prevState: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  const principal = await getPrincipal()
  if (!principal) return errorState('Your session has ended. Sign in again.')

  try {
    const removed = await resetGraphLayout(principal)
    revalidatePath('/candidate/graph')
    return successState(
      removed > 0
        ? `Cleared ${removed} saved edit${removed === 1 ? '' : 's'}; the generated layout is back.`
        : 'There were no saved edits to clear.',
    )
  } catch (error) {
    return errorState(message(error, 'Could not reset the layout.'))
  }
}
