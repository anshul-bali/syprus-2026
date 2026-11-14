/**
 * Live checks for the employer hiring overview: role filter, stage counts,
 * history versus current stage, shortlist coverage and anonymity.
 *   npx tsx scripts/check-employer-dash.ts <base>
 * Read-only — no employer action is recorded by this script.
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

async function signIn(page: Page, email: string) {
  await page.goto('/login')
  await page.getByLabel('Email address', { exact: true }).fill(email)
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
  await page.locator('main').getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 60_000 })
}

/** The number a StatCard with this label is showing (its value is the second paragraph). */
async function statValue(page: Page, label: string) {
  return page.evaluate((wanted) => {
    const node = Array.from(document.querySelectorAll('main p')).find((el) => el.textContent?.trim() === wanted)
    const paragraphs = node?.parentElement?.querySelectorAll('p') ?? []
    const value = paragraphs.length > 1 ? (paragraphs[1]?.textContent ?? '').trim() : ''
    return /^\d+$/.test(value) ? Number(value) : -1
  }, label)
}

/** Stage → count, read from the dt/dd pairs inside a named card. */
async function stageCounts(page: Page, cardText: string) {
  const card = page.locator('[data-slot="card"]').filter({ hasText: cardText }).first()
  return card.evaluate((node) =>
    Array.from(node.querySelectorAll('dl dt'))
      .map((dt) => {
        const dd = dt.nextElementSibling
        const numbers = (dd?.textContent ?? '').match(/\d+/g)
        return {
          label: (dt.textContent ?? '').replace(/\s+/g, ' ').trim(),
          count: numbers ? Number(numbers[numbers.length - 1]) : Number.NaN,
        }
      })
      .filter((row) => row.label.length > 0 && Number.isFinite(row.count)),
  )
}

/** The card’s own reconciliation sentence, read from the paragraph that holds it. */
async function reconciliation(page: Page, cardText: string) {
  const paragraph = page
    .locator('[data-slot="card"]')
    .filter({ hasText: cardText })
    .first()
    .locator('p')
    .filter({ hasText: /counted from .* application/ })
    .first()
  const text = ((await paragraph.textContent()) ?? '').replace(/\s+/g, ' ').trim()
  const match = /(\d+) counted from (\d+) application/.exec(text)
  return match ? { counted: Number(match[1]), applications: Number(match[2]), text } : null
}

async function main() {
  const browser = await chromium.launch()
  const context = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 1600 } })
  const page = await context.newPage()
  const consoleErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('?_rsc=')) consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => consoleErrors.push(String(error)))

  await signIn(page, 'people@meridian.example.com')
  await page.goto('/employer')
  await page.waitForLoadState('networkidle')

  const bodyText = await page.locator('body').innerText()

  // Anonymity: the dashboard must not leak a candidate identity.
  const leaks = ['anshika@example.com', 'Anshika', 'priya.n@example.com', 'Farah', 'Sana'].filter((needle) =>
    bodyText.includes(needle),
  )
  check(leaks.length === 0, 'no candidate name or email appears on the overview', leaks.join(', '))

  // Roles by status: the chart is paired with a list, and the list totals the roles.
  const roleRows = await stageCounts(page, 'Roles by status')
  console.log('  roles by status:', JSON.stringify(roleRows))
  const roleSum = roleRows.filter((row) => row.label !== 'Total roles').reduce((total, row) => total + row.count, 0)
  const statedTotal = roleRows.find((row) => row.label === 'Total roles')?.count ?? roleSum
  check(roleSum === statedTotal, 'role status counts add to the total roles', `${roleSum} vs ${statedTotal}`)
  const headerRoles = await statValue(page, 'Roles')
  check(headerRoles === statedTotal, 'the header stat agrees with the role list', `${headerRoles} vs ${statedTotal}`)

  // Applications by stage, all roles.
  const allStages = await stageCounts(page, 'Applications by stage')
  console.log('  stages (all roles):', JSON.stringify(allStages))
  const allSum = allStages.reduce((total, row) => total + row.count, 0)
  const claimed = await reconciliation(page, 'Applications by stage')
  check(Boolean(claimed), 'the stage card states its own reconciliation', claimed ? `${claimed.counted} counted / ${claimed.applications} applications` : 'no sentence')
  if (claimed) {
    check(claimed.counted === allSum, 'the reconciliation line matches the listed stages', `${claimed.counted} vs ${allSum}`)
    check(claimed.applications >= allSum, 'every application is counted at most once', `${claimed.applications} applications, ${allSum} counted`)
    check(claimed.applications === claimed.counted, 'current-stage counts equal the applications on view', claimed.text)
  }

  // Role filter: per-role counts must sum to the all-roles total.
  const filterNav = page.locator('nav[aria-label="Filter the pipeline by role"]')
  const hasFilter = (await filterNav.count()) > 0
  check(hasFilter, 'a role filter is offered')
  if (hasFilter) {
    const buttons = filterNav.locator('a')
    const labels = await buttons.allTextContents()
    console.log('  filter chips:', JSON.stringify(labels.map((text) => text.replace(/\s+/g, ' ').trim())))
    let perRoleTotal = 0
    for (const index of Array.from({ length: await buttons.count() }, (_, i) => i).slice(1)) {
      const label = (await buttons.nth(index).textContent()) ?? ''
      const claimedCount = Number((label.replace(/\s+/g, ' ').match(/(\d+)\s*$/)?.[1] ?? 0))
      await buttons.nth(index).click()
      await page.waitForURL((url) => url.searchParams.has('job'), { timeout: 30_000 })
      await page.waitForLoadState('networkidle')
      await page.waitForTimeout(600)
      const stages = await stageCounts(page, 'Applications by stage')
      const sum = stages.reduce((total, row) => total + row.count, 0)
      const note = await reconciliation(page, 'Applications by stage')
      check(
        note ? note.counted === sum && note.applications === claimedCount : sum === claimedCount,
        `filter “${label.replace(/\s+/g, ' ').trim()}” counts its own applications`,
        note ? `${note.counted} counted from ${note.applications} applications, chip says ${claimedCount}` : `sum ${sum} vs chip ${claimedCount}`,
      )
      const navText = ((await filterNav.textContent()) ?? '').replace(/\s+/g, ' ')
      check(
        new RegExp(`showing ${claimedCount} application`).test(navText),
        `the filtered view says which role it is showing`,
        navText.slice(-90),
      )
      perRoleTotal += sum
      await filterNav.locator('a').first().click()
      await page.waitForURL((url) => !url.searchParams.has('job'), { timeout: 30_000 })
      await page.waitForLoadState('networkidle')
      await page.waitForTimeout(400)
    }
    check(perRoleTotal === allSum, 'the per-role totals add to the all-roles total', `${perRoleTotal} vs ${allSum}`)
  }

  // History versus current stage: a stage held now must have been reached ever.
  const historyTable = page.locator('table').filter({ hasText: 'Ever reached' }).first()
  if ((await historyTable.count()) === 1) {
    const rows = await historyTable.locator('tbody tr').evaluateAll((nodes) =>
      nodes.map((node) => {
        const cells = Array.from(node.querySelectorAll('th, td')).map((cell) => cell.textContent?.trim() ?? '')
        return { stage: cells[0] ?? '', ever: Number(cells[1] ?? 0), moved: Number(cells[2] ?? 0) }
      }),
    )
    console.log('  history:', JSON.stringify(rows))
    const current = new Map(allStages.map((row) => [row.label, row.count]))
    const inconsistent = rows.filter((row) => row.ever < (current.get(row.stage) ?? 0))
    check(
      inconsistent.length === 0,
      'a stage held now is always counted as ever reached',
      inconsistent.map((row) => `${row.stage}: ever ${row.ever} < now ${current.get(row.stage)}`).join(', '),
    )
    check(
      rows.every((row) => row.moved >= 0 && row.ever >= row.moved - (current.get(row.stage) ?? 0)),
      'the 30-day moves never exceed what has ever happened',
      JSON.stringify(rows.map((row) => [row.ever, row.moved])),
    )
    const rateWords = /conversion rate of \d|funnel of \d/i.test(bodyText)
    check(!rateWords, 'no conversion rate is invented from the history')
  } else {
    const noHistory = /No status event has been recorded/.test(bodyText)
    check(noHistory, 'without history the card says there is nothing to chart', 'history table absent')
  }

  // Shortlist coverage.
  const shortlistCard = page.locator('[data-slot="card"]').filter({ hasText: 'Shortlist coverage' }).first()
  check((await shortlistCard.count()) === 1, 'shortlist coverage is present')
  const shortlistText = ((await shortlistCard.textContent()) ?? '').replace(/\s+/g, ' ')
  console.log('  shortlist:', shortlistText.slice(0, 160))

  for (const width of [375, 768, 1024]) {
    await page.setViewportSize({ width, height: 1200 })
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
          offender = `${el.tagName.toLowerCase()} [${text.slice(0, 60)}]`
        }
      }
      return { worst, offender }
    })
    check(
      scroll <= 0 && clipped.worst === 0,
      `overview fits ${width}px`,
      `page ${scroll}px, clipped ${clipped.worst}px (${clipped.offender})`,
    )
  }

  check(consoleErrors.length === 0, 'no console or page errors', consoleErrors.slice(0, 4).join(' | '))

  await browser.close()
  if (problems.length) {
    console.log(`\n${problems.length} problem(s):`)
    for (const problem of problems) console.log(` - ${problem}`)
    process.exit(1)
  }
  console.log('\nAll employer overview checks passed.')
}

main()
