import { prisma } from '@/lib/db'
import type { CatalogSkill, CandidateSkillView, JobSkillView } from '@/lib/engines/types'
import type { ConsentType, ProficiencyLevel } from '@prisma/client'
import { policyVersion } from '@/lib/env'

/** Reads the skill catalogue in the shape the inference engine expects. */
export async function loadCatalogSkills(): Promise<CatalogSkill[]> {
  const skills = await prisma.skill.findMany({
    select: { slug: true, name: true, category: true, transferable: true, aliases: true },
    orderBy: { name: 'asc' },
  })
  return skills.map((skill) => ({
    slug: skill.slug,
    name: skill.name,
    category: skill.category,
    transferable: skill.transferable,
    aliases: skill.aliases,
  }))
}

export async function skillIdsBySlug(slugs: string[]) {
  if (slugs.length === 0) return new Map<string, string>()
  const skills = await prisma.skill.findMany({ where: { slug: { in: slugs } }, select: { id: true, slug: true } })
  return new Map(skills.map((skill) => [skill.slug, skill.id]))
}

/** Candidate skills in the shape the matching and gap engines expect. */
export async function candidateSkillViews(candidateProfileId: string): Promise<CandidateSkillView[]> {
  const rows = await prisma.candidateSkill.findMany({
    where: { candidateProfileId },
    include: { skill: { select: { slug: true, name: true, category: true, transferable: true } } },
  })
  return rows.map((row) => ({
    slug: row.skill.slug,
    name: row.skill.name,
    category: row.skill.category,
    transferable: row.skill.transferable,
    level: row.level as ProficiencyLevel,
    confidence: row.confidence,
    validationStatus: row.validationStatus,
    evidenceCount: row.evidenceCount,
  }))
}

export async function jobSkillViews(jobId: string): Promise<JobSkillView[]> {
  const rows = await prisma.jobSkill.findMany({ where: { jobId }, include: { skill: true } })
  return rows.map((row) => ({
    slug: row.skill.slug,
    name: row.skill.name,
    level: row.level as ProficiencyLevel,
    weight: row.weight,
    requirement: row.requirement,
  }))
}

/** Union of required and preferred skills across a set of roles. */
export async function jobSkillViewsForJobIds(jobIds: string[]): Promise<JobSkillView[]> {
  if (jobIds.length === 0) return []
  const rows = await prisma.jobSkill.findMany({
    where: { jobId: { in: jobIds } },
    include: { skill: true },
  })
  return rows.map((row) => ({
    slug: row.skill.slug,
    name: row.skill.name,
    level: row.level as ProficiencyLevel,
    weight: row.weight,
    requirement: row.requirement,
  }))
}

/**
 * Consent is versioned. The current effective decision for a type is the newest
 * record for the active policy version, so a withdrawal is never overwritten by
 * an older grant.
 */
export async function hasConsent(userId: string, type: ConsentType) {
  const record = await prisma.consentRecord.findFirst({
    where: { userId, type, policyVersion: policyVersion(), scope: null },
    orderBy: { decidedAt: 'desc' },
    select: { decision: true },
  })
  return record?.decision === 'GRANTED'
}

export async function effectiveConsents(userId: string) {
  const records = await prisma.consentRecord.findMany({
    where: { userId, policyVersion: policyVersion(), scope: null },
    orderBy: { decidedAt: 'desc' },
  })
  const latest = new Map<string, (typeof records)[number]>()
  for (const record of records) {
    if (!latest.has(record.type)) latest.set(record.type, record)
  }
  return latest
}
