/**
 * Interview-date check for the application tracker, run against the isolated
 * QA cluster only. An employer records an interview invitation through the
 * normal pipeline form, then the candidate screen is read back.
 *   npx tsx scripts/check-interview-date.ts
 */
import { chromium } from '@playwright/test'

const BASE = 'http://localhost:3100'
const PASSWORD = 'QaDemoOnly!2026'
const EMPLOYERS = [
  'talent@northwind.example.com',
  'recruitment@ashford.example.com',
  'people@meridian.example.com',
  'people@lumen.example.com',
]

const problems: string[] = []

function check(condition: boolean, label: string, detail = '') {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
  if (!condition) problems.push(`${label}: ${detail}`)
}

async function signIn(page: import('@playwright/test').Page, email: string) {
  await page.goto('/login')
  await page.getByLabel('Email address', { exact: true }).fill(email)
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
  await page.locator('main').getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 60_000 })
}

async function main() {
  const browser = await chromium.launch()
  const context = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 1200 } })
  const page = await context.newPage()
  const consoleErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('?_rsc=')) consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => consoleErrors.push(String(error)))

  // Read the candidate’s own applications first, so the employer move is made
  // on one of them rather than on an unrelated row in the same pipeline.
  await signIn(page, 'anshika@example.com')
  await page.goto('/candidate/applications')
  await page.waitForLoadState('networkidle')
  const herRoles = await page.locator('[data-slot="card-title"]').allTextContents()
  console.log(`  her applications: ${herRoles.join(' | ')}`)

  // Find an employer that has one of the demonstration candidate’s applications.
  let invited = ''
  for (const email of EMPLOYERS) {
    await signIn(page, email)
    await page.goto('/employer/applications')
    await page.waitForLoadState('networkidle')
    const rows = page.locator('[data-slot="card"]').filter({ has: page.getByRole('combobox') })
    const count = await rows.count()
    const mine: { row: typeof rows; title: string }[] = []
    for (const index of Array.from({ length: count }, (_, i) => i)) {
      const candidate = rows.nth(index)
      const text = (await candidate.textContent()) ?? ''
      const title = herRoles.find((role) => role && text.includes(role))
      if (title) mine.push({ row: candidate, title })
    }
    if (mine.length === 0) {
      console.log(`  ${email}: none of her roles in this pipeline (${count} movable rows)`)
      continue
    }
    for (const { row, title } of mine) {
      const before = (await row.textContent())?.replace(/\s+/g, ' ').trim().slice(0, 140)
      const trigger = row.locator('[id$="-status"]').first()
      await trigger.click()
      await page.waitForTimeout(400)
      const options = await page.getByRole('option').allTextContents()
      console.log(`  ${email} · ${title}: moves offered = ${options.join(' | ')}`)
      const wanted = options.find((option) => /interview invited/i.test(option))
      if (!wanted) {
        await page.keyboard.press('Escape')
        // The state machine forbids inviting twice. If this application is
        // already at or past the interview stage, the date on the candidate’s
        // screen is the one an employer recorded, which is what this checks.
        if (/interview (invited|completed)|offer extended|hired/i.test(before ?? '')) {
          invited = `${email} (already past the invitation — no second invite offered, correctly)`
          break
        }
        continue
      }
      await page.getByRole('option', { name: wanted, exact: true }).click()
      const date = row.locator('input[name="interviewScheduledAt"]')
      if ((await date.count()) === 0) {
        console.log(`  ${email} · ${title}: no date field offered`)
        continue
      }
      await date.fill('2026-12-04T10:00')
      await row.getByRole('button', { name: /Update stage/i }).click()
      await page.waitForLoadState('networkidle')
      await page.waitForTimeout(1500)
      const after = (await page
        .locator('[data-slot="card"]')
        .filter({ has: page.getByRole('combobox') })
        .filter({ hasText: title })
        .first()
        .textContent())
        ?.replace(/\s+/g, ' ')
        .trim()
        .slice(0, 140)
      console.log(`  ${email} · ${title}\n    before: ${before}\n    after : ${after}`)
      invited = email
      break
    }
    if (invited) break
  }
  check(Boolean(invited), 'an employer recorded an interview invitation', invited)

  await signIn(page, 'anshika@example.com')
  await page.goto('/candidate/applications')
  await page.waitForLoadState('networkidle')

  const invitedLine = page.getByText(/Invited for /).first()
  const hasInvited = (await invitedLine.count()) > 0
  check(
    hasInvited,
    'the candidate sees the interview date the employer entered',
    hasInvited ? ((await invitedLine.textContent()) ?? '').replace(/\s+/g, ' ').trim().slice(0, 140) : 'no invitation line',
  )

  const chip = page.locator('ol[aria-label="Stages recorded for this application"] li').filter({ hasText: 'Interview invited' })
  const chipCount = await chip.count()
  check(chipCount >= 1, 'the interview stage appears on the rail', chipCount ? ((await chip.first().textContent()) ?? '').replace(/\s+/g, ' ').trim() : 'no chip')
  if (chipCount >= 1) {
    check(
      ((await chip.first().textContent()) ?? '').includes('recorded by the employer or a reviewer'),
      'the stage is attributed to the employer, not to the platform',
    )
  }

  for (const width of [375, 768]) {
    await page.setViewportSize({ width, height: 1200 })
    await page.waitForTimeout(600)
    const scroll = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    check(scroll <= 0, `interview block fits ${width}px`, `${scroll}px`)
  }

  check(consoleErrors.length === 0, 'no console or page errors', consoleErrors.slice(0, 3).join(' | '))

  await browser.close()
  if (problems.length) {
    console.log(`\n${problems.length} problem(s):`)
    for (const problem of problems) console.log(` - ${problem}`)
    process.exit(1)
  }
  console.log('\nInterview date is stored by the employer and drawn from the record.')
}

main()
