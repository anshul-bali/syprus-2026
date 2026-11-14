/**
 * Whole-site stability sweep.
 *   npx tsx scripts/sweep-site.ts <base> [QA-demo-password]
 * Crawls every internal page reachable from each portal and the public site, and
 * for each one records: the document status, same-origin subresource failures,
 * console errors, thrown page errors, and whether the page landed on the error
 * boundary. Prints a defect list; exits non-zero when anything is found.
 */
import { existsSync, readFileSync } from 'node:fs'
import { chromium, type BrowserContext, type Page } from '@playwright/test'

const BASE = process.argv[2] ?? 'http://localhost:3100'
// The QA cluster is seeded with its own demo password; anything else reads the
// value from .env so it never appears on a command line or in a log.
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
const ROOTS = [
  { scope: 'public', email: '', starts: ['/', '/login', '/register', '/register?role=employer'] },
  { scope: 'candidate', email: 'anshika@example.com', starts: ['/candidate'] },
  { scope: 'employer', email: 'people@meridian.example.com', starts: ['/employer'] },
  { scope: 'admin', email: 'admin@syprus.example.com', starts: ['/admin'] },
]

type Finding = { url: string; kind: string; detail: string }

async function collect(page: Page, start: string, seen: Set<string>, findings: Finding[], maxPages: number) {
  const queue = [start]
  while (queue.length && seen.size < maxPages) {
    const url = queue.shift()!
    if (seen.has(url)) continue
    seen.add(url)

    const failures: string[] = []
    const errors: string[] = []
    const onResponse = (response: { status: () => number; url: () => string }) => {
      const sameOrigin = response.url().startsWith(BASE)
      if (sameOrigin && response.status() >= 400 && !/\/api\/auth/.test(response.url())) {
        failures.push(`${response.status()} ${response.url().replace(BASE, '')}`)
      }
    }
    page.on('response', onResponse)
    page.on('requestfailed', (request) => {
      // App Router prefetches (`?_rsc=`) are cancelled whenever navigation
      // happens. That is the framework working, not a defect, and it accounts
      // for every aborted request seen so far.
      if (/_rsc=/.test(request.url())) return
      if (request.url().startsWith(BASE)) failures.push(`FAILED ${request.url().replace(BASE, '')} ${request.failure()?.errorText ?? ''}`)
    })
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text().replace(/\s+/g, ' ').slice(0, 180))
    })
    page.on('pageerror', (error) => errors.push(`pageerror: ${error.message.slice(0, 180)}`))

    let finalUrl = url
    try {
      await page.goto(url, { waitUntil: 'load', timeout: 45_000 })
      await page.waitForTimeout(700)
      finalUrl = new URL(page.url()).pathname + new URL(page.url()).search
    } catch (error) {
      findings.push({ url, kind: 'navigation', detail: String(error).slice(0, 160) })
    }

    const body = await page.locator('body').innerText({ timeout: 5_000 }).catch(() => '')
    if (/Something went wrong/i.test(body)) findings.push({ url: finalUrl, kind: 'error-boundary', detail: body.replace(/\s+/g, ' ').slice(0, 200) })
    for (const item of new Set(failures)) findings.push({ url: finalUrl, kind: 'subresource', detail: item })
    for (const item of [...new Set(errors)].filter((text) => !/favicon|ResizeObserver|Download the React DevTools/i.test(text))) {
      findings.push({ url: finalUrl, kind: 'console', detail: item })
    }

    const links = await page
      .evaluate(() => Array.from(document.querySelectorAll('main a[href], header a[href]')).map((anchor) => (anchor as HTMLAnchorElement).getAttribute('href') ?? ''))
      .catch(() => [] as string[])
    for (const href of links) {
      if (!href.startsWith('/') || href.startsWith('//')) continue
      if (/\.(svg|png|webp|jpg|ico|css|js)$/.test(href)) continue
      if (/\/(logout|signout)/.test(href)) continue
      if (!queue.includes(href) && !seen.has(href)) queue.push(href)
    }
    page.removeAllListeners('response')
    page.removeAllListeners('requestfailed')
    page.removeAllListeners('console')
    page.removeAllListeners('pageerror')
  }
}

async function main() {
  const browser = await chromium.launch()
  const findings: Finding[] = []
  let visited = 0
  for (const root of ROOTS) {
    const context: BrowserContext = await browser.newContext({ baseURL: BASE, viewport: { width: 1280, height: 900 } })
    const page = await context.newPage()
    if (root.email) {
      await page.goto('/login')
      await page.getByLabel('Email address', { exact: true }).fill(root.email)
      await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
      await page.locator('main').getByRole('button', { name: 'Sign in', exact: true }).click()
      await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 60_000 })
    }
    const seen = new Set<string>()
    for (const start of root.starts) await collect(page, start, seen, findings, 60)
    visited += seen.size
    console.log(`${root.scope.padEnd(10)} visited ${seen.size}`)
    await context.close()
  }
  await browser.close()
  console.log(`\n${visited} pages checked, ${findings.length} finding(s)`)
  for (const finding of findings) console.log(`  [${finding.kind}] ${finding.url} — ${finding.detail}`)
  process.exitCode = findings.length === 0 ? 0 : 1
}

void main()
