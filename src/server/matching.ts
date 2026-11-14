import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { scoreMatch } from '@/lib/engines/matching'
import { matchModelVersion } from '@/lib/env'
import { AccessDeniedError, assertPermission, type Principal } from '@/lib/authz'
import { runEngine } from '@/server/engine-log'
import { activeWeights } from '@/server/weights'
import { json } from '@/server/fields'
import { candidateSkillViews, jobSkillViews } from '@/server/skill-catalog'
import { toAnonymizedProfile, canRevealIdentity, type AnonymizedProfile } from '@/server/anonymize'
import { recordAudit } from '@/server/audit'
import { readExplanation } from '@/lib/match-view'

/**
 * Matching service: turns the explainable scorer into persisted rows, and reads
 * those rows back for the candidate and employer screens.
 */

export async function computeMatchesForProfile(candidateProfileId: string) {
  return runEngine('MATCHING', async () => {
    const profile = await prisma.candidateProfile.findUnique({
      where: { id: candidateProfileId },
      include: { user: { select: { id: true } } },
    })
    if (!profile) throw new AccessDeniedError('Candidate profile not found.')

    const skills = await candidateSkillViews(candidateProfileId)
    if (skills.length === 0) {
      const cleared = await prisma.match.deleteMany({ where: { candidateProfileId } })
      return {
        result: { processed: 0, written: 0, cleared: cleared.count },
        itemsProcessed: 0,
        itemsAffected: 0,
        inputSummary: { reason: 'No skills on the profile yet.' },
      }
    }

    const jobs = await prisma.job.findMany({
      where: { status: 'PUBLISHED', organization: { verificationStatus: 'VERIFIED' }, OR: [{ closesAt: null }, { closesAt: { gt: new Date() } }] },
      select: {
        id: true,
        experienceYearsMin: true,
        experienceYearsMax: true,
        workMode: true,
        employmentType: true,
        locationCity: true,
        skills: { include: { skill: true } },
      },
    })

    const { weights, version: weightsVersion } = await activeWeights()

    let written = 0
    for (const job of jobs) {
      const jobSkills = job.skills.map((row) => ({
        slug: row.skill.slug,
        name: row.skill.name,
        level: row.level,
        weight: row.weight,
        requirement: row.requirement,
      }))
      if (jobSkills.length === 0) continue

      const scored = scoreMatch({
        candidateSkills: skills,
        jobSkills,
        yearsOfExperience: profile.yearsOfExperience,
        experienceYearsMin: job.experienceYearsMin,
        experienceYearsMax: job.experienceYearsMax,
        preferences: {
          workMode: profile.workPreference,
          availabilityHours: profile.availabilityHours,
          locationCity: profile.locationCity,
        },
        jobPreferences: {
          workMode: job.workMode,
          employmentType: job.employmentType,
          locationCity: job.locationCity,
        },
        weights,
        weightsVersion,
        modelVersion: matchModelVersion(),
      })

      await prisma.match.upsert({
        where: { candidateProfileId_jobId: { candidateProfileId, jobId: job.id } },
        create: {
          candidateProfileId,
          jobId: job.id,
          score: scored.score,
          requiredScore: scored.requiredScore,
          preferredScore: scored.preferredScore,
          preferenceScore: scored.preferenceScore,
          evidenceScore: scored.evidenceScore,
          explanation: json(scored.explanation),
          modelVersion: matchModelVersion(),
          weightVersion: weightsVersion,
          status: 'COMPUTED',
          computedAt: new Date(),
        },
        update: {
          score: scored.score,
          requiredScore: scored.requiredScore,
          preferredScore: scored.preferredScore,
          preferenceScore: scored.preferenceScore,
          evidenceScore: scored.evidenceScore,
          explanation: json(scored.explanation),
          modelVersion: matchModelVersion(),
          weightVersion: weightsVersion,
          status: 'COMPUTED',
          computedAt: new Date(),
        },
      })
      written += 1
    }

    // Roles that are no longer published stop being recommended.
    const cleared = await prisma.match.deleteMany({
      where: {
        candidateProfileId,
        jobId: { notIn: jobs.filter((job) => job.skills.length > 0).map((job) => job.id) },
      },
    })

    return {
      result: { processed: jobs.length, written, cleared: cleared.count },
      itemsProcessed: jobs.length,
      itemsAffected: written,
      inputSummary: { candidateProfileId, jobSkillsEvaluated: jobs.map((job) => job.id) },
    }
  })
}

export async function recomputeAllMatches() {
  const profiles = await prisma.candidateProfile.findMany({
    where: { skills: { some: {} } },
    select: { id: true },
  })
  let processed = 0
  for (const profile of profiles) {
    await computeMatchesForProfile(profile.id)
    processed += 1
  }
  return processed
}

/** Candidate-facing recommended roles. */
export async function recommendedJobs(principal: Principal, options: { limit?: number; minScore?: number; search?: string } = {}) {
  assertPermission(principal, 'candidate.match.read')
  const profileId = principal.candidateProfileId
  if (!profileId) throw new AccessDeniedError('No candidate profile attached to this account.')

  const matches = await prisma.match.findMany({
    where: {
      candidateProfileId: profileId,
      job: { status: 'PUBLISHED', organization: { verificationStatus: 'VERIFIED' }, OR: [{ closesAt: null }, { closesAt: { gt: new Date() } }],
        ...(options.search ? { AND: [{ OR: [{ title: { contains: options.search, mode: 'insensitive' } }, { organization: { name: { contains: options.search, mode: 'insensitive' } } }, { locationCity: { contains: options.search, mode: 'insensitive' } }] }] } : {}) },
      status: 'COMPUTED',
      ...(options.minScore ? { score: { gte: options.minScore } } : {}),
    },
    orderBy: { score: 'desc' },
    take: options.limit ?? 8,
    include: {
      job: {
        include: {
          organization: { select: { id: true, name: true, verificationStatus: true, locationCity: true } },
          skills: { include: { skill: { select: { slug: true, name: true } } } },
        },
      },
    },
  })

  const jobIds = matches.map((match) => match.job.id)
  const applications = jobIds.length
    ? await prisma.application.findMany({
        where: { candidateProfileId: profileId, jobId: { in: jobIds } },
        select: { jobId: true, status: true, id: true },
      })
    : []
  const applicationByJob = new Map(applications.map((application) => [application.jobId, application]))

  return matches.map((match) => ({
    matchId: match.id,
    score: match.score,
    requiredScore: match.requiredScore,
    preferredScore: match.preferredScore,
    preferenceScore: match.preferenceScore,
    evidenceScore: match.evidenceScore,
    computedAt: match.computedAt,
    explanation: match.explanation,
    job: match.job,
    application: applicationByJob.get(match.job.id) ?? null,
  }))
}

export async function matchForCandidateAndJob(principal: Principal, jobId: string) {
  assertPermission(principal, 'candidate.match.read')
  if (!principal.candidateProfileId) throw new AccessDeniedError('No candidate profile attached to this account.')
  return prisma.match.findUnique({
    where: { candidateProfileId_jobId: { candidateProfileId: principal.candidateProfileId, jobId } },
    include: { job: { include: { organization: { select: { name: true } }, skills: { include: { skill: true } } } } },
  })
}

/**
 * Employer-facing candidate list for a role. Only profiles the candidate has
 * made visible appear, and each is passed through the anonymisation filter.
 */
function anonymousExplanation(raw: unknown) {
  const explanation = readExplanation(raw)
  if (!explanation) return null
  return { ...explanation, preferenceChecks: explanation.preferenceChecks.map((check) => check.label === 'Location'
    ? { ...check, note: 'Location comparison recorded; location text is withheld in anonymous review.' } : check) }
}

export async function candidatesForJob(
  principal: Principal,
  jobId: string,
  options: { minScore?: number | null; take?: number } = {},
) {
  assertPermission(principal, 'employer.candidate.anonymous.read')
  if (!principal.organizationId) throw new AccessDeniedError('No organisation attached to this account.')

  const job = await prisma.job.findFirst({
    where: { id: jobId, organizationId: principal.organizationId },
    include: { skills: { include: { skill: true } } },
  })
  if (!job) throw new AccessDeniedError('This role belongs to another organisation.')

  const matches = await prisma.match.findMany({
    where: {
      jobId,
      status: 'COMPUTED',
      ...(options.minScore ? { score: { gte: options.minScore } } : {}),
      candidateProfile: { visibleToEmployers: true, sharingMode: { not: 'NOT_VISIBLE' } },
    },
    orderBy: { score: 'desc' },
    take: options.take ?? 40,
    include: {
      candidateProfile: {
        include: {
          user: { select: { name: true, email: true } },
          skills: { include: { skill: true } },
          experiences: true,
        },
      },
    },
  })

  const applications = await prisma.application.findMany({ where: { jobId, candidateProfileId: { in: matches.map((match) => match.candidateProfileId) }, status: { not: 'WITHDRAWN' } }, select: { candidateProfileId: true } })
  const applicants = new Set(applications.map((application) => application.candidateProfileId))
  const revealed = new Map<string, boolean>()
  for (const match of matches) {
    revealed.set(
      match.candidateProfileId,
      await canRevealIdentity(match.candidateProfileId, principal.organizationId!),
    )
  }

  const profiles: AnonymizedProfile[] = []
  for (const match of matches) {
    profiles.push(
      await toAnonymizedProfile(match.candidateProfile, {
        revealIdentity: revealed.get(match.candidateProfileId) ?? false,
      }),
    )
  }

  await prisma.profileView.createMany({
    data: matches.map((match) => ({
      candidateProfileId: match.candidateProfileId,
      organizationId: principal.organizationId!,
      viewerUserId: principal.userId,
      jobId,
      scoreSeen: match.score,
      revealedIdentity: revealed.get(match.candidateProfileId) ?? false,
    })),
  })

  await recordAudit({
    actor: principal,
    action: 'employer.candidate.list_anonymous',
    entityType: 'jobs',
    entityId: jobId,
    organizationId: principal.organizationId,
    metadata: { returned: matches.length, minScore: options.minScore ?? null },
  })

  return matches.map((match, index) => ({
    matchId: match.id,
    score: match.score,
    requiredScore: match.requiredScore,
    preferredScore: match.preferredScore,
    preferenceScore: match.preferenceScore,
    evidenceScore: match.evidenceScore,
    explanation: profiles[index].identityRevealed ? match.explanation : anonymousExplanation(match.explanation),
    profile: profiles[index],
    applied: applicants.has(match.candidateProfileId),
  }))
}

export async function jobSkillSummary(jobId: string) {
  const rows = await prisma.jobSkill.findMany({ where: { jobId }, include: { skill: true } })
  return rows.map((row) => ({
    slug: row.skill.slug,
    name: row.skill.name,
    level: row.level,
    weight: row.weight,
    requirement: row.requirement,
  }))
}

export { jobSkillViews }
export type MatchedJob = Prisma.MatchGetPayload<{ include: { job: true } }>
