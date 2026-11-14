/**
 * Live provider check — the only part of the AI layer that cannot be exercised
 * by the offline suite, because it makes real network calls with a real key.
 *
 *   npm run check:ai            # probe each chat-capable Groq model
 *   npm run check:ai -- --persist
 *
 * `--persist` additionally runs the product path (runSkillsDiscovery), which
 * writes a real `ai_runs` row and candidate `ai_proposals`.
 *
 * Reads AI_API_KEY from .env. Prints model names, counts and latencies only —
 * never the key.
 */

if (!process.env.DATABASE_URL) process.loadEnvFile('.env')

import { prisma } from '../src/lib/db'
import { aiConfig, resetAiConfig } from '../src/lib/ai/config'
import { runAgent } from '../src/lib/ai/client'
import { createOpenAiCompatibleProvider } from '../src/lib/ai/providers/openai-compatible'
import { discoveryOutputSchema, type DiscoveryInput, type DiscoveryOutput } from '../src/lib/ai/schemas'
import { guardDiscovery } from '../src/lib/ai/guardrails'
import { buildDiscoveryInput, deterministicDiscovery, runBiasAudit, runSkillsDiscovery } from '../src/server/ai/agents'
import { permissionsFor, type RoleName } from '../src/lib/permissions'
import type { Principal } from '../src/lib/authz'

/** Chat-capable models on this key. Excludes whisper (STT), orpheus (TTS) and
 *  llama-prompt-guard (classifier), which cannot serve a JSON chat contract. */
const MODELS = [
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b',
  'openai/gpt-oss-safeguard-20b',
  'qwen/qwen3.8-27b',
]

const DEMO_EMAIL = 'anshika@example.com'
const persist = process.argv.includes('--persist')
/** `--model=openai/gpt-oss-120b` probes one model, to stay inside the free tier. */
const only = process.argv.find((arg) => arg.startsWith('--model='))?.split('=')[1]
const TARGETS = only ? [only] : MODELS

function log(...args: unknown[]) {
  console.log(...args)
}

async function buildPrincipal(userId: string): Promise<Principal> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      status: true,
      candidateProfile: { select: { id: true } },
      ownedOrganization: { select: { id: true, name: true, verificationStatus: true } },
      memberships: { select: { id: true, name: true, verificationStatus: true } },
    },
  })
  const role = await prisma.roleDefinition.findUniqueOrThrow({
    where: { role: user.role },
    include: { permissions: true },
  })

  return {
    userId: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    status: user.status,
    organizationId: user.ownedOrganization?.id ?? user.memberships[0]?.id ?? null,
    organizationName: user.ownedOrganization?.name ?? user.memberships[0]?.name ?? null,
    organizationVerification: user.ownedOrganization?.verificationStatus ?? user.memberships[0]?.verificationStatus ?? null,
    candidateProfileId: user.candidateProfile?.id ?? null,
    permissions: (role.permissions.length
      ? role.permissions.map((permission) => permission.key)
      : permissionsFor(user.role as RoleName)) as Principal['permissions'],
  }
}

async function main() {
  const config = aiConfig()
  log('\nLive AI provider check')
  log(`  endpoint ${config.baseUrl ? new URL(config.baseUrl).host : '(unset)'}`)
  log(`  credential configured: ${Boolean(config.apiKey)}`)
  if (!config.apiKey) {
    log('\nNo AI_API_KEY in .env — nothing to probe.')
    process.exit(1)
  }

  const user = await prisma.user.findUnique({
    where: { email: DEMO_EMAIL },
    select: { id: true, name: true, candidateProfile: { select: { id: true } } },
  })
  if (!user?.candidateProfile) {
    log(`\nDemo profile ${DEMO_EMAIL} not found. Run npm run db:seed first.`)
    process.exit(1)
  }

  const principal = await buildPrincipal(user.id)

  /**
   * `--bias` probes the Bias Audit agent instead: its prompt is a few hundred
   * tokens, so it fits inside this key's 8,000 TPM allowance and can complete a
   * real AI-mode run that persists a language review.
   */
  if (process.argv.includes('--bias')) {
    const admin = await prisma.user.findUnique({ where: { email: 'admin@syprus.example.com' }, select: { id: true } })
    const job = await prisma.job.findFirst({ where: { status: 'PUBLISHED' }, select: { id: true, title: true } })
    if (!admin || !job) {
      log('Need a seeded administrator and one published role. Run npm run db:seed first.')
      process.exit(1)
    }

    const reviewer = await buildPrincipal(admin.id)
    log(`\nBias audit, live: "${job.title}"`)
    const started = Date.now()
    const result = await runBiasAudit(reviewer, job.id)
    log(`  mode ${result.outcome.mode}, model ${result.outcome.model}, ${result.outcome.usage.totalTokens} tokens, ${Date.now() - started}ms`)
    log(`  risk ${result.output.overallRisk}, findings ${result.output.findings.length}, continuity checks ${result.output.continuityChecks.length}`)
    if (result.outcome.fallbackReason) log(`  fell back: ${result.outcome.fallbackReason} — ${result.outcome.providerError ?? result.outcome.fallbackNote}`)
    for (const finding of result.output.findings.slice(0, 6)) {
      log(`    [${finding.severity.toLowerCase()}] ${finding.category}: “${finding.excerpt.slice(0, 80)}”`)
    }
    const row = await prisma.languageReview.findUniqueOrThrow({ where: { id: result.review.id } })
    log(`  persisted language_review ${row.id} mode=${row.mode} status=${row.status}; review task queued: ${row.status === 'OPEN' && result.output.reviewRequired}`)
    log('')
    return
  }

  const input = await buildDiscoveryInput(principal, user.candidateProfile.id)
  log(`  probe subject: ${user.name}, ${input.blocks.length} experience block(s), ${input.taxonomy.length} taxonomy skills`)

  const results: { model: string; ok: boolean; detail: string }[] = []

  for (const model of TARGETS) {
    process.env.AI_MODEL = model
    resetAiConfig()
    const provider = createOpenAiCompatibleProvider()
    const started = Date.now()

    try {
      const outcome = await runAgent<DiscoveryInput, DiscoveryOutput>({
        agent: 'SKILLS_DISCOVERY',
        subjectKey: 'live-check',
        input,
        contract: discoveryOutputSchema as never,
        schemaVersion: 'live-check',
        guard: (raw, value) => guardDiscovery(raw, value),
        deterministic: (value) => deterministicDiscovery(value),
        provider,
        config: aiConfig(),
      })

      const invented = outcome.blocked.filter((item) => item.rule === 'unknown-skill').length
      const unquoted = outcome.blocked.filter((item) => item.rule === 'unquoted-evidence').length
      const detail =
        outcome.mode === 'AI'
          ? `${outcome.output.proposals.length} accepted proposal(s), refused ${invented} invented slug(s) and ${unquoted} unquoted evidence, ${outcome.usage.totalTokens} tokens, ${outcome.attempts} attempt(s), ${Date.now() - started}ms`
          : `fell back to the rule engine: ${outcome.fallbackReason}${outcome.providerError ? ` — provider said: ${outcome.providerError.slice(0, 200)}` : ''} — ${Date.now() - started}ms`

      results.push({ model, ok: outcome.mode === 'AI', detail })
      log(`\n  ${outcome.mode === 'AI' ? 'PASS' : 'FALLBACK'}  ${model}\n          ${detail}`)

      for (const proposal of outcome.output.proposals.slice(0, 4)) {
        log(`            · ${proposal.slug} ${proposal.level} @${proposal.confidence.toFixed(2)}${proposal.requiresHumanReview ? ' (human review)' : ''}`)
      }
      for (const blocked of outcome.blocked.slice(0, 5)) {
        log(`            refused [${blocked.rule}] ${blocked.detail}`)
      }
    } catch (error) {
      results.push({ model, ok: false, detail: error instanceof Error ? error.message : String(error) })
      log(`\n  ERROR   ${model}\n          ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  log('\nSummary')
  for (const result of results) log(`  ${result.ok ? 'usable  ' : 'not ok  '} ${result.model}`)

  if (!persist) {
    log('\nProbe only: nothing was written. Re-run with --persist to exercise the product path.\n')
    return
  }

  // Use the best model that actually satisfied the contract.
  const winner = results.find((result) => result.ok)?.model ?? MODELS[0]
  process.env.AI_MODEL = winner
  resetAiConfig()

  log(`\nProduct path with ${winner} (writes ai_runs + ai_proposals)\n`)
  const ran = await runSkillsDiscovery(principal)
  log(`  mode ${ran.mode}, provider ${ran.provider}, model ${ran.model}`)
  log(`  proposals accepted ${ran.output.proposals.length}, refused ${ran.blocked.length}, created ${ran.created}, already held ${ran.skipped}`)
  if (ran.fallbackReason) log(`  fallback: ${ran.fallbackReason} — ${ran.fallbackNote}`)

  const runRow = await prisma.aiRun.findUniqueOrThrow({ where: { id: ran.aiRunId } })
  log(`  persisted ai_run ${runRow.id}: ${runRow.status} ${runRow.mode} ${runRow.model} ${runRow.tokensTotal} tokens ${runRow.durationMs}ms`)

  const proposals = await prisma.aiProposal.findMany({
    where: { aiRunId: ran.aiRunId },
    include: { skill: { select: { name: true, slug: true } } },
    orderBy: { confidence: 'desc' },
    take: 8,
  })
  for (const proposal of proposals) {
    log(`    PROPOSED ${proposal.skill.name} (${proposal.proposedLevel}) @${proposal.confidence.toFixed(2)} review=${proposal.requiresHumanReview}`)
  }
  log('')
}

main()
  .catch((error) => {
    console.error('\nLive check crashed:', error)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
