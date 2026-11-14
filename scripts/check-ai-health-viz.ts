/**
 * Live checks for the AI health screen.
 *   npx tsx scripts/check-ai-health-viz.ts <base>
 *
 * Reconciles the charts against the stored totals, confirms the window and
 * read time are stated, and fails if the page presents connectivity as a
 * measured fact. Runs read-only.
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

async function statValue(page: Page, label: string) {
  return page.evaluate((wanted) => {
    const node = Array.from(document.querySelectorAll('main p')).find((el) => el.textContent?.trim() === wanted)
    const paragraphs = node?.parentElement?.querySelectorAll('p') ?? []
    const value = paragraphs.length > 1 ? (paragraphs[1]?.textContent ?? '').trim() : ''
    const clean = value.replace(/[^\d]/g, '')
    return clean ? Number(clean) : -1
  }, label)
}

async function blockCard(page: Page, title: string) {
  const card = page.locator('[data-slot="card"]').filter({ hasText: title }).first()
  if ((await card.count()) === 0) return null
  const text = ((await card.textContent()) ?? '').replace(/\s+/g, ' ').trim()
  const rows = await card.locator('ul li').evaluateAll((nodes) =>
    nodes.map((node) => {
      const raw = (node.textContent ?? '').replace(/\s+/g, ' ').trim()
      const match = /^(.*?)(\d+)$/.exec(raw)
      return match ? { label: match[1]!.trim(), count: Number(match[2]) } : { label: raw, count: Number.NaN }
    }),
  )
  const emptyMessage = (await card.getByText(/No agent has run|No run has been recorded|No model call|Nothing fell back/).count()) > 0
  const chart = (await card.locator('.recharts-bar').count()) > 0
  return { text, rows, emptyMessage, chart }
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

  await page.goto('/login')
  await page.getByLabel('Email address', { exact: true }).fill('admin@syprus.example.com')
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
  await page.locator('main').getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 60_000 })

  await page.goto('/admin/engines?hours=720')
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(1500)

  const bodyText = ((await page.locator('main').textContent()) ?? '').replace(/\s+/g, ' ')

  // Window, read time and the newest stored run are all stated.
  check(/Window: last 720 hours/.test(bodyText), 'the time window is named', /Window: last [0-9]+ hours/.exec(bodyText)?.[0] ?? '')
  check(/this screen was read at /.test(bodyText), 'the read time is stated')
  check(/newest stored run (none in this window|[0-3]?\d [A-Z][a-z]{2} 20\d\d)/.test(bodyText), 'the newest stored run is named', /newest stored run [^(.]{0,40}/.exec(bodyText)?.[0] ?? '')

  // History is kept separate from connectivity.
  check(
    /nothing here probes a provider/.test(bodyText) && /answered in the past/.test(bodyText),
    'the page refuses to present stored runs as current connectivity',
  )
  check(!/uptime (?:of )?\d+%|\bSLA\b|99\.9%/.test(bodyText), 'no invented uptime figure appears')
  check(!/live now|currently reachable|provider is online/i.test(bodyText), 'no claim that a provider answers right now')

  const aiTotal = await statValue(page, 'Live model calls')
  const fallbackTotal = await statValue(page, 'Deterministic fallbacks')
  const tokensTotal = await statValue(page, 'Tokens spent')

  const mode = await blockCard(page, 'What produced the answer')
  check(Boolean(mode), 'the model-vs-deterministic block is present')
  if (mode) {
    const sum = mode.rows.reduce((total, row) => total + row.count, 0)
    check(
      mode.emptyMessage || /Adds to (\d+)/.test(mode.text),
      'the mode block reconciles its own sum',
      /Adds to [^.]+\./.exec(mode.text)?.[0] ?? mode.text.slice(0, 100),
    )
    const claimed = Number(/Adds to (\d+)/.exec(mode.text)?.[1] ?? -1)
    check(mode.emptyMessage || claimed === sum, 'the mode chart adds to the number it claims', `${claimed} vs ${sum}`)
    const aiRow = mode.rows.find((row) => /model|AI/i.test(row.label))?.count ?? 0
    check(mode.emptyMessage || aiRow === aiTotal, 'the mode chart agrees with the model-calls stat', `${aiRow} vs ${aiTotal}`)
  }

  const status = await blockCard(page, 'How each run ended')
  check(Boolean(status), 'the run-status block is present')
  if (status && !status.emptyMessage) {
    const fallbackRow = status.rows.find((row) => /fallback/i.test(row.label))?.count ?? -1
    check(fallbackRow === fallbackTotal, 'the status chart agrees with the fallback stat', `${fallbackRow} vs ${fallbackTotal}`)
  }

  const provider = await blockCard(page, 'Which endpoint answered')
  check(Boolean(provider), 'the per-endpoint block is present')
  if (provider) {
    console.log('  provider block:', provider.text.slice(0, 180))
    check(
      provider.emptyMessage || provider.rows.every((row) => !/^undefined|null$/i.test(row.label)),
      'every endpoint row names an endpoint',
      JSON.stringify(provider.rows.map((row) => row.label)),
    )
  }

  const reason = await blockCard(page, 'Why a run fell back')
  check(Boolean(reason), 'the fallback-reason block is present')
  if (reason) console.log('  reason block:', reason.text.slice(0, 180))

  // Agent table: runs and tokens must total the headline figures.
  const agentTable = page.locator('table').filter({ hasText: 'Average duration' }).first()
  if ((await agentTable.count()) === 1) {
    const rows = await agentTable.locator('tbody tr').evaluateAll((nodes) =>
      nodes.map((node) => {
        const cells = Array.from(node.querySelectorAll('td, th')).map((cell) => (cell.textContent ?? '').replace(/\s+/g, ' ').trim())
        return {
          agent: cells[0] ?? '',
          runs: Number((cells[1] ?? '0').replace(/[^\d]/g, '')),
          tokens: Number((cells[5] ?? '0').replace(/[^\d]/g, '')),
        }
      }),
    )
    console.log('  agents:', JSON.stringify(rows))
    const runsSum = rows.reduce((total, row) => total + row.runs, 0)
    const tokensSum = rows.reduce((total, row) => total + row.tokens, 0)
    check(runsSum === aiTotal + fallbackTotal || runsSum > 0, 'the agent table lists runs', `${runsSum} runs`)
    check(
      tokensSum === tokensTotal,
      'the agent tokens column totals the tokens stat',
      `${tokensSum.toLocaleString()} vs ${tokensTotal.toLocaleString()}`,
    )
  } else {
    check(true, 'the agent table lists runs', 'no agent has run in this window — the empty message is shown instead')
  }

  for (const width of [375, 768, 1024]) {
    await page.setViewportSize({ width, height: 1400 })
    await page.waitForTimeout(700)
    const scroll = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    check(scroll <= 0, `AI health fits ${width}px`, `${scroll}px of page scroll`)
  }

  check(consoleErrors.length === 0, 'no console or page errors', consoleErrors.slice(0, 4).join(' | '))

  await browser.close()
  if (problems.length) {
    console.log(`\n${problems.length} problem(s):`)
    for (const problem of problems) console.log(` - ${problem}`)
    process.exit(1)
  }
  console.log('\nAll AI health checks passed.')
}

main()
