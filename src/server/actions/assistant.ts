'use server'

/**
 * Server actions behind the SYPRUS Sona panel. The principal is re-resolved on
 * every call and the work is handed to the assistant service, which owns the
 * scoping, the contract and the persistence.
 */

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { AccessDeniedError, getPrincipal, type Principal } from '@/lib/authz'
import { errorState, type ActionState } from '@/lib/action-state'
import { askSona, clearSonaTranscript, sonaStarters, type SonaReply, type SonaTurn } from '@/server/ai/assistant'

export type SonaState = ActionState & {
  reply?: SonaReply
  transcript?: SonaTurn[]
  starters?: string[]
  /** Which action wrote last, so the panel can show one transcript without an effect. */
  seq?: number
}

const questionSchema = z.object({
  question: z
    .string()
    .trim()
    .min(3, 'Ask Sona something in a few words.')
    .max(600, 'Sona answers best on questions under 600 characters. Try shortening it.'),
})

export async function askSonaAction(_prevState: SonaState, formData: FormData): Promise<SonaState> {
  const principal = await getPrincipal()
  if (!principal) return errorState('Your session has ended. Sign in again.')

  const parsed = questionSchema.safeParse({ question: formData.get('question') ?? '' })
  if (!parsed.success) {
    return errorState(
      parsed.error.issues[0]?.message ?? 'That question could not be read.',
      { question: parsed.error.issues[0]?.message ?? 'Check this field.' },
    )
  }

  try {
    const result = await askSona(principal, parsed.data.question)
    revalidatePath('/candidate')
    revalidatePath('/employer')
    revalidatePath('/admin')
    return {
      status: 'success',
      seq: Date.now(),
      message: result.usedModel
        ? `Answered by ${result.reply.provider} (${result.reply.model}).`
        : 'Answered directly from your stored records — the model path was unavailable.',
      reply: result.reply,
      transcript: result.transcript,
      starters: sonaStarters(principal.role),
    }
  } catch (error) {
    return errorState(
      error instanceof AccessDeniedError ? error.message : 'Sona could not answer this time. Your records are unchanged.',
    )
  }
}

export async function clearSonaAction(_prevState: SonaState, _formData: FormData): Promise<SonaState> {
  const principal: Principal | null = await getPrincipal()
  if (!principal) return errorState('Your session has ended. Sign in again.')
  const { cleared } = await clearSonaTranscript(principal)
  return {
    status: 'success',
    seq: Date.now(),
    message: cleared ? 'This conversation was deleted from your account.' : 'There was nothing to delete.',
    transcript: [],
    starters: sonaStarters(principal.role),
  }
}
