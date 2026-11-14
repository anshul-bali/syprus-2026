import type { JobStatus, UserRole } from '@prisma/client'
import { prisma } from '@/lib/db'
import { AccessDeniedError, assertPermission, type Principal } from '@/lib/authz'
import { recordAudit } from '@/server/audit'
import { nullableString } from '@/server/fields'
import { publishJobAfterModeration } from '@/server/jobs'
import { notifyOrganization } from '@/server/notifications'
import { auditFairness, type FairnessSample } from '@/lib/engines/fairness'
import { policyVersion } from '@/lib/env'
import type { z } from 'zod'
import type { jobModerationSchema } from '@/lib/validation'

type ModerationDto = z.infer<typeof jobModerationSchema>

export async function listUsers(
  principal: Principal,
  filter: { query?: string; role?: UserRole; take?: number } = {},
) {
  assertPermission(principal, 'admin.user.read')
  const take = filter.take ?? 100

  return prisma.user.findMany({
    where: {
      ...(filter.role ? { role: filter.role } : {}),
      ...(filter.query?.trim()
        ? {
            OR: [
              { name: { contains: filter.query.trim(), mode: 'insensitive' } },
              { email: { contains: filter.query.trim(), mode: 'insensitive' } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: 'desc' },
    take,
    include: {
      candidateProfile: { select: { id: true, profileCompletion: true, visibleToEmployers: true, skills: { select: { id: true } } } },
      ownedOrganization: { select: { id: true, name: true, verificationStatus: true } },
      memberships: { select: { id: true, name: true } },
    },
  })
}

export async function moderationQueue(principal: Principal, status: JobStatus = 'PENDING_MODERATION') {
  assertPermission(principal, 'admin.job.read')
  return prisma.job.findMany({
    where: { status },
    orderBy: { updatedAt: 'asc' },
    include: {
      organization: { select: { id: true, name: true, verificationStatus: true, industry: true } },
      skills: { include: { skill: true } },
      _count: { select: { applications: true } },
    },
  })
}

/**
 * Moderation is the only route to `PUBLISHED`. Publishing recomputes matches,
 * because a new role changes every candidate's recommendation set.
 */
export async function moderateJob(principal: Principal, dto: ModerationDto) {
  assertPermission(principal, 'admin.job.moderate')

  const job = await prisma.job.findUnique({
    where: { id: dto.jobId },
    include: {
      organization: { select: { id: true, name: true, verificationStatus: true } },
      skills: { select: { id: true } },
    },
  })
  if (!job) throw new AccessDeniedError('Role not found.')

  if (dto.decision === 'PUBLISHED') {
    if (job.organization.verificationStatus !== 'VERIFIED') {
      throw new AccessDeniedError(
        `${job.organization.name} is not verified. Verify the organisation first, then publish its roles.`,
      )
    }
    if (job.skills.length === 0) {
      throw new AccessDeniedError('This role defines no skills, so it cannot be matched. Ask the employer to add skills.')
    }
    if (!dto.note) {
      throw new AccessDeniedError('Record the reason the role passed moderation.')
    }
  }

  if (dto.decision === 'PUBLISHED') {
    await prisma.job.update({
      where: { id: job.id },
      data: { moderatedById: principal.userId, moderatedAt: new Date(), moderationNote: nullableString(dto.note) },
    })
    const profilesMatched = await publishJobAfterModeration(job.id)

    await notifyOrganization(job.organizationId, {
      type: 'ADMIN_NOTICE',
      title: 'Role published',
      body: `“${job.title}” is live and matched against ${profilesMatched} candidate profile${profilesMatched === 1 ? '' : 's'}.`,
      link: `/employer/jobs/${job.id}`,
    })

    await recordAudit({
      actor: principal,
      action: 'admin.job.publish',
      entityType: 'jobs',
      entityId: job.id,
      organizationId: job.organizationId,
      metadata: { profilesMatched, note: dto.note },
    })
    return { status: 'PUBLISHED' as const, profilesMatched }
  }

  await prisma.job.update({
    where: { id: job.id },
    data: {
      status: dto.decision,
      moderatedById: principal.userId,
      moderatedAt: new Date(),
      moderationNote: nullableString(dto.note),
    },
  })

  await notifyOrganization(job.organizationId, {
    type: 'ADMIN_NOTICE',
    title: `Role ${dto.decision.toLowerCase()}`,
    body: `“${job.title}”: ${dto.note ?? 'No note recorded.'}`,
    link: `/employer/jobs/${job.id}`,
  })

  await recordAudit({
    actor: principal,
    action: `admin.job.${dto.decision.toLowerCase()}`,
    entityType: 'jobs',
    entityId: job.id,
    organizationId: job.organizationId,
    metadata: { note: dto.note },
  })

  return { status: dto.decision, profilesMatched: 0 }
}

export async function reportingDashboard(principal: Principal) {
  assertPermission(principal, 'admin.reporting.read')

  const days = 30
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

  const [
    usersByRole,
    orgsByVerification,
    jobsByStatus,
    applicationsByStatus,
    matchAggregate,
    skillCount,
    evidencedSkills,
    inferredSkills,
    profiles,
    recentSignups,
    recentApplications,
    breakBands,
  ] = await Promise.all([
    prisma.user.groupBy({ by: ['role'], _count: { _all: true } }),
    prisma.organization.groupBy({ by: ['verificationStatus'], _count: { _all: true } }),
    prisma.job.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.application.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.match.aggregate({ _avg: { score: true }, _count: { _all: true } }),
    prisma.skill.count(),
    prisma.candidateSkill.count({ where: { evidenceCount: { gt: 0 } } }),
    prisma.candidateSkill.count({ where: { validationStatus: 'RULE_INFERRED' } }),
    prisma.candidateProfile.count({ where: { visibleToEmployers: true } }),
    prisma.user.findMany({ where: { createdAt: { gte: since } }, select: { createdAt: true } }),
    prisma.application.findMany({ where: { createdAt: { gte: since } }, select: { createdAt: true, status: true } }),
    prisma.candidateProfile.groupBy({
      by: ['careerBreakMonths'],
      _count: { _all: true },
      where: { careerBreakMonths: { not: null } },
    }),
  ])

  const toSeries = (rows: { createdAt: Date }[]) => {
    const buckets = new Map<string, number>()
    for (let offset = days - 1; offset >= 0; offset--) {
      const date = new Date(Date.now() - offset * 24 * 60 * 60 * 1000)
      buckets.set(date.toISOString().slice(0, 10), 0)
    }
    for (const row of rows) {
      const key = row.createdAt.toISOString().slice(0, 10)
      if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + 1)
    }
    return [...buckets.entries()].map(([day, count]) => ({ day, count }))
  }

  const bandSummary = [
    { label: 'None', test: (value: number) => value === 0 },
    { label: '≤6 months', test: (value: number) => value >= 1 && value <= 6 },
    { label: '7–12 months', test: (value: number) => value >= 7 && value <= 12 },
    { label: '1–2 years', test: (value: number) => value >= 13 && value <= 24 },
    { label: '2–4 years', test: (value: number) => value >= 25 && value <= 48 },
    { label: '4+ years', test: (value: number) => value > 48 },
  ].map((band) => ({
    label: band.label,
    count: breakBands
      .filter((row) => row.careerBreakMonths != null && band.test(row.careerBreakMonths))
      .reduce((total, row) => total + row._count._all, 0),
  }))

  return {
    totals: {
      candidates: usersByRole.find((row) => row.role === 'CANDIDATE')?._count._all ?? 0,
      employers: usersByRole.find((row) => row.role === 'EMPLOYER')?._count._all ?? 0,
      admins: usersByRole.find((row) => row.role === 'ADMIN')?._count._all ?? 0,
      organisations: orgsByVerification.reduce((total, row) => total + row._count._all, 0),
      verifiedOrganisations: orgsByVerification.find((row) => row.verificationStatus === 'VERIFIED')?._count._all ?? 0,
      publishedJobs: jobsByStatus.find((row) => row.status === 'PUBLISHED')?._count._all ?? 0,
      pendingModeration: jobsByStatus.find((row) => row.status === 'PENDING_MODERATION')?._count._all ?? 0,
      applications: applicationsByStatus.reduce((total, row) => total + row._count._all, 0),
      matches: matchAggregate._count._all,
      averageMatchScore: matchAggregate._avg.score ?? 0,
      skills: skillCount,
      evidencedSkills,
      inferredSkills,
      visibleProfiles: profiles,
    },
    byRole: usersByRole.map((row) => ({ role: row.role, count: row._count._all })),
    byVerification: orgsByVerification.map((row) => ({ status: row.verificationStatus, count: row._count._all })),
    byJobStatus: jobsByStatus.map((row) => ({ status: row.status, count: row._count._all })),
    byApplicationStatus: applicationsByStatus.map((row) => ({ status: row.status, count: row._count._all })),
    signupSeries: toSeries(recentSignups),
    applicationSeries: toSeries(recentApplications),
    breakBands: bandSummary,
  }
}

/**
 * Fairness monitoring over stored matches. Reads the scores the matching engine
 * actually wrote and tests them against the skills-first claim. Career-break and
 * caregiving attributes are only measured for candidates who separately granted
 * research consent; consent history is append-only, so the newest decision wins.
 */
export async function fairnessReport(principal: Principal) {
  assertPermission(principal, 'admin.fairness.read')

  const consentRecords = await prisma.consentRecord.findMany({
    where: { type: 'RESEARCH_CONTRIBUTION', policyVersion: policyVersion() },
    orderBy: { decidedAt: 'asc' },
    select: { userId: true, decision: true },
  })
  const consentByUser = new Map(consentRecords.map((record) => [record.userId, record.decision === 'GRANTED']))
  const optedIn = await prisma.candidateProfile.findMany({
    where: { user: { id: { in: [...consentByUser.keys()] } } },
    select: { id: true, userId: true },
  })
  const optedInProfileIds = optedIn
    .filter((profile) => consentByUser.get(profile.userId))
    .map((profile) => profile.id)

  const [matches, allScoredProfileIds] = await Promise.all([
    prisma.match.findMany({
      where: { status: 'COMPUTED', candidateProfileId: { in: optedInProfileIds } },
      orderBy: { computedAt: 'desc' },
      take: 3000,
      select: {
        score: true,
        jobId: true,
        candidateProfileId: true,
        candidateProfile: {
          select: {
            careerBreakMonths: true,
            experiences: { where: { isCaregiving: true }, select: { id: true }, take: 1 },
          },
        },
      },
    }),
    prisma.match.findMany({ where: { status: 'COMPUTED' }, distinct: ['candidateProfileId'], select: { candidateProfileId: true } }),
  ])

  const samples: FairnessSample[] = matches.map((match) => ({
    score: match.score,
    jobId: match.jobId,
    candidateProfileId: match.candidateProfileId,
    careerBreakMonths: match.candidateProfile.careerBreakMonths,
    hasCaregivingExperience: match.candidateProfile.experiences.length > 0,
  }))

  const audit = auditFairness(samples)

  const [totalViews, identityRevealCount] = await Promise.all([
    prisma.profileView.count(),
    prisma.profileView.count({ where: { revealedIdentity: true } }),
  ])

  return {
    audit,
    governance: {
      optedInProfileCount: optedInProfileIds.length,
      scoredProfileCount: allScoredProfileIds.length,
      policyVersion: policyVersion(),
    },
    disclosure: {
      totalViews,
      identityRevealedViews: identityRevealCount,
      rate: totalViews > 0 ? identityRevealCount / totalViews : null,
      note: 'Identity is only revealed after the candidate applies to a role in that organisation.',
    },
  }
}
