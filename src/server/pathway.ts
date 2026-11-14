import { prisma } from '@/lib/db'
import { buildLearningPlan, type PlanningResource } from '@/lib/engines/pathway'
import { AccessDeniedError, assertPermission, type Principal } from '@/lib/authz'
import { runEngine } from '@/server/engine-log'
import { nullableString } from '@/server/fields'
import { generateGapReport } from '@/server/gap'
import { recordAudit } from '@/server/audit'
import { notifyUser } from '@/server/notifications'

/**
 * Learning pathway service. Plans are assembled from the local resource
 * catalogue only; a gap with no catalogued resource is reported as uncovered
 * rather than filled with an invented link.
 */

export async function generateLearningPlan(
  principal: Principal,
  options: { targetJobId?: string | null; force?: boolean } = {},
) {
  assertPermission(principal, 'candidate.plan.read')
  if (!principal.candidateProfileId) throw new AccessDeniedError('No candidate profile attached to this account.')

  const profileId = principal.candidateProfileId
  const targetJobId = options.targetJobId ?? null

  const report = await generateGapReport(principal, { targetJobId })

  // Reuse an untouched plan for the same target unless explicitly regenerated.
  if (!options.force) {
    const existing = await prisma.learningPlan.findFirst({
      where: { candidateProfileId: profileId, targetJobId, status: 'ACTIVE' },
      include: { items: { include: { resource: { include: { skill: true } } }, orderBy: { position: 'asc' } } },
    })
    if (existing && existing.items.length > 0) {
      return { plan: existing, regenerated: false, uncoveredGaps: [] as string[] }
    }
  }

  return runEngine('PATHWAY_PLANNER', async () => {
    const gapSlugs = report.analysis.gaps.slice(0, 8).map((gap) => gap.slug)
    const skills = await prisma.skill.findMany({ where: { slug: { in: gapSlugs } }, select: { id: true, slug: true } })

    const rows = await prisma.learningResource.findMany({
      where: { skillId: { in: skills.map((skill) => skill.id) } },
      include: { skill: { select: { slug: true } } },
    })

    const resources: PlanningResource[] = rows.map((row) => ({
      id: row.id,
      title: row.title,
      provider: row.provider,
      type: row.type,
      format: row.format,
      skillSlug: row.skill?.slug ?? null,
      targetLevel: row.targetLevel,
      durationHours: row.durationHours,
      isFree: row.isFree,
      costLabel: row.costLabel,
      outcome: row.outcome,
      url: row.url,
      demonstration: row.demonstration,
    }))

    const draft = buildLearningPlan(report.analysis.gaps, resources, report.targetJobTitle ?? report.analysis.contextLabel)

    if (draft.items.length === 0) {
      await recordAudit({
        actor: principal,
        action: 'candidate.plan.no_resources',
        entityType: 'learning_plans',
        entityId: profileId,
        metadata: { uncoveredGaps: draft.uncoveredGaps },
      })
      throw new AccessDeniedError(
        draft.uncoveredGaps.length > 0
          ? `The learning catalogue has no entry yet for: ${draft.uncoveredGaps.join(', ')}. Gaps stay open rather than being filled with an unverified suggestion.`
          : 'No skill gaps were found, so there is nothing to plan yet.',
      )
    }

    const plan = await prisma.$transaction(async (tx) => {
      const created = await tx.learningPlan.create({
        data: {
          candidateProfileId: profileId,
          userId: principal.userId,
          title: draft.title,
          goal: draft.goal,
          summary: draft.summary,
          status: 'ACTIVE',
          priority: draft.priority,
          targetJobId,
          generatedBy: 'PATHWAY_PLANNER_RULES',
        },
      })

      await tx.learningPlanItem.createMany({
        data: draft.items.map((item) => ({
          planId: created.id,
          resourceId: item.resourceId,
          position: item.position,
          gapSkillSlug: nullableString(item.gapSkillSlug),
          note: nullableString(item.reason),
          status: 'NOT_STARTED',
        })),
      })

      // Retire older plans for the same target so the portal shows one active path.
      await tx.learningPlan.updateMany({
        where: { candidateProfileId: profileId, targetJobId, status: 'ACTIVE', id: { not: created.id } },
        data: { status: 'ABANDONED' },
      })

      return created
    })

    const withItems = await prisma.learningPlan.findUniqueOrThrow({
      where: { id: plan.id },
      include: {
        items: {
          include: { resource: { include: { skill: { select: { slug: true, name: true } } } } },
          orderBy: { position: 'asc' },
        },
      },
    })

    await notifyUser(principal.userId, {
      type: 'PLAN_REMINDER',
      title: 'A new learning pathway is ready',
      body: `${withItems.title}: ${draft.items.length} steps, about ${draft.weeksAtFiveHours} weeks at ${draft.weeklyHours} hrs/week.`,
      link: '/candidate/pathways',
    })

    await recordAudit({
      actor: principal,
      action: 'candidate.plan.generate',
      entityType: 'learning_plans',
      entityId: plan.id,
      metadata: { items: draft.items.length, uncovered: draft.uncoveredGaps.length, estimatedHours: draft.estimatedHours },
    })

    return {
      result: { plan: withItems, regenerated: true, uncoveredGaps: draft.uncoveredGaps },
      itemsProcessed: report.analysis.gaps.length,
      itemsAffected: draft.items.length,
      inputSummary: { profileId, targetJobId, catalogueSize: resources.length },
    }
  })
}

export async function setPlanItemStatus(
  principal: Principal,
  input: { itemId: string; status: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' | 'SKIPPED'; note?: string | null },
) {
  assertPermission(principal, 'candidate.plan.update')
  if (!principal.candidateProfileId) throw new AccessDeniedError('No candidate profile attached to this account.')

  const item = await prisma.learningPlanItem.findFirst({
    where: { id: input.itemId, plan: { candidateProfileId: principal.candidateProfileId } },
    include: {
      plan: { select: { id: true } },
      resource: { select: { title: true, provider: true } },
    },
  })
  if (!item) throw new AccessDeniedError('That plan step is not on your profile.')

  const updated = await prisma.learningPlanItem.update({
    where: { id: item.id },
    data: {
      status: input.status,
      note: nullableString(input.note),
      completedAt: input.status === 'COMPLETED' ? new Date() : null,
    },
  })

  // A finished step lifts the matching skill's evidence, closing the loop
  // between learning activity and the skills inventory.
  if (input.status === 'COMPLETED' && item.gapSkillSlug) {
    const skill = await prisma.skill.findUnique({
      where: { slug: item.gapSkillSlug },
      select: { id: true, name: true },
    })
    if (skill) {
      const candidateSkill = await prisma.candidateSkill.findUnique({
        where: {
          candidateProfileId_skillId: {
            candidateProfileId: principal.candidateProfileId,
            skillId: skill.id,
          },
        },
      })
      if (candidateSkill) {
        await prisma.skillEvidence.create({
          data: {
            candidateSkillId: candidateSkill.id,
            type: 'ASSESSMENT',
            description: `Completed “${item.resource.title}” listed as a step toward ${skill.name}.`,
          },
        })
        await prisma.candidateSkill.update({
          where: { id: candidateSkill.id },
          data: { evidenceCount: { increment: 1 }, confidence: Math.min(0.95, candidateSkill.confidence + 0.06) },
        })
      }
    }
  }

  await recordAudit({
    actor: principal,
    action: 'candidate.plan.item_status',
    entityType: 'learning_plan_items',
    entityId: item.id,
    metadata: { status: input.status },
  })

  return updated
}

export async function activePlans(principal: Principal) {
  assertPermission(principal, 'candidate.plan.read')
  if (!principal.candidateProfileId) throw new AccessDeniedError('No candidate profile attached to this account.')
  return prisma.learningPlan.findMany({
    where: { candidateProfileId: principal.candidateProfileId },
    orderBy: [{ status: 'asc' }, { priority: 'asc' }, { createdAt: 'desc' }],
    include: {
      items: {
        include: { resource: { include: { skill: { select: { slug: true, name: true } } } } },
        orderBy: { position: 'asc' },
      },
    },
  })
}

/** Learning catalogue browse, grouped by skill for the pathways screen. */
export async function catalogueForSlugs(slugs: string[]) {
  if (slugs.length === 0) return []
  return prisma.learningResource.findMany({
    where: { skill: { slug: { in: slugs } } },
    include: { skill: { select: { slug: true, name: true } } },
    orderBy: [{ type: 'asc' }, { title: 'asc' }],
  })
}
