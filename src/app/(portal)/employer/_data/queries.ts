import { prisma } from '@/lib/db'
import { EMPLOYER_TRANSITIONS } from '@/server/applications'
import { APPLICATION_STATUSES, label as enumLabel, type ApplicationStatus } from '@/lib/options'
import type { JobFormValues } from '@/components/employer/job-form'

/**
 * Read helpers the employer screens need on top of the foundation services.
 * Each one is tenancy-scoped by `organizationId`, and none of them reads a
 * candidate's `user` relation — candidate data reaches an employer only through
 * `src/server/anonymize.ts`.
 */

export type ProfileViewRow = {
  id: string
  createdAt: Date
  scoreSeen: number | null
  revealedIdentity: boolean
  jobId: string | null
  anonymousHandle: string
  headline: string | null
}

export async function recentProfileViews(organizationId: string, take = 8): Promise<ProfileViewRow[]> {
  const rows = await prisma.profileView.findMany({
    where: { organizationId },
    orderBy: { createdAt: 'desc' },
    take,
    select: {
      id: true,
      createdAt: true,
      scoreSeen: true,
      revealedIdentity: true,
      jobId: true,
      candidateProfile: { select: { anonymousHandle: true, headline: true } },
    },
  })

  return rows.map((row) => ({
    id: row.id,
    createdAt: row.createdAt,
    scoreSeen: row.scoreSeen,
    revealedIdentity: row.revealedIdentity,
    jobId: row.jobId,
    anonymousHandle: row.candidateProfile.anonymousHandle,
    headline: row.revealedIdentity ? row.candidateProfile.headline : null,
  }))
}

/**
 * Legal next pipeline stages for an employer, narrowed by the permissions the
 * account actually holds, so no screen offers a button the service would reject.
 */
export function nextStagesFor(status: string, permissions: string[]) {
  const allowed: string[] = EMPLOYER_TRANSITIONS[status as ApplicationStatus] ?? []
  return allowed
    .filter(
      (next) =>
        next !== 'INTERVIEW_INVITED' || permissions.includes('employer.invitation.send'),
    )
    .map((next) => ({ value: next, label: enumLabel(next) }))
}

export const APPLICATION_STATUS_OPTIONS = APPLICATION_STATUSES.map((value) => ({
  value,
  label: enumLabel(value),
}))

/** Applications of this organisation keyed by candidate profile — used for the shortlist identity flags. */
export async function organizationApplicationsForProfiles(organizationId: string, candidateProfileIds: string[]) {
  if (candidateProfileIds.length === 0) return []
  return prisma.application.findMany({
    where: { organizationId, candidateProfileId: { in: candidateProfileIds }, identityConsentAt: { not: null } },
    select: { id: true, candidateProfileId: true, status: true, jobId: true, updatedAt: true },
    orderBy: { updatedAt: 'desc' },
  })
}

export async function shortlistedProfileIds(organizationId: string) {
  const rows = await prisma.shortlistEntry.findMany({
    where: { job: { organizationId } },
    select: { candidateProfileId: true },
    distinct: ['candidateProfileId'],
  })
  return new Set(rows.map((row) => row.candidateProfileId))
}

/** The verifier behind an organisation decision, which `getOrganization` does not include. */
export async function organizationVerifier(organizationId: string) {
  const organization = await prisma.organization.findFirst({
    where: { id: organizationId },
    select: { verifiedById: true, verifier: { select: { name: true, email: true } } },
  })
  if (!organization?.verifiedById) return null
  return organization.verifier
}

export async function profileViewCount(organizationId: string) {
  return prisma.profileView.count({ where: { organizationId } })
}

/**
 * Pipeline history, kept separate from the current-stage counts the overview
 * also shows. Two different questions: what is at a stage right now, and how
 * many applications have ever passed through it. The second only exists once
 * status events have been recorded, which is why it is never presented as a
 * conversion rate when the first event is missing.
 */
export type StageHistory = {
  windowDays: number
  windowStart: Date
  movedByStage: { status: ApplicationStatus; count: number }[]
  everReached: { status: ApplicationStatus; applications: number }[]
  totalEvents: number
  firstEventAt: Date | null
}

export async function stageHistory(
  organizationId: string,
  jobId: string | null,
  windowDays = 30,
): Promise<StageHistory> {
  const scope = { application: { organizationId, ...(jobId ? { jobId } : {}) } } as const
  const windowStart = new Date(Date.now() - windowDays * 86_400_000)

  const [moved, reached, oldest] = await Promise.all([
    prisma.applicationStatusEvent.groupBy({
      by: ['toStatus'],
      where: { ...scope, createdAt: { gte: windowStart } },
      _count: { _all: true },
    }),
    prisma.applicationStatusEvent.findMany({
      where: scope,
      select: { toStatus: true, applicationId: true },
      distinct: ['toStatus', 'applicationId'],
    }),
    prisma.applicationStatusEvent.findFirst({
      where: scope,
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    }),
  ])

  const movedMap = new Map(moved.map((row) => [row.toStatus, row._count._all]))
  const reachedMap = new Map<ApplicationStatus, number>()
  for (const row of reached) {
    reachedMap.set(row.toStatus, (reachedMap.get(row.toStatus) ?? 0) + 1)
  }

  return {
    windowDays,
    windowStart,
    movedByStage: APPLICATION_STATUSES.map((status) => ({ status, count: movedMap.get(status) ?? 0 })).filter(
      (row) => row.count > 0,
    ),
    everReached: APPLICATION_STATUSES.map((status) => ({ status, applications: reachedMap.get(status) ?? 0 })).filter(
      (row) => row.applications > 0,
    ),
    totalEvents: moved.reduce((total, row) => total + row._count._all, 0),
    firstEventAt: oldest?.createdAt ?? null,
  }
}

/** Shortlist sizes per role, tenancy-scoped. Comparison detail stays on the shortlist screen. */
export async function shortlistCounts(organizationId: string, jobId: string | null) {
  const rows = await prisma.shortlistEntry.findMany({
    where: { job: { organizationId }, ...(jobId ? { jobId } : {}) },
    select: { jobId: true, shortlistId: true },
  })
  const byJob = new Map<string, { entries: number; lists: Set<string> }>()
  for (const row of rows) {
    const bucket = byJob.get(row.jobId) ?? { entries: 0, lists: new Set<string>() }
    bucket.entries += 1
    bucket.lists.add(row.shortlistId)
    byJob.set(row.jobId, bucket)
  }
  return byJob
}

// ---------------------------------------------------------------------------
// Search params
// ---------------------------------------------------------------------------

export type ParamValue = string | string[] | undefined

export function readParam(value: ParamValue) {
  const raw = Array.isArray(value) ? value[0] : value
  return raw && raw.trim() ? raw.trim() : undefined
}

/** Thresholds arrive as whole percentages; the engine stores 0–1 scores. */
export function readScoreFloor(value: ParamValue) {
  const raw = readParam(value)
  if (!raw) return null
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) return null
  return Math.min(1, Math.max(0, parsed / 100))
}

export function readStatusFilter(value: ParamValue): ApplicationStatus | undefined {
  const raw = readParam(value)
  return APPLICATION_STATUSES.find((status) => status === raw)
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

/**
 * Seeded records carry a `(demonstration)` marker in their name — the only signal
 * the schema gives us, since organisations and roles have no demo column.
 */
export function isDemonstrationName(name: string | null | undefined) {
  return /\(demonstration\)/i.test(name ?? '')
}

function toDateInputValue(value: Date | null) {
  if (!value) return ''
  return value.toISOString().slice(0, 10)
}

function toText(value: string | null | undefined) {
  return value ?? ''
}

export function jobToFormValues(job: {
  title: string
  description: string
  responsibilities: string[]
  requirementsText: string | null
  locationCity: string | null
  locationCountry: string | null
  workMode: string
  employmentType: string
  salaryMin: number | null
  salaryMax: number | null
  experienceYearsMin: number | null
  experienceYearsMax: number | null
  reEntryFriendly: boolean
  flexibleHours: boolean
  returnshipProgram: boolean
  closesAt: Date | null
  skills: { level: string; weight: number; requirement: string; skill: { slug: string; name: string } }[]
}): JobFormValues {
  return {
    title: job.title,
    description: job.description,
    responsibilities: job.responsibilities.join('\n'),
    requirementsText: toText(job.requirementsText),
    locationCity: toText(job.locationCity),
    locationCountry: toText(job.locationCountry),
    workMode: job.workMode as JobFormValues['workMode'],
    employmentType: job.employmentType as JobFormValues['employmentType'],
    salaryMin: job.salaryMin == null ? '' : String(job.salaryMin),
    salaryMax: job.salaryMax == null ? '' : String(job.salaryMax),
    experienceYearsMin: job.experienceYearsMin == null ? '' : String(job.experienceYearsMin),
    experienceYearsMax: job.experienceYearsMax == null ? '' : String(job.experienceYearsMax),
    reEntryFriendly: job.reEntryFriendly,
    flexibleHours: job.flexibleHours,
    returnshipProgram: job.returnshipProgram,
    closesAt: toDateInputValue(job.closesAt),
    skills: job.skills.map((row) => ({
      skillSlug: row.skill.slug,
      skillName: row.skill.name,
      level: row.level as JobFormValues['skills'][number]['level'],
      weight: row.weight,
      requirement: row.requirement as JobFormValues['skills'][number]['requirement'],
    })),
  }
}
