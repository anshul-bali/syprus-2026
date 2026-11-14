import type { JobStatus } from '@prisma/client'
import { prisma } from '@/lib/db'
import { JOB_STATUSES } from '@/lib/options'
import { assertPermission, type Principal } from '@/lib/authz'

/**
 * Read-only helpers for the administrator screens.
 *
 * `src/server/admin.ts` is owned by the foundation, so the extra listings the
 * moderation and engine-health screens need live here. Every function asserts a
 * real permission key from `src/lib/permissions.ts` before touching the database.
 */

export async function jobStatusBreakdown(principal: Principal) {
  assertPermission(principal, 'admin.job.read')

  const rows = await prisma.job.groupBy({ by: ['status'], _count: { _all: true } })
  const counts = new Map<string, number>(rows.map((row) => [row.status as string, row._count._all]))

  return JOB_STATUSES.map((status) => ({
    status,
    count: counts.get(status) ?? 0,
  }))
}

export async function listJobsByStatus(
  principal: Principal,
  filter: { status?: JobStatus; take?: number } = {},
) {
  assertPermission(principal, 'admin.job.read')

  return prisma.job.findMany({
    where: filter.status ? { status: filter.status } : {},
    orderBy: { updatedAt: 'desc' },
    take: filter.take ?? 60,
    include: {
      organization: { select: { id: true, name: true, verificationStatus: true, industry: true } },
      _count: { select: { skills: true, applications: true, matches: true } },
    },
  })
}

export async function auditEntityTypeBreakdown(principal: Principal) {
  assertPermission(principal, 'admin.audit.read')

  const rows = await prisma.auditEvent.groupBy({
    by: ['entityType'],
    _count: { _all: true },
    orderBy: { entityType: 'asc' },
  })

  return rows.map((row) => ({ entityType: row.entityType, count: row._count._all }))
}

/**
 * Real activity of the anonymisation filter, read from `profile_views`. The
 * filter itself is a deterministic field projection, so this is the only honest
 * way to show that it ran.
 */
export async function anonymizationActivity(principal: Principal, windowHours = 168) {
  assertPermission(principal, 'admin.engine.read')

  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000)

  const [total, inWindow, revealedTotal, revealedInWindow, profiles, organizations, lastView] =
    await Promise.all([
      prisma.profileView.count(),
      prisma.profileView.count({ where: { createdAt: { gte: since } } }),
      prisma.profileView.count({ where: { revealedIdentity: true } }),
      prisma.profileView.count({ where: { revealedIdentity: true, createdAt: { gte: since } } }),
      prisma.profileView.findMany({
        where: { createdAt: { gte: since } },
        select: { candidateProfileId: true },
        distinct: ['candidateProfileId'],
      }),
      prisma.profileView.findMany({
        where: { createdAt: { gte: since } },
        select: { organizationId: true },
        distinct: ['organizationId'],
      }),
      prisma.profileView.findFirst({ orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
    ])

  return {
    windowHours,
    totalViews: total,
    viewsInWindow: inWindow,
    identityRevealedTotal: revealedTotal,
    identityRevealedInWindow: revealedInWindow,
    profilesViewedInWindow: profiles.length,
    organizationsViewingInWindow: organizations.length,
    lastViewAt: lastView?.createdAt ?? null,
  }
}

