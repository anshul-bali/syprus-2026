/**
 * Login check for the demo accounts. Reads the seeded password from .env and
 * reports whether each role can sign in — the value itself is never printed,
 * so this can be run in front of an audience or pasted into a shared log.
 *
 * Sign-in is two steps now: password, then a six-digit code. Every account here
 * lives on a reserved example domain, which no mailer delivers to, so the code is
 * shown on the screen and this script reads it back off that screen.
 */
import { chromium, type Page } from '@playwright/test'
import { readFileSync, existsSync } from 'node:fs'

function fromEnv(name: string) {
  for (const file of ['.env', '.env.local']) {
    if (!existsSync(file)) continue
    const match = new RegExp(`^${name}="?([^"\\n]+)"?`, 'm').exec(readFileSync(file, 'utf8'))
    if (match) return match[1]
  }
  throw new Error(`${name} is not set in .env`)
}

const BASE = process.env.QA_BASE_URL ?? 'http://localhost:3000'

const ACCOUNTS = [
  ['candidate', 'anshika@example.com', '/candidate'],
  ['employer (her target)', 'people@meridian.example.com', '/employer'],
  ['employer (other)', 'recruitment@ashford.example.com', '/employer'],
  ['employer (unverified)', 'people@lumen.example.com', '/employer'],
  ['administrator', 'admin@syprus.example.com', '/admin'],
]

/** Passes the code screen if there is one; returns the text shown when there is not. */
async function completeCodeStep(page: Page) {
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 25_000 })
  if (!new URL(page.url()).pathname.startsWith('/verify-email')) return null

  const preview = page.locator('#verification-preview-code')
  await preview.waitFor({ state: 'visible', timeout: 15_000 })
  const code = (await preview.textContent())?.replace(/\D/g, '') ?? ''
  if (code.length !== 6) throw new Error(`preview code was not six digits: "${code}"`)

  await page.getByLabel('Six-digit code', { exact: true }).fill(code)
  await page.getByRole('button', { name: /Verify and sign in|Confirm and continue/ }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/verify-email'), { timeout: 25_000 })
  return null
}

async function main() {
  const password = fromEnv('SEED_DEMO_PASSWORD')
  console.log(`target ${BASE}`)
  console.log(`password read from .env (${password.length} characters, not shown)\n`)
  const browser = await chromium.launch()
  const context = await browser.newContext()
  const page = await context.newPage()
  try {
    for (const [label, email, landing] of ACCOUNTS) {
      await page.goto(`${BASE}/login`)
      await page.getByLabel('Email address', { exact: true }).fill(email)
      await page.getByLabel('Password', { exact: true }).fill(password)
      await page.locator('main').getByRole('button', { name: 'Sign in', exact: true }).click()
      try {
        await completeCodeStep(page)
        const landed = new URL(page.url()).pathname
        const matches = landed === landing || landed.startsWith(`${landing}/`)
        console.log(
          `  ${matches ? 'OK   ' : 'WRONG'} ${label.padEnd(22)} ${email.padEnd(34)} landed on ${landed}${matches ? '' : ` (expected ${landing})`}`,
        )
      } catch {
        const message = (await page.locator('main').innerText()).replace(/\s+/g, ' ').slice(0, 110)
        console.log(`  FAIL  ${label.padEnd(22)} ${email.padEnd(34)} ${message}`)
      }
      await context.clearCookies()
    }
    console.log('\nTo see the value yourself:  grep SEED_DEMO_PASSWORD .env')
  } finally {
    await browser.close()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
