/**
 * Failover proof.
 *
 * Reads the credentials from .env, asks each configured endpoint for the same
 * tiny structured answer, and then breaks the primary on purpose to show that
 * the chain actually moves to the next endpoint instead of falling straight to
 * the rule engines.
 *
 *   npx tsx scripts/check-failover.ts
 *   npx tsx scripts/check-failover.ts --persist   # write a real ai_runs row
 */

import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(__dirname, '..')

function loadEnv() {
  for (const file of ['.env', '.env.local']) {
    const path = resolve(ROOT, file)
    if (!existsSync(path)) continue
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
      if (match && !process.env[match[1]]) {
        process.env[match[1]] = match[2].replace(/^"|"$/g, '').trim()
      }
    }
  }
}

loadEnv()

const PROMPT =
  'A person wrote: “I ran the school parents committee and kept three teams agreeing on the fete date.” ' +
  'Return {"proposals":[{"slug":"stakeholder-management","name":"Stakeholder Management","reason":"kept three teams aligned","quote":"kept three teams agreeing on the fete date","level":"PROFICIENT","confidence":0.7}],"summary":"string","professionallyVerified":false}'

async function main() {
  const { aiEndpoints, aiConfigSummary, resetAiConfig, resetAiEndpoints } = await import('../src/lib/ai/config')
  const { createOpenAiCompatibleProvider } = await import('../src/lib/ai/providers/openai-compatible')
  const { createFailoverProvider } = await import('../src/lib/ai/providers/failover')
  const { ProviderError } = await import('../src/lib/ai/provider')
  const { resetRateLimitState } = await import('../src/lib/ai/rate-limit')

  console.log('\nFailover proof')
  const summary = aiConfigSummary()
  console.log(`  primary: ${summary.model} @ ${summary.baseUrl} (credential ${summary.credentialConfigured})`)
  console.log(`  chain:   ${summary.chain.map((entry) => `${entry.name}/${entry.model}`).join(' → ') || 'none'}`)

  resetRateLimitState()
  const endpoints = aiEndpoints()
  if (endpoints.length < 2) {
    console.log('\n  Need at least two configured endpoints to prove failover. Add a fallback credential to .env.')
    process.exitCode = 1
    return
  }

  // 1. Every endpoint on its own.
  console.log('\n  Direct calls')
  for (const endpoint of endpoints) {
    const provider = createOpenAiCompatibleProvider(endpoint)
    const started = Date.now()
    try {
      const result = await provider.complete({
        agent: 'FAILOVER_PROBE',
        messages: [
          { role: 'system', content: 'Reply with one JSON object and nothing else.' },
          { role: 'user', content: PROMPT },
        ],
        outputContract: '{proposals:[{slug,name,reason,quote,level,confidence}],summary,professionallyVerified:false}',
        temperature: 0,
        maxTokens: 500,
        timeoutMs: 45_000,
        maxRetries: 0,
      })
      const proposals = (result.json as { proposals?: unknown[] }).proposals
      console.log(
        `    PASS  ${endpoint.name.padEnd(11)} ${String(Date.now() - started).padStart(5)}ms  ${result.usage.totalTokens} tokens  ${
          Array.isArray(proposals) ? `${proposals.length} proposal(s)` : 'no proposals array'
        }`,
      )
    } catch (error) {
      const category = error instanceof ProviderError ? error.category : 'unknown'
      const message = error instanceof Error ? error.message.replace(/\s+/g, ' ').slice(0, 140) : String(error)
      console.log(`    FAIL  ${endpoint.name.padEnd(11)} ${category} — ${message}`)
    }
  }

  // 2. Break the primary and show the chain still answers.
  console.log('\n  Chain with the primary pointed at a model that does not exist')
  resetRateLimitState()
  resetAiConfig()
  resetAiEndpoints()
  const broken: typeof endpoints = [
    { ...endpoints[0], model: 'this-model-does-not-exist-syprus-probe' },
    ...endpoints.slice(1),
  ]
  const trace: string[] = []
  const chain = createFailoverProvider({
    endpoints: broken,
    onAttempt: (attempt) => trace.push(`${attempt.provider}:${attempt.outcome.toLowerCase()}`),
  })

  try {
    const result = await chain.complete({
      agent: 'FAILOVER_PROBE',
      messages: [
        { role: 'system', content: 'Reply with one JSON object and nothing else.' },
        { role: 'user', content: PROMPT },
      ],
      outputContract: '{proposals:[…],summary,professionallyVerified:false}',
      temperature: 0,
      maxTokens: 500,
      timeoutMs: 45_000,
      maxRetries: 0,
    })
    console.log(`    PASS  answered by ${result.provider} (${result.model}) after ${trace.length} attempt(s)`)
    console.log(`          chain: ${trace.join(' → ')}`)

    if (process.argv.includes('--persist')) {
      const { prisma } = await import('../src/lib/db')
      const row = await prisma.aiRun.create({
        data: {
          agent: 'SKILLS_DISCOVERY',
          status: 'SUCCESS',
          mode: 'AI',
          provider: result.provider,
          model: result.model,
          promptVersion: 'failover-proof',
          schemaVersion: 'failover-proof',
          attempts: trace.length,
          durationMs: result.latencyMs,
          tokensPrompt: result.usage.promptTokens,
          tokensCompletion: result.usage.completionTokens,
          tokensTotal: result.usage.totalTokens,
          inputSummary: { note: 'written by scripts/check-failover.ts --persist' },
          outputSummary: { proposals: (result.json as { proposals?: unknown[] }).proposals?.length ?? 0 },
          finishedAt: new Date(),
        },
        select: { id: true, provider: true, model: true },
      })
      console.log(`    wrote ai_runs row ${row.id} provider=${row.provider} model=${row.model}`)
      await prisma.$disconnect()
    }
  } catch (error) {
    console.log(`    FAIL  no endpoint answered — ${error instanceof Error ? error.message.slice(0, 200) : String(error)}`)
    console.log(`          chain: ${trace.join(' → ') || 'nothing attempted'}`)
    process.exitCode = 1
  }

  console.log('')
}

main().catch((error) => {
  console.error('Failover probe crashed:', error)
  process.exitCode = 1
})
