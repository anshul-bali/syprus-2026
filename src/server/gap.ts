import type { SkillGapReport } from '@prisma/client'
import { prisma } from '@/lib/db'
import { analyseGaps, GAP_READINESS_WEIGHTS, type GapAnalysis } from '@/lib/engines/gap'
import { AccessDeniedError, assertPermission, type Principal } from '@/lib/authz'
import { runEngine } from '@/server/engine-log'
import { json } from '@/server/fields'
import { candidateSkillViews, jobSkillViews, jobSkillViewsForJobIds } from '@/server/skill-catalog'
import { recordAudit } from '@/server/audit'

/**
 * Skill gap reports. A report is either against one chosen role or, when no
 * role is chosen, against the union of skills across the roles the candidate is
 * already matched to — so a report is always meaningful.
 */

export type GapReport = {
  id: string
  candidateProfileId: string
  targetJobId: string | null
  targetJobTitle: string | null
  readiness: SkillGapReport['readiness']
  readinessScore: number
  createdAt: Date
  analysis: GapAnalysis
}

function toGapReport(
  stored: Pick<SkillGapReport, 'id' | 'candidateProfileId' | 'targetJobId' | 'readiness' | 'readinessScore' | 'createdAt'>,
  targetJobTitle: string | null,
  analysis: GapAnalysis,
): GapReport {
  return {
    id: stored.id,
    candidateProfileId: stored.candidateProfileId,
    targetJobId: stored.targetJobId,
    targetJobTitle,
    readiness: stored.readiness,
    readinessScore: stored.readinessScore,
    createdAt: stored.createdAt,
    analysis,
  }
}

async function buildAnalysis(principal: Principal, targetJobId?: string | null) {
  const profileId = principal.candidateProfileId as string
  const skills = await candidateSkillViews(profileId)
  const profile = await prisma.candidateProfile.findUnique({
    where: { id: profileId },
    select: { yearsOfExperience: true },
  })
  if (!profile) throw new AccessDeniedError('Candidate profile not found.')

  let targets
  let contextLabel: string
  let resolvedJobId: string | null = null
  let jobTitle: string | null = null

  if (targetJobId) {
    const job = await prisma.job.findUnique({
      where: { id: targetJobId },
      select: { id: true, title: true, status: true },
    })
    if (!job || job.status !== 'PUBLISHED') {
      throw new AccessDeniedError('Choose a published role as the target for a gap report.')
    }
    targets = await jobSkillViews(job.id)
    contextLabel = job.title
    resolvedJobId = job.id
    jobTitle = job.title
  } else {
    const topMatches = await prisma.match.findMany({
      where: { candidateProfileId: profileId, status: 'COMPUTED' },
      orderBy: { score: 'desc' },
      take: 5,
      select: { jobId: true },
    })
    targets = await jobSkillViewsForJobIds(topMatches.map((match) => match.jobId))

    if (targets.length === 0) {
      const published = await prisma.job.findMany({ where: { status: 'PUBLISHED' }, select: { id: true }, take: 20 })
      targets = await jobSkillViewsForJobIds(published.map((job) => job.id))
      contextLabel = 'all published roles'
    } else {
      contextLabel = `your ${topMatches.length} closest matched roles`
    }
  }

  const analysis = analyseGaps({
    candidateSkills: skills,
    targets,
    yearsOfExperience: profile.yearsOfExperience,
    experienceYearsMin: null,
    contextLabel,
  })

  return { analysis, resolvedJobId, jobTitle, targetCount: targets.length, skillCount: skills.length }
}

export async function generateGapReport(
  principal: Principal,
  options: { targetJobId?: string | null } = {},
): Promise<GapReport> {
  assertPermission(principal, 'candidate.gap.generate')
  if (!principal.candidateProfileId) throw new AccessDeniedError('No candidate profile attached to this account.')

  const built = await buildAnalysis(principal, options.targetJobId ?? null)

  return runEngine('GAP_ANALYSIS', async () => {
    const stored = await prisma.skillGapReport.create({
      data: {
        candidateProfileId: principal.candidateProfileId as string,
        targetJobId: built.resolvedJobId,
        readiness: built.analysis.readiness,
        readinessScore: built.analysis.readinessScore,
        strengths: json(built.analysis.strengths),
        gaps: json(built.analysis.gaps),
        transferables: json(built.analysis.transferables),
        scores: json({
          coverage: built.analysis.coverage,
          evidenceQuality: built.analysis.evidenceQuality,
          experienceFit: built.analysis.experienceFit,
          experienceStated: built.analysis.experienceStated,
          weights: GAP_READINESS_WEIGHTS,
          contextLabel: built.analysis.contextLabel,
          note: built.analysis.generatedAtNote,
        }),
      },
      select: {
        id: true,
        candidateProfileId: true,
        targetJobId: true,
        readiness: true,
        readinessScore: true,
        createdAt: true,
      },
    })

    await recordAudit({
      actor: principal,
      action: 'candidate.gap.generate',
      entityType: 'skill_gap_reports',
      entityId: stored.id,
      metadata: {
        readiness: built.analysis.readiness,
        gaps: built.analysis.gaps.length,
        targetJobId: built.resolvedJobId,
      },
    })

    return {
      result: toGapReport(stored, built.jobTitle, built.analysis),
      itemsProcessed: built.targetCount,
      itemsAffected: built.analysis.gaps.length,
      inputSummary: { candidateSkills: built.skillCount, targetJobId: built.resolvedJobId },
    }
  })
}

export async function storedGapReports(principal: Principal, take = 10) {
  assertPermission(principal, 'candidate.gap.read')
  if (!principal.candidateProfileId) throw new AccessDeniedError('No candidate profile attached to this account.')
  return prisma.skillGapReport.findMany({
    where: { candidateProfileId: principal.candidateProfileId },
    orderBy: { createdAt: 'desc' },
    take,
    include: { targetJob: { select: { id: true, title: true } } },
  })
}

export async function latestStoredGapReport(principal: Principal) {
  const reports = await storedGapReports(principal, 1)
  return reports[0] ?? null
}

/** Reads a stored report back into the typed shape for the detail screen. */
export function parseStoredReport(report: {
  id: string
  candidateProfileId: string
  targetJobId: string | null
  readiness: SkillGapReport['readiness']
  readinessScore: number
  createdAt: Date
  strengths: unknown
  gaps: unknown
  transferables: unknown
  scores: unknown
  targetJob?: { id: string; title: string } | null
}) {
  return {
    id: report.id,
    candidateProfileId: report.candidateProfileId,
    targetJobId: report.targetJobId,
    targetJobTitle: report.targetJob?.title ?? null,
    readiness: report.readiness,
    readinessScore: report.readinessScore,
    createdAt: report.createdAt,
    strengths: (report.strengths ?? []) as GapAnalysis['strengths'],
    gaps: (report.gaps ?? []) as GapAnalysis['gaps'],
    transferables: (report.transferables ?? []) as GapAnalysis['transferables'],
    scores: (report.scores ?? {}) as {
      coverage: number
      evidenceQuality: number
      experienceFit: number
      experienceStated?: boolean
      weights?: Partial<Record<'coverage' | 'evidenceQuality' | 'experienceFit', number>>
      contextLabel: string
      note: string
    },
  }
}

export type ParsedGapReport = ReturnType<typeof parseStoredReport>
