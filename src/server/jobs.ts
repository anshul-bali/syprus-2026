import type { Job, JobStatus } from '@prisma/client'
import { prisma } from '@/lib/db'
import { AccessDeniedError, assertPermission, type Principal } from '@/lib/authz'
import { nullableDate, nullableNumber, nullableString } from '@/server/fields'
import { recordAudit } from '@/server/audit'
import { computeMatchesForProfile } from '@/server/matching'
import { notifyOrganization, notifyUser } from '@/server/notifications'
import type { z } from 'zod'
import type { jobSchema } from '@/lib/validation'

type JobDto = z.infer<typeof jobSchema>

/**
 * Jobs are created as drafts and only become visible after administrator
 * moderation, so an unverified organisation cannot reach candidates.
 */

/** Catalogue lookup keyed the way the caller holds the skill: by slug. */
async function resolveSkillIds(slugs: string[]) {
  if (slugs.length === 0) return new Map<string, string>()
  const skills = await prisma.skill.findMany({ where: { slug: { in: slugs } }, select: { id: true, slug: true } })
  return new Map(skills.map((skill) => [skill.slug, skill.id]))
}

async function jobSkillRows(skills: JobDto['skills']) {
  const idsBySlug = await resolveSkillIds(skills.map((skill) => skill.skillSlug))
  const unknown = skills.filter((skill) => !idsBySlug.has(skill.skillSlug)).map((skill) => skill.skillSlug)
  if (unknown.length > 0) {
    throw new AccessDeniedError(`These skills are not in the catalogue: ${unknown.join(', ')}.`)
  }

  return skills.map((skill) => ({
    skillId: idsBySlug.get(skill.skillSlug) as string,
    level: skill.level,
    weight: skill.weight,
    requirement: skill.requirement,
  }))
}

export async function requireEmployerOrg(principal: Principal) {
  assertPermission(principal, 'employer.job.read')
  if (!principal.organizationId) {
    throw new AccessDeniedError('This account is not attached to an organisation.')
  }
  return principal.organizationId
}

export async function createJob(principal: Principal, dto: JobDto) {
  assertPermission(principal, 'employer.job.create')
  const organizationId = await requireEmployerOrg(principal)

  const skills = await jobSkillRows(dto.skills)
  const job = await prisma.job.create({
    data: {
      organizationId,
      skills: { create: skills },
      title: dto.title.trim(),
      description: dto.description.trim(),
      responsibilities: dto.responsibilities,
      requirementsText: nullableString(dto.requirementsText),
      locationCity: nullableString(dto.locationCity),
      locationCountry: nullableString(dto.locationCountry),
      workMode: dto.workMode,
      employmentType: dto.employmentType,
      salaryMin: nullableNumber(dto.salaryMin),
      salaryMax: nullableNumber(dto.salaryMax),
      experienceYearsMin: nullableNumber(dto.experienceYearsMin),
      experienceYearsMax: nullableNumber(dto.experienceYearsMax),
      status: 'DRAFT',
      reEntryFriendly: dto.reEntryFriendly,
      flexibleHours: dto.flexibleHours,
      returnshipProgram: dto.returnshipProgram,
      closesAt: nullableDate(dto.closesAt),
    },
  })

  await recordAudit({
    actor: principal,
    action: 'employer.job.create',
    entityType: 'jobs',
    entityId: job.id,
    organizationId,
    metadata: { title: job.title, skills: dto.skills.length },
  })

  return prisma.job.findUniqueOrThrow({
    where: { id: job.id },
    include: { skills: { include: { skill: true } }, organization: true },
  })
}

export async function updateJob(principal: Principal, jobId: string, dto: JobDto) {
  assertPermission(principal, 'employer.job.update')
  const organizationId = await requireEmployerOrg(principal)

  const existing = await prisma.job.findFirst({ where: { id: jobId, organizationId } })
  if (!existing) throw new AccessDeniedError('This role belongs to another organisation.')
  if (existing.status === 'CLOSED') {
    throw new AccessDeniedError('Closed roles cannot be edited. Duplicate the role to reuse its content.')
  }

  const skills = await jobSkillRows(dto.skills)
  await prisma.job.update({
    where: { id: jobId },
    data: {
      skills: { deleteMany: {}, create: skills },
      title: dto.title.trim(),
      description: dto.description.trim(),
      responsibilities: dto.responsibilities,
      requirementsText: nullableString(dto.requirementsText),
      locationCity: nullableString(dto.locationCity),
      locationCountry: nullableString(dto.locationCountry),
      workMode: dto.workMode,
      employmentType: dto.employmentType,
      salaryMin: nullableNumber(dto.salaryMin),
      salaryMax: nullableNumber(dto.salaryMax),
      experienceYearsMin: nullableNumber(dto.experienceYearsMin),
      experienceYearsMax: nullableNumber(dto.experienceYearsMax),
      reEntryFriendly: dto.reEntryFriendly,
      flexibleHours: dto.flexibleHours,
      returnshipProgram: dto.returnshipProgram,
      closesAt: nullableDate(dto.closesAt),
      // Any edit to a live listing sends it back through moderation.
      status: existing.status === 'PUBLISHED' ? 'PENDING_MODERATION' : existing.status,
      moderatedAt: existing.status === 'PUBLISHED' ? null : existing.moderatedAt,
    },
  })

  await recordAudit({
    actor: principal,
    action: 'employer.job.update',
    entityType: 'jobs',
    entityId: jobId,
    organizationId,
    metadata: { resubmittedForModeration: existing.status === 'PUBLISHED' },
  })

  return prisma.job.findUniqueOrThrow({
    where: { id: jobId },
    include: { skills: { include: { skill: true } } },
  })
}

export type JobLifecycleAction = 'SUBMIT' | 'PAUSE' | 'RESUME' | 'CLOSE' | 'DELETE'

const LIFECYCLE_RULES: Record<JobLifecycleAction, { from: JobStatus[]; to: JobStatus | null }> = {
  SUBMIT: { from: ['DRAFT', 'REJECTED'], to: 'PENDING_MODERATION' },
  PAUSE: { from: ['PUBLISHED'], to: 'PAUSED' },
  RESUME: { from: ['PAUSED'], to: 'PUBLISHED' },
  CLOSE: { from: ['PUBLISHED', 'PAUSED', 'PENDING_MODERATION'], to: 'CLOSED' },
  DELETE: { from: ['DRAFT'], to: null },
}

export async function setJobLifecycle(principal: Principal, jobId: string, action: JobLifecycleAction) {
  assertPermission(principal, 'employer.job.update')
  const organizationId = await requireEmployerOrg(principal)

  const job = await prisma.job.findFirst({
    where: { id: jobId, organizationId },
    include: { organization: { select: { verificationStatus: true, name: true } } },
  })
  if (!job) throw new AccessDeniedError('This role belongs to another organisation.')

  const rule = LIFECYCLE_RULES[action]
  if (!rule.from.includes(job.status)) {
    throw new AccessDeniedError(`A role in ${job.status.toLowerCase()} status cannot be ${action.toLowerCase()}.`)
  }
  if ((action === 'SUBMIT' || action === 'RESUME') && job.organization.verificationStatus !== 'VERIFIED') {
    throw new AccessDeniedError(
      `${job.organization.name} is not verified yet. An administrator must verify the organisation before roles reach candidates.`,
    )
  }

  if (action === 'DELETE') {
    await prisma.job.delete({ where: { id: jobId } })
    await recordAudit({
      actor: principal,
      action: 'employer.job.delete',
      entityType: 'jobs',
      entityId: jobId,
      organizationId,
      metadata: { title: job.title },
    })
    return { deleted: true, status: null as JobStatus | null }
  }

  const status = rule.to as JobStatus
  await prisma.job.update({
    where: { id: jobId },
    data: {
      status,
      postedAt: status === 'PUBLISHED' ? job.postedAt ?? new Date() : job.postedAt,
      moderatedAt: status === 'PUBLISHED' ? job.moderatedAt ?? new Date() : job.moderatedAt,
    },
  })

  if (status === 'CLOSED') {
    const applicants = await prisma.application.findMany({
      where: { jobId, status: { notIn: ['REJECTED', 'WITHDRAWN', 'HIRED'] } },
      select: { userId: true },
    })
    for (const applicant of applicants) {
      await notifyApplicantClosed(applicant.userId, job.title)
    }
  }

  if (action === 'SUBMIT') {
    await notifyOrganization(organizationId, {
      type: 'ADMIN_NOTICE',
      title: 'Role submitted for moderation',
      body: `“${job.title}” is queued for administrator review. You will be notified when it is published.`,
      link: `/employer/jobs/${jobId}`,
    })
  }

  await recordAudit({
    actor: principal,
    action: `employer.job.${action.toLowerCase()}`,
    entityType: 'jobs',
    entityId: jobId,
    organizationId,
    metadata: { from: job.status, to: status },
  })

  return { deleted: false, status }
}

async function notifyApplicantClosed(userId: string, jobTitle: string) {
  await notifyUser(userId, {
    type: 'APPLICATION_UPDATE',
    title: 'A role you applied to has closed',
    body: `“${jobTitle}” is no longer accepting applications. Your application stays in your tracker for reference.`,
    link: '/candidate/applications',
  })
}

/**
 * Publishes a role after administrator moderation and refreshes candidate
 * matches, since a new published role changes everyone's recommendation set.
 */
export async function publishJobAfterModeration(jobId: string) {
  await prisma.job.update({
    where: { id: jobId },
    data: { status: 'PUBLISHED', postedAt: new Date() },
  })

  const profiles = await prisma.candidateProfile.findMany({
    where: { skills: { some: {} } },
    select: { id: true },
    take: 200,
  })
  for (const profile of profiles) {
    await computeMatchesForProfile(profile.id)
  }
  return profiles.length
}

export async function listOrgJobs(principal: Principal, filter: { status?: JobStatus } = {}) {
  const organizationId = await requireEmployerOrg(principal)
  return prisma.job.findMany({
    where: { organizationId, ...(filter.status ? { status: filter.status } : {}) },
    orderBy: { updatedAt: 'desc' },
    include: {
      skills: { include: { skill: true } },
      _count: { select: { applications: true, matches: true } },
    },
  })
}

export async function getJobForEmployer(principal: Principal, jobId: string) {
  const organizationId = await requireEmployerOrg(principal)
  const job = await prisma.job.findFirst({
    where: { id: jobId, organizationId },
    include: {
      skills: { include: { skill: true } },
      organization: true,
      _count: { select: { applications: true, matches: true } },
    },
  })
  if (!job) throw new AccessDeniedError('This role belongs to another organisation.')
  return job
}

/** Public browse used by the candidate recommended-jobs screen. */
export async function publishedJobs(options: {
  search?: string
  workMode?: Job['workMode']
  employmentType?: Job['employmentType']
  take?: number
} = {}) {
  const where: Record<string, unknown> = { status: 'PUBLISHED' }
  if (options.workMode) where.workMode = options.workMode
  if (options.employmentType) where.employmentType = options.employmentType
  if (options.search?.trim()) {
    const term = options.search.trim()
    where.OR = [
      { title: { contains: term, mode: 'insensitive' } },
      { description: { contains: term, mode: 'insensitive' } },
      { locationCity: { contains: term, mode: 'insensitive' } },
    ]
  }

  return prisma.job.findMany({
    where: where as never,
    orderBy: { postedAt: 'desc' },
    take: options.take ?? 50,
    include: {
      organization: { select: { name: true, verificationStatus: true, locationCity: true } },
      skills: { include: { skill: { select: { name: true, slug: true, transferable: true } } } },
    },
  })
}
