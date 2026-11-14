import type { ProposalStatus } from '@prisma/client'
import { prisma } from '@/lib/db'
import { AccessDeniedError, assertPermission, type Principal } from '@/lib/authz'
import { recordAudit } from '@/server/audit'
import { nullableString } from '@/server/fields'
import { refreshEvidenceCount, refreshProfileCompletion } from '@/server/candidate'
import { computeMatchesForProfile } from '@/server/matching'

/**
 * Candidate control over AI proposals.
 *
 * A proposal is inert until the candidate acts on it: accepting writes a skill
 * with provenance USER_CONFIRMED, because the person — not the model — adopted
 * the claim. Rejection keeps the record so the platform can show how often its
 * suggestions were refused.
 */

export type ProposalDecision = 'CONFIRMED' | 'EDITED' | 'REJECTED'

export async function listProposals(principal: Principal, filter: { status?: ProposalStatus } = {}) {
  assertPermission(principal, 'candidate.skills.read')
  const profileId = principal.candidateProfileId
  if (!profileId) throw new AccessDeniedError('No candidate profile attached to this account.')

  const rows = await prisma.aiProposal.findMany({
    where: { candidateProfileId: profileId, ...(filter.status ? { status: filter.status } : {}) },
    orderBy: { createdAt: 'desc' },
    include: {
      skill: true,
      aiRun: { select: { mode: true, provider: true, model: true, fallbackReason: true, startedAt: true } },
    },
  })

  return rows.map((row) => ({
    id: row.id,
    skill: { slug: row.skill.slug, name: row.skill.name, category: row.skill.category, transferable: row.skill.transferable },
    proposedLevel: row.proposedLevel,
    confidence: row.confidence,
    evidence: row.evidence as { quote: string; context: string }[],
    rationale: row.rationale,
    requiresHumanReview: row.requiresHumanReview,
    status: row.status,
    decisionNote: row.decisionNote,
    createdAt: row.createdAt,
    origin: {
      mode: row.aiRun.mode,
      label: row.aiRun.mode === 'AI' ? `Model ${row.aiRun.model}` : 'Rule-based engine',
      fallbackReason: row.aiRun.fallbackReason,
      runAt: row.aiRun.startedAt,
    },
  }))
}

export async function openProposalCount(principal: Principal) {
  if (!principal.candidateProfileId) return 0
  return prisma.aiProposal.count({ where: { candidateProfileId: principal.candidateProfileId, status: 'PROPOSED' } })
}

export async function decideProposal(
  principal: Principal,
  input: { proposalId: string; decision: ProposalDecision; level?: string; note?: string | null },
) {
  assertPermission(principal, 'candidate.skills.manage')
  const profileId = principal.candidateProfileId
  if (!profileId) throw new AccessDeniedError('No candidate profile attached to this account.')

  // Ownership is enforced in the query, not by trusting the identifier.
  const proposal = await prisma.aiProposal.findFirst({
    where: { id: input.proposalId, candidateProfileId: profileId },
    include: { skill: true },
  })
  if (!proposal) throw new AccessDeniedError('That suggestion is not on your account.')
  if (proposal.status !== 'PROPOSED') {
    throw new AccessDeniedError(`This suggestion was already ${proposal.status.toLowerCase()}.`)
  }

  if (input.decision === 'REJECTED') {
    const updated = await prisma.aiProposal.update({
      where: { id: proposal.id },
      data: {
        status: 'REJECTED',
        decidedById: principal.userId,
        decidedAt: new Date(),
        decisionNote: nullableString(input.note) ?? 'Rejected by the candidate.',
      },
    })
    await recordAudit({
      actor: principal,
      action: 'ai.proposal.reject',
      entityType: 'ai_proposals',
      entityId: updated.id,
      metadata: { slug: proposal.skill.slug },
    })
    return { status: 'REJECTED' as const, skillName: proposal.skill.name, candidateSkillId: null }
  }

  const level = (input.level ?? proposal.proposedLevel) as never
  const edited = input.level != null && input.level !== proposal.proposedLevel

  const candidateSkill = await prisma.candidateSkill.upsert({
    where: { candidateProfileId_skillId: { candidateProfileId: profileId, skillId: proposal.skillId } },
    create: {
      candidateProfileId: profileId,
      skillId: proposal.skillId,
      level,
      // Confirmation raises confidence to at least 0.7: the candidate adopted it.
      confidence: Math.max(0.7, proposal.confidence),
      validationStatus: 'USER_CONFIRMED',
      source: 'AI_PROPOSAL_CONFIRMED',
      note: proposal.rationale,
    },
    update: { level, validationStatus: 'USER_CONFIRMED', source: 'AI_PROPOSAL_CONFIRMED' },
  })

  await prisma.skillEvidence.create({
    data: {
      candidateSkillId: candidateSkill.id,
      type: 'ONBOARDING_ANSWER',
      description: `Accepted from a ${proposal.requiresHumanReview ? 'non-work' : 'experience-based'} suggestion: ${proposal.rationale}`,
    },
  })
  await refreshEvidenceCount(candidateSkill.id)

  await prisma.aiProposal.update({
    where: { id: proposal.id },
    data: {
      status: edited ? 'EDITED' : 'CONFIRMED',
      decidedById: principal.userId,
      decidedAt: new Date(),
      decisionNote: nullableString(input.note),
      proposedLevel: level,
    },
  })

  await refreshProfileCompletion(profileId)
  await recordAudit({
    actor: principal,
    action: edited ? 'ai.proposal.edit_confirm' : 'ai.proposal.confirm',
    entityType: 'candidate_skills',
    entityId: candidateSkill.id,
    metadata: { slug: proposal.skill.slug, level, proposalId: proposal.id },
  })

  // Recommendations depend on the confirmed skill set, so refresh matches.
  await computeMatchesForProfile(profileId)

  return { status: (edited ? 'EDITED' : 'CONFIRMED') as ProposalDecision, skillName: proposal.skill.name, candidateSkillId: candidateSkill.id }
}

/** Adds a skill the candidate knows the model missed. */
export async function addOwnSkill(principal: Principal, input: { skillSlug: string; level: string; note?: string | null }) {
  assertPermission(principal, 'candidate.skills.manage')
  const profileId = principal.candidateProfileId
  if (!profileId) throw new AccessDeniedError('No candidate profile attached to this account.')

  const skill = await prisma.skill.findUnique({ where: { slug: input.skillSlug } })
  if (!skill) throw new AccessDeniedError(`Unknown skill “${input.skillSlug}”.`)

  const row = await prisma.candidateSkill.upsert({
    where: { candidateProfileId_skillId: { candidateProfileId: profileId, skillId: skill.id } },
    create: {
      candidateProfileId: profileId,
      skillId: skill.id,
      level: input.level as never,
      confidence: 0.75,
      validationStatus: 'SELF_REPORTED',
      source: 'CANDIDATE_ADDED',
      note: nullableString(input.note),
    },
    update: { level: input.level as never, validationStatus: 'SELF_REPORTED', source: 'CANDIDATE_ADDED' },
  })

  await refreshProfileCompletion(profileId)
  await recordAudit({
    actor: principal,
    action: 'candidate.skill.self_added',
    entityType: 'candidate_skills',
    entityId: row.id,
    metadata: { slug: skill.slug },
  })
  await computeMatchesForProfile(profileId)

  return row
}
