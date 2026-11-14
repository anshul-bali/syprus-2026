/**
 * Dashboard layout + completion-state checker.
 *   npx tsx scripts/check-dashboard-layout.ts <base-url> [prefix] [register]
 * Visits the candidate dashboard at four widths, reports the completion heading
 * the page chose, and measures every element that is actually clipping its own
 * text (that is what "truncated label" means, class-wise and computed-wise).
 * Screenshots land in .qa-logs/. The seeded account is read-only; the "register"
 * argument additionally creates a throwaway account, so only use it against the
 * isolated QA database.
 */
import { existsSync, readFileSync } from 'node:fs'
import { chromium, type Page } from '@playwright/test'

const BASE = process.argv[2] ?? 'http://localhost:3100'
const PREFIX = process.argv[3] ?? 'after'
const ALLOW_REGISTER = process.argv[4] === 'register'
const WIDTHS = [375, 768, 1024, 1440]
// The isolated QA cluster is seeded by scripts/qa.ts with its own demo
// password; anything else (the Supabase demo build) uses the .env value.
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
const ACCOUNTS = [
  { label: 'seeded', email: 'anshika@example.com', create: false },
  ...(ALLOW_REGISTER ? [{ label: 'new', email: `qa-dashboard-${Date.now().toString(36)}@example.com`, create: true }] : []),
]

async function clipped(page: Page) {
  return page.evaluate(() => {
    const out: { text: string; cls: string; clipped: number }[] = []
    for (const node of Array.from(document.querySelectorAll('main *'))) {
      const el = node as HTMLElement
      if (!el.textContent || el.children.length > 0) continue
      const text = el.textContent.trim()
      if (text.length < 3) continue
      const style = getComputedStyle(el)
      // Visually hidden text is clipped on purpose; it is not a layout defect.
      if (el.className.toString().includes('sr-only') || style.position === 'absolute' && style.width === '1px') continue
      const overflowing = el.scrollWidth - el.clientWidth
      if (overflowing > 1 && (style.textOverflow === 'ellipsis' || style.overflow !== 'visible' || el.className.toString().includes('truncate'))) {
        out.push({ text: text.slice(0, 40), cls: el.className.toString().slice(0, 60), clipped: overflowing })
      }
    }
    return out
  })
}

async function main() {
  const browser = await chromium.launch()
  let failures = 0
  for (const account of ACCOUNTS) {
    const context = await browser.newContext({ baseURL: BASE })
    const page = await context.newPage()
    if (account.create) {
      await page.goto('/register')
      await page.getByLabel('Full name', { exact: true }).fill('QA Layout Candidate')
      await page.locator('#candidate-email').fill(account.email)
      await page.locator('#candidate-password').fill('QaLayoutOnly!2026')
      await page.locator('#candidate-confirm-password').fill('QaLayoutOnly!2026')
      await page.getByRole('checkbox').check()
      await page.getByRole('button', { name: 'Create candidate account' }).click()
      await page.waitForURL(/onboarding/, { timeout: 60_000 })
      await page.goto('/candidate')
    } else {
      await page.goto('/login')
      await page.getByLabel('Email address', { exact: true }).fill(account.email)
      await page.getByLabel('Password', { exact: true }).fill(account.create ? 'QaLayoutOnly!2026' : PASSWORD)
      await page.locator('main').getByRole('button', { name: 'Sign in', exact: true }).click()
      await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 60_000 })
    }

    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 })
      await page.goto('/candidate', { waitUntil: 'load' })
      const heading = await page
        .locator('[data-slot="card-title"]')
        .filter({ hasText: /profile is complete|still missing/i })
        .first()
        .innerText()
        .catch(() => '(no heading found)')
      const percent = await page.locator('main').getByText(/^\d+%$/).first().innerText().catch(() => '?')
      const clippedNodes = await clipped(page)
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
      const nextStep = await page.locator('main').getByText(/Next step/i).count()
      const statusLine = await page.getByRole('status').count()
      const bad =
        clippedNodes.length > 0 ||
        overflow > 1 ||
        /Something went wrong/i.test(await page.locator('body').innerText()) ||
        (percent === '100%' ? nextStep > 0 || statusLine === 0 : nextStep === 0)
      failures += bad ? 1 : 0
      console.log(
        `${bad ? 'FAIL' : 'ok  '} ${account.label.padEnd(7)} ${String(width).padStart(4)}px  heading="${heading.replace(/\s+/g, ' ')}" completion=${percent} next-step=${nextStep} status-line=${statusLine} horizontal-overflow=${Math.max(0, overflow)}px`,
      )
      for (const node of clippedNodes.slice(0, 6)) console.log(`       clipped by ${node.clipped}px: "${node.text}" [${node.cls}]`)
      await page.screenshot({ path: `.qa-logs/dashboard-${PREFIX}-${account.label}-${width}.png`, fullPage: true })

      // Same measurement on any extra screens, without screenshots. Git Bash
      // rewrites values that look like absolute paths, so routes are passed
      // without the leading slash and rebuilt here.
      for (const raw of (process.env.EXTRA_ROUTES ?? '').split(',').filter(Boolean)) {
        const route = `${BASE}${raw.startsWith('/') ? raw : `/${raw}`}`
        await page.goto(route, { waitUntil: 'load' })
        const extraClipped = await clipped(page)
        const extraOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
        const extraCrash = /Something went wrong/i.test(await page.locator('body').innerText())
        failures += extraClipped.length || extraOverflow > 1 || extraCrash ? 1 : 0
        console.log(`${extraClipped.length === 0 && extraOverflow <= 1 && !extraCrash ? 'ok  ' : 'FAIL'} ${account.label.padEnd(7)} ${String(width).padStart(4)}px  ${route}${extraCrash ? ' ERROR BOUNDARY' : ''}`)
        for (const node of extraClipped.slice(0, 4)) console.log(`       clipped by ${node.clipped}px: "${node.text}" [${node.cls}]`)
      }
    }
    await context.close()
  }
  await browser.close()
  console.log(failures === 0 ? '\nno clipping at any width' : `\n${failures} width check(s) clipped`)
  process.exitCode = failures === 0 ? 0 : 1
}

void main()
