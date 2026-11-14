/**
 * Live checks for the public skills-to-role demo.
 *   npx tsx scripts/check-public-demo.ts <base>
 *
 * The demo must stay a toy: labelled as illustrative, recomputing correctly,
 * making no request of any kind, and never sounding like a prediction.
 */
import { chromium, type Page } from '@playwright/test'

const BASE = process.argv[2] ?? 'http://localhost:3000'
const problems: string[] = []

function check(condition: boolean, label: string, detail = '') {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
  if (!condition) problems.push(`${label}: ${detail}`)
}

/** Re-reads the widget’s own numbers from the DOM. */
async function readDemo(page: Page) {
  const card = page.locator('[data-slot="card"]').filter({ hasText: 'Try the arithmetic yourself' }).first()
  const cardText = ((await card.textContent()) ?? '').replace(/\s+/g, ' ')
  const percent = Number(/Illustrative coverage of [A-Za-z ]+?(\d+)%/.exec(cardText)?.[1] ?? -1)
  const status = ((await card.getByRole('status').textContent()) ?? '').replace(/\s+/g, ' ').trim()
  const counted = Number(/from (\d+) of \d+ skills/.exec(status)?.[1] ?? -1)
  const points = Number(/(\d+) of \d+ weight points/.exec(status)?.[1] ?? -1)
  const pointsTotal = Number(/(\d+) of (\d+) weight points/.exec(status)?.[2] ?? -1)
  const rows = await card.locator('ul li').evaluateAll((nodes) =>
    nodes.map((node) => {
      const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim()
      const weight = Number(/weight (\d+)$/.exec(text)?.[1] ?? -1)
      return { text, weight }
    }),
  )
  return { card, percent, status, counted, points, pointsTotal, rows }
}

async function main() {
  const browser = await chromium.launch()
  const context = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 1600 } })
  const page = await context.newPage()
  const consoleErrors: string[] = []
  const requests: string[] = []

  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('?_rsc=')) consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => consoleErrors.push(String(error)))
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.origin !== new URL(BASE).origin) requests.push(`external ${request.method()} ${url.href}`)
    else if (url.pathname.startsWith('/api/') || request.method() !== 'GET') requests.push(`${request.method()} ${url.pathname}`)
  })

  await page.goto('/')
  await page.waitForLoadState('networkidle')

  const section = page.locator('#how-it-works')
  const card = section.locator('[data-slot="card"]').filter({ hasText: 'Try the arithmetic yourself' }).first()
  check((await card.count()) === 1, 'the demo sits inside the How it works section')

  const cardText = ((await card.textContent()) ?? '').replace(/\s+/g, ' ')
  check(/Illustrative data · not a match score/.test(cardText), 'the widget is labelled illustrative, not a score')
  check(/invented for this demo/i.test(cardText), 'the data is named as invented')
  check(/nothing you choose here is stored, sent to a model/i.test(cardText), 'the widget states nothing is stored or sent')
  // Prediction language, ignoring the sentence that disclaims prediction.
  const withoutDisclaimers = cardText
    .split(/(?<=\.)\s+/)
    .filter((sentence) => !/not a prediction|predicts nothing|no prediction/i.test(sentence))
    .join(' ')
  check(
    !/you will be (?:shortlisted|hired|invited)|chance of being|likely to get|we predict/i.test(withoutDisclaimers),
    'the widget makes no hiring prediction',
    withoutDisclaimers.slice(0, 120),
  )
  check(/not a prediction that you will be shortlisted/i.test(cardText), 'the widget says what it is not')

  // Interaction changes the number, and the number is the arithmetic shown.
  const before = await readDemo(page)
  check(before.percent >= 0, 'the widget reports a coverage figure', before.status)
  const weightRows = before.rows.filter((row) => row.weight > 0)
  const countedWeights = weightRows.slice(0, before.counted).reduce((total, row) => total + row.weight, 0)
  const totalWeights = weightRows.reduce((total, row) => total + row.weight, 0)
  check(
    before.points === countedWeights && before.pointsTotal === totalWeights,
    'the weight points quoted equal the weights listed',
    `${before.points}/${before.pointsTotal} vs ${countedWeights}/${totalWeights}`,
  )
  check(
    before.percent === Math.round((before.points / Math.max(1, before.pointsTotal)) * 100),
    'the percentage equals points over total points',
    `${before.percent}% vs ${before.points}/${before.pointsTotal}`,
  )

  const skillButtons = card.locator('[role="group"][aria-label="Illustrative skills"] button')
  const target = skillButtons.filter({ hasText: 'Stakeholder management' }).first()
  const wasPressed = (await target.getAttribute('aria-pressed')) === 'true'
  await target.click()
  await page.waitForTimeout(400)
  const after = await readDemo(page)
  check(
    (await target.getAttribute('aria-pressed')) === (wasPressed ? 'false' : 'true'),
    'a skill chip toggles its pressed state',
    `was ${wasPressed}`,
  )
  check(
    after.percent !== before.percent || after.counted !== before.counted,
    'toggling a skill the role asks for changes the coverage',
    `${before.percent}% → ${after.percent}%`,
  )

  // Keyboard operation.
  await target.focus()
  await page.keyboard.press('Enter')
  await page.waitForTimeout(400)
  const backAgain = await readDemo(page)
  check(
    backAgain.counted === before.counted && backAgain.percent === before.percent,
    'the keyboard toggles it back to the starting figure',
    `${backAgain.counted} vs ${before.counted}`,
  )

  // Choosing another role re-reads that role’s asks.
  const roleButtons = card.locator('[role="group"][aria-label="Illustrative roles"] button')
  const other = roleButtons.filter({ hasText: 'Records and data assistant' }).first()
  await other.click()
  await page.waitForTimeout(400)
  const swapped = await readDemo(page)
  check(
    swapped.status.includes('Records and data assistant'),
    'the coverage sentence names the selected role',
    swapped.status.slice(0, 90),
  )
  check(
    swapped.rows.some((row) => /Records management/.test(row.text)) || swapped.rows.some((row) => /Data privacy/.test(row.text)),
    'the new role’s own asks are listed',
    JSON.stringify(swapped.rows.map((row) => row.text).slice(0, 6)),
  )

  for (const width of [375, 768, 1024]) {
    await page.setViewportSize({ width, height: 1300 })
    await page.waitForTimeout(600)
    const scroll = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    check(scroll <= 0, `the demo fits ${width}px`, `${scroll}px of page scroll`)
  }

  const afterInteraction = requests.slice()
  check(
    afterInteraction.length === 0,
    'interacting with the demo makes no request at all',
    afterInteraction.slice(0, 5).join(' | '),
  )
  check(consoleErrors.length === 0, 'no console or page errors', consoleErrors.slice(0, 4).join(' | '))

  await browser.close()
  if (problems.length) {
    console.log(`\n${problems.length} problem(s):`)
    for (const problem of problems) console.log(` - ${problem}`)
    process.exit(1)
  }
  console.log('\nAll public skills-demo checks passed.')
}

main()
