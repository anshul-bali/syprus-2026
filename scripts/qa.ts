import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * `tsx` and `next` do not load `.env` for a plain script, so the live-agent
 * commands read the AI settings from the file themselves. Values are passed only
 * into the child environment and never printed.
 */
function fromEnvFile(names: string[]) {
  const found: Record<string, string> = {}
  for (const file of ['.env', '.env.local']) {
    if (!existsSync(file)) continue
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
      if (match && names.includes(match[1]) && !process.env[match[1]]) found[match[1]] = match[2].replace(/^"|"$/g, '').trim()
    }
  }
  return found
}

const commands: Record<string, string[]> = {
  migrate: ['prisma/build/index.js', 'migrate', 'deploy'],
  seed: ['tsx/dist/cli.mjs', 'prisma/seed.ts'],
  dev: ['next/dist/bin/next', 'dev', '--port', '3100'],
  build: ['next/dist/bin/next', 'build'],
  start: ['next/dist/bin/next', 'start', '--port', '3100'],
  browser: ['@playwright/test/cli.js', 'test'],
  integration: ['tsx/dist/cli.mjs', 'tests/integration.ts'],
  demo: ['tsx/dist/cli.mjs', 'scripts/demo-audit.ts'],
  'ai-demo': ['tsx/dist/cli.mjs', 'scripts/seed-ai-demo.ts'],
  'check-ai': ['tsx/dist/cli.mjs', 'scripts/check-ai.ts'],
}
const command = commands[process.argv[2]]
if (!command) throw new Error(`Choose ${Object.keys(commands).join(', ')}.`)
const databaseUrl = 'postgresql://syprus:syprus_qa_local@localhost:55433/syprus_qa'
// Live-agent commands keep whatever credentials and AI settings .env carries;
// every other QA command runs the deterministic engines so results repeat.
const liveAi = process.argv[2] === 'ai-demo' || process.argv[2] === 'check-ai'
// Production builds (and the server that serves them) get their own directory:
// sharing `.next-qa` with the running dev server would corrupt the cache under
// test, and `next start` must read the same distDir `next build` wrote.
const distDir = process.argv[2] === 'build' || process.argv[2] === 'start' ? '.next-qa-build' : '.next-qa'
const AI_VARS = ['AI_ENABLED', 'AI_PROVIDER', 'AI_BASE_URL', 'AI_MODEL', 'AI_API_KEY', 'AI_MAX_TOKENS', 'AI_TIMEOUT_MS',
  'AI_MAX_RETRIES', 'AI_RATE_LIMIT_PER_MIN', 'AI_TOKENS_PER_MINUTE', 'AI_BUDGET_TOKENS_PER_DAY', 'AI_FAILOVER_ENABLED',
  'OPENROUTER_API_KEY', 'OPENROUTER_MODEL', 'GEMINI_API_KEY', 'GEMINI_MODEL']
const fileEnv = liveAi ? fromEnvFile(AI_VARS) : {}
const value = (name: string) => process.env[name] ?? fileEnv[name]
const child = spawn(process.execPath, [path.join('node_modules', command[0]), ...command.slice(1), ...process.argv.slice(3)], {
  stdio: 'inherit',
  env: { ...process.env, DATABASE_URL: databaseUrl, DIRECT_DATABASE_URL: databaseUrl,
    AUTH_SECRET: 'local-qa-only-auth-secret-never-use-in-production', AUTH_URL: 'http://localhost:3100', AUTH_TRUST_HOST: 'true',
    SEED_DEMO_PASSWORD: 'QaDemoOnly!2026',
    AI_ENABLED: liveAi ? (value('AI_ENABLED') ?? 'true') : 'false',
    AI_PROVIDER: liveAi ? (value('AI_PROVIDER') ?? 'openai-compatible') : 'deterministic',
    AI_FAILOVER_ENABLED: liveAi ? (value('AI_FAILOVER_ENABLED') ?? 'true') : 'false',
    AI_API_KEY: liveAi ? value('AI_API_KEY') : undefined,
    AI_BASE_URL: liveAi ? value('AI_BASE_URL') : undefined,
    AI_MODEL: liveAi ? value('AI_MODEL') : undefined,
    AI_MAX_TOKENS: liveAi ? value('AI_MAX_TOKENS') : undefined,
    AI_TIMEOUT_MS: liveAi ? value('AI_TIMEOUT_MS') : undefined,
    AI_MAX_RETRIES: liveAi ? value('AI_MAX_RETRIES') : undefined,
    AI_RATE_LIMIT_PER_MIN: liveAi ? value('AI_RATE_LIMIT_PER_MIN') : undefined,
    AI_TOKENS_PER_MINUTE: liveAi ? value('AI_TOKENS_PER_MINUTE') : undefined,
    AI_BUDGET_TOKENS_PER_DAY: liveAi ? value('AI_BUDGET_TOKENS_PER_DAY') : undefined,
    OPENROUTER_API_KEY: liveAi ? value('OPENROUTER_API_KEY') : undefined,
    OPENROUTER_MODEL: liveAi ? value('OPENROUTER_MODEL') : undefined,
    GEMINI_API_KEY: liveAi ? value('GEMINI_API_KEY') : undefined,
    GEMINI_MODEL: liveAi ? value('GEMINI_MODEL') : undefined,
    NEXT_DIST_DIR: distDir, UPLOAD_STORAGE_DIR: 'qa',
    // This cluster is disposable: a local Postgres on 55433 that the seed wipes
    // and rebuilds. Declaring it is what allows the seed to run and what allows
    // MAIL_MODE=preview below to keep codes on screen. A deployed server sets
    // neither, so both refuse there.
    SYPRUS_DEMO_ENV: 'true',
    SEED_ALLOW_RESET: 'true',
    // The QA cluster proves the gated flow: every suite signs in through a code,
    // so the demonstration waiver that .env may carry for the demo server is
    // switched off here. A value already in the environment beats the .env file,
    // which is what makes the browser and integration results mean something.
    DEMO_SKIP_EMAIL_CODE: 'false',
    // No QA run may put a letter on the internet. `preview` keeps every code on
    // the entry screen — which is what the browser suites read — and means the
    // Supabase mail function is never called, whatever .env carries for project
    // URL and key. The delivery path itself is proven live, by name, on the demo
    // server; a test cluster that mailed for real would be a test cluster
    // sending strangers' codes to whoever the suite registered last.
    MAIL_MODE: 'preview',
    // A suite signs the same seeded accounts in a dozen times, which would trip
    // the production send ceiling and turn a passing flow into a rate-limit
    // message. The ceiling itself is still tested — tests/integration.ts drives
    // it at a number it picks for itself.
    VERIFICATION_MAX_SENDS_PER_HOUR: '120',
  },
})
child.on('exit', (code) => { process.exitCode = code ?? 1 })
child.on('error', (error) => { console.error(error.message); process.exitCode = 1 })
