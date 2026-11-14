/**
 * Per-asset render check.
 *   npx tsx scripts/check-assets.ts <base>
 * For every placement that is reachable on this database, it scrolls the page,
 * finds the image whose optimised source names that asset, and requires it to be
 * actually decoded (naturalWidth > 0) inside a box with real height. A file that
 * is merely present in public/ but never rendered fails here, which is the point.
 */
import { existsSync, readFileSync } from 'node:fs'
import { chromium, type Page } from '@playwright/test'

const BASE = process.argv[2] ?? 'http://localhost:3000'
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

const ACCOUNTS: Record<string, string> = {
  public: '',
  candidate: 'anshika@example.com',
  employer: 'people@meridian.example.com',
  admin: 'admin@syprus.example.com',
}

type Case = { asset: string; scope: keyof typeof ACCOUNTS; path: string; note?: string }

const CASES: Case[] = [
  { asset: 'hero-possibilities', scope: 'public', path: '/' },
  { asset: 'transferable-experience', scope: 'public', path: '/' },
  { asset: 'career-pathway', scope: 'public', path: '/' },
  { asset: 'candidate-return', scope: 'public', path: '/' },
  { asset: 'employer-collaboration', scope: 'public', path: '/' },
  { asset: 'privacy-control', scope: 'public', path: '/' },
  { asset: 'login-workspace', scope: 'public', path: '/login' },
  { asset: 'candidate-new-chapter', scope: 'public', path: '/register' },
  { asset: 'employer-building-team', scope: 'public', path: '/register?role=employer' },
  { asset: 'onboarding-conversation', scope: 'candidate', path: '/candidate/onboarding' },
  { asset: 'review-queue-clear', scope: 'admin', path: '/admin/review', note: 'reached by filtering to a task kind with no open rows' },
]

async function decoded(page: Page, asset: string) {
  await page.evaluate(async () => {
    const height = document.documentElement.scrollHeight
    for (let y = 0; y < height; y += 500) {
      window.scrollTo(0, y)
      await new Promise((resolve) => setTimeout(resolve, 90))
    }
  })
  await page.waitForTimeout(900)
  return page.evaluate((name) => {
    const img = Array.from(document.images).find((entry) => decodeURIComponent(entry.currentSrc || entry.src).includes(name))
    if (!img) return { found: false, natural: 0, width: 0, height: 0 }
    const box = img.getBoundingClientRect()
    return { found: true, natural: img.naturalWidth, width: Math.round(box.width), height: Math.round(box.height) }
  }, asset)
}

async function main() {
  const browser = await chromium.launch()
  const problems: string[] = []
  const byScope = new Map<string, Case[]>()
  for (const item of CASES) byScope.set(item.scope, [...(byScope.get(item.scope) ?? []), item])

  for (const [scope, items] of byScope) {
    const context = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 } })
    const page = await context.newPage()
    if (ACCOUNTS[scope]) {
      await page.goto('/login')
      await page.getByLabel('Email address', { exact: true }).fill(ACCOUNTS[scope])
      await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
      await page.locator('main').getByRole('button', { name: 'Sign in', exact: true }).click()
      await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 60_000 })
    }

    for (const item of items) {
      if (item.path === '/admin/review') {
        // Reach the empty state with real data: filter to a task kind that
        // currently has no open rows instead of pretending the queue is empty.
        await page.goto(item.path)
        // The kind filters are links carrying `kind=`; pick one whose tally is
        // absent, i.e. a task kind with no open rows on this database.
        const kinds = page.locator('main a[href*="kind="]')
        const labels = await kinds.allInnerTexts()
        const index = labels.findIndex((text) => !/\(\d+\)/.test(text))
        if (index === -1) {
          problems.push('every review task kind currently has open rows, so the empty queue state is not reachable here')
          continue
        }
        const href = await kinds.nth(index).getAttribute('href')
        console.log(`     using kind: ${labels[index].trim()} -> ${href}`)
        await page.goto(href ?? item.path)
        await page.waitForTimeout(1500)
      } else {
        await page.goto(item.path)
      }
      const result = await decoded(page, item.asset)
      const ok = result.found && result.natural > 0 && result.height >= 40
      if (!ok) problems.push(`${item.asset} on ${item.scope}${item.path}: ${JSON.stringify(result)}`)
      console.log(`${ok ? 'ok  ' : 'FAIL'} ${item.asset.padEnd(26)} ${item.scope.padEnd(9)} ${item.path}  natural=${result.natural} box=${result.width}x${result.height}${item.note ? `  (${item.note})` : ''}`)
    }
    await context.close()
  }

  await browser.close()
  console.log(problems.length ? `\n${problems.length} problem(s):\n${problems.join('\n')}` : '\nevery reachable asset decoded at its real size')
  process.exitCode = problems.length ? 1 : 0
}

void main()
