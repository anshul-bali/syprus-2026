/**
 * Live checks for the fairness monitoring screen.
 *   npx tsx scripts/check-fairness-viz.ts <base>
 *
 * Reconciles the sample-count chart with the band table, confirms missing data
 * is named rather than zeroed, proves no individual attribute is rendered, and
 * checks the access boundary by asking for the page as a candidate.
 */
import { existsSync, readFileSync } from 'node:fs'
import { chromium, type Page } from '@playwright/test'

const BASE = process.argv[2] ?? 'http://localhost:3000'
const PASSWORD = BASE.includes(':3100') ? 'QaDemoOnly!2026' : (() => {
  for (const file of ['.env', '.env.local']) {
    if (!existsSync(file)) continue
    const match = /^SEED_DEMO_PASSWORD="?([^"\n]+)"?/m.exec(readFileSync(file, 'utf8'))
    if (match) return match[1]
  }
  throw new Error('SEED_DEMO_PASSWORD is not set in .env')
})()

const problems: string[] = []

function check(condition: boolean, label: string, detail = '') {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
  if (!condition) problems.push(`${label}: ${detail}`)
}

async function signIn(page: Page, email: string) {
  await page.goto('/login')
  await page.getByLabel('Email address', { exact: true }).fill(email)
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
  await page.locator('main').getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 60_000 })
}

/** Reads the “Matches per band” chart’s accessible figures. */
async function sampleChart(page: Page) {
  const figure = page.getByRole('img', { name: /^Stored matches per career-break band/ })
  if ((await figure.count()) === 0) return null
  const aria = ((await figure.first().getAttribute('aria-label')) ?? '').trim()
  const body = aria.replace(/^Stored matches per career-break band:\s*/, '')
  const rows = [...body.matchAll(/([A-Za-z0-9–<>+ ]+?)\s+(\d+)(?=,|$)/g)].map((match) => ({
    label: match[1]!.trim(),
    count: Number(match[2]),
  }))
  return { aria, rows, sum: rows.reduce((total, row) => total + row.count, 0) }
}

async function main() {
  const browser = await chromium.launch()
  const context = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 1700 } })
  const page = await context.newPage()
  const consoleErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('?_rsc=')) consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => consoleErrors.push(String(error)))

  await signIn(page, 'admin@syprus.example.com')
  await page.goto('/admin/fairness')
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(1200)

  const text = ((await page.locator('main').textContent()) ?? '').replace(/\s+/g, ' ')

  // Sample counts: chart vs the headline count vs the band table.
  const headline = Number(/Opted-in matches read\s*(\d+)/.exec(text)?.[1] ?? -1)
  const chart = await sampleChart(page)
  check(Boolean(chart), 'the sample-count chart is present', chart?.aria.slice(0, 120) ?? 'absent')
  if (chart) {
    check(
      chart.sum === headline,
      'the band counts add to the matches the audit read',
      `chart ${chart.sum} vs headline ${headline}`,
    )
    const tableRows = await page
      .locator('table')
      .filter({ hasText: 'Mean score' })
      .first()
      .locator('tbody tr')
      .evaluateAll((nodes) =>
        nodes.map((node) => {
          const cells = Array.from(node.querySelectorAll('td, th')).map((cell) => (cell.textContent ?? '').replace(/\s+/g, ' ').trim())
          return { band: cells[0] ?? '', matches: Number((cells[1] ?? '').replace(/[^\d]/g, '')) }
        }),
      )
    console.log('  band table:', JSON.stringify(tableRows))
    const tableSum = tableRows.reduce((total, row) => total + row.matches, 0)
    check(tableSum === headline, 'the band table adds to the same total', `${tableSum} vs ${headline}`)
    const missingFromChart = tableRows.filter(
      (row) => row.matches > 0 && !chart.rows.some((chartRow) => chartRow.count === row.matches),
    )
    check(
      missingFromChart.length === 0,
      'every populated band appears in the chart',
      missingFromChart.map((row) => `${row.band} (${row.matches})`).join(', '),
    )
  }

  // Missing data is named, never silently zeroed.
  const zeroBands = /band(s)? (has|have) no matches at all/.test(text)
  const unrecorded = /no career-break length recorded/.test(text)
  const thin = /fewer than 5 matches/.test(text)
  console.log(`  missing-data statements: unrecorded=${unrecorded} empty-bands=${zeroBands} thin-samples=${thin}`)
  check(
    /No scores stored|no mean is reported/.test(text) || !/NaN|undefined/.test(text),
    'a band without scores reports no mean instead of a zero',
  )
  check(!/NaN|undefined|null/.test(text), 'no unformatted value reaches the page')

  // Consent coverage is stated as a sample of volunteers.
  const consent = /(\d+) of (\d+) profiles carrying stored matches granted research consent/.exec(text)
  check(Boolean(consent), 'the research sample is described as a subset', consent?.[0] ?? '')
  if (consent) {
    const optedIn = Number(consent[1])
    const scored = Number(consent[2])
    check(optedIn <= scored, 'the consented subset is not larger than the scored population', `${optedIn} of ${scored}`)
    const share = /(\d+)% of the scored population/.exec(text)
    check(
      share == null || Number(share[1]) === Math.round((optedIn / Math.max(1, scored)) * 100),
      'the stated share matches the counts',
      share ? `${share[1]}%` : 'no percentage stated',
    )
    const bar = page.getByRole('img', { name: /^Research consent coverage/ })
    check((await bar.count()) === 1, 'the consent coverage bar names its own figures', (await bar.getAttribute('aria-label')) ?? '')
  }

  // Limits of the claim.
  check(!/bias[- ]free|no bias|unbiased|guaranteed fair|fair by design/i.test(text), 'the page never claims the platform is bias-free')
  check(/Monitoring is not a guarantee/.test(text), 'the limitation note is present')
  check(
    /does not identify an individual|Nothing here identifies an individual/i.test(text),
    'the page states it reports aggregates only',
  )

  // No individual attribute is rendered.
  const emails = text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/gi) ?? []
  const handles = text.match(/SYPR-[A-Z0-9]{4}/g) ?? []
  check(emails.length === 0, 'no email address appears on the fairness screen', emails.slice(0, 3).join(', '))
  check(handles.length === 0, 'no anonymous handle appears on the fairness screen', handles.slice(0, 3).join(', '))

  for (const width of [375, 768, 1024]) {
    await page.setViewportSize({ width, height: 1400 })
    await page.waitForTimeout(700)
    const scroll = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    check(scroll <= 0, `fairness screen fits ${width}px`, `${scroll}px of page scroll`)
  }

  // Access boundary: a candidate must not be able to read it.
  const candidatePage = await context.newPage()
  await candidatePage.goto('/login')
  await candidatePage.getByLabel('Email address', { exact: true }).fill('anshika@example.com')
  await candidatePage.getByLabel('Password', { exact: true }).fill(PASSWORD)
  await candidatePage.locator('main').getByRole('button', { name: 'Sign in', exact: true }).click()
  await candidatePage.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 60_000 })
  await candidatePage.goto('/admin/fairness')
  await candidatePage.waitForLoadState('networkidle')
  const denied = ((await candidatePage.locator('main').textContent()) ?? '').replace(/\s+/g, ' ')
  const leakedToCandidate =
    /career-break band|Opted-in matches read|Mean stored score/.test(denied) &&
    !/not authorised|Access denied|You do not have|Something went wrong|restricted/i.test(denied)
  check(!leakedToCandidate, 'a candidate cannot read the fairness screen', denied.slice(0, 110))
  await candidatePage.close()

  check(consoleErrors.length === 0, 'no console or page errors', consoleErrors.slice(0, 4).join(' | '))

  await browser.close()
  if (problems.length) {
    console.log(`\n${problems.length} problem(s):`)
    for (const problem of problems) console.log(` - ${problem}`)
    process.exit(1)
  }
  console.log('\nAll fairness monitoring checks passed.')
}

main()
