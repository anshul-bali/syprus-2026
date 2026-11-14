/**
 * Dark-mode pass over the real screens: forces the theme, reads the computed
 * surfaces, and captures the pages a reviewer would compare.
 *   npx tsx scripts/check-dark-mode.ts <base>
 */
import { existsSync, readFileSync, mkdirSync } from 'node:fs'
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

mkdirSync('.qa-logs/shots', { recursive: true })
const problems: string[] = []

function check(condition: boolean, label: string, detail = '') {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
  if (!condition) problems.push(`${label}: ${detail}`)
}

/** luminance from a computed rgb() colour, for a rough contrast floor. */
async function contrastPair(page: Page, selector: string) {
  return page.evaluate((target) => {
    const out: { text: string; ratio: number; fg: string; bg: string }[] = []
    for (const node of Array.from(document.querySelectorAll<HTMLElement>(target))) {
      const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim()
      if (text.length < 8 || node.children.length > 0) continue
      const style = getComputedStyle(node)
      if (style.visibility === 'hidden' || style.display === 'none') continue
      let bg = 'rgba(0, 0, 0, 0)'
      let element: HTMLElement | null = node
      while (element) {
        const value = getComputedStyle(element).backgroundColor
        // An alpha of 0 means the surface is see-through; keep walking up.
        if (!/,\s*0\)$/.test(value)) {
          bg = value
          break
        }
        element = element.parentElement
      }
      // Anonymous so the bundler does not name-annotate a function that only
      // ever exists inside the browser.
      const luminances = [style.color, bg].map((value) => {
        const match = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/.exec(value)
        if (!match) return null
        const [r, g, b] = [Number(match[1]), Number(match[2]), Number(match[3])].map((v) => {
          const c = v / 255
          return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
        })
        return 0.2126 * r + 0.7152 * g + 0.0722 * b
      })
      const fg = luminances[0]
      const bgL = luminances[1]
      if (fg == null || bgL == null) continue
      const [light, dark] = fg > bgL ? [fg, bgL] : [bgL, fg]
      out.push({ text: text.slice(0, 48), ratio: (light + 0.05) / (dark + 0.05), fg: style.color, bg })
    }
    return out
  }, selector)
}

async function signIn(page: Page, email: string) {
  await page.goto('/login')
  await page.getByLabel('Email address', { exact: true }).fill(email)
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
  await page.locator('main').getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 60_000 })
}

async function main() {
  const browser = await chromium.launch()
  const context = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 1500 } })
  await context.addInitScript(() => localStorage.setItem('theme', 'dark'))
  const page = await context.newPage()
  const consoleErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('?_rsc=')) consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => consoleErrors.push(String(error)))

  await page.goto('/')
  await page.waitForLoadState('networkidle')

  const htmlClass = await page.evaluate(() => document.documentElement.className)
  check(/\bdark\b/.test(htmlClass), 'the stored preference applies the dark class before paint', htmlClass.slice(0, 80))

  const surfaces = await page.evaluate(() => {
    const cs = getComputedStyle(document.body)
    return { background: cs.backgroundColor, foreground: cs.color }
  })
  console.log('  body surfaces:', JSON.stringify(surfaces))

  const toggle = page.getByRole('button', { name: /Colour theme/i }).first()
  check((await toggle.count()) === 1, 'the public header offers a theme control', (await toggle.getAttribute('aria-label')) ?? '')
  await toggle.click()
  await page.waitForTimeout(500)
  const afterClick = await page.evaluate(() => document.documentElement.className)
  check(!/\bdark\b/.test(afterClick), 'the control really switches the theme', afterClick.slice(0, 60))
  await toggle.click()
  await page.waitForTimeout(400)

  const screens: [string, string, string][] = [
    ['home', '/', 'main'],
    ['login', '/login', 'main'],
    ['candidate', '/candidate', 'main'],
    ['gap', '/candidate/gap-report', 'main'],
    ['graph', '/candidate/graph', 'main'],
    ['pathways', '/candidate/pathways', 'main'],
    ['applications', '/candidate/applications', 'main'],
  ]

  await signIn(page, 'anshika@example.com')
  for (const [name, route, scope] of screens) {
    if (route === '/' || route === '/login') continue
    await page.goto(route)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(900)
    await page.screenshot({ path: `.qa-logs/shots/dark-${name}-1440.png`, fullPage: true })
    const low = (await contrastPair(page, `${scope} p, ${scope} li, ${scope} span, ${scope} td, ${scope} th, ${scope} summary`)).filter(
      (row) => row.ratio < 3.6,
    )
    check(low.length === 0, `dark contrast on ${route}`, low.slice(0, 3).map((row) => `${row.ratio.toFixed(1)}: ${row.text}`).join(' | '))
  }

  for (const [email, routes] of [
    ['people@meridian.example.com', ['/employer', '/employer/applications', '/employer/candidates']],
    ['admin@syprus.example.com', ['/admin', '/admin/engines', '/admin/fairness', '/admin/review']],
  ] as const) {
    await signIn(page, email)
    for (const route of routes) {
      await page.goto(route)
      await page.waitForLoadState('networkidle')
      await page.waitForTimeout(900)
      const name = route.replace(/\//g, '-').replace(/^-/, '')
      await page.screenshot({ path: `.qa-logs/shots/dark${name}-1440.png`, fullPage: true })
      const low = (await contrastPair(page, 'main p, main li, main span, main td, main th, main summary')).filter((row) => row.ratio < 3.6)
      check(low.length === 0, `dark contrast on ${route}`, low.slice(0, 3).map((row) => `${row.ratio.toFixed(1)}: ${row.text}`).join(' | '))
    }
  }

  // Public pages in dark, including the new hero pairing.
  for (const route of ['/', '/login', '/register']) {
    await page.setViewportSize({ width: 1440, height: 1500 })
    await page.goto(route)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1000)
    const low = (await contrastPair(page, 'main p, main li, main span, main summary, main h2, main h3, main dd')).filter(
      (row) => row.ratio < 3.6,
    )
    check(low.length === 0, `dark contrast on ${route}`, low.slice(0, 3).map((row) => `${row.ratio.toFixed(1)}: ${row.text}`).join(' | '))
  }

  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(1000)
  await page.screenshot({ path: '.qa-logs/shots/dark-home-1440.png', fullPage: false })
  await page.setViewportSize({ width: 375, height: 1200 })
  await page.waitForTimeout(700)
  await page.screenshot({ path: '.qa-logs/shots/dark-home-375.png', fullPage: false })

  check(consoleErrors.length === 0, 'no console or page errors', consoleErrors.slice(0, 4).join(' | '))

  await browser.close()
  if (problems.length) {
    console.log(`\n${problems.length} problem(s):`)
    for (const problem of problems) console.log(` - ${problem}`)
    process.exit(1)
  }
  console.log('\nDark mode holds up across the screens checked.')
}

main()
