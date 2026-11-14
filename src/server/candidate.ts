import type { ExperienceType, Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { anonymousHandle } from '@/lib/utils'
import { policyVersion } from '@/lib/env'
import { AccessDeniedError, assertPermission, type Principal } from '@/lib/authz'
import type { InferenceContext } from '@/lib/engines/inference'
import { inferAndPersistSkills, inferenceInputFrom, pruneOrphanedInferences } from '@/server/inference'
import { recordAudit } from '@/server/audit'
import { nullableDate, nullableNumber, nullableString } from '@/server/fields'
import { hasConsent } from '@/server/skill-catalog'
import { computeMatchesForProfile } from '@/server/matching'
import type {
  candidateProfileSchema,
  candidateSkillSchema,
  consentToggleSchema,
  experienceSchema,
  skillEvidenceSchema,
} from '@/lib/validation'
import { z } from 'zod'

type ProfileDto = z.infer<typeof candidateProfileSchema>
type ExperienceDto = z.infer<typeof experienceSchema>
type SkillDto = z.infer<typeof candidateSkillSchema>
type EvidenceDto = z.infer<typeof skillEvidenceSchema>
type ConsentDto = z.infer<typeof consentToggleSchema>

const CONTEXT_BY_EXPERIENCE: Record<ExperienceType, InferenceContext> = {
  PAID_EMPLOYMENT: 'WORK',
  FREELANCE: 'WORK',
  INTERNSHIP: 'WORK',
  VOLUNTEERING: 'VOLUNTEER',
  ENTREPRENEURSHIP: 'WORK',
  CAREGIVING: 'CAREGIVING',
  COMMUNITY_LEADERSHIP: 'VOLUNTEER',
  EDUCATION: 'LEARNING',
  UP_SKILLING: 'LEARNING',
}

/** Creates the candidate record on first sign-in. Idempotent. */
export async function ensureCandidateProfile(userId: string) {
  const existing = await prisma.candidateProfile.findUnique({ where: { userId } })
  if (existing) return existing

  try {
    return await prisma.candidateProfile.create({
      data: { userId, anonymousHandle: anonymousHandle(userId) },
    })
  } catch {
    // Handle collision on the unique anonymous handle.
    return prisma.candidateProfile.create({
      data: { userId, anonymousHandle: anonymousHandle(`${userId}-${Date.now()}`) },
    })
  }
}

export async function requireOwnProfile(principal: Principal) {
  assertPermission(principal, 'candidate.profile.read')
  if (!principal.candidateProfileId) {
    throw new AccessDeniedError('No candidate profile is attached to this account yet.')
  }
  return principal.candidateProfileId
}

export async function updateProfile(principal: Principal, dto: ProfileDto) {
  const profileId = await requireOwnProfile(principal)
  assertPermission(principal, 'candidate.profile.update')
  if (dto.visibleToEmployers && !(await hasConsent(principal.userId, 'ANONYMIZED_PROFILE_SHARING'))) {
    throw new AccessDeniedError('Enable anonymised profile sharing in Privacy controls before making your profile visible to employers.')
  }

  const updated = await prisma.candidateProfile.update({
    where: { id: profileId },
    data: {
      headline: nullableString(dto.headline),
      summary: nullableString(dto.summary),
      locationCity: nullableString(dto.locationCity),
      locationCountry: nullableString(dto.locationCountry),
      workPreference: dto.workPreference,
      availabilityHours: nullableNumber(dto.availabilityHours),
      targetRole: nullableString(dto.targetRole),
      targetIndustry: nullableString(dto.targetIndustry),
      careerBreakMonths: nullableNumber(dto.careerBreakMonths),
      breakReason: nullableString(dto.breakReason),
      returnTimeline: nullableString(dto.returnTimeline),
      yearsOfExperience: dto.yearsOfExperience ?? 0,
      educationSummary: nullableString(dto.educationSummary),
      sharingMode: dto.sharingMode,
      visibleToEmployers: dto.visibleToEmployers,
    },
  })

  await computeMatchesForProfile(profileId)

  await recordAudit({
    actor: principal,
    action: 'candidate.profile.update',
    entityType: 'candidate_profiles',
    entityId: profileId,
    metadata: { visibleToEmployers: dto.visibleToEmployers, sharingMode: dto.sharingMode },
  })

  return updated
}

export async function addExperience(principal: Principal, dto: ExperienceDto) {
  const profileId = await requireOwnProfile(principal)
  assertPermission(principal, 'candidate.experience.manage')

  const experience = await prisma.experience.create({
    data: {
      candidateProfileId: profileId,
      type: dto.type,
      title: dto.title.trim(),
      organization: nullableString(dto.organization),
      description: dto.description.trim(),
      achievements: nullableString(dto.achievements),
      startDate: nullableDate(dto.startDate),
      endDate: nullableDate(dto.endDate),
      ongoing: dto.ongoing,
      hoursPerWeek: nullableNumber(dto.hoursPerWeek),
      isCaregiving: dto.isCaregiving || dto.type === 'CAREGIVING',
    },
  })

  const years = yearsBetween(dto.startDate ?? null, dto.endDate ?? null, dto.ongoing)
  const inference = await inferAndPersistSkills(
    { id: profileId, userId: principal.userId },
    [inferenceInputFrom(dto, CONTEXT_BY_EXPERIENCE[dto.type], experience.id, years)],
  )

  await recomputeYearsOfExperience(profileId)
  await recordAudit({
    actor: principal,
    action: 'candidate.experience.create',
    entityType: 'experiences',
    entityId: experience.id,
    metadata: { type: dto.type, inferredSkills: inference.applied.map((skill) => skill.slug) },
  })

  return { experience, inferred: inference.applied, inferenceSkipped: inference.skipped }
}

export async function removeExperience(principal: Principal, experienceId: string) {
  const profileId = await requireOwnProfile(principal)
  assertPermission(principal, 'candidate.experience.manage')

  const experience = await prisma.experience.findFirst({ where: { id: experienceId, candidateProfileId: profileId } })
  if (!experience) throw new AccessDeniedError('That experience entry is not on your profile.')

  await prisma.experience.delete({ where: { id: experienceId } })
  const pruned = await pruneOrphanedInferences(profileId)
  await recomputeYearsOfExperience(profileId)

  await recordAudit({
    actor: principal,
    action: 'candidate.experience.delete',
    entityType: 'experiences',
    entityId: experienceId,
    metadata: { prunedInferredSkills: pruned },
  })
  return { pruned }
}

export async function addSkill(principal: Principal, dto: SkillDto) {
  const profileId = await requireOwnProfile(principal)
  assertPermission(principal, 'candidate.skills.manage')

  if (!['SELF_REPORTED', 'RULE_INFERRED', 'DISPUTED'].includes(dto.validationStatus)) {
    throw new AccessDeniedError('Assessed and reviewed statuses cannot be self-declared.')
  }

  const skill = await prisma.skill.findUnique({ where: { slug: dto.skillSlug } })
  if (!skill) throw new AccessDeniedError(`Unknown skill "${dto.skillSlug}".`)

  const record = await prisma.candidateSkill.upsert({
    where: { candidateProfileId_skillId: { candidateProfileId: profileId, skillId: skill.id } },
    create: {
      candidateProfileId: profileId,
      skillId: skill.id,
      level: dto.level,
      // A self-declared skill starts at 0.6: stated, but not yet evidenced.
      confidence: dto.validationStatus === 'SELF_REPORTED' ? 0.6 : 0.5,
      validationStatus: dto.validationStatus,
      source: 'MANUAL',
      note: nullableString(dto.note),
    },
    update: {
      level: dto.level,
      validationStatus: dto.validationStatus === 'RULE_INFERRED' ? 'SELF_REPORTED' : dto.validationStatus,
      source: 'MANUAL',
      note: nullableString(dto.note),
    },
  })

  await recordAudit({
    actor: principal,
    action: 'candidate.skill.upsert',
    entityType: 'candidate_skills',
    entityId: record.id,
    metadata: { slug: skill.slug, level: dto.level },
  })
  await computeMatchesForProfile(profileId)
  return record
}

export async function removeSkill(principal: Principal, candidateSkillId: string) {
  const profileId = await requireOwnProfile(principal)
  assertPermission(principal, 'candidate.skills.manage')

  const owned = await prisma.candidateSkill.findFirst({ where: { id: candidateSkillId, candidateProfileId: profileId } })
  if (!owned) throw new AccessDeniedError('That skill is not on your profile.')

  await prisma.candidateSkill.delete({ where: { id: candidateSkillId } })
  await recordAudit({
    actor: principal,
    action: 'candidate.skill.delete',
    entityType: 'candidate_skills',
    entityId: candidateSkillId,
  })
  await computeMatchesForProfile(profileId)
}

export async function addEvidence(principal: Principal, dto: EvidenceDto) {
  const profileId = await requireOwnProfile(principal)
  assertPermission(principal, 'candidate.skills.manage')

  const skillRow = await prisma.candidateSkill.findFirst({
    where: { id: dto.candidateSkillId, candidateProfileId: profileId },
  })
  if (!skillRow) throw new AccessDeniedError('That skill is not on your profile.')

  const evidence = await prisma.skillEvidence.create({
    data: {
      candidateSkillId: skillRow.id,
      type: dto.type,
      description: dto.description.trim(),
      url: nullableString(dto.url),
    },
  })

  await refreshEvidenceCount(skillRow.id)
  // Documented proof raises confidence, but never claims external verification.
  await prisma.candidateSkill.update({
    where: { id: skillRow.id },
    data: { confidence: Math.min(0.95, skillRow.confidence + 0.08) },
  })

  await recordAudit({
    actor: principal,
    action: 'candidate.evidence.create',
    entityType: 'skill_evidence',
    entityId: evidence.id,
    metadata: { type: dto.type },
  })
  return evidence
}

export async function removeEvidence(principal: Principal, evidenceId: string) {
  const profileId = await requireOwnProfile(principal)
  assertPermission(principal, 'candidate.skills.manage')

  const evidence = await prisma.skillEvidence.findFirst({
    where: { id: evidenceId, candidateSkill: { candidateProfileId: profileId } },
  })
  if (!evidence) throw new AccessDeniedError('That evidence is not on your profile.')

  await prisma.skillEvidence.delete({ where: { id: evidenceId } })
  await refreshEvidenceCount(evidence.candidateSkillId)
  await recordAudit({
    actor: principal,
    action: 'candidate.evidence.delete',
    entityType: 'skill_evidence',
    entityId: evidenceId,
  })
}

/** Sets a single consent decision for the active policy version. */
export async function setConsent(principal: Principal, dto: ConsentDto) {
  assertPermission(principal, 'candidate.consent.manage')

  await prisma.$transaction(async (tx) => {
    await tx.consentRecord.create({ data: {
      userId: principal.userId, type: dto.type, decision: dto.granted ? 'GRANTED' : 'WITHDRAWN',
      policyVersion: policyVersion(), withdrawnAt: dto.granted ? null : new Date(),
    } })
    if (!dto.granted && ['ANONYMIZED_PROFILE_SHARING', 'IDENTIFIED_PROFILE_SHARING'].includes(dto.type)) {
      await tx.candidateProfile.updateMany({ where: { userId: principal.userId }, data: { visibleToEmployers: false, sharingMode: 'NOT_VISIBLE' } })
      await tx.identityDisclosureRequest.updateMany({ where: { candidateProfile: { userId: principal.userId }, status: { in: ['PENDING', 'APPROVED'] } },
        data: { status: 'WITHDRAWN', decidedById: principal.userId, decidedAt: new Date() } })
      await tx.application.updateMany({ where: { userId: principal.userId }, data: { identityConsentAt: null } })
    }
    if (!dto.granted && dto.type === 'RULE_BASED_INFERENCE') {
      await tx.candidateSkill.deleteMany({ where: { candidateProfile: { userId: principal.userId }, validationStatus: { in: ['RULE_INFERRED', 'AI_SUGGESTED'] } } })
      await tx.aiProposal.updateMany({ where: { candidateProfile: { userId: principal.userId }, status: 'PROPOSED' }, data: { status: 'REJECTED', decisionNote: 'Inference consent withdrawn.', decidedAt: new Date(), decidedById: principal.userId } })
    }
  })
  if (!dto.granted && dto.type === 'RULE_BASED_INFERENCE' && principal.candidateProfileId) {
    await computeMatchesForProfile(principal.candidateProfileId)
  }

  await recordAudit({
    actor: principal,
    action: `consent.${dto.type.toLowerCase()}.${dto.granted ? 'granted' : 'withdrawn'}`,
    entityType: 'consent_records',
    entityId: principal.userId,
    targetUserId: principal.userId,
    metadata: { policyVersion: policyVersion() },
    visibility: 'USER',
  })

  return { type: dto.type, granted: dto.granted }
}

/** Reads the effective consent map for the privacy screen. */
export async function consentMap(userId: string) {
  const records = await prisma.consentRecord.findMany({
    where: { userId, policyVersion: policyVersion(), scope: null },
    orderBy: { decidedAt: 'desc' },
  })
  const effective = new Map<string, { granted: boolean; decidedAt: Date; policyVersion: string }>()
  for (const record of records) {
    if (!effective.has(record.type)) {
      effective.set(record.type, {
        granted: record.decision === 'GRANTED',
        decidedAt: record.decidedAt,
        policyVersion: record.policyVersion,
      })
    }
  }
  return effective
}

export async function markOnboardingComplete(principal: Principal) {
  const profileId = await requireOwnProfile(principal)
  await prisma.candidateProfile.update({ where: { id: profileId }, data: { onboardingComplete: true } })
  await refreshProfileCompletion(profileId)
  await recordAudit({
    actor: principal,
    action: 'candidate.onboarding.complete',
    entityType: 'candidate_profiles',
    entityId: profileId,
  })
}

// ---------------------------------------------------------------------------
// Derived figures
// ---------------------------------------------------------------------------

export async function refreshEvidenceCount(candidateSkillId: string) {
  const count = await prisma.skillEvidence.count({ where: { candidateSkillId } }) +
    await prisma.evidenceUpload.count({ where: { candidateSkillId, status: 'ACCEPTED' } })
  await prisma.candidateSkill.update({ where: { id: candidateSkillId }, data: { evidenceCount: count } })
  return count
}

/** Total experience is summed from paid, freelance and business entries only. */
export async function recomputeYearsOfExperience(candidateProfileId: string) {
  const experiences = await prisma.experience.findMany({
    where: {
      candidateProfileId,
      type: { in: ['PAID_EMPLOYMENT', 'FREELANCE', 'INTERNSHIP', 'ENTREPRENEURSHIP'] },
    },
  })

  let totalYears = 0
  for (const experience of experiences) {
    const years = yearsBetween(experience.startDate, experience.endDate, experience.ongoing)
    const partTimeFactor = experience.hoursPerWeek ? Math.min(1, experience.hoursPerWeek / 40) : 1
    totalYears += years * partTimeFactor
  }

  await prisma.candidateProfile.update({
    where: { id: candidateProfileId },
    data: { yearsOfExperience: Math.round(totalYears * 10) / 10 },
  })
  return Math.round(totalYears * 10) / 10
}

function yearsBetween(start: Date | null, end: Date | null, ongoing: boolean) {
  if (!start) return 0
  const effectiveEnd = ongoing ? new Date() : end
  if (!effectiveEnd) return 0
  const months = Math.max(0, (effectiveEnd.getTime() - start.getTime()) / (1000 * 60 * 60 * 24 * 30.44))
  return months / 12
}

export type CompletionItem = { key: string; label: string; done: boolean; hint: string }

export function buildChecklist(input: {
  headline: boolean
  summary: boolean
  location: boolean
  targetRole: boolean
  experiences: number
  skills: number
  evidencedSkills: number
  consentGranted: boolean
  breakRecorded: boolean
}): { items: CompletionItem[]; percent: number } {
  const items: CompletionItem[] = [
    { key: 'headline', label: 'Add a headline', done: input.headline, hint: 'One line describing the kind of work you want next.' },
    { key: 'summary', label: 'Write your summary', done: input.summary, hint: 'A short paragraph in your own words.' },
    { key: 'location', label: 'Add your location', done: input.location, hint: 'Only city and country are ever shown to employers.' },
    { key: 'target', label: 'Name your target role', done: input.targetRole, hint: 'Powers job recommendations and gap reports.' },
    { key: 'experiences', label: 'Record at least one experience', done: input.experiences > 0, hint: 'Work, freelance, volunteering or caregiving all count.' },
    { key: 'break', label: 'Note your break period', done: input.breakRecorded, hint: 'Optional. Break length is never used in matching.' },
    { key: 'skills', label: 'Have five skills on file', done: input.skills >= 5, hint: 'Suggestions from your own wording can be accepted or removed.' },
    { key: 'evidence', label: 'Attach evidence to three skills', done: input.evidencedSkills >= 3, hint: 'Evidence is what raises a skill’s confidence.' },
    { key: 'consent', label: 'Choose your sharing consent', done: input.consentGranted, hint: 'Controls whether employers can see your anonymised profile.' },
  ]
  const done = items.filter((item) => item.done).length
  return { items, percent: Math.round((done / items.length) * 100) }
}

export async function refreshProfileCompletion(candidateProfileId: string) {
  const profile = await prisma.candidateProfile.findUnique({
    where: { id: candidateProfileId },
    include: {
      skills: { select: { evidenceCount: true } },
      experiences: { select: { id: true } },
    },
  })
  if (!profile) return null

  const consent = await consentMap(profile.userId)
  const checklist = buildChecklist({
    headline: Boolean(profile.headline),
    summary: Boolean(profile.summary),
    location: Boolean(profile.locationCity || profile.locationCountry),
    targetRole: Boolean(profile.targetRole),
    experiences: profile.experiences.length,
    skills: profile.skills.length,
    evidencedSkills: profile.skills.filter((skill) => skill.evidenceCount > 0).length,
    consentGranted: consent.get('ANONYMIZED_PROFILE_SHARING')?.granted ?? false,
    breakRecorded: profile.careerBreakMonths != null,
  })

  await prisma.candidateProfile.update({
    where: { id: candidateProfileId },
    data: { profileCompletion: checklist.percent },
  })
  return checklist
}

/** Dashboard read model: everything the candidate landing screen needs. */
export async function getCandidateOverview(userId: string) {
  const profile = await prisma.candidateProfile.findUnique({
    where: { userId },
    include: {
      skills: { include: { skill: true }, orderBy: { confidence: 'desc' } },
      experiences: { orderBy: { createdAt: 'desc' } },
      matches: {
        where: { status: 'COMPUTED' },
        orderBy: { score: 'desc' },
        take: 6,
        include: { job: { include: { organization: { select: { name: true, verificationStatus: true } } } } },
      },
      applications: {
        orderBy: { updatedAt: 'desc' },
        take: 6,
        include: { job: { select: { id: true, title: true, status: true } } },
      },
      learningPlans: {
        where: { status: 'ACTIVE' },
        orderBy: { priority: 'asc' },
        take: 2,
        include: { items: { include: { resource: true }, orderBy: { position: 'asc' } } },
      },
      gapReports: { orderBy: { createdAt: 'desc' }, take: 1 },
    },
  })

  if (!profile) return null

  const [applicationTotal, unreadNotifications, checklistInput] = await Promise.all([
    prisma.application.count({ where: { candidateProfileId: profile.id } }),
    prisma.notification.count({ where: { userId, readAt: null } }),
    prisma.candidateSkill.count({ where: { candidateProfileId: profile.id, evidenceCount: { gt: 0 } } }),
  ])

  const consent = await consentMap(userId)
  const checklist = buildChecklist({
    headline: Boolean(profile.headline),
    summary: Boolean(profile.summary),
    location: Boolean(profile.locationCity || profile.locationCountry),
    targetRole: Boolean(profile.targetRole),
    experiences: profile.experiences.length,
    skills: profile.skills.length,
    evidencedSkills: checklistInput,
    consentGranted: consent.get('ANONYMIZED_PROFILE_SHARING')?.granted ?? false,
    breakRecorded: profile.careerBreakMonths != null,
  })

  return { profile, applicationTotal, unreadNotifications, checklist, consent }
}

export type CandidateOverview = NonNullable<Awaited<ReturnType<typeof getCandidateOverview>>>

/** Ensures a query can only touch the requesting candidate's own rows. */
export function ownProfileWhere(principal: Principal): Prisma.CandidateProfileWhereInput {
  if (!principal.candidateProfileId) throw new AccessDeniedError('No candidate profile attached to this account.')
  return { id: principal.candidateProfileId, userId: principal.userId }
}
