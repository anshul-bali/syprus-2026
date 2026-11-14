/**
 * Live checks for the administrator overview charts.
 *   npx tsx scripts/check-admin-dash.ts <base>
 *
 * Everything here is a reconciliation: the bars, the list beside them, the
 * sentence under them and the totals block must agree, and a trend may only be
 * drawn when the stored rows actually contain a history.
 */
import { existsSync, readFileSync } from 'node:fs'
import { chromium, type Page } from '@playwright/test'

const BASE = process.argv[2] ?? 'http://localhost:3100'
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
    return /^\d+$/.test(value) ? Number(value) : -1
  }, label)
}

async function compositionCard(page: Page, title: string) {
  const card = page.locator('[data-slot="card"]').filter({ hasText: title }).first()
  if ((await card.count()) === 0) return null
  const rows = await card.locator('ul li').evaluateAll((nodes) =>
    nodes.map((node) => {
      // The label and the count are separate flex children, so textContent has
      // no space between them: “Published12”.
      const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim()
      const match = /^(.*?)(\d+)$/.exec(text)
      return match ? { label: match[1]!.trim(), count: Number(match[2]) } : { label: text, count: Number.NaN }
    }),
  )
  const note = ((await card.locator('p').filter({ hasText: /adds to|both add to/ }).first().textContent()) ?? '').replace(/\s+/g, ' ').trim()
  const figure = card.locator('figure[role="img"]').first()
  const aria = ((await figure.count()) > 0 ? ((await figure.getAttribute('aria-label')) ?? '') : '').trim()
  // Drop the “<title>: ” prefix so the title is not read as another row.
  const body = aria.replace(new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\s*`), '')
  const figures = [...body.matchAll(/([A-Za-z][A-Za-z ]*?) (\d+)/g)].map((match) => ({ label: match[1]!.trim(), count: Number(match[2]) }))
  const bars = await card.locator('.recharts-bar').count()
  return { rows, note, figures, bars }
}

function numbersFromRows(rows: { label: string; count: number }[], excludeTotal = true) {
  const body = excludeTotal ? rows.filter((row) => row.label !== 'Total') : rows
  return body.reduce((total, row) => total + (Number.isFinite(row.count) ? row.count : 0), 0)
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

  await page.goto('/admin')
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(1200)

  // Composition cards: bars, list and sentence must be the same numbers.
  for (const [title, expectedTotal, expectedLabel] of [
    ['Applications by pipeline stage', 'Applications', 'the applications total'],
    ['Accounts by role', null, null],
    ['Roles by moderation status', null, null],
  ] as const) {
    const card = await compositionCard(page, title)
    check(Boolean(card), `composition card “${title}” is present`)
    if (!card) continue
    const listed = numbersFromRows(card.rows)
    const totalRow = card.rows.find((row) => row.label === 'Total')?.count
    check(totalRow === listed, `${title}: the Total row equals the listed rows`, `${totalRow} vs ${listed}`)
    const ariaSum = card.figures.reduce((total, row) => total + row.count, 0)
    check(card.figures.length === card.rows.length - 1, `${title}: the chart names every listed row`, `${card.figures.length} of ${card.rows.length - 1}`)
    check(
      card.figures.every((figure) => card.rows.some((row) => row.label === figure.label && row.count === figure.count)),
      `${title}: each bar carries the same label and count as its row`,
      JSON.stringify(card.figures),
    )
    check(ariaSum === listed, `${title}: the chart’s accessible figures add to the list`, `${ariaSum} vs ${listed}`)
    check(/both add to/.test(card.note) || card.rows.length === 0, `${title}: the card states its own reconciliation`, card.note.slice(0, 110))
    if (expectedTotal) {
      const headerTotal = await statValue(page, expectedTotal)
      check(headerTotal === listed, `${title} matches the ${expectedLabel}`, `${headerTotal} vs ${listed}`)
    }
  }

  // Roles awaiting moderation: queue card vs composition row.
  const rolesCard = await compositionCard(page, 'Roles by moderation status')
  const pendingRow = rolesCard?.rows.find((row) => /awaiting|pending/i.test(row.label))?.count ?? -1
  const queueStat = await statValue(page, 'Roles awaiting moderation')
  check(queueStat === pendingRow, 'the moderation queue card equals the composition row', `${queueStat} vs ${pendingRow}`)

  // Trends only where history exists.
  for (const [title, stat] of [
    ['New accounts, last 30 days', null],
    ['Applications started, last 30 days', null],
  ] as const) {
    void stat
    const card = page.locator('[data-slot="card"]').filter({ hasText: title }).first()
    const description = ((await card.locator('[data-slot="card-description"]').first().textContent()) ?? '').replace(/\s+/g, ' ')
    const windowNumber = Number(/(\d+) in the window/.exec(description)?.[1] ?? -1)
    const drawn = (await card.locator('.recharts-surface').count()) > 0
    const refused = /no trend is drawn|no recent series to draw/.test(((await card.textContent()) ?? '').replace(/\s+/g, ' '))
    check(
      (windowNumber > 0 && drawn) || (windowNumber === 0 && refused),
      `“${title}” draws a trend only when the window has rows`,
      `window ${windowNumber}, chart ${drawn}, refusal ${refused}`,
    )
  }

  // Review queue card must come from stored tasks, not a synthetic number.
  const reviewText = ((await page.locator('[data-slot="card"]').filter({ hasText: 'Review tasks open' }).first().textContent()) ?? '').replace(/\s+/g, ' ')
  check(/task(s)? ever recorded|0 task/.test(reviewText) || /Review tasks open/.test(reviewText), 'review queue figures are stated as stored rows', reviewText.slice(0, 120))

  for (const width of [375, 768, 1024]) {
    await page.setViewportSize({ width, height: 1400 })
    await page.waitForTimeout(700)
    const scroll = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    const clipped = await page.evaluate(() => {
      let worst = 0
      let offender = 'none'
      for (const node of Array.from(document.querySelectorAll('main *'))) {
        const el = node as HTMLElement
        if (el.children.length > 0 || el.closest('.sr-only')) continue
        const text = el.textContent?.trim() ?? ''
        if (text.length < 3) continue
        const style = getComputedStyle(el)
        if (style.overflowX === 'auto' || style.overflowX === 'scroll') continue
        let parent = el.parentElement
        let inScroller = false
        while (parent) {
          const ps = getComputedStyle(parent)
          if (ps.overflowX === 'auto' || ps.overflowX === 'scroll') {
            inScroller = true
            break
          }
          parent = parent.parentElement
        }
        if (inScroller) continue
        const delta = Math.round(el.scrollWidth - el.clientWidth)
        if (delta > worst) {
          worst = delta
          offender = `${el.tagName.toLowerCase()} [${text.slice(0, 50)}]`
        }
      }
      return { worst, offender }
    })
    check(scroll <= 0 && clipped.worst === 0, `admin overview fits ${width}px`, `page ${scroll}px, clipped ${clipped.worst}px (${clipped.offender})`)
  }

  check(consoleErrors.length === 0, 'no console or page errors', consoleErrors.slice(0, 4).join(' | '))

  await browser.close()
  if (problems.length) {
    console.log(`\n${problems.length} problem(s):`)
    for (const problem of problems) console.log(` - ${problem}`)
    process.exit(1)
  }
  console.log('\nAll administrator overview chart checks passed.')
}

main()
