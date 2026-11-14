import { Prisma } from '@prisma/client'
import { AccessDeniedError, assertPermission, assertRole, type Principal } from '@/lib/authz'
import { prisma } from '@/lib/db'
import { policyVersion } from '@/lib/env'
import { recordAudit } from '@/server/audit'
import { notifyUser } from '@/server/notifications'

const REQUEST_VALID_MS = 30 * 24 * 60 * 60 * 1000
const LIST_INCLUDE = {
  organization: { select: { name: true } },
  job: { select: { title: true } },
  candidateProfile: { select: { anonymousHandle: true } },
} as const

type DisclosureRow = Prisma.IdentityDisclosureRequestGetPayload<{ include: typeof LIST_INCLUDE }>
export type DisclosureRequestView = {
  id: string
  status: string
  reason: string
  createdAt: Date
  decidedAt: Date | null
  decisionNote: string | null
  expiresAt: Date | null
  organizationName: string
  jobTitle: string | null
  requesterName: string | null
  anonymousHandle: string | null
}

function toView(row: DisclosureRow, requesterName: string | null = null): DisclosureRequestView {
  return {
    id: row.id, status: row.status, reason: row.reason, createdAt: row.createdAt,
    decidedAt: row.decidedAt, decisionNote: row.decisionNote, expiresAt: row.expiresAt,
    organizationName: row.organization.name, jobTitle: row.job?.title ?? null,
    requesterName, anonymousHandle: row.candidateProfile.anonymousHandle,
  }
}

async function decorate(rows: DisclosureRow[]) {
  const users = await prisma.user.findMany({
    where: { id: { in: rows.map((row) => row.requestedById) } }, select: { id: true, name: true },
  })
  const names = new Map(users.map((user) => [user.id, user.name]))
  return rows.map((row) => toView(row, names.get(row.requestedById) ?? null))
}

async function expireStale(scope: Prisma.IdentityDisclosureRequestWhereInput) {
  await prisma.identityDisclosureRequest.updateMany({
    where: { ...scope, status: { in: ['PENDING', 'APPROVED'] }, expiresAt: { lte: new Date() } },
    data: { status: 'EXPIRED' },
  })
}

export async function hasApprovedDisclosure(candidateProfileId: string, organizationId: string) {
  return Boolean(await prisma.identityDisclosureRequest.findFirst({
    where: { candidateProfileId, organizationId, status: 'APPROVED', OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
    select: { id: true },
  }))
}

export async function requestIdentityDisclosure(
  principal: Principal,
  input: { candidateProfileId: string; jobId?: string | null; reason: string },
) {
  assertRole(principal, 'EMPLOYER')
  assertPermission(principal, 'employer.candidate.anonymous.read')
  if (!principal.organizationId) throw new AccessDeniedError('No organisation is attached to this account.')
  const organizationId = principal.organizationId
  const reason = input.reason.trim()
  if (reason.length < 20 || reason.length > 600) throw new AccessDeniedError('Give a reason between 20 and 600 characters.')
  const organization = await prisma.organization.findFirst({ where: { id: organizationId, verificationStatus: 'VERIFIED' } })
  if (!organization) throw new AccessDeniedError('Only verified organisations may request identity disclosure.')
  const match = await prisma.match.findFirst({
    where: {
      candidateProfileId: input.candidateProfileId,
      ...(input.jobId ? { jobId: input.jobId } : {}),
      job: { organizationId, status: 'PUBLISHED' },
      candidateProfile: { visibleToEmployers: true, sharingMode: { not: 'NOT_VISIBLE' }, user: { status: 'ACTIVE' } },
    },
    include: { candidateProfile: { select: { userId: true } } },
  })
  if (!match) throw new AccessDeniedError('A visible profile matched to your published role is required.')
  await expireStale({ candidateProfileId: input.candidateProfileId, organizationId })
  if (await hasApprovedDisclosure(input.candidateProfileId, organizationId)) {
    return { ok: true as const, alreadyOpen: true, requestId: null, message: 'This candidate already shared their identity with your organisation.' }
  }
  const existing = await prisma.identityDisclosureRequest.findFirst({
    where: { candidateProfileId: input.candidateProfileId, organizationId, status: 'PENDING' },
  })
  if (existing) return { ok: true as const, alreadyOpen: false, requestId: existing.id, message: 'A request is already waiting for this candidate’s decision.' }
  const request = await prisma.identityDisclosureRequest.create({
    data: { candidateProfileId: input.candidateProfileId, organizationId, jobId: match.jobId,
      requestedById: principal.userId, reason, expiresAt: new Date(Date.now() + REQUEST_VALID_MS) },
  })
  await notifyUser(match.candidateProfile.userId, {
    type: 'DISCLOSURE_REQUEST', title: 'An employer asked to see your name',
    body: `${organization.name} requested identity disclosure. Nothing is shared until you approve.`, link: '/candidate/disclosures',
  })
  await recordAudit({ actor: principal, action: 'disclosure.requested', entityType: 'IdentityDisclosureRequest', entityId: request.id,
    organizationId, targetUserId: match.candidateProfile.userId, metadata: { candidateProfileId: input.candidateProfileId, jobId: match.jobId } })
  return { ok: true as const, alreadyOpen: false, requestId: request.id, message: 'Request sent. Identity stays hidden until the candidate approves.' }
}

export async function decideDisclosure(
  principal: Principal,
  input: { requestId: string; decision: 'APPROVED' | 'DECLINED'; note?: string | null },
) {
  assertRole(principal, 'CANDIDATE')
  assertPermission(principal, 'candidate.consent.manage')
  if (!principal.candidateProfileId) throw new AccessDeniedError('No candidate profile is attached to this account.')
  if (!['APPROVED', 'DECLINED'].includes(input.decision)) throw new AccessDeniedError('Choose approve or decline.')
  const candidateProfileId = principal.candidateProfileId
  const now = new Date()
  const updated = await prisma.$transaction(async (tx) => {
    const request = await tx.identityDisclosureRequest.findFirst({
      where: { id: input.requestId, candidateProfileId }, include: LIST_INCLUDE,
    })
    if (!request || request.status !== 'PENDING' || (request.expiresAt && request.expiresAt <= now)) {
      throw new AccessDeniedError('This request is not yours, has expired, or has already been decided.')
    }
    const changed = await tx.identityDisclosureRequest.updateMany({
      where: { id: request.id, status: 'PENDING' },
      data: { status: input.decision, decidedById: principal.userId, decidedAt: now,
        decisionNote: input.note?.trim().slice(0, 400) || null, expiresAt: new Date(now.getTime() + REQUEST_VALID_MS) },
    })
    if (changed.count !== 1) throw new AccessDeniedError('That request has already been decided.')
    await tx.consentRecord.create({ data: {
      userId: principal.userId, type: 'IDENTIFIED_PROFILE_SHARING', decision: input.decision === 'APPROVED' ? 'GRANTED' : 'DECLINED',
      policyVersion: policyVersion(), scope: `disclosure:${request.id}:org:${request.organizationId}`, decidedAt: now,
    } })
    return tx.identityDisclosureRequest.findUniqueOrThrow({ where: { id: request.id }, include: LIST_INCLUDE })
  })
  await notifyUser(updated.requestedById, { type: 'DISCLOSURE_DECISION',
    title: input.decision === 'APPROVED' ? 'Candidate shared their identity' : 'Candidate declined identity disclosure',
    body: input.decision === 'APPROVED' ? 'The grant lasts 30 days unless withdrawn sooner. Identified views are logged.' : 'The candidate chose to remain anonymous.',
    link: '/employer/candidates' })
  await recordAudit({ actor: principal, action: input.decision === 'APPROVED' ? 'disclosure.approved' : 'disclosure.declined',
    entityType: 'IdentityDisclosureRequest', entityId: updated.id, organizationId: updated.organizationId,
    targetUserId: principal.userId, visibility: 'USER', metadata: { candidateProfileId: principal.candidateProfileId } })
  return toView(updated)
}

export async function revokeDisclosure(principal: Principal, requestId: string) {
  assertRole(principal, 'CANDIDATE')
  assertPermission(principal, 'candidate.consent.manage')
  if (!principal.candidateProfileId) throw new AccessDeniedError('No candidate profile is attached to this account.')
  const candidateProfileId = principal.candidateProfileId
  const request = await prisma.$transaction(async (tx) => {
    const row = await tx.identityDisclosureRequest.findFirst({ where: { id: requestId, candidateProfileId, status: 'APPROVED' } })
    if (!row) throw new AccessDeniedError('No active disclosure grant belongs to you here.')
    await tx.identityDisclosureRequest.update({ where: { id: row.id }, data: { status: 'WITHDRAWN', decidedAt: new Date(), decidedById: principal.userId } })
    await tx.consentRecord.create({ data: { userId: principal.userId, type: 'IDENTIFIED_PROFILE_SHARING', decision: 'WITHDRAWN',
      policyVersion: policyVersion(), scope: `disclosure:${row.id}:org:${row.organizationId}`, withdrawnAt: new Date() } })
    return row
  })
  await recordAudit({ actor: principal, action: 'disclosure.revoked', entityType: 'IdentityDisclosureRequest', entityId: request.id,
    organizationId: request.organizationId, targetUserId: principal.userId, visibility: 'USER' })
}

export async function withdrawDisclosureRequest(principal: Principal, requestId: string) {
  assertRole(principal, 'EMPLOYER')
  assertPermission(principal, 'employer.candidate.anonymous.read')
  if (!principal.organizationId) throw new AccessDeniedError('No organisation is attached to this account.')
  const result = await prisma.identityDisclosureRequest.updateMany({
    where: { id: requestId, organizationId: principal.organizationId, status: 'PENDING' },
    data: { status: 'WITHDRAWN', decidedById: principal.userId, decidedAt: new Date() },
  })
  if (!result.count) throw new AccessDeniedError('Only your organisation’s pending requests can be withdrawn.')
  await recordAudit({ actor: principal, action: 'disclosure.withdrawn', entityType: 'IdentityDisclosureRequest', entityId: requestId, organizationId: principal.organizationId })
  return result
}

export async function disclosureRequestsForCandidate(principal: Principal) {
  assertPermission(principal, 'candidate.consent.manage')
  if (!principal.candidateProfileId) return []
  const where = { candidateProfileId: principal.candidateProfileId }
  await expireStale(where)
  return decorate(await prisma.identityDisclosureRequest.findMany({ where, include: LIST_INCLUDE, orderBy: { createdAt: 'desc' }, take: 40 }))
}

export async function disclosureRequestsForOrganization(principal: Principal) {
  assertPermission(principal, 'employer.candidate.anonymous.read')
  if (!principal.organizationId) return []
  const where = { organizationId: principal.organizationId }
  await expireStale(where)
  return decorate(await prisma.identityDisclosureRequest.findMany({ where, include: LIST_INCLUDE, orderBy: { createdAt: 'desc' }, take: 40 }))
}

export type DisclosureState = {
  status: 'NONE' | 'PENDING' | 'DECLINED' | 'WITHDRAWN' | 'EXPIRED' | 'REVEALED_BY_APPLICATION' | 'REVEALED_BY_CONSENT'
  requestId: string | null
}

export async function disclosureStateFor(candidateProfileId: string, organizationId: string): Promise<DisclosureState> {
  const application = await prisma.application.findFirst({
    where: { candidateProfileId, organizationId, status: { not: 'WITHDRAWN' }, identityConsentAt: { not: null } }, select: { id: true },
  })
  if (application) return { status: 'REVEALED_BY_APPLICATION', requestId: null }
  await expireStale({ candidateProfileId, organizationId })
  const request = await prisma.identityDisclosureRequest.findFirst({ where: { candidateProfileId, organizationId }, orderBy: { createdAt: 'desc' } })
  if (!request) return { status: 'NONE', requestId: null }
  return { status: request.status === 'APPROVED' ? 'REVEALED_BY_CONSENT' : request.status, requestId: request.id }
}

export async function disclosureLedger(principal: Principal, take = 50) {
  assertPermission(principal, 'admin.audit.read')
  const rows = await prisma.identityDisclosureRequest.findMany({ include: LIST_INCLUDE, orderBy: { createdAt: 'desc' }, take })
  return { requests: await decorate(rows), totals: { total: rows.length, pending: rows.filter((r) => r.status === 'PENDING').length,
    approved: rows.filter((r) => r.status === 'APPROVED').length, declined: rows.filter((r) => r.status === 'DECLINED').length } }
}
