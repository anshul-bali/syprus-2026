import { requirePrincipal } from '@/lib/authz'
import { PORTAL_NAV, ROLE_LABELS } from '@/lib/nav'
import { listNotifications, unreadNotificationCount } from '@/server/notifications'
import { sonaStarters, sonaTranscript } from '@/server/ai/assistant'
import { PortalShell, type NotificationItem } from '@/components/app-shell/portal-shell'
import { SonaPanel } from '@/components/assistant/sona-panel'

const NOTIFICATIONS_HREF = {
  CANDIDATE: '/candidate/notifications',
  EMPLOYER: '/employer/notifications',
  ADMIN: '/admin/notifications',
} as const

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const principal = await requirePrincipal()

  const [rows, unreadCount, transcript] = await Promise.all([
    listNotifications(principal.userId, { take: 8 }),
    unreadNotificationCount(principal.userId),
    sonaTranscript(principal),
  ])

  const notifications: NotificationItem[] = rows.map((row) => ({
    id: row.id,
    title: row.title,
    body: row.body,
    type: row.type,
    link: row.link,
    readAt: row.readAt ? row.readAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  }))

  return (
    <PortalShell
      roleLabel={ROLE_LABELS[principal.role].name}
      name={principal.name}
      email={principal.email}
      organizationName={principal.organizationName}
      organizationVerification={principal.organizationVerification}
      navItems={PORTAL_NAV[principal.role]}
      notifications={notifications}
      unreadCount={unreadCount}
      notificationsHref={NOTIFICATIONS_HREF[principal.role]}
      assistant={<SonaPanel initialState={{ status: 'idle', transcript, starters: sonaStarters(principal.role) }} />}
    >
      {children}
    </PortalShell>
  )
}
