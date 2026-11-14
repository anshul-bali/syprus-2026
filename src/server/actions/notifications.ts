'use server'

import { revalidatePath } from 'next/cache'
import { getPrincipal } from '@/lib/authz'
import { markAllNotificationsRead, markNotificationRead } from '@/server/notifications'
import { errorState, successState, type ActionState } from '@/lib/action-state'

/**
 * Two shapes on purpose. A plain `<form action={…}>` in the notification bell
 * needs an action returning void, while a form wired to `useActionState` needs
 * one that returns the next state.
 */
export async function markNotificationReadAction(notificationId: string): Promise<void> {
  const principal = await getPrincipal()
  if (!principal) return

  await markNotificationRead(principal.userId, notificationId)
  revalidatePath('/candidate/notifications')
  revalidatePath('/employer/notifications')
  revalidatePath('/admin/notifications')
}

export async function markAllNotificationsReadAction(): Promise<void> {
  const principal = await getPrincipal()
  if (!principal) return

  await markAllNotificationsRead(principal.userId)
  revalidatePath('/candidate/notifications')
  revalidatePath('/employer/notifications')
  revalidatePath('/admin/notifications')
}

export async function markOneNotificationAction(prevState: ActionState, formData: FormData): Promise<ActionState> {
  const principal = await getPrincipal()
  if (!principal) return errorState('Your session has ended. Sign in again.')

  const notificationId = formData.get('notificationId')
  if (typeof notificationId !== 'string') return errorState('Missing notification reference.')

  const changed = await markNotificationRead(principal.userId, notificationId)
  revalidatePath('/candidate/notifications')
  revalidatePath('/employer/notifications')
  revalidatePath('/admin/notifications')

  return changed
    ? successState('Marked as read.')
    : errorState('That notification was already read.')
}
