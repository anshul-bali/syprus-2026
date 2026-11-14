import Link from 'next/link'
import { BellOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState, InfoNote, PageHeader, StatusBadge } from '@/components/common'
import { requirePermission } from '@/lib/authz'
import { listNotifications, unreadNotificationCount } from '@/server/notifications'
import { markAllNotificationsReadAction } from '@/server/actions/notifications'
import { formatDateTime, relativeTime } from '@/lib/utils'
import { label as enumLabel } from '@/lib/options'
import { AdminNotificationForm } from '@/components/admin/notification-form'

export const metadata = { title: 'Notifications' }

export default async function AdminNotificationsPage() {
  const principal = await requirePermission('admin.dashboard.read')

  const [rows, unread] = await Promise.all([listNotifications(principal.userId, { take: 60 }), unreadNotificationCount(principal.userId)])

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Administrator"
        title="Notifications"
        description="Messages the platform sent to this account: moderation outcomes, verification changes and status notices."
        actions={
          unread > 0 ? (
            <form action={markAllNotificationsReadAction}>
              <Button type="submit" variant="outline" size="sm">
                Mark all {unread} read
              </Button>
            </form>
          ) : null
        }
      />

      <InfoNote tone="info" title="Why an administrator sees these">
        <p>
          Status changes and verification decisions are also written to the audit history. This list is the copy the
          account received, so a dispute about what was communicated can be settled from one place.
        </p>
      </InfoNote>

      {rows.length === 0 ? (
        <EmptyState
          title="No notifications yet"
          description="Nothing has been sent to this account. Administrator actions appear here as they happen."
          icon={BellOff}
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{rows.length} message{rows.length === 1 ? '' : 's'}</CardTitle>
            <CardDescription>Newest first, up to 60.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border/70">
              {rows.map((notification) => (
                <li key={notification.id} className="flex flex-col gap-2 py-3.5 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className={notification.readAt ? 'text-sm text-muted-foreground' : 'text-sm font-medium'}>
                      {notification.title}
                    </p>
                    <StatusBadge value={notification.type} label={enumLabel(notification.type)} />
                  </div>
                  <p className="text-sm leading-relaxed text-muted-foreground">{notification.body}</p>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">
                      {formatDateTime(notification.createdAt)} · {relativeTime(notification.createdAt)}
                      {notification.readAt ? ' · read' : ' · unread'}
                    </span>
                    <span className="flex items-center gap-1.5">
                      {!notification.readAt ? (
                        <AdminNotificationForm notificationId={notification.id} />
                      ) : null}
                      {notification.link ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          nativeButton={false}
                          render={<Link href={notification.link} />}
                        >
                          Open
                        </Button>
                      ) : null}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
