/**
 * Failover provider probe.
 *
 * Reads the fallback credentials from .env (never from arguments, so a key
 * cannot land in a shell history line), asks each endpoint which models it will
 * serve, then makes one small JSON-mode call to prove the transport works.
 *
 * Prints no secrets: only hosts, model identifiers, token counts and categories.
 *
 *   npx tsx scripts/check-fallback.ts
 *   npx tsx scripts/check-fallback.ts --call=openrouter
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

const ENDPOINTS = [
  {
    name: 'groq',
    keyVar: 'GROQ_API_KEY',
    base: process.env.GROQ_BASE_URL?.trim() || 'https://api.groq.com/openai/v1',
    defaultModels: ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile'],
  },
  {
    name: 'openrouter',
    keyVar: 'OPENROUTER_API_KEY',
    base: process.env.OPENROUTER_BASE_URL?.trim() || 'https://openrouter.ai/api/v1',
    defaultModels: [
      'google/gemini-2.5-flash-lite',
      'meta-llama/llama-3.3-70b-instruct:free',
      'openai/gpt-oss-120b:free',
    ],
  },
  {
    name: 'gemini',
    keyVar: 'GEMINI_API_KEY',
    base: process.env.GEMINI_BASE_URL?.trim() || 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModels: ['gemini-2.5-flash-lite', 'gemini-2.0-flash-lite', 'gemini-2.5-flash'],
  },
]

const wanted = process.argv
  .filter((arg) => arg.startsWith('--call='))
  .flatMap((arg) => arg.slice('--call='.length).split(','))

async function main() {
  console.log('\nFailover provider probe')
  let anyConfigured = false

  for (const endpoint of ENDPOINTS) {
    const key = process.env[endpoint.keyVar]?.trim()
    if (!key) {
      console.log(`  ${endpoint.name}: no credential in .env — skipped`)
      continue
    }
    anyConfigured = true
    console.log(`\n  ${endpoint.name} @ ${new URL(endpoint.base).host}`)

    // 1. Does the key work at all?
    try {
      const response = await fetch(`${endpoint.base}/models`, {
        headers: { authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(20_000),
      })
      const text = await response.text()
      if (!response.ok) {
        console.log(`    models: HTTP ${response.status} — ${text.slice(0, 160).replace(/\s+/g, ' ')}`)
      } else {
        const body = JSON.parse(text) as { data?: { id?: string }[] }
        const ids = (body.data ?? []).map((entry) => entry.id ?? '').filter(Boolean)
        const candidates = [
          ...endpoint.defaultModels.filter((model) => ids.includes(model)),
          ...ids.filter((id) => /(flash-lite|:free|oss-20b|lite)/i.test(id)).slice(0, 8),
        ]
        console.log(`    models: accepted, ${ids.length} listed`)
        console.log(`    usable candidates: ${[...new Set(candidates)].slice(0, 8).join(', ') || 'none matched'}`)
        endpoint.defaultModels = [...new Set(candidates.length ? candidates : endpoint.defaultModels)]
      }
    } catch (error) {
      console.log(`    models: request failed — ${(error as Error).name} ${(error as Error).message.slice(0, 120)}`)
      continue
    }

    if (wanted.length > 0 && !wanted.includes(endpoint.name)) continue

    // 2. Prove one JSON-mode completion.
    for (const model of endpoint.defaultModels.slice(0, 3)) {
      const started = Date.now()
      try {
        const response = await fetch(`${endpoint.base}/chat/completions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
          body: JSON.stringify({
            model,
            temperature: 0,
            max_tokens: 200,
            response_format: { type: 'json_object' },
            messages: [
              {
                role: 'system',
                content: 'Answer with a single JSON object only. No prose, no fence.',
              },
              {
                role: 'user',
                content:
                  'Return {"skills":[{"slug":"stakeholder-management","name":"Stakeholder Management","reason":"coordinated between three teams"}]} for someone who "ran the school parents committee and kept three teams agreeing on the fete date".',
              },
            ],
          }),
          signal: AbortSignal.timeout(45_000),
        })
        const text = await response.text()
        if (!response.ok) {
          const detail = text.replace(/\s+/g, ' ').slice(0, 200)
          console.log(`    call ${model}: HTTP ${response.status} — ${detail}`)
          continue
        }
        const body = JSON.parse(text) as {
          choices?: { message?: { content?: string }; finish_reason?: string }[]
          usage?: { total_tokens?: number }
        }
        const content = body.choices?.[0]?.message?.content ?? ''
        const start = content.indexOf('{')
        const end = content.lastIndexOf('}')
        let parse = 'no-json'
        if (start !== -1 && end > start) {
          try {
            const value = JSON.parse(content.slice(start, end + 1)) as { skills?: unknown[] }
            parse = Array.isArray(value.skills) ? `parsed ${value.skills.length} skill(s)` : 'parsed, no skills array'
          } catch {
            parse = 'malformed json'
          }
        }
        console.log(
          `    call ${model}: ok in ${Date.now() - started}ms · ${body.choices?.[0]?.finish_reason ?? '?'} · ${
            body.usage?.total_tokens ?? 0
          } tokens · ${parse}`,
        )
        break
      } catch (error) {
        console.log(`    call ${model}: failed — ${(error as Error).name} ${(error as Error).message.slice(0, 120)}`)
      }
    }
  }

  if (!anyConfigured) {
    console.log('\n  Nothing to probe: neither OPENROUTER_API_KEY nor GEMINI_API_KEY is set.')
  }
  console.log('')
}

main().catch((error) => {
  console.error('Probe crashed:', error)
  process.exitCode = 1
})
