/**
 * Shape shared by every server action and the client forms that call them.
 * Only serialisable fields, because it crosses the server-function boundary.
 */
export type ActionState = {
  status: 'idle' | 'error' | 'success'
  message?: string
  fieldErrors?: Record<string, string>
  /** Values to restore after a failed submit, minus secrets. */
  values?: Record<string, string | number | boolean | string[]>
}

export const IDLE_STATE: ActionState = { status: 'idle' }

export function errorState(
  message: string,
  fieldErrors: Record<string, string> = {},
  values?: Record<string, string>,
): ActionState {
  return { status: 'error', message, fieldErrors, values }
}

export function successState(message: string): ActionState {
  return { status: 'success', message }
}

/** Errors surfaced for a field by a server action, for use with useActionState. */
export function fieldError(state: ActionState | undefined, key: string) {
  return state?.status === 'error' ? state.fieldErrors?.[key] : undefined
}

export class ActionFailure extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ActionFailure'
  }
}
