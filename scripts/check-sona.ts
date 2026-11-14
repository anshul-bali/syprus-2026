/**
 * Live check for SYPRUS Sona against a running build.
 *   npx tsx scripts/check-sona.ts <base>
 * Signs in as the demonstration candidate, asks two questions, and reports the
 * engine that answered each one, the answer text, and whether the transcript
 * persisted across a reload. Also measures the authentication panels at the
 * widths a reviewer is likely to be sitting at.
 */
import { existsSync, readFileSync } from 'node:fs'
import { chromium } from '@playwright/test'

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

const QUESTIONS = [
  'What is still missing from my profile?',
  'Which role am I closest to, and why?',
]

async function main() {
  const browser = await chromium.launch()
  const context = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  const problems: string[] = []

  await page.goto('/login')
  await page.getByLabel('Email address', { exact: true }).fill('anshika@example.com')
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
  await page.locator('main').getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 60_000 })

  await page.goto('/candidate')
  await page.getByRole('button', { name: 'Ask SYPRUS Sona' }).click()
  const panel = page.locator('#syprus-sona-panel')
  await panel.getByRole('button', { name: QUESTIONS[0] }).click()

  let before = await panel.locator('[aria-live="polite"] p').count()
  for (const [index, question] of QUESTIONS.entries()) {
    if (index > 0) {
      await panel.locator('#sona-question').fill(question)
      await panel.getByRole('button', { name: 'Ask Sona' }).click()
    }
    const previous = before
    const deadline = Date.now() + 90_000
    let grew = previous
    while (Date.now() < deadline) {
      grew = await panel.locator('[aria-live="polite"] p').count()
      if (grew > previous) break
      await page.waitForTimeout(500)
    }
    await page.waitForTimeout(800)
    before = grew
    const badges = await panel.locator('p').filter({ hasText: /model ·|rule engine/ }).allInnerTexts()
    const bubbles = await panel.locator('p.leading-relaxed').allInnerTexts()
    const answer = bubbles.filter((line) => line.length > 60).at(-1) ?? '(no answer found)'
    console.log(`\nQ${index + 1}: ${question}`)
    console.log(`  answered by: ${badges.at(-1)?.replace(/\s+/g, ' ').slice(0, 60) || 'no engine badge'}`)
    console.log(`  answer: ${answer.slice(0, 320).replace(/\s+/g, ' ')}`)
    console.log(`  turns: ${previous} -> ${grew}`)
    if (grew <= previous) problems.push(`question ${index + 1} appended no turn`)
    if (/^\(no answer/.test(answer)) problems.push(`question ${index + 1} produced no answer text`)
  }

  await page.screenshot({ path: '.qa-logs/shots/sona-live.png' })
  await page.reload()
  await page.goto('/candidate')
  await page.getByRole('button', { name: 'Ask SYPRUS Sona' }).click()
  const persisted = await panel.locator('[aria-live="polite"] p').count()
  console.log(`\npersisted turns after reload: ${persisted}`)
  if (persisted < 4) problems.push(`transcript did not persist (${persisted} turns)`)

  for (const width of [820, 900, 1024]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/login')
    const visible = await page.locator('aside').isVisible().catch(() => false)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    console.log(`login at ${width}px: panel=${visible ? 'shown' : 'hidden'} overflow=${Math.max(0, overflow)}px`)
    if (!visible) problems.push(`auth panel hidden at ${width}px`)
    if (overflow > 1) problems.push(`horizontal overflow at ${width}px`)
  }

  await browser.close()
  console.log(problems.length ? `\nPROBLEMS:\n${problems.join('\n')}` : '\nSona answered live, persisted, and the panels render at reviewer widths')
  process.exitCode = problems.length ? 1 : 0
}

void main()
