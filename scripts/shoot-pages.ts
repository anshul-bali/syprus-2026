/**
 * Screenshot + image-integrity probe.
 *   npx tsx scripts/shoot-pages.ts <base> <prefix> <widths csv> <pages csv>
 * Pages may carry an account prefix: "candidate:/candidate", "employer:/employer",
 * "admin:/admin"; a bare path is treated as public. For each page and width it
 * reports broken images, stretched images (rendered ratio away from the intrinsic
 * ratio), zero-height figures and horizontal overflow, then saves a full-page shot
 * to .qa-logs/shots/.
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { chromium, type Page } from '@playwright/test'

const BASE = process.argv[2] ?? 'http://localhost:3100'
const PREFIX = process.argv[3] ?? 'img'
const WIDTHS = (process.argv[4] ?? '375,768,1024,1440').split(',').map(Number)
const PAGES = (process.argv[5] ?? '/').split(',')

function demoPassword() {
  if (BASE.includes(':3100')) return 'QaDemoOnly!2026'
  for (const file of ['.env', '.env.local']) {
    if (!existsSync(file)) continue
    const match = /^SEED_DEMO_PASSWORD="?([^"\n]+)"?/m.exec(readFileSync(file, 'utf8'))
    if (match) return match[1]
  }
  return 'QaDemoOnly!2026'
}

const ACCOUNTS: Record<string, string> = {
  candidate: 'anshika@example.com',
  employer: 'people@meridian.example.com',
  'employer-small': 'people@lumen.example.com',
  admin: 'admin@syprus.example.com',
}

async function inspect(page: Page) {
  // Lazy figures only exist once they have been near the viewport, so scroll the
  // whole page first; otherwise an unloaded image looks like a broken one.
  await page.evaluate(async () => {
    const height = document.documentElement.scrollHeight
    for (let y = 0; y < height; y += Math.max(300, window.innerHeight - 100)) {
      window.scrollTo(0, y)
      await new Promise((resolve) => setTimeout(resolve, 120))
    }
    window.scrollTo(0, 0)
  })
  await page.waitForTimeout(1200)
  return page.evaluate(() => {
    const images = Array.from(document.images)
    const failed = images
      .filter((img) => img.currentSrc && img.complete && img.naturalWidth === 0)
      .map((img) => img.currentSrc)
    const unloaded = images.filter((img) => !img.currentSrc).map((img) => img.src.split('/').pop() ?? '')
    const stretched = images
      .filter((img) => img.naturalWidth > 0 && img.getBoundingClientRect().width > 0)
      .map((img) => {
        const box = img.getBoundingClientRect()
        const intrinsic = img.naturalWidth / img.naturalHeight
        const rendered = box.width / box.height
        return { src: (img.currentSrc || img.src).split('/').pop() ?? '', drift: Math.abs(rendered - intrinsic) / intrinsic }
      })
      .filter((entry) => entry.drift > 0.02)
    const collapsed = images
      .filter((img) => img.currentSrc && img.getBoundingClientRect().height < 4)
      .map((img) => (img.currentSrc || img.src).split('/').pop() ?? '')
    const overflow = document.documentElement.scrollWidth - window.innerWidth
    const errors = /Something went wrong/i.test(document.body.innerText)
    return {
      count: images.length,
      broken: failed,
      unloaded,
      stretched,
      collapsed,
      overflow: Math.max(0, overflow),
      errors,
      served: images.filter((img) => img.currentSrc).map((img) => `${(img.currentSrc || img.src).split('/').pop()?.slice(0, 34)} ${img.naturalWidth}x${img.naturalHeight}`),
    }
  })
}

async function main() {
  mkdirSync('.qa-logs/shots', { recursive: true })
  const browser = await chromium.launch()
  let problems = 0
  for (const rawEntry of PAGES) {
    // Git Bash rewrites arguments that look like absolute paths, so routes are
    // passed without the leading slash and rebuilt here.
    const entry = rawEntry.startsWith('/') ? rawEntry.slice(1) : rawEntry
    const [scope, path] = entry.includes(':') ? entry.split(':') : ['public', entry]
    const route = path?.startsWith('/') ? path : `/${path ?? ''}`
    const context = await browser.newContext({ baseURL: BASE })
    const page = await context.newPage()
    const consoleErrors: string[] = []
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text().replace(/\s+/g, ' ').slice(0, 160))
    })
    page.on('pageerror', (error) => consoleErrors.push(`pageerror ${error.message.slice(0, 160)}`))

    if (scope === 'new' || scope === 'new-employer') {
      // A freshly registered account has genuinely empty screens, which is the
      // only honest way to see an empty state. Removed afterwards by the caller.
      const email = `qa-images-${Date.now().toString(36)}@example.com`
      console.log(`       throwaway account: ${email}`)
      await page.goto(scope === 'new-employer' ? '/register?role=employer' : '/register')
      if (scope === 'new-employer') {
        await page.locator('#employer-name').fill('QA Image Recruiter')
        await page.locator('#employer-email').fill(email)
        await page.locator('#organization-name').fill(`QA Image Organisation ${Date.now().toString(36)}`)
        await page.locator('#employer-password').fill('QaImagesOnly!2026')
        await page.locator('#employer-confirm-password').fill('QaImagesOnly!2026')
        await page.getByRole('checkbox').check()
        await page.getByRole('button', { name: 'Register organisation' }).click()
        await page.waitForURL(/employer/, { timeout: 90_000 })
      } else {
        await page.getByLabel('Full name', { exact: true }).fill('QA Image Candidate')
        await page.locator('#candidate-email').fill(email)
        await page.locator('#candidate-password').fill('QaImagesOnly!2026')
        await page.locator('#candidate-confirm-password').fill('QaImagesOnly!2026')
        await page.getByRole('checkbox').check()
        await page.getByRole('button', { name: 'Create candidate account' }).click()
        await page.waitForURL(/onboarding/, { timeout: 90_000 })
      }
    } else if (ACCOUNTS[scope]) {
      await page.goto('/login')
      await page.getByLabel('Email address', { exact: true }).fill(ACCOUNTS[scope])
      await page.getByLabel('Password', { exact: true }).fill(demoPassword())
      await page.locator('main').getByRole('button', { name: 'Sign in', exact: true }).click()
      await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 60_000 })
    }

    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 })
      await page.goto(route, { waitUntil: 'load' })
      await page.waitForTimeout(900)
      const report = await inspect(page)
      const bad =
        report.broken.length > 0 ||
        report.stretched.length > 0 ||
        report.collapsed.length > 0 ||
        report.overflow > 1 ||
        report.errors
      problems += bad ? 1 : 0
      const label = `${scope}:${route}`
      console.log(
        `${bad ? 'FAIL' : 'ok  '} ${label.padEnd(34)} ${String(width).padStart(4)}px images=${report.count} failed=${report.broken.length} unloaded=${report.unloaded.length} stretched=${report.stretched.length} collapsed=${report.collapsed.length} overflow=${report.overflow}px${report.errors ? ' ERROR-BOUNDARY' : ''}`,
      )
      for (const item of report.broken.slice(0, 3)) console.log(`       failed: ${item}`)
      for (const item of report.unloaded.slice(0, 3)) console.log(`       never requested: ${item}`)
      for (const item of report.stretched.slice(0, 3)) console.log(`       ratio drift: ${item.src} ${(item.drift * 100).toFixed(1)}%`)
      for (const item of report.collapsed.slice(0, 3)) console.log(`       collapsed: ${item}`)
      if (process.env.SHOW_SERVED) for (const item of report.served) console.log(`       served: ${item}`)
      await page.screenshot({ path: `.qa-logs/shots/${PREFIX}-${scope}${route.replace(/[^\w]+/g, '-')}-${width}.png`, fullPage: true })
    }
    if (consoleErrors.length) {
      problems += 1
      console.log(`       console: ${consoleErrors.slice(0, 3).join(' | ')}`)
    }
    await context.close()
  }
  await browser.close()
  console.log(problems === 0 ? '\nall pages clean' : `\n${problems} page/width problem(s)`)
  process.exitCode = problems === 0 ? 0 : 1
}

void main()
