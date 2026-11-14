import Link from 'next/link'
import { requirePermission } from '@/lib/authz'
import { listNotifications, unreadNotificationCount } from '@/server/notifications'
import { EmptyState, InfoNote, PageHeader, StatusBadge } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { label as enumLabel } from '@/lib/options'
import { relativeTime } from '@/lib/utils'
import { markAllNotificationsReadAction, markNotificationReadAction } from '@/server/actions/notifications'

export const metadata = { title: 'Notifications' }

export default async function CandidateNotificationsPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const principal = await requirePermission('candidate.notification.read')
  const searchParams = await props.searchParams
  const filter = typeof searchParams.filter === 'string' ? searchParams.filter : undefined
  const unreadOnly = filter === 'unread'

  const [rows, unread] = await Promise.all([
    listNotifications(principal.userId, { take: 50, unreadOnly }),
    unreadNotificationCount(principal.userId),
  ])

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="You"
        title="Notifications"
        description="Match news, application updates, skill suggestions waiting on you, disclosure requests and assessment results addressed to your account."
        actions={
          unread > 0 ? (
            <form action={markAllNotificationsReadAction}>
              <Button type="submit" size="sm" className="bg-brand-600 hover:bg-brand-700">
                Mark all as read
              </Button>
            </form>
          ) : null
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button variant={unreadOnly ? 'outline' : 'default'} size="sm" nativeButton={false} render={<Link href="/candidate/notifications" />}>
          All
        </Button>
        <Button
          variant={unreadOnly ? 'default' : 'outline'}
          size="sm"
          nativeButton={false}
          render={<Link href="/candidate/notifications?filter=unread" />}
        >
          Unread ({unread})
        </Button>
        <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/candidate/suggestions" />}>
          Skill suggestions
        </Button>
        <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/candidate/disclosures" />}>
          Disclosure requests
        </Button>
      </div>

      <InfoNote tone="info" title="A notification is a pointer, not an outcome">
        Marking one read changes nothing about the role, suggestion or request it describes. Nothing here means an
        employer has responded, and no notification claims a verified outcome.
      </InfoNote>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {rows.length} notification{rows.length === 1 ? '' : 's'}
            {unreadOnly ? ' unread' : ''}
          </CardTitle>
          <CardDescription>Most recent first, capped at the latest 50.</CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <EmptyState
              title={unreadOnly ? 'Nothing unread' : 'No notifications yet'}
              description={
                unreadOnly
                  ? 'Every notification addressed to you has been read.'
                  : 'Onboarding suggestions, match news, moderation decisions and employer actions are written here as they happen.'
              }
              action={
                unreadOnly ? (
                  <Button variant="outline" nativeButton={false} render={<Link href="/candidate/notifications" />}>
                    Show all
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <ul className="divide-y divide-border/60">
              {rows.map((notification) => (
                <li key={notification.id} className="py-3">
                  <form
                    action={markNotificationReadAction.bind(null, notification.id)}
                    className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
                  >
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2">
                        <span className={notification.readAt ? 'text-sm text-muted-foreground' : 'text-sm font-medium'}>
                          {notification.title}
                        </span>
                        <StatusBadge value={notification.type} label={enumLabel(notification.type)} />
                      </p>
                      <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{notification.body}</p>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {relativeTime(notification.createdAt)}
                        {notification.readAt ? ' · read ' + relativeTime(notification.readAt) : ' · unread'}
                      </p>
                    </div>
                    <span className="flex shrink-0 items-center gap-1.5">
                      {!notification.readAt ? (
                        <Button type="submit" variant="outline" size="xs">
                          Mark read
                        </Button>
                      ) : null}
                      {notification.link ? (
                        <Button variant="ghost" size="xs" nativeButton={false} render={<Link href={notification.link} />}>
                          Open
                        </Button>
                      ) : null}
                    </span>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
