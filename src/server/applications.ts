import type { ApplicationStatus } from '@prisma/client'
import { prisma } from '@/lib/db'
import { AccessDeniedError, assertPermission, type Principal } from '@/lib/authz'
import { nullableDate, nullableString } from '@/server/fields'
import { recordAudit } from '@/server/audit'
import { notifyOrganization, notifyUser } from '@/server/notifications'
import { computeMatchesForProfile } from '@/server/matching'
import type { z } from 'zod'
import { applicationCreateSchema, type applicationStatusSchema, type shortlistSchema } from '@/lib/validation'

type ApplyDto = z.infer<typeof applicationCreateSchema>
type StatusDto = z.infer<typeof applicationStatusSchema>
type ShortlistDto = z.infer<typeof shortlistSchema>

/**
 * Pipeline state machine. Forward moves only, and a candidate may only ever
 * move their own application to WITHDRAWN.
 */
const EMPLOYER_TRANSITIONS: Record<ApplicationStatus, ApplicationStatus[]> = {
  SUBMITTED: ['IN_REVIEW', 'SHORTLISTED', 'REJECTED'],
  IN_REVIEW: ['SHORTLISTED', 'REJECTED'],
  SHORTLISTED: ['INTERVIEW_INVITED', 'REJECTED'],
  INTERVIEW_INVITED: ['INTERVIEW_COMPLETED', 'SHORTLISTED', 'REJECTED'],
  INTERVIEW_COMPLETED: ['OFFER_EXTENDED', 'REJECTED'],
  OFFER_EXTENDED: ['HIRED', 'REJECTED'],
  REJECTED: [],
  WITHDRAWN: [],
  HIRED: [],
}

const STATUS_NOTIFICATION: Record<ApplicationStatus, { title: string; body: (job: string) => string }> = {
  SUBMITTED: { title: 'Application received', body: (job) => `Your application to ${job} was recorded.` },
  IN_REVIEW: { title: 'Application under review', body: (job) => `The hiring team is reviewing your application to ${job}.` },
  SHORTLISTED: { title: 'You are shortlisted', body: (job) => `You have been shortlisted for ${job}.` },
  INTERVIEW_INVITED: { title: 'Interview invitation', body: (job) => `You have been invited to interview for ${job}.` },
  INTERVIEW_COMPLETED: { title: 'Interview recorded', body: (job) => `Your interview for ${job} was marked complete.` },
  OFFER_EXTENDED: { title: 'Offer extended', body: (job) => `An offer has been extended for ${job}.` },
  REJECTED: { title: 'Application not advanced', body: (job) => `Your application to ${job} was not advanced this time.` },
  WITHDRAWN: { title: 'Application withdrawn', body: (job) => `Your application to ${job} is marked withdrawn.` },
  HIRED: { title: 'Marked as hired', body: (job) => `You were marked as hired for ${job}.` },
}

/** One role's match is scored on demand so a snapshot always exists at apply time. */
async function ensureMatch(candidateProfileId: string, jobId: string) {
  await computeMatchesForProfile(candidateProfileId)
  const existing = await prisma.match.findUnique({
    where: { candidateProfileId_jobId: { candidateProfileId, jobId } },
  })
  if (existing) return existing

  throw new AccessDeniedError('Add at least one skill before applying to an eligible role.')
}

export async function applyToJob(principal: Principal, dto: ApplyDto) {
  assertPermission(principal, 'candidate.application.create')
  dto = applicationCreateSchema.parse(dto)
  const profileId = principal.candidateProfileId
  if (!profileId) throw new AccessDeniedError('No candidate profile attached to this account.')

  const job = await prisma.job.findUnique({
    where: { id: dto.jobId },
    include: {
      organization: { select: { id: true, name: true, verificationStatus: true } },
      skills: { include: { skill: true } },
    },
  })
  if (!job || job.status !== 'PUBLISHED' || (job.closesAt && job.closesAt <= new Date())) throw new AccessDeniedError('This role is not accepting applications.')
  if (job.organization.verificationStatus !== 'VERIFIED') {
    throw new AccessDeniedError('This organisation has not been verified yet.')
  }
  if (job.skills.length === 0) throw new AccessDeniedError('This role has no defined skills and cannot be matched.')

  const duplicate = await prisma.application.findUnique({
    where: { candidateProfileId_jobId: { candidateProfileId: profileId, jobId: job.id } },
  })
  if (duplicate && duplicate.status !== 'WITHDRAWN') {
    throw new AccessDeniedError('You have already applied to this role.')
  }

  const match = await ensureMatch(profileId, job.id)

  const application = await prisma.application.upsert({
    where: { candidateProfileId_jobId: { candidateProfileId: profileId, jobId: job.id } },
    create: {
      candidateProfileId: profileId,
      jobId: job.id,
      organizationId: job.organizationId,
      userId: principal.userId,
      status: 'SUBMITTED',
      coverLetter: nullableString(dto.coverLetter),
      identityConsentAt: new Date(),
      matchScoreSnapshot: match.score,
      source: 'DIRECT',
    },
    update: {
      status: 'SUBMITTED',
      coverLetter: nullableString(dto.coverLetter),
      identityConsentAt: new Date(),
      matchScoreSnapshot: match.score,
    },
  })

  await prisma.applicationStatusEvent.create({
    data: { applicationId: application.id, toStatus: 'SUBMITTED', note: 'Submitted by the candidate.', actorUserId: principal.userId },
  })

  await notifyOrganization(job.organizationId, {
    type: 'MESSAGE',
    title: 'New application received',
    body: `An anonymised candidate applied to ${job.title}. Match score ${(match.score * 100).toFixed(0)}%.`,
    link: `/employer/jobs/${job.id}`,
  })

  await notifyUser(principal.userId, {
    type: 'APPLICATION_UPDATE',
    title: 'Application submitted',
    body: `You applied to ${job.title} at ${job.organization.name}. Applying shares your identity with that organisation.`,
    link: '/candidate/applications',
  })

  await recordAudit({
    actor: principal,
    action: 'candidate.application.create',
    entityType: 'applications',
    entityId: application.id,
    organizationId: job.organizationId,
    metadata: { jobId: job.id, score: match.score, identityDisclosed: true },
  })

  return application
}

export async function withdrawApplication(principal: Principal, applicationId: string) {
  assertPermission(principal, 'candidate.application.withdraw')

  const application = await prisma.application.findFirst({
    where: { id: applicationId, userId: principal.userId },
    include: { job: { select: { title: true, organizationId: true } } },
  })
  if (!application) throw new AccessDeniedError('That application is not yours.')
  if (application.status === 'HIRED' || application.status === 'WITHDRAWN') {
    throw new AccessDeniedError(`An application marked ${application.status.toLowerCase()} cannot be withdrawn.`)
  }

  const updated = await prisma.application.update({
    where: { id: applicationId },
    data: { status: 'WITHDRAWN' },
  })
  await prisma.applicationStatusEvent.create({
    data: {
      applicationId,
      fromStatus: application.status,
      toStatus: 'WITHDRAWN',
      note: 'Withdrawn by the candidate.',
      actorUserId: principal.userId,
    },
  })

  await notifyOrganization(application.job.organizationId, {
    type: 'APPLICATION_UPDATE',
    title: 'Candidate withdrew',
    body: `A candidate withdrew their application to ${application.job.title}.`,
    link: `/employer/jobs/${application.jobId}`,
  })

  await recordAudit({
    actor: principal,
    action: 'candidate.application.withdraw',
    entityType: 'applications',
    entityId: applicationId,
    metadata: { from: application.status },
  })
  return updated
}

/** Employer-side pipeline move, guarded by the transition table. */
export async function updateApplicationStatus(principal: Principal, dto: StatusDto) {
  const permission =
    dto.status === 'INTERVIEW_INVITED' ? 'employer.invitation.send' : 'employer.application.update'
  assertPermission(principal, permission)
  if (!principal.organizationId) throw new AccessDeniedError('No organisation attached to this account.')

  const application = await prisma.application.findFirst({
    where: { id: dto.applicationId, organizationId: principal.organizationId },
    include: { job: { select: { title: true } }, candidateProfile: { select: { id: true, userId: true } } },
  })
  if (!application) throw new AccessDeniedError('This application belongs to another organisation.')

  if (!EMPLOYER_TRANSITIONS[application.status].includes(dto.status)) {
    throw new AccessDeniedError(`Cannot move an application from ${application.status.toLowerCase()} to ${dto.status.toLowerCase()}.`)
  }
  if (dto.status === 'INTERVIEW_INVITED' && !dto.interviewScheduledAt) {
    throw new AccessDeniedError('Set an interview date and time before sending the invitation.')
  }

  const updated = await prisma.application.update({
    where: { id: application.id },
    data: {
      status: dto.status,
      interviewScheduledAt: dto.interviewScheduledAt
        ? nullableDate(dto.interviewScheduledAt)
        : application.interviewScheduledAt,
    },
  })

  await prisma.applicationStatusEvent.create({
    data: {
      applicationId: application.id,
      fromStatus: application.status,
      toStatus: dto.status,
      note: nullableString(dto.note),
      actorUserId: principal.userId,
    },
  })

  const message = STATUS_NOTIFICATION[dto.status]
  await notifyUser(application.candidateProfile.userId, {
    type: dto.status === 'INTERVIEW_INVITED' ? 'INTERVIEW_INVITATION' : 'APPLICATION_UPDATE',
    title: message.title,
    body: `${message.body(application.job.title)}${
      dto.note ? ` Note from the hiring team: ${dto.note}` : ''
    }${
      dto.interviewScheduledAt
        ? ` Scheduled for ${dto.interviewScheduledAt.toLocaleString('en-IN')}.`
        : ''
    }`,
    link: '/candidate/applications',
  })

  await recordAudit({
    actor: principal,
    action: 'employer.application.status',
    entityType: 'applications',
    entityId: application.id,
    organizationId: principal.organizationId,
    targetUserId: application.candidateProfile.userId,
    metadata: { from: application.status, to: dto.status },
  })

  return updated
}

export async function candidateApplications(principal: Principal) {
  assertPermission(principal, 'candidate.application.read')
  if (!principal.candidateProfileId) throw new AccessDeniedError('No candidate profile attached to this account.')

  return prisma.application.findMany({
    where: { candidateProfileId: principal.candidateProfileId },
    orderBy: { updatedAt: 'desc' },
    include: {
      job: { include: { organization: { select: { name: true, verificationStatus: true } } } },
      statusEvents: { orderBy: { createdAt: 'asc' } },
    },
  })
}

export async function organizationApplications(
  principal: Principal,
  filter: { jobId?: string; status?: ApplicationStatus } = {},
) {
  assertPermission(principal, 'employer.application.read')
  if (!principal.organizationId) throw new AccessDeniedError('No organisation attached to this account.')

  return prisma.application.findMany({
    where: {
      organizationId: principal.organizationId,
      ...(filter.jobId ? { jobId: filter.jobId } : {}),
      ...(filter.status ? { status: filter.status } : {}),
    },
    orderBy: { updatedAt: 'desc' },
    take: 200,
    include: {
      job: { select: { id: true, title: true } },
      candidateProfile: {
        select: { id: true, anonymousHandle: true, headline: true, yearsOfExperience: true, workPreference: true },
      },
      statusEvents: { orderBy: { createdAt: 'desc' }, take: 1 },    },
  }).then((rows) =>
    rows.map((row) => ({
      ...row,
      // Identity is available while a consented application is live; withdrawing
      // it ends the disclosure, exactly as `canRevealIdentity` decides elsewhere.
      candidateProfile: {
        ...row.candidateProfile,
        headline: row.identityConsentAt && row.status !== 'WITHDRAWN' ? row.candidateProfile.headline : null,
      },
    })),
  )
}

export async function shortlistCandidate(principal: Principal, dto: ShortlistDto) {
  assertPermission(principal, 'employer.shortlist.manage')
  if (!principal.organizationId) throw new AccessDeniedError('No organisation attached to this account.')

  const job = await prisma.job.findFirst({
    where: { id: dto.jobId, organizationId: principal.organizationId },
    select: { id: true, title: true },
  })
  if (!job) throw new AccessDeniedError('This role belongs to another organisation.')

  const match = await prisma.match.findFirst({
    where: { jobId: job.id, candidateProfileId: dto.candidateProfileId, candidateProfile: { visibleToEmployers: true, sharingMode: { not: 'NOT_VISIBLE' } } },
    select: { id: true, score: true },
  })
  if (!match) throw new AccessDeniedError('That candidate is not matched to this role.')

  const shortlist =
    (await prisma.shortlist.findFirst({ where: { organizationId: principal.organizationId } })) ??
    (await prisma.shortlist.create({
      data: { organizationId: principal.organizationId, name: 'Active shortlist' },
    }))

  const entry = await prisma.shortlistEntry.upsert({
    where: { jobId_candidateProfileId: { jobId: job.id, candidateProfileId: dto.candidateProfileId } },
    create: {
      shortlistId: shortlist.id,
      jobId: job.id,
      candidateProfileId: dto.candidateProfileId,
      note: nullableString(dto.note),
      addedById: principal.userId,
    },
    update: { shortlistId: shortlist.id, note: nullableString(dto.note) },
  })

  await recordAudit({
    actor: principal,
    action: 'employer.shortlist.add',
    entityType: 'shortlist_entries',
    entityId: entry.id,
    organizationId: principal.organizationId,
    metadata: { jobId: job.id, score: match.score },
  })

  return entry
}

export async function removeShortlistEntry(principal: Principal, entryId: string) {
  assertPermission(principal, 'employer.shortlist.manage')
  if (!principal.organizationId) throw new AccessDeniedError('No organisation attached to this account.')

  const entry = await prisma.shortlistEntry.findFirst({
    where: { id: entryId, job: { organizationId: principal.organizationId } },
  })
  if (!entry) throw new AccessDeniedError('That shortlist entry is not in your organisation.')

  await prisma.shortlistEntry.delete({ where: { id: entryId } })
  await recordAudit({
    actor: principal,
    action: 'employer.shortlist.remove',
    entityType: 'shortlist_entries',
    entityId: entryId,
    organizationId: principal.organizationId,
  })
}

export async function shortlistForJob(principal: Principal, jobId: string) {
  assertPermission(principal, 'employer.shortlist.manage')
  if (!principal.organizationId) throw new AccessDeniedError('No organisation attached to this account.')

  const job = await prisma.job.findFirst({ where: { id: jobId, organizationId: principal.organizationId } })
  if (!job) throw new AccessDeniedError('This role belongs to another organisation.')

  return prisma.shortlistEntry.findMany({
    where: { jobId, candidateProfile: { visibleToEmployers: true, sharingMode: { not: 'NOT_VISIBLE' } } },
    orderBy: { createdAt: 'desc' },
    include: {
      candidateProfile: {
        select: { id: true, anonymousHandle: true, yearsOfExperience: true },
      },
    },
  }).then((rows) => rows.map((row) => ({ ...row, candidateProfile: { ...row.candidateProfile, headline: null } })))
}

export { EMPLOYER_TRANSITIONS }
