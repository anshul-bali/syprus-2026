import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { label } from '@/lib/options'

/**
 * Anonymisation filter for employer-facing views.
 *
 * Employers review capability, not chronology. This module is the only path by
 * which an employer reads a candidate record, and it removes names, contact
 * details, organisation names, calendar dates and career-break length. Identity
 * becomes available only through the candidate's own act: submitting an
 * application, or approving that organisation's disclosure request.
 */

type ProfileWithDetails = Prisma.CandidateProfileGetPayload<{
  include: {
    user: { select: { name: true; email: true } }
    skills: { include: { skill: true } }
    experiences: true
  }
}>

export type AnonymizedSkill = {
  slug: string
  name: string
  category: string
  level: string
  confidence: number
  validationStatus: string
  evidenceCount: number
  transferable: boolean
}

export type AnonymizedExperience = {
  id: string
  type: string
  typeLabel: string
  title: string
  organizationLabel: string
  durationLabel: string
  description: string | null
  isCaregiving: boolean
}

export type AnonymizedProfile = {
  candidateProfileId: string
  anonymousHandle: string
  headline: string | null
  summary: string | null
  locationRegion: string | null
  workPreferenceLabel: string
  availabilityHours: number | null
  targetRole: string | null
  targetIndustry: string | null
  yearsOfExperience: number
  educationSummary: string | null
  skills: AnonymizedSkill[]
  experiences: AnonymizedExperience[]
  identityRevealed: boolean
  realName: string | null
  email: string | null
  redactions: string[]
}

function durationLabel(start: Date | null, end: Date | null, ongoing: boolean, hoursPerWeek: number | null) {
  const effectiveEnd = ongoing ? new Date() : end
  let years: number | null = null
  if (start && effectiveEnd) {
    const months = Math.max(0, (effectiveEnd.getTime() - start.getTime()) / (1000 * 60 * 60 * 24 * 30.44))
    years = months / 12
  }
  const length =
    years == null
      ? 'Duration not recorded'
      : years < 1
        ? `${Math.max(1, Math.round(years * 12))} months`
        : `${Math.max(1, Math.round(years))} years`
  const commitment = hoursPerWeek ? `, ~${hoursPerWeek} hrs/week` : ''
  const status = ongoing ? ' (current)' : ''
  return `${length}${commitment}${status}`
}

function region(city: string | null, country: string | null) {
  if (city && country) return `${city}, ${country}`
  return country ?? city ?? 'Location not shared'
}

/**
 * Maps organisation text to a neutral label so company names cannot leak while
 * the nature of the work stays understandable.
 */
function organizationLabel(value: string | null, type: string, index: number) {
  if (!value?.trim()) return type === 'CAREGIVING' ? 'Household and care' : 'Not specified'
  if (type === 'CAREGIVING') return 'Household and care'
  if (type === 'VOLUNTEERING' || type === 'COMMUNITY_LEADERSHIP') return 'Community organisation'
  return `Employer ${index + 1}`
}

/**
 * Identity is available in exactly two situations, and both are the candidate's
 * own act: they applied to a role in this organisation, or they approved that
 * organisation's disclosure request. Everything else stays anonymous.
 */
export async function canRevealIdentity(candidateProfileId: string, organizationId: string) {
  const application = await prisma.application.findFirst({
    where: {
      candidateProfileId,
      organizationId,
      status: { not: 'WITHDRAWN' },
      identityConsentAt: { not: null },
    },
    select: { id: true },
  })
  if (application) return true

  const consent = await prisma.identityDisclosureRequest.findFirst({
    where: { candidateProfileId, organizationId, status: 'APPROVED', OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
    select: { id: true },
  })
  return Boolean(consent)
}

export async function toAnonymizedProfile(
  profile: ProfileWithDetails,
  options: { organizationId?: string; revealIdentity?: boolean } = {},
): Promise<AnonymizedProfile> {
  const revealIdentity =
    options.revealIdentity ??
    (options.organizationId ? await canRevealIdentity(profile.id, options.organizationId) : false)

  const redactions: string[] = [
    'Name, email and profile links are hidden while sharing is anonymous.',
    'Employer names are replaced with neutral labels.',
    'Calendar dates are replaced with durations, so a break in service is not visible.',
    'Career-break length and reason are never included in an employer view.',
  ]
  if (!revealIdentity) {
    redactions.push(
      'Experience descriptions stay hidden until the candidate applies to a role here or approves a disclosure request.',
    )
  } else {
    redactions.push('Identity was disclosed by the candidate, and this view is logged.')
  }

  const experiences: AnonymizedExperience[] = profile.experiences
    .sort((a, b) => {
      if (a.startDate && b.startDate) return b.startDate.getTime() - a.startDate.getTime()
      if (a.startDate) return -1
      if (b.startDate) return 1
      return 0
    })
    .map((experience, index) => ({
      id: experience.id,
      type: revealIdentity ? experience.type : 'GENERAL',
      typeLabel: revealIdentity ? label(experience.type) : 'Experience',
      title: revealIdentity ? experience.title : `Experience ${index + 1}`,
      organizationLabel: revealIdentity ? organizationLabel(experience.organization, experience.type, index) : 'Not disclosed',
      durationLabel: durationLabel(
        experience.startDate,
        experience.endDate,
        experience.ongoing,
        experience.hoursPerWeek,
      ),
      description: revealIdentity ? experience.description : null,
      isCaregiving: revealIdentity && experience.isCaregiving,
    }))

  return {
    candidateProfileId: profile.id,
    anonymousHandle: profile.anonymousHandle,
    headline: revealIdentity ? profile.headline : null,
    summary: revealIdentity ? profile.summary : null,
    locationRegion: revealIdentity ? region(profile.locationCity, profile.locationCountry) : null,
    workPreferenceLabel: label(profile.workPreference),
    availabilityHours: profile.availabilityHours,
    targetRole: revealIdentity ? profile.targetRole : null,
    targetIndustry: revealIdentity ? profile.targetIndustry : null,
    yearsOfExperience: profile.yearsOfExperience,
    educationSummary: revealIdentity ? profile.educationSummary : null,
    skills: profile.skills
      .map((entry) => ({
        slug: entry.skill.slug,
        name: entry.skill.name,
        category: entry.skill.category,
        level: entry.level,
        confidence: entry.confidence,
        validationStatus: entry.validationStatus,
        evidenceCount: entry.evidenceCount,
        transferable: entry.skill.transferable,
      }))
      .sort((a, b) => b.confidence - a.confidence),
    experiences,
    identityRevealed: revealIdentity,
    realName: revealIdentity ? profile.user.name : null,
    email: revealIdentity ? profile.user.email : null,
    redactions,
  }
}

/** Loads a candidate record for employer review, applying the anonymous filter. */
export async function anonymizedProfileForEmployer(candidateProfileId: string, organizationId: string) {
  const profile = await prisma.candidateProfile.findUnique({
    where: { id: candidateProfileId },
    include: {
      user: { select: { name: true, email: true } },
      skills: { include: { skill: true } },
      experiences: true,
    },
  })
  if (!profile) return null
  if (!profile.visibleToEmployers) return null
  if (profile.sharingMode === 'NOT_VISIBLE') return null
  return toAnonymizedProfile(profile, { organizationId })
}
