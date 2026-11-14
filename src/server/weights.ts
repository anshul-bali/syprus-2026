import { prisma } from '@/lib/db'
import { DEFAULT_WEIGHTS, WEIGHTS_VERSION, type MatchWeights } from '@/lib/engines/matching'
import { AccessDeniedError, assertPermission, type Principal } from '@/lib/authz'
import { recordAudit } from '@/server/audit'
import { nullableString } from '@/server/fields'

/**
 * Matching weights are data, not constants.
 *
 * Prompt 3 asks that the weights be treated as configurable prototype
 * assumptions, so an administrator can change them, every score records the
 * version that produced it, and the sum-to-one rule is enforced here rather than
 * assumed.
 */

export type ActiveWeights = { weights: MatchWeights; version: string; source: 'database' | 'default' }

export async function activeWeights(): Promise<ActiveWeights> {
  try {
    const row = await prisma.weightProfile.findFirst({ where: { active: true }, orderBy: { updatedAt: 'desc' } })
    if (row) {
      return {
        weights: {
          required: row.required,
          preferred: row.preferred,
          evidence: row.evidence,
          preferences: row.preferences,
        },
        version: row.version,
        source: 'database',
      }
    }
  } catch {
    // A missing table on a fresh database must not stop matching; the defaults
    // are the documented Prompt 3 proposal.
  }
  return { weights: DEFAULT_WEIGHTS, version: WEIGHTS_VERSION, source: 'default' }
}

export function weightSum(weights: MatchWeights) {
  return weights.required + weights.preferred + weights.evidence + weights.preferences
}

/** Lists every profile, active first. */
export async function listWeightProfiles(principal: Principal) {
  assertPermission(principal, 'admin.reporting.read')
  return prisma.weightProfile.findMany({ orderBy: [{ active: 'desc' }, { updatedAt: 'desc' }] })
}

export async function saveWeightProfile(
  principal: Principal,
  input: {
    version: string
    label: string
    required: number
    preferred: number
    evidence: number
    preferences: number
    activate: boolean
    note?: string | null
  },
) {
  assertPermission(principal, 'admin.reporting.read')

  const values = [input.required, input.preferred, input.evidence, input.preferences]
  if (values.some((value) => Number.isNaN(value) || value < 0 || value > 1)) {
    throw new AccessDeniedError('Every weight must be a number between 0 and 1.')
  }
  if (Math.abs(weightSum({ required: input.required, preferred: input.preferred, evidence: input.evidence, preferences: input.preferences }) - 1) > 0.001) {
    throw new AccessDeniedError(
      `Weights must add up to 1.00. They currently total ${weightSum({
        required: input.required,
        preferred: input.preferred,
        evidence: input.evidence,
        preferences: input.preferences,
      }).toFixed(2)}.`,
    )
  }
  if (input.required < 0.3) {
    // Guard the product's central claim: skills must stay the dominant signal.
    throw new AccessDeniedError('Required skill coverage must stay at or above 0.30 for the platform to remain skills-first.')
  }
  if (!/^[a-z0-9._-]{4,40}$/.test(input.version)) {
    throw new AccessDeniedError('Use a version id such as prototype-2026-11-b (4–40 characters, lowercase).')
  }

  if (await prisma.weightProfile.findUnique({ where: { version: input.version } })) {
    throw new AccessDeniedError('That version already exists. Use a new version tag to preserve score history.')
  }
  const profile = await prisma.$transaction(async (tx) => {
    if (input.activate) await tx.weightProfile.updateMany({ where: { active: true }, data: { active: false } })
    return tx.weightProfile.create({
    data: {
      version: input.version,
      label: input.label,
      required: input.required,
      preferred: input.preferred,
      evidence: input.evidence,
      preferences: input.preferences,
      active: input.activate,
      note: nullableString(input.note),
      createdById: principal.userId,
      updatedById: principal.userId,
    },
    })
  }, { isolationLevel: 'Serializable' })

  await recordAudit({
    actor: principal,
    action: 'admin.weights.save',
    entityType: 'weight_profiles',
    entityId: profile.id,
    metadata: {
      version: profile.version,
      weights: { required: profile.required, preferred: profile.preferred, evidence: profile.evidence, preferences: profile.preferences },
      activated: profile.active,
    },
  })

  return profile
}

/**
 * Recomputes every stored match under the active weight set. Offered explicitly
 * rather than as a background job so the operator sees how many rows changed.
 */
export async function reapplyWeights(principal: Principal) {
  assertPermission(principal, 'admin.job.moderate')
  const { computeMatchesForProfile } = await import('@/server/matching')
  const profiles = await prisma.candidateProfile.findMany({ where: { skills: { some: {} } }, select: { id: true } })
  for (const profile of profiles) await computeMatchesForProfile(profile.id)

  await recordAudit({
    actor: principal,
    action: 'admin.weights.reapplied',
    entityType: 'weight_profiles',
    entityId: null,
    metadata: { profiles: profiles.length },
  })
  return profiles.length
}
