/**
 * Email verification, checked in a real browser.
 *
 *   npx tsx scripts/check-verification.ts http://localhost:3000
 *   QA_BASE_URL=http://localhost:3100 npx tsx scripts/check-verification.ts --signup
 *
 * It reports whether this server requires a code, whether the demonstration
 * waiver is switched on and says so on screen, and that a demonstration account
 * still lands in its own portal either way. With `--signup` it also registers an
 * address that no waiver can cover, to prove the code step is reached for it —
 * which writes a throwaway account, so point that run at the QA cluster.
 *
 * The seeded password is read from .env and never printed.
 */
import { chromium, type Page } from '@playwright/test'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'

const args = process.argv.slice(2)
const deep = args.includes('--signup')
const BASE = args.find((a) => a.startsWith('http')) ?? process.env.QA_BASE_URL ?? 'http://localhost:3000'
const shots = '.qa-logs/shots'

function readEnv(name: string): string | undefined {
  for (const file of ['.env', '.env.local']) {
    if (!existsSync(file)) continue
    const match = new RegExp(`^${name}="?([^"\\n]+)"?`, 'm').exec(readFileSync(file, 'utf8'))
    if (match) return match[1]
  }
  return process.env[name]
}

function fromEnv(name: string) {
  const value = readEnv(name)
  if (value === undefined) throw new Error(`${name} is not set in .env`)
  return value
}

async function mailReport() {
  try {
    const response = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(15_000) })
    if (!response.ok) return '  mail  unavailable: server health check failed'
    const health = await response.json() as { mail?: unknown }
    if (health.mail === 'function-configured') {
      return '  mail  Supabase function connection configured; deployment, provider setup and inbox delivery are NOT verified by this check'
    }
    if (health.mail === 'screen-only') return '  mail  preview mode: codes appear on screen; no email is sent'
    if (health.mail === 'not-configured') return '  mail  server configuration missing or invalid; real-address verification is unavailable'
  } catch {
    return '  mail  unknown: server health check could not be read'
  }
  return '  mail  unknown: server did not return a recognized mail configuration status'
}

const results: string[] = []
let failed = 0
function report(ok: boolean, line: string) {
  results.push(`  ${ok ? 'OK  ' : 'FAIL'} ${line}`)
  if (!ok) failed += 1
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto(`${BASE}/login`)
  await page.getByLabel('Email address', { exact: true }).fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.locator('#main').getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 60_000 })
  const codeStep = new URL(page.url()).pathname.startsWith('/verify-email')
  if (codeStep) {
    const preview = page.locator('#verification-preview-code')
    await preview.waitFor({ state: 'visible', timeout: 30_000 })
    await page.getByLabel('Six-digit code', { exact: true }).fill(((await preview.textContent()) ?? '').replace(/\D/g, ''))
    await page.getByRole('button', { name: 'Verify and sign in' }).click()
    await page.waitForURL((url) => !url.pathname.startsWith('/verify-email'), { timeout: 60_000 })
  }
  return { codeStep, path: new URL(page.url()).pathname }
}

async function main() {
  mkdirSync(shots, { recursive: true })
  // The QA cluster is seeded with its own fixed password; the demo server uses
  // whatever SEED_DEMO_PASSWORD holds. Neither value is printed.
  const password = BASE.includes(':3100') ? 'QaDemoOnly!2026' : fromEnv('SEED_DEMO_PASSWORD')
  const browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await context.newPage()
  const run = Date.now().toString(36)

  console.log(`target ${BASE}`)
  console.log(await mailReport())

  await page.goto(`${BASE}/login`)
  const notice = await page.locator('#main').innerText()
  const waiverShown = notice.includes('Sign-in codes are switched off on this server for demonstration accounts.')
  await page.screenshot({ path: `${shots}/verification-login-${new URL(BASE).port}.png` })

  const demo = await signIn(page, 'anshika@example.com', password)
  report(demo.path === '/candidate', `demonstration candidate reached /candidate (${demo.path})`)
  report(
    waiverShown ? !demo.codeStep : demo.codeStep,
    waiverShown
      ? 'with the waiver announced on screen, no code was asked for'
      : 'with no waiver on screen, the code step was required',
  )
  report(
    (await context.request.get(`${BASE}/api/skills`)).status() === 200,
    'the resulting session is a real one (the API answers for it)',
  )

  await context.clearCookies()
  await page.goto(`${BASE}/candidate/gap-report`)
  report(
    new URL(page.url()).pathname.startsWith('/login'),
    `a fresh browser gets no portal by guessing the url (${new URL(page.url()).pathname})`,
  )

  if (deep) {
    await context.clearCookies()
    const realAddress = `qa-uncoded-${run}@syprus-demo.invalid`
    await page.goto(`${BASE}/register`)
    await page.getByLabel('Full name', { exact: true }).fill('Fictional Uncoded Candidate')
    await page.locator('#candidate-email').fill(realAddress)
    await page.locator('#candidate-password').fill(password)
    await page.locator('#candidate-confirm-password').fill(password)
    await page.getByRole('checkbox').check()
    await page.getByRole('button', { name: 'Create candidate account' }).click()
    await page
      .waitForURL((url) => url.pathname !== '/register', { timeout: 30_000 })
      .catch(() => undefined) // staying put is a valid answer, if it says why
    const path = new URL(page.url()).pathname
    const alerts = (await page.getByRole('alert').allInnerTexts())
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
    await page.screenshot({ path: `${shots}/verification-signup-${new URL(BASE).port}.png` })
    report(
      path.startsWith('/verify-email') || /no mail delivery configured|could not be sent/i.test(alerts),
      `a non-demonstration address is never waved through (${
        path.startsWith('/verify-email') ? 'sent to the code screen' : alerts || `nothing on ${path}`
      })`,
    )
    report(!path.startsWith('/candidate'), 'and it is not signed in by registering')
  } else {
    console.log('  (skipped the real-address registration; add --signup, against the QA cluster)')
  }

  await browser.close()
  console.log(results.join('\n'))
  console.log(`\n${failed === 0 ? 'all checks passed' : `${failed} check(s) failed`}`)
  if (failed > 0) process.exitCode = 1
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
