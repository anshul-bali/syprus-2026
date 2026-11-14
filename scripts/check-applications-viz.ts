/**
 * Live read-only check for the application tracker.
 *   npx tsx scripts/check-applications-viz.ts <base>
 *
 * Nothing here writes: the point is that the screen draws exactly what the
 * stored history says, so the check reads the DOM and reconciles the stage rail
 * against the event list, the missing-stage line and the interview block.
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

const STAGES = [
  'Submitted',
  'In review',
  'Shortlisted',
  'Interview invited',
  'Interview completed',
  'Offer extended',
  'Hired',
  'Rejected',
  'Withdrawn',
]

const problems: string[] = []

function check(condition: boolean, label: string, detail = '') {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
  if (!condition) problems.push(`${label}: ${detail}`)
}

function stageIn(text: string) {
  return STAGES.find((stage) => text.toLowerCase().startsWith(stage.toLowerCase()) || text.toLowerCase().includes(` ${stage.toLowerCase()}`)) ?? null
}

async function readCards(page: Page) {
  return page.locator('[data-slot="card"]').evaluateAll((cards) =>
    cards
      .filter((card) => card.querySelector('ol[aria-label="Stages recorded for this application"]'))
      .map((card) => {
        const chips = Array.from(card.querySelectorAll('ol[aria-label="Stages recorded for this application"] li')).map((node) =>
          (node.textContent ?? '').replace(/\s+/g, ' ').trim(),
        )
        const events = Array.from(
          card.querySelectorAll('ol[aria-label="Status events recorded for this application"] li'),
        ).map((node) => (node.textContent ?? '').replace(/\s+/g, ' ').trim())
        const text = (card.textContent ?? '').replace(/\s+/g, ' ')
        return { chips, events, text }
      }),
  )
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

  await page.goto('/candidate/applications')
  await page.waitForLoadState('networkidle')

  if ((await page.getByText('No applications yet').count()) > 0) {
    console.log('  this account has no applications — nothing to reconcile')
    await browser.close()
    return
  }

  const cards = await readCards(page)
  check(cards.length > 0, 'applications render with a stage rail', `${cards.length} card(s)`)

  let chipsChecked = 0
  let interviewCards = 0
  for (const [index, card] of cards.entries()) {
    const currentMatch = card.text.match(/(Submitted|In review|Shortlisted|Interview invited|Interview completed|Offer extended|Hired|Rejected|Withdrawn)/)
    for (const chip of card.chips) {
      const stage = stageIn(chip)
      if (!stage) continue
      chipsChecked += 1
      const hasEvent = card.events.some((event) => stageIn(event) === stage)
      const isCurrent = chip.includes('now')
      const claimsNoEvent = /no event on file/i.test(chip)
      check(
        hasEvent || isCurrent || claimsNoEvent || stage === currentMatch?.[1],
        `card ${index + 1}: the ${stage} chip is backed by a recorded event`,
        chip.slice(0, 90),
      )
    }

    const missingLine = /No event on file for ([^.]+)\./.exec(card.text)
    if (missingLine) {
      const named = missingLine[1]!
        .split(',')
        .map((part) => part.trim().replace(/^and /, ''))
        .filter(Boolean)
      const overlap = named.filter((stage) => card.chips.some((chip) => stageIn(chip)?.toLowerCase() === stage))
      check(overlap.length === 0, `card ${index + 1}: a stage named as missing is not drawn as reached`, `${named.join(', ')} vs ${card.chips.length} chips`)
    }

    const invited = /Invited for /.test(card.text)
    const noDate = /no date was entered with it/.test(card.text)
    const interviewChip = card.chips.some((chip) => /Interview invited|Interview completed/i.test(chip))
    if (interviewChip) interviewCards += 1
    check(
      invited || noDate || !interviewChip,
      `card ${index + 1}: an interview stage either carries a stored date or says none exists`,
      `invited=${invited} noDateNote=${noDate} chip=${interviewChip}`,
    )
  }

  // Group headings must agree with the badge each card carries.
  const groups = await page.locator('main section').evaluateAll((sections) => {
    const stageWords = [
      'submitted',
      'in review',
      'shortlisted',
      'interview invited',
      'interview completed',
      'offer extended',
      'hired',
      'rejected',
      'withdrawn',
    ]
    return sections.map((section) => {
      const heading = section.querySelector('h2')?.textContent?.trim() ?? ''
      const badges = Array.from(section.querySelectorAll('[data-slot="card"]')).map((card) => {
        // StatusBadge is a plain span in the header; the rail’s “now” chip lives
        // in the body, so reading the header only keeps the two apart.
        const header = card.querySelector('[data-slot="card-header"]')
        const texts = Array.from(header?.querySelectorAll('span') ?? []).map((node) => node.textContent?.trim().toLowerCase() ?? '')
        return stageWords.find((word) => texts.includes(word)) ?? ''
      })
      return { heading, badges }
    })
  })
  console.log('  groups:', JSON.stringify(groups))
  const liveWords = ['submitted', 'in review', 'shortlisted', 'interview invited', 'interview completed', 'offer extended']
  for (const group of groups) {
    if (/Still with a hiring team/i.test(group.heading)) {
      check(
        group.badges.every((badge) => liveWords.includes(badge)),
        'the live group holds only undecided stages',
        group.badges.join(', '),
      )
    }
    if (/Withdrawn by you/i.test(group.heading)) {
      check(group.badges.every((badge) => badge === 'withdrawn'), 'withdrawn group holds only withdrawals', group.badges.join(', '))
    }
    if (/Decided/i.test(group.heading)) {
      check(group.badges.every((badge) => ['rejected', 'hired'].includes(badge)), 'decided group holds only outcomes', group.badges.join(', '))
    }
  }

  const totalNumber = await page.evaluate(() => {
    const label = Array.from(document.querySelectorAll('main p, main span')).find(
      (node) => node.textContent?.trim() === 'Submitted here',
    )
    const card = label?.closest('[data-slot="card"]')
    const match = /(\d+)/.exec((card?.textContent ?? '').replace(/\s+/g, ' '))
    return match ? Number(match[1]) : -1
  })
  check(totalNumber === cards.length, 'the header count equals the cards listed', `${totalNumber} vs ${cards.length}`)

  for (const width of [375, 768, 1024]) {
    await page.setViewportSize({ width, height: 1200 })
    await page.waitForTimeout(700)
    const scroll = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    check(scroll <= 0, `tracker fits ${width}px`, `${scroll}px of page scroll`)
  }

  check(consoleErrors.length === 0, 'no console or page errors', consoleErrors.slice(0, 4).join(' | '))
  console.log(`  reconciled ${chipsChecked} stage chips across ${cards.length} applications, ${interviewCards} with an interview stage`)

  await browser.close()
  if (problems.length) {
    console.log(`\n${problems.length} problem(s):`)
    for (const problem of problems) console.log(` - ${problem}`)
    process.exit(1)
  }
  console.log('\nAll application tracker checks passed.')
}

main()
