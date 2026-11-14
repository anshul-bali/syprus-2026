import type { ReviewTaskStatus } from '@prisma/client'
import { AccessDeniedError, assertPermission, type Principal } from '@/lib/authz'
import { prisma } from '@/lib/db'
import { recordAudit } from '@/server/audit'

/**
 * The human review queue.
 *
 * Consequential or uncertain AI output is written here as an open task and stays
 * open until a person decides it. Nothing in this module lets a model clear its
 * own finding: the deciding actor is always the signed-in principal, and the
 * decision is audited with the note that justified it.
 */

export const REVIEW_TASK_KIND_LABELS: Record<string, string> = {
  BIAS_FINDING: 'Job wording finding',
  SHORTLIST_DECISION: 'Shortlist decision',
  INTERVIEW_INVITATION: 'Interview invitation',
  IDENTITY_DISCLOSURE: 'Identity disclosure',
  PROFILE_VISIBILITY: 'Profile visibility change',
  SKILL_VERIFICATION: 'Skill verification',
}

export async function openReviewTasks(
  principal: Principal,
  filter: { status?: ReviewTaskStatus; kind?: string; take?: number } = {},
) {
  assertPermission(principal, 'admin.job.moderate')

  const rows = await prisma.reviewTask.findMany({
    where: {
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.kind && Object.hasOwn(REVIEW_TASK_KIND_LABELS, filter.kind) ? { kind: filter.kind as never } : {}),
    },
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    take: filter.take ?? 60,
  })

  // `review_tasks` stores subject ids without relations on purpose, so an entry
  // outlives the row it described. Names are joined here, and absence is shown.
  const [organizations, jobs, profiles] = await Promise.all([
    (() => {
      const ids = [...new Set(rows.map((row) => row.organizationId).filter((id): id is string => Boolean(id)))]
      return ids.length
        ? prisma.organization.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
        : Promise.resolve([])
    })(),
    (() => {
      const ids = [...new Set(rows.map((row) => row.jobId).filter((id): id is string => Boolean(id)))]
      return ids.length ? prisma.job.findMany({ where: { id: { in: ids } }, select: { id: true, title: true } }) : Promise.resolve([])
    })(),
    (() => {
      const ids = [
        ...new Set(rows.map((row) => row.candidateProfileId).filter((id): id is string => Boolean(id))),
      ]
      return ids.length
        ? prisma.candidateProfile.findMany({ where: { id: { in: ids } }, select: { id: true, anonymousHandle: true } })
        : Promise.resolve([])
    })(),
  ])
  const orgName = new Map(organizations.map((entry) => [entry.id, entry.name]))
  const jobTitle = new Map(jobs.map((entry) => [entry.id, entry.title]))
  const handle = new Map(profiles.map((entry) => [entry.id, entry.anonymousHandle]))

  const deciders = [...new Set(rows.map((row) => row.decidedById).filter((id): id is string => Boolean(id)))]
  const people = deciders.length
    ? await prisma.user.findMany({ where: { id: { in: deciders } }, select: { id: true, name: true } })
    : []
  const nameById = new Map(people.map((person) => [person.id, person.name]))

  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    kindLabel: REVIEW_TASK_KIND_LABELS[row.kind] ?? row.kind,
    status: row.status,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    reason: row.reason,
    payload: row.payload,
    organizationName: row.organizationId ? (orgName.get(row.organizationId) ?? 'Organisation removed') : null,
    anonymousHandle: row.candidateProfileId ? (handle.get(row.candidateProfileId) ?? 'Profile removed') : null,
    jobTitle: row.jobId ? (jobTitle.get(row.jobId) ?? 'Role removed') : null,
    createdAt: row.createdAt,
    decidedAt: row.decidedAt,
    decidedByName: row.decidedById ? (nameById.get(row.decidedById) ?? 'Former account') : null,
    decisionNote: row.decisionNote,
    assigneeRole: row.assigneeRole,
  }))
}

export async function reviewTaskCounts() {
  const rows = await prisma.reviewTask.groupBy({ by: ['status'], _count: { _all: true } })
  const byStatus = new Map(rows.map((row) => [row.status, row._count._all]))
  return {
    open: byStatus.get('OPEN') ?? 0,
    approved: byStatus.get('APPROVED') ?? 0,
    rejected: byStatus.get('REJECTED') ?? 0,
    deferred: byStatus.get('DEFERRED') ?? 0,
    total: rows.reduce((total, row) => total + row._count._all, 0),
  }
}

/**
 * A person decides. The task row keeps who decided, when, and the note they
 * wrote, so an evaluation later can separate human judgements from model ones.
 */
export async function decideReviewTask(
  principal: Principal,
  input: { taskId: string; status: ReviewTaskStatus; note: string },
) {
  assertPermission(principal, 'admin.job.moderate')

  const note = input.note.trim()
  if (note.length < 10) {
    throw new AccessDeniedError('A review decision needs a note of at least 10 characters — it is the record of why.')
  }

  const task = await prisma.reviewTask.findUnique({ where: { id: input.taskId } })
  if (!task) throw new AccessDeniedError('That review task does not exist.')
  if (task.status !== 'OPEN') {
    throw new AccessDeniedError(`Already ${task.status.toLowerCase()} — a closed task is not re-decided here.`)
  }

  const updated = await prisma.reviewTask.update({
    where: { id: task.id },
    data: {
      status: input.status,
      decidedById: principal.userId,
      decidedAt: new Date(),
      decisionNote: note.slice(0, 600),
    },
  })

  await recordAudit({
    actor: principal,
    action: `review.${input.status.toLowerCase()}`,
    entityType: 'review_tasks',
    entityId: updated.id,
    organizationId: updated.organizationId,
    targetUserId: updated.candidateProfileId
      ? (await prisma.candidateProfile.findUnique({ where: { id: updated.candidateProfileId }, select: { userId: true } }))?.userId ?? null
      : null,
    metadata: { kind: updated.kind, subjectType: updated.subjectType, subjectId: updated.subjectId },
  })

  // The person whose profile or role is under review hears the outcome.
  const targetUserId = updated.candidateProfileId
    ? (await prisma.candidateProfile.findUnique({ where: { id: updated.candidateProfileId }, select: { userId: true } }))?.userId
    : null
  if (targetUserId) {
    await prisma.notification.create({
      data: {
        userId: targetUserId,
        type: 'ADMIN_NOTICE',
        title: `A review item about your profile was ${input.status.toLowerCase()}`,
        body: `Kind: ${REVIEW_TASK_KIND_LABELS[updated.kind] ?? updated.kind}. An administrator recorded: ${note.slice(0, 200)}`,
        link: '/candidate/notifications',
      },
    })
  }

  return updated
}

/** Queue shape used by the admin review screen and the engines dashboard. */
export async function reviewQueue(principal: Principal) {
  const [tasks, counts] = await Promise.all([openReviewTasks(principal, { status: 'OPEN' }), reviewTaskCounts()])
  return { tasks, counts }
}

/** Turns a stored JSON payload into lines the screen can show without guessing. */
export function payloadLines(payload: unknown): { label: string; value: string }[] {
  if (!payload || typeof payload !== 'object') return []
  const lines: { label: string; value: string }[] = []
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    if (value == null) continue
    if (Array.isArray(value)) {
      lines.push({ label: key, value: `${value.length} item(s): ${value.slice(0, 3).map((entry) => String(entry)).join(' · ')}` })
    } else if (typeof value === 'object') {
      lines.push({ label: key, value: JSON.stringify(value).slice(0, 200) })
    } else {
      lines.push({ label: key, value: String(value) })
    }
  }
  return lines
}
