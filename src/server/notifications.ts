import type { NotificationType } from '@prisma/client'
import { prisma } from '@/lib/db'

type NotifyInput = {
  type: NotificationType
  title: string
  body: string
  link?: string | null
}

export async function notifyUser(userId: string, input: NotifyInput) {
  return prisma.notification.create({
    data: {
      userId,
      type: input.type,
      title: input.title,
      body: input.body,
      link: input.link ?? null,
    },
  })
}

/** Notifies every active account attached to an organisation (owner plus members). */
export async function notifyOrganization(organizationId: string, input: NotifyInput) {
  const recipients = await prisma.user.findMany({
    where: {
      role: 'EMPLOYER',
      status: 'ACTIVE',
      OR: [{ ownedOrganization: { id: organizationId } }, { memberships: { some: { id: organizationId } } }],
    },
    select: { id: true },
  })

  if (recipients.length === 0) return 0

  await prisma.notification.createMany({
    data: recipients.map((recipient) => ({
      userId: recipient.id,
      type: input.type,
      title: input.title,
      body: input.body,
      link: input.link ?? null,
    })),
  })
  return recipients.length
}

export async function listNotifications(userId: string, options: { take?: number; unreadOnly?: boolean } = {}) {
  return prisma.notification.findMany({
    where: { userId, ...(options.unreadOnly ? { readAt: null } : {}) },
    orderBy: { createdAt: 'desc' },
    take: options.take ?? 40,
  })
}

export async function unreadNotificationCount(userId: string) {
  return prisma.notification.count({ where: { userId, readAt: null } })
}

/** Ownership is enforced by filtering on `userId` inside the update itself. */
export async function markNotificationRead(userId: string, notificationId: string) {
  const result = await prisma.notification.updateMany({
    where: { id: notificationId, userId, readAt: null },
    data: { readAt: new Date() },
  })
  return result.count > 0
}

export async function markAllNotificationsRead(userId: string) {
  const result = await prisma.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  })
  return result.count
}
