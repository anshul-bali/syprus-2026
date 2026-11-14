'use client'

import { Button } from '@/components/ui/button'
import { markNotificationReadAction } from '@/server/actions/notifications'

/**
 * Per-message “mark read” control. It uses the void-returning action shape, which
 * is what a plain `<form action={…}>` requires, and the notification id is bound
 * into the action rather than posted as a field.
 */
export function AdminNotificationForm({ notificationId }: { notificationId: string }) {
  return (
    <form action={markNotificationReadAction.bind(null, notificationId)}>
      <Button type="submit" variant="ghost" size="sm" className="h-7 text-xs">
        Mark read
      </Button>
    </form>
  )
}
