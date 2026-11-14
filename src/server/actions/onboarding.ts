'use server'

import { revalidatePath } from 'next/cache'
import { AccessDeniedError, getPrincipal } from '@/lib/authz'
import { onboardingAnswerSchema, parseJsonField } from '@/lib/validation'
import { errorState, successState, type ActionState } from '@/lib/action-state'
import { answerStep, type AnswerMap } from '@/server/onboarding'

/** The JSON blob posted by the onboarding chat: `{ stepKey, answers }`. */
const onboardingAnswerPayload = onboardingAnswerSchema

export async function answerOnboardingStepAction(
  prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const principal = await getPrincipal()
  if (!principal) return errorState('Your session has ended. Sign in again.')

  const parsed = parseJsonField(formData, 'answers', onboardingAnswerPayload)
  if (!parsed.ok) return errorState(parsed.error, parsed.fieldErrors, parsed.values)

  try {
    const result = await answerStep(principal, parsed.data.stepKey, parsed.data.answers as AnswerMap)

    revalidatePath('/candidate/onboarding')
    revalidatePath('/candidate')
    revalidatePath('/candidate/experiences')
    revalidatePath('/candidate/skills')
    revalidatePath('/candidate/graph')
    revalidatePath('/candidate/profile')
    revalidatePath('/candidate/jobs')

    if (result.completed) {
      return successState(
        [...result.effects, 'Onboarding finished. Matches computed against published roles.'].join('\n'),
      )
    }

    return {
      status: 'success',
      message: result.effects.join('\n') || 'Answer recorded — next question below.',
      values: { stepKey: result.step?.key ?? '' },
    }
  } catch (error) {
    return errorState(
      error instanceof AccessDeniedError ? error.message : 'Could not record that answer. Try again.',
    )
  }
}
