/**
 * Reproduction + verification harness for the shared account menu.
 * Run it against a dev server so an unminified Base UI invariant message and
 * stack survive (production minifies both):
 *   npx tsx scripts/qa.ts dev
 *   npx tsx scripts/repro-account-menu.ts [screenshot-prefix]
 * For each portal it opens the account menu by pointer and by keyboard, prints
 * what the menu actually rendered, follows sign-out to a signed-out request, and
 * reports the error boundary as a failure instead of cascading from it.
 * Exits non-zero when anything failed.
 */
import { existsSync, readFileSync } from 'node:fs'
import { chromium, type Page } from '@playwright/test'

const BASE = process.env.REPRO_BASE ?? 'http://localhost:3100'
// The isolated QA cluster is seeded by scripts/qa.ts; the demo build uses the
// .env value. Either way the password is read here, never passed on a command line.
const PASSWORD = BASE.includes(':3100')
  ? 'QaDemoOnly!2026'
  : (() => {
      for (const file of ['.env', '.env.local']) {
        if (!existsSync(file)) continue
        const match = /^SEED_DEMO_PASSWORD="?([^"\n]+)"?/m.exec(readFileSync(file, 'utf8'))
        if (match) return match[1]
      }
      throw new Error('SEED_DEMO_PASSWORD is not set in .env')
    })()
const SHOT_PREFIX = process.argv[2] ?? 'after'
const ACCOUNTS = [
  { label: 'candidate', email: 'anshika@example.com', home: '/candidate', routes: ['/candidate', '/candidate/suggestions'] },
  { label: 'employer', email: 'people@meridian.example.com', home: '/employer', routes: ['/employer', '/employer/shortlist'] },
  { label: 'admin', email: 'admin@syprus.example.com', home: '/admin', routes: ['/admin', '/admin/engines'] },
]

async function crashText(page: Page) {
  const body = await page.locator('body').innerText({ timeout: 5_000 }).catch(() => '')
  return /Something went wrong/i.test(body) ? body.replace(/\s+/g, ' ').slice(0, 140) : ''
}

async function main() {
  const browser = await chromium.launch()
  let failures = 0
  for (const account of ACCOUNTS) {
    const context = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 } })
    const page = await context.newPage()
    const causes: string[] = []
    page.on('pageerror', (error) => causes.push((error.stack ?? error.message).split('\n').slice(0, 2).join(' | ')))
    page.on('console', (message) => {
      const text = message.text().replace(/\s+/g, ' ')
      if (/Base UI|MenuGroupContext/.test(text)) causes.push(text.slice(0, 220))
    })

    await page.goto('/login')
    await page.getByLabel('Email address', { exact: true }).fill(account.email)
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
    await page.locator('main').getByRole('button', { name: 'Sign in', exact: true }).click()
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 60_000 })

    const trigger = page.locator('[data-slot="dropdown-menu-trigger"]')
    for (const route of account.routes) {
      await page.goto(route, { waitUntil: 'load' })
      await page.waitForSelector('[data-slot="dropdown-menu-trigger"]', { timeout: 60_000 })
      const label = (await trigger.innerText()).replace(/\s+/g, ' ')
      causes.length = 0
      await trigger.click()
      await page.waitForTimeout(1200)
      const crashed = await crashText(page)
      const popup = page.locator('[data-slot="dropdown-menu-content"]')
      const opened = !crashed && (await popup.isVisible().catch(() => false))
      const contents = opened ? (await popup.innerText()).replace(/\s+/g, ' ') : crashed ? `error boundary: ${crashed}` : '(no popup)'
      failures += opened ? 0 : 1
      console.log(`${opened ? 'ok   ' : 'FAIL '} ${account.label.padEnd(9)} pointer-open ${route.padEnd(24)} trigger="${label}"`)
      console.log(`      ${contents.slice(0, 170)}`)
      if (!opened && causes.length) console.log(`      cause: ${causes[0]}`)
      if (route === account.home) await page.screenshot({ path: `.qa-logs/menu-${SHOT_PREFIX}-${account.label}.png` })
      await page.reload({ waitUntil: 'load' }).catch(() => {})
    }

    // Keyboard-only operation: focus the trigger, Enter to open, arrows to move, Escape to close.
    await page.goto(account.home, { waitUntil: 'load' })
    await page.waitForSelector('[data-slot="dropdown-menu-trigger"]', { timeout: 60_000 })
    causes.length = 0
    await trigger.focus()
    await page.keyboard.press('Enter')
    await page.waitForTimeout(1000)
    const popup = page.locator('[data-slot="dropdown-menu-content"]')
    const keyboardOpened = !(await crashText(page)) && (await popup.isVisible().catch(() => false))
    if (keyboardOpened) {
      await page.keyboard.press('ArrowDown')
      await page.keyboard.press('ArrowUp')
    }
    const focused = await page.evaluate(() => document.activeElement?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 24) ?? '')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(400)
    const stillOpen = await popup.isVisible().catch(() => false)
    const keyboardOk = keyboardOpened && !stillOpen
    failures += keyboardOk ? 0 : 1
    console.log(
      `${keyboardOk ? 'ok   ' : 'FAIL '} ${account.label.padEnd(9)} keyboard       opened=${keyboardOpened} focus="${focused}" escape-closes=${!stillOpen}`,
    )
    if (!keyboardOk && causes.length) console.log(`      cause: ${causes[0]}`)
    if (!keyboardOpened) {
      await context.close()
      continue
    }

    // Sign out from the menu item itself, then prove the session is really gone.
    await trigger.click()
    await page.getByRole('menuitem', { name: /Sign out/ }).click()
    await page.waitForURL((url) => url.pathname === '/', { timeout: 30_000 }).catch(() => {})
    const landed = new URL(page.url()).pathname
    await page.goto(account.home)
    const afterSignOut = new URL(page.url()).pathname
    const signedOut = landed === '/' && afterSignOut.startsWith('/login')
    failures += signedOut ? 0 : 1
    console.log(`${signedOut ? 'ok   ' : 'FAIL '} ${account.label.padEnd(9)} sign-out       landed=${landed} ${account.home} -> ${afterSignOut}`)
    await context.close()
  }
  await browser.close()
  console.log(failures === 0 ? '\nall account-menu checks passed' : `\n${failures} account-menu check(s) failed`)
  process.exitCode = failures === 0 ? 0 : 1
}

void main()
