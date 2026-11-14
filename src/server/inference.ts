import type { EvidenceType } from '@prisma/client'
import { prisma } from '@/lib/db'
import { inferSkills, explainHit, type InferenceContext, type InferenceInput } from '@/lib/engines/inference'
import { hasConsent, loadCatalogSkills, skillIdsBySlug } from '@/server/skill-catalog'
import type { CandidateProfile } from '@prisma/client'

/**
 * Persists inference output.
 *
 * Inference may only create or improve a skill it owns (`source = INFERENCE`).
 * A level the candidate set by hand, or that a person reviewed, is never
 * downgraded or overwritten by a keyword pass.
 */

export type InferenceSource = {
  experienceId?: string | null
  text: string
  context: InferenceContext
  yearsInRole?: number
}

export type AppliedSkill = {
  slug: string
  name: string
  level: string
  confidence: number
  reason: string
  created: boolean
}

const INFERENCE_SOURCE_LABEL = 'INFERENCE'

export async function inferAndPersistSkills(
  profile: Pick<CandidateProfile, 'id' | 'userId'>,
  sources: InferenceSource[],
): Promise<{ applied: AppliedSkill[]; skipped: boolean }> {
  const allowed = await hasConsent(profile.userId, 'RULE_BASED_INFERENCE')
  if (!allowed) return { applied: [], skipped: true }

  const usable = sources.filter((source) => source.text.trim().length > 12)
  if (usable.length === 0) return { applied: [], skipped: false }

  const catalog = await loadCatalogSkills()
  const inputs: InferenceInput[] = usable.map((source) => ({
    text: source.text,
    context: source.context,
    yearsInRole: source.yearsInRole,
  }))

  const hits = inferSkills(inputs, catalog)
  if (hits.length === 0) return { applied: [], skipped: false }

  const idsBySlug = await skillIdsBySlug(hits.map((hit) => hit.slug))
  const existing = await prisma.candidateSkill.findMany({
    where: { candidateProfileId: profile.id, skillId: { in: [...idsBySlug.values()] } },
    include: { skill: { select: { name: true } } },
  })
  const existingBySkillId = new Map(existing.map((row) => [row.skillId, row]))

  const evidenceTypeFor = (context: InferenceContext): EvidenceType =>
    context === 'CAREGIVING' ? 'EXPERIENCE_DESCRIPTION' : 'ONBOARDING_ANSWER'

  const applied: AppliedSkill[] = []

  for (const hit of hits) {
    const skillId = idsBySlug.get(hit.slug)
    if (!skillId) continue
    const current = existingBySkillId.get(skillId)
    const reason = explainHit(hit)

    if (!current) {
      const created = await prisma.candidateSkill.create({
        data: {
          candidateProfileId: profile.id,
          skillId,
          level: hit.level,
          confidence: hit.confidence,
          validationStatus: 'RULE_INFERRED',
          source: INFERENCE_SOURCE_LABEL,
          note: reason,
        },
      })
      const firstSource = usable[0]
      await prisma.skillEvidence.create({
        data: {
          candidateSkillId: created.id,
          experienceId: firstSource?.experienceId ?? null,
          type: evidenceTypeFor(hit.contexts[0] === 'CAREGIVING' ? 'CAREGIVING' : 'GENERAL'),
          description: reason,
        },
      })
      await prisma.candidateSkill.update({ where: { id: created.id }, data: { evidenceCount: 1 } })
      applied.push({ slug: hit.slug, name: hit.name, level: hit.level, confidence: hit.confidence, reason, created: true })
      continue
    }

    // Only inference-owned rows are eligible for an upgrade.
    const canImprove =
      current.source === INFERENCE_SOURCE_LABEL &&
      current.validationStatus === 'RULE_INFERRED' &&
      hit.confidence > current.confidence

    if (!canImprove) {
      // Evidence still accumulates against the existing claim.
      const source = usable.find((entry) => entry.experienceId) ?? usable[0]
      await prisma.skillEvidence.create({
        data: {
          candidateSkillId: current.id,
          experienceId: source?.experienceId ?? null,
          type: evidenceTypeFor(hit.contexts[0] === 'CAREGIVING' ? 'CAREGIVING' : 'GENERAL'),
          description: reason,
        },
      })
      await prisma.candidateSkill.update({
        where: { id: current.id },
        data: { evidenceCount: { increment: 1 } },
      })
      continue
    }

    await prisma.candidateSkill.update({
      where: { id: current.id },
      data: { level: hit.level, confidence: hit.confidence, note: reason },
    })
    applied.push({ slug: hit.slug, name: hit.name, level: hit.level, confidence: hit.confidence, reason, created: false })
  }

  return { applied, skipped: false }
}

/**
 * Removes inference-owned skills that no longer have any supporting evidence.
 * Manual and reviewed entries are left untouched.
 */
export async function pruneOrphanedInferences(candidateProfileId: string) {
  const result = await prisma.candidateSkill.deleteMany({
    where: {
      candidateProfileId,
      source: INFERENCE_SOURCE_LABEL,
      validationStatus: 'RULE_INFERRED',
      evidenceCount: 0,
    },
  })
  return result.count
}

export function inferenceInputFrom(fields: { title: string; description: string; achievements?: string | null; organization?: string | null }, context: InferenceContext, experienceId?: string | null, yearsInRole?: number): InferenceSource {
  return {
    experienceId: experienceId ?? null,
    text: [fields.title, fields.description, fields.achievements].filter(Boolean).join('. '),
    context,
    yearsInRole,
  }
}
