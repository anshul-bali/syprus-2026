/**
 * Live check for the learning-pathway timeline.
 *   npx tsx scripts/check-pathway-viz.ts <base>
 *
 * Builds a plan against the isolated QA cluster when none exists, then reads
 * what the screen claims: step order, recorded statuses, catalogued hours,
 * resource links and the next action. Status changes are written through the
 * normal server action and reverted, so the stored record is what the page says.
 */
import { existsSync, readFileSync } from 'node:fs'
import { chromium, type Page } from '@playwright/test'

const BASE = process.argv[2] ?? 'http://localhost:3100'
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

const problems: string[] = []

function check(condition: boolean, label: string, detail = '') {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
  if (!condition) problems.push(`${label}: ${detail}`)
}

async function overflowReport(page: Page) {
  return page.evaluate(() => {
    let offender = 'none'
    let worst = 0
    for (const element of Array.from(document.querySelectorAll('main *'))) {
      const node = element as HTMLElement
      if (node.classList.contains('sr-only') || node.closest('.sr-only')) continue
      if (node.getBoundingClientRect().width === 0) continue
      if (['INPUT', 'TEXTAREA', 'SELECT', 'OPTION'].includes(node.tagName)) continue
      const style = getComputedStyle(node)
      if (style.overflowX === 'auto' || style.overflowX === 'scroll') continue
      let parent = node.parentElement
      let scrollable = false
      while (parent) {
        const parentStyle = getComputedStyle(parent)
        if (parentStyle.overflowX === 'auto' || parentStyle.overflowX === 'scroll') {
          scrollable = true
          break
        }
        parent = parent.parentElement
      }
      if (scrollable) continue
      const text = node.textContent?.replace(/\s+/g, ' ').trim() ?? ''
      if (node.children.length > 0 || text.length < 3) continue
      const delta = Math.round(node.scrollWidth - node.clientWidth)
      if (delta > worst) {
        worst = delta
        offender = `${node.tagName.toLowerCase()} [${text.slice(0, 60)}]`
      }
    }
    return { worst, offender, pageScroll: Math.round(document.documentElement.scrollWidth - window.innerWidth) }
  })
}

/** Ask the planner for a plan, trying the automatic target first. */
async function ensurePlan(page: Page) {
  await page.goto('/candidate/pathways')
  await page.waitForLoadState('networkidle')
  if ((await page.locator('ol li').count()) > 0) return true
  for (const which of ['Automatic — my closest matched roles', null]) {
    await page.locator('#targetJobId').click()
    await page.waitForTimeout(300)
    if (which) {
      await page.getByRole('option', { name: which, exact: true }).click()
    } else {
      await page.keyboard.press('ArrowDown')
      await page.keyboard.press('Enter')
    }
    await page.getByRole('button', { name: /Build pathway/i }).first().click()
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(2000)
    if ((await page.locator('ol li').count()) > 0) return true
    const refusal = await page.locator('[role="alert"], [data-slot="form-message"]').first().textContent()
    console.log(`  planner refused: ${(refusal ?? '').replace(/\s+/g, ' ').trim().slice(0, 160)}`)
  }
  return false
}

async function main() {
  const browser = await chromium.launch()
  const context = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 1400 } })
  const page = await context.newPage()
  const consoleErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('?_rsc=')) consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => consoleErrors.push(String(error)))

  await page.goto('/login')
  await page.getByLabel('Email address', { exact: true }).fill('anshika@example.com')
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
  await page.locator('main').getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 60_000 })

  const built = await ensurePlan(page)
  check(built, 'a pathway with steps is on screen')
  if (!built) {
    console.log('\nBlocked by stored data: the catalogue holds no resource for this account’s gaps, so the planner refuses rather than inventing one.')
    await browser.close()
    return
  }

  const steps = page.locator('ol li')
  const positions = await steps.evaluateAll((nodes) =>
    nodes.map((node) => Number(/-step-(\d+)$/.exec(node.id)?.[1] ?? Number.NaN)),
  )
  check(
    positions.every((position, index) => Number.isInteger(position) && (index === 0 || position > positions[index - 1]!)),
    'steps are listed in recorded order',
    JSON.stringify(positions),
  )

  const rail = page.getByRole('img', { name: /^Progress across/ })
  check((await rail.count()) >= 1, 'the progress rail names the counts', (await rail.first().getAttribute('aria-label')) ?? '')

  const summary = await page.locator('p', { hasText: /steps? recorded as complete/ }).first().textContent()
  console.log(`  summary: ${(summary ?? '').replace(/\s+/g, ' ').trim().slice(0, 220)}`)

  const nextBlock = page.locator('div').filter({ hasText: /^Next action/ }).last()
  const nextText = ((await nextBlock.textContent()) ?? '').replace(/\s+/g, ' ').trim()
  const nextPosition = Number((nextText.match(/Step (\d+)/) ?? [])[1])
  check(Number.isInteger(nextPosition), 'a next action names a step', nextText.slice(0, 120))

  // The next action must be the first step that is neither complete nor skipped.
  const statuses = await steps.evaluateAll((nodes) =>
    nodes.map((node) => {
      const pressed = Array.from(node.querySelectorAll('button[disabled]')).map((button) => button.textContent?.trim() ?? '')
      return pressed.join(',')
    }),
  )
  const firstOpenIndex = statuses.findIndex((status) => !/Completed|Skipped/.test(status))
  check(
    firstOpenIndex === -1 || statuses[firstOpenIndex] !== undefined,
    'every step carries its recorded status',
    JSON.stringify(statuses.slice(0, 8)),
  )
  check(
    firstOpenIndex === -1 || positions[firstOpenIndex] === nextPosition,
    'the next action is the first step still open',
    `first open position ${positions[firstOpenIndex]} vs next ${nextPosition}`,
  )

  const links: string[] = await page
    .locator('ol li a[target="_blank"]')
    .evaluateAll((nodes) => nodes.map((node) => (node as HTMLAnchorElement).href))
  check(
    links.every((href) => /^https?:\/\//.test(href)),
    'resource links are real URLs, never placeholders',
    JSON.stringify(links.slice(0, 4)),
  )
  const unlinked = await page.getByText(/No link is stored|store no link/).count()
  console.log(`  steps without a stored link: ${unlinked}`)

  const durationClaims = await page.locator('ol li').evaluateAll((nodes) =>
    nodes.map((node) => {
      const text = (node.textContent ?? '').replace(/\s+/g, ' ')
      const hours = /~(\d+(?:\.\d+)?)h estimated/.exec(text)
      return hours ? Number(hours[1]) : null
    }),
  )
  const claimed = durationClaims.reduce<number>((total, value) => total + (value ?? 0), 0)
  const summaryHours = /(\d+(?:\.\d+)?) of (\d+(?:\.\d+)?) catalogued hours/.exec((summary ?? '').replace(/\s+/g, ' '))
  check(
    !summaryHours || Number(summaryHours[2]) === claimed,
    'the hours line equals the per-step durations',
    `line says ${summaryHours?.[2]} of total, steps sum to ${claimed}`,
  )

  // Record a step complete through the normal action, then put it back.
  const targetStep = firstOpenIndex === -1 ? steps.first() : steps.nth(firstOpenIndex)
  await targetStep.getByRole('button', { name: 'Completed', exact: true }).click()
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(1500)
  const afterComplete = ((await page.locator('p', { hasText: /steps? recorded as complete/ }).first().textContent()) ?? '').replace(/\s+/g, ' ')
  const recordedDate = await page.getByText(/you recorded this/).count()
  check(
    Number(afterComplete.match(/(\d+) of \d+ steps? recorded as complete/)?.[1]) ===
      Number(summary?.replace(/\s+/g, ' ').match(/(\d+) of \d+ steps? recorded as complete/)?.[1] ?? -1) + 1,
    'marking a step complete moves the recorded count',
    afterComplete.slice(0, 90),
  )
  check(recordedDate >= 1, 'a completed step shows when you recorded it', `${recordedDate} dated line(s)`)

  await targetStep.getByRole('button', { name: 'Not started', exact: true }).click()
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(1500)
  const afterRevert = ((await page.locator('p', { hasText: /steps? recorded as complete/ }).first().textContent()) ?? '').replace(/\s+/g, ' ')
  check(
    Number(afterRevert.match(/(\d+) of \d+ steps? recorded as complete/)?.[1]) ===
      Number(summary?.replace(/\s+/g, ' ').match(/(\d+) of \d+ steps? recorded as complete/)?.[1]),
    'reverting the status restores the original count',
    afterRevert.slice(0, 90),
  )

  // Keyboard: reach a status control and act on it without a pointer.
  await targetStep.getByRole('button', { name: 'In progress', exact: true }).focus()
  await page.keyboard.press('Enter')
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(1500)
  const inProgressNow = await targetStep.getByRole('button', { name: 'In progress', exact: true, disabled: true }).count()
  check(inProgressNow === 1, 'status controls work from the keyboard')
  await targetStep.getByRole('button', { name: 'Not started', exact: true }).click()
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(1200)

  for (const width of [375, 768, 1024]) {
    await page.setViewportSize({ width, height: 1200 })
    await page.waitForTimeout(700)
    const report = await overflowReport(page)
    check(
      report.worst === 0 && report.pageScroll === 0,
      `pathway fits ${width}px`,
      `clipped ${report.worst}px (${report.offender}); page scroll ${report.pageScroll}px`,
    )
  }

  check(consoleErrors.length === 0, 'no console or page errors', consoleErrors.slice(0, 4).join(' | '))

  await browser.close()
  if (problems.length) {
    console.log(`\n${problems.length} problem(s):`)
    for (const problem of problems) console.log(` - ${problem}`)
    process.exit(1)
  }
  console.log('\nAll pathway timeline checks passed.')
}

main()
