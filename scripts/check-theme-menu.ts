/**
 * Account-menu appearance control: does it actually change the theme, and does
 * the menu still behave for keyboard and screen readers with the group inside?
 *   npx tsx scripts/check-theme-menu.ts <base>
 */
import { existsSync, readFileSync, mkdirSync } from 'node:fs'
import { chromium } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

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

async function main() {
  const browser = await chromium.launch()
  const context = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 1100 }, colorScheme: 'dark' })
  const page = await context.newPage()
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(String(error)))

  await page.goto('/login')
  await page.getByLabel('Email address', { exact: true }).fill('anshika@example.com')
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
  await page.locator('main').getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 60_000 })
  await page.goto('/candidate')
  await page.waitForLoadState('networkidle')

  const stored = await page.evaluate(() => localStorage.getItem('theme'))
  check(stored === null || stored === 'system', 'a first visit follows the device, with no stored theme', String(stored))
  const followsDevice = await page.evaluate(() => document.documentElement.classList.contains('dark'))
  check(followsDevice, 'the dark device preference is applied on first visit')

  const trigger = page.locator('button').filter({ hasText: /Anshika/ }).last()
  /** Opening the menu is a toggle, and a re-render can swallow the first click. */
  async function openMenu() {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      if ((await page.getByRole('menu').count()) > 0) return
      await trigger.click()
      await page.waitForTimeout(350)
    }
    throw new Error('the account menu would not open')
  }

  await openMenu()
  const menu = page.getByRole('menu')
  check((await menu.count()) === 1, 'the account menu opens')

  const appearance = page.getByRole('menuitemradio', { name: /Light|Dark|Use device setting/ })
  const options = await appearance.allTextContents()
  check(options.length === 3, 'the menu offers three appearance choices', options.join(' | '))
  const checkedNow = await page.getByRole('menuitemradio', { name: 'Use device setting' }).getAttribute('aria-checked')
  check(checkedNow === 'true', 'the active choice is marked as checked', String(checkedNow))

  await page.screenshot({ path: '.qa-logs/shots/menu-appearance-dark.png' })

  await page.getByRole('menuitemradio', { name: 'Light', exact: true }).click()
  await page.waitForTimeout(500)
  const afterLight = await page.evaluate(() => ({
    stored: localStorage.getItem('theme'),
    dark: document.documentElement.classList.contains('dark'),
  }))
  check(afterLight.stored === 'light' && !afterLight.dark, 'choosing Light overrides the device setting', JSON.stringify(afterLight))

  await openMenu()
  await page.getByRole('menuitemradio', { name: 'Dark', exact: true }).click()
  await page.waitForTimeout(500)
  const afterDark = await page.evaluate(() => document.documentElement.classList.contains('dark'))
  check(afterDark, 'choosing Dark applies the dark palette')

  await openMenu()
  await page.getByRole('menuitemradio', { name: 'Use device setting' }).click()
  await page.waitForTimeout(500)
  const backToSystem = await page.evaluate(() => ({
    stored: localStorage.getItem('theme'),
    dark: document.documentElement.classList.contains('dark'),
  }))
  check(
    (backToSystem.stored === 'system' || backToSystem.stored === null) && backToSystem.dark,
    'returning to the device setting follows the emulated scheme again',
    JSON.stringify(backToSystem),
  )

  // The header icon control and the menu must agree.
  await page.getByRole('button', { name: /Colour theme/i }).first().click()
  await page.waitForTimeout(400)
  const viaIcon = await page.evaluate(() => ({ stored: localStorage.getItem('theme'), dark: document.documentElement.classList.contains('dark') }))
  check(viaIcon.stored === 'light' && !viaIcon.dark, 'the header control switches from the resolved dark to light', JSON.stringify(viaIcon))

  await page.evaluate(() => localStorage.setItem('theme', 'dark'))
  await page.reload()
  await page.waitForLoadState('networkidle')
  await openMenu()
  const audit = await new AxeBuilder({ page }).include('[role="menu"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
  check(audit.violations.length === 0, 'the menu with the appearance group passes axe', JSON.stringify(audit.violations.map((v) => v.id)))

  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  check((await page.getByRole('menu').count()) === 0, 'Escape still closes the menu')

  // Keyboard path: arrow to an appearance item and choose it.
  await trigger.focus()
  await page.keyboard.press('Enter')
  await page.waitForTimeout(300)
  let focused = ''
  for (let step = 0; step < 12; step += 1) {
    await page.keyboard.press('ArrowDown')
    focused = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? '')
    if (/Light|Dark|Use device setting/.test(focused)) break
  }
  check(/Light|Dark|Use device setting/.test(focused), 'the appearance items are reachable by keyboard', focused)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(400)
  const keyboardChoice = await page.evaluate(() => localStorage.getItem('theme'))
  check(keyboardChoice !== null, 'an appearance choice can be made without a pointer', String(keyboardChoice))

  check(errors.length === 0, 'no page errors', errors.slice(0, 3).join(' | '))

  await browser.close()
  if (problems.length) {
    console.log(`\n${problems.length} problem(s):`)
    for (const problem of problems) console.log(` - ${problem}`)
    process.exit(1)
  }
  console.log('\nAppearance control works from pointer, keyboard and menu.')
}

main()
