/**
 * Post-start smoke test: sign in through the real UI as the demonstration
 * candidate and as a demonstration employer, and report what each portal shows.
 * Prints no passwords, no cookies and no tokens.
 */
import { chromium, type Page } from '@playwright/test'
import { readFileSync, existsSync } from 'node:fs'

function seedPassword() {
  for (const file of ['.env', '.env.local']) {
    if (!existsSync(file)) continue
    const match = /^SEED_DEMO_PASSWORD="?([^"\n]+)"?/m.exec(readFileSync(file, 'utf8'))
    if (match) return match[1]
  }
  throw new Error('SEED_DEMO_PASSWORD is not set in .env')
}

const base = 'http://localhost:3000'

async function signIn(page: Page, email: string, password: string) {
  await page.goto(`${base}/login`)
  await page.getByLabel('Email address', { exact: true }).fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.locator('main').getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 })
}

const text = (value: string) => value.replace(/\s+/g, ' ').trim()

async function main() {
  const password = seedPassword()
  const browser = await chromium.launch()
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
    const page = await context.newPage()
    const problems: string[] = []
    page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`))

    await signIn(page, 'anshika@example.com', password)
    console.log('candidate signed in →', new URL(page.url()).pathname)
    const dashboard = text(await page.locator('body').innerText())
    console.log('  dashboard says:', dashboard.slice(0, 240))

    await page.goto(`${base}/candidate/jobs`)
    const jobCards = await page.locator('main article, main [data-slot="card"]').count()
    const matchPercents = [...dashboard.matchAll(/(\d{2})%/g)].length
    const jobsText = text(await page.locator('main').innerText())
    console.log(`  recommended roles: ${jobCards} cards, first line: ${jobsText.slice(0, 150)}`)
    void matchPercents

    await page.goto(`${base}/candidate/graph`)
    // React Flow mounts its nodes after hydration, so counting immediately can
    // report zero on a perfectly good graph. Wait for the first node instead.
    let nodes = 0
    try {
      await page.locator('.react-flow__node').first().waitFor({ timeout: 30_000 })
      nodes = await page.locator('.react-flow__node').count()
    } catch {
      problems.push('candidate graph rendered no nodes')
    }
    console.log('  graph nodes rendered:', nodes)

    await page.goto(`${base}/candidate/disclosures`)
    console.log('  disclosure screen ok:', !/Something went wrong/.test(await page.locator('body').innerText()))

    // Two employers, two different truths. Meridian holds a role Anshika applied
    // to *with consent*, so her name belongs there. Ashford never received a
    // consented application, so her name and email must not appear at all.
    const candidateName = 'Anshika (demonstration)'

    for (const [email, expectRevealed] of [
      ['people@meridian.example.com', true],
      ['recruitment@ashford.example.com', false],
    ] as const) {
      await context.clearCookies()
      await signIn(page, email, password)
      await page.goto(`${base}/employer/candidates`)
      const body = text(await page.locator('body').innerText())

      // Per-card is the only honest granularity: an email must never sit on a card
      // that does not also carry a disclosed identity.
      const cards = await page.locator('[data-slot="card"]').evaluateAll((nodes) =>
        nodes.map((node) => {
          const value = (node.textContent ?? '').replace(/\s+/g, ' ')
          return {
            handle: /SYPR-[A-Z0-9]+/.test(value),
            addresses: [...value.matchAll(/[\w.+-]+@[\w-]+\.[\w.]+/g)].map((match) => match[0]),
            disclosed: /Identity disclosed/i.test(value),
            withheld: /Profile text withheld|Anonymous$/i.test(value),
          }
        }),
      )
      const listed = cards.filter((card) => card.handle)
      const leaked = listed.filter((card) => card.addresses.length && !card.disclosed)
      console.log(`\nemployer ${email}`)
      console.log(`  anonymous handles listed: ${listed.length}`)
      console.log(`  candidate name shown: ${body.includes(candidateName)} (expected ${expectRevealed})`)
      for (const card of listed.filter((entry) => entry.addresses.length)) {
        console.log(`    card addresses: ${card.addresses.join(', ')} | disclosed flag: ${card.disclosed} | withheld copy: ${card.withheld}`)
      }
      if (leaked.length) problems.push(`${email}: ${leaked.length} card(s) show contact details without a disclosed identity`)
      if (body.includes(candidateName) !== expectRevealed) {
        problems.push(`${email}: identity visibility did not match the consent on file`)
      }
      await page.goto(`${base}/employer/jobs`)
      console.log(`  roles page renders: ${!(await page.locator('body').innerText()).includes('Something went wrong')}`)
    }

    await context.clearCookies()
    await signIn(page, 'admin@syprus.example.com', password)
    await page.goto(`${base}/admin/fairness`)
    console.log('  admin fairness verdict line:', text(await page.locator('main').innerText()).slice(0, 150))

    console.log(problems.length ? `PROBLEMS:\n${problems.join('\n')}` : 'no page errors during the walkthrough')
  } finally {
    await browser.close()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
