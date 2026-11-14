/**
 * Live AI demonstration pass.
 *
 * Runs the four agents through the real product services against the configured
 * provider chain, so the employer and admin screens show genuine stored output
 * instead of an empty queue. Every row keeps the mode and the endpoint that
 * produced it; nothing here writes a claim the engines did not actually return.
 *
 *   npx tsx scripts/seed-ai-demo.ts
 *   npx tsx scripts/seed-ai-demo.ts --candidate anshika@example.com
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function principalFor(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: {
      candidateProfile: { select: { id: true } },
      ownedOrganization: { select: { id: true, name: true, verificationStatus: true } },
      memberships: { select: { id: true, name: true, verificationStatus: true } },
    },
  })
  const roleRow = await prisma.roleDefinition.findUniqueOrThrow({
    where: { role: user.role },
    include: { permissions: true },
  })
  const organisation = user.ownedOrganization ?? user.memberships[0] ?? null
  return {
    userId: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    status: user.status,
    organizationId: organisation?.id ?? null,
    organizationName: organisation?.name ?? null,
    organizationVerification: organisation?.verificationStatus ?? null,
    candidateProfileId: user.candidateProfile?.id ?? null,
    permissions: roleRow.permissions.map((permission) => permission.key),
  } as import('../src/lib/authz').Principal
}

async function main() {
  const emailIndex = process.argv.indexOf('--candidate')
  const candidateEmail = emailIndex > -1 ? process.argv[emailIndex + 1] : 'anshika@example.com'

  const candidateUser = await prisma.user.findFirstOrThrow({ where: { email: candidateEmail } })
  const adminUser = await prisma.user.findFirstOrThrow({ where: { role: 'ADMIN' } })
  const candidate = await principalFor(candidateUser.id)
  if (!candidate.candidateProfileId) throw new Error('Select an account with a candidate profile.')
  const candidateProfileId = candidate.candidateProfileId
  const admin = await principalFor(adminUser.id)

  const agents = await import('../src/server/ai/agents')
  const orchestration = await import('../src/server/ai/orchestration')
  const { aiConfigSummary } = await import('../src/lib/ai/config')

  const config = aiConfigSummary()
  console.log(`\nLive AI demonstration pass for ${candidateEmail}`)
  console.log(`  chain: ${config.chain.map((entry) => `${entry.name}/${entry.model}`).join(' → ') || 'deterministic only'}`)

  // Agent 1 — suggestions from her own wording.
  try {
    const discovery = await agents.runSkillsDiscovery(candidate)
    console.log(
      `  agent 1  ${discovery.mode} via ${discovery.provider}: ${discovery.created} new proposal(s), ${discovery.skipped} already held` +
        `${discovery.fallbackReason ? ` (fallback: ${discovery.fallbackReason})` : ''}`,
    )
  } catch (error) {
    console.log(`  agent 1  failed — ${(error as Error).message.slice(0, 160)}`)
  }

  // Agent 4 — language review on the roles she matches, plus any role whose
  // wording the audit should flag for a human.
  const jobs = await prisma.job.findMany({
    where: { status: 'PUBLISHED' },
    select: { id: true, title: true },
    orderBy: { postedAt: 'desc' },
    take: 8,
  })
  for (const job of jobs) {
    try {
      const review = await agents.runBiasAudit(admin, job.id)
      console.log(
        `  agent 4  ${review.outcome.mode} on “${job.title}”: ${review.output.findings.length} finding(s), ` +
          `${review.output.continuityChecks.length} continuity check(s), risk ${review.output.overallRisk.toLowerCase()}` +
          `${review.output.reviewRequired ? ' · review task queued' : ''}`,
      )
    } catch (error) {
      console.log(`  agent 4  “${job.title}” failed — ${(error as Error).message.slice(0, 140)}`)
    }
  }

  // Agent 2 — demand comparison for her best match.
  const top = await prisma.match.findFirst({ where: { candidateProfileId }, orderBy: { score: 'desc' } })
  if (top) {
    try {
      const market = await agents.runMarketIntelligence(admin, top.jobId, candidateProfileId)
      console.log(
        `  agent 2  ${market.outcome.mode}: score ${Math.round(market.insight.score * 100)}%, ` +
          `source ${market.insight.source}, live signal ${market.insight.isLive}`,
      )
    } catch (error) {
      console.log(`  agent 2  failed — ${(error as Error).message.slice(0, 140)}`)
    }
  }

  // Agent 3 — pathway reasoning over the catalogue.
  try {
    const pathway = await agents.runLearningPathways(candidate, { targetJobId: top?.jobId ?? null })
    console.log(
      `  agent 3  ${pathway.outcome?.mode ?? 'DETERMINISTIC'}: ${pathway.plan?.items.length ?? 0} step(s), ` +
        `${pathway.gaps.length} gap(s) considered` +
        `${pathway.message ? ` · ${pathway.message.slice(0, 120)}` : ''}`,
    )
  } catch (error) {
    console.log(`  agent 3  failed — ${(error as Error).message.slice(0, 140)}`)
  }

  // The workflow, end to end. As the candidate, every step runs for real; as an
  // administrator, the two candidate-owned steps report as skipped.
  const asCandidate = process.argv.includes('--as-candidate')
  const trigger = asCandidate ? candidate : admin
  try {
    const run = await orchestration.runOrchestration(trigger, {
      profileId: asCandidate ? undefined : candidateProfileId,
      targetJobId: top?.jobId ?? null,
    })
    console.log(`  workflow ${run.status} (${run.mode}): ${run.steps.map((step) => `${step.agent}=${step.status}`).join(' → ')}`)
  } catch (error) {
    console.log(`  workflow failed — ${(error as Error).message.slice(0, 140)}`)
  }

  const counts = {
    aiRuns: await prisma.aiRun.count(),
    proposals: await prisma.aiProposal.count({ where: { status: 'PROPOSED' } }),
    languageReviews: await prisma.languageReview.count(),
    marketInsights: await prisma.marketInsight.count(),
    reviewTasks: await prisma.reviewTask.count({ where: { status: 'OPEN' } }),
    orchestrationRuns: await prisma.orchestrationRun.count(),
  }
  console.log('\n  stored now:', JSON.stringify(counts))
  console.log('  screens that read it: /candidate/suggestions, /employer/jobs/<id>, /admin/engines, /admin/review\n')

  await prisma.$disconnect()
}

main().catch(async (error) => {
  console.error('Live demonstration pass crashed:', error)
  await prisma.$disconnect().catch(() => {})
  process.exitCode = 1
})
