import { prisma } from '@/lib/db'
import type { Principal } from '@/lib/authz'
import { jsonOrNull } from '@/server/fields'

export type AuditInput = {
  actor: Principal | null
  action: string
  entityType: string
  entityId?: string | null
  targetUserId?: string | null
  organizationId?: string | null
  metadata?: Record<string, unknown> | null
  /** `ADMIN` keeps the entry in the audit log only; `USER` also surfaces it. */
  visibility?: 'ADMIN' | 'USER'
}

/**
 * Appends an immutable entry to `audit_events`. Called by every server function
 * that changes state, so the admin audit screen describes real activity rather
 * than a sample list.
 */
export async function recordAudit(input: AuditInput) {
  return prisma.auditEvent.create({
    data: {
      actorUserId: input.actor?.userId ?? null,
      actorRole: input.actor?.role ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      targetUserId: input.targetUserId ?? null,
      organizationId: input.organizationId ?? null,
      visibility: input.visibility ?? 'ADMIN',
      metadata: jsonOrNull(input.metadata),
    },
  })
}

export async function readAuditLog(options: {
  take?: number
  skip?: number
  entityType?: string
  action?: string
  from?: Date
  to?: Date
}) {
  const { take = 100, skip = 0, entityType, action, from, to } = options
  const where = {
    ...(entityType ? { entityType } : {}),
    ...(action ? { action: { contains: action } } : {}),
    ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
  }
  const [events, total] = await Promise.all([
    prisma.auditEvent.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take,
      skip,
      include: { actor: { select: { id: true, name: true, email: true, role: true } } },
    }),
    prisma.auditEvent.count({ where }),
  ])
  return { events, total, take, skip }
}
