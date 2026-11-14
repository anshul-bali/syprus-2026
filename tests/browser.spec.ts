import { test, expect, type Page, type Locator } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { PrismaClient } from '@prisma/client'

const database = new URL(process.env.DATABASE_URL || 'http://invalid')
if (database.hostname !== 'localhost' || database.port !== '55433' || database.pathname !== '/syprus_qa') {
  throw new Error('Browser tests must run through scripts/qa.ts against the isolated local QA database.')
}
const prisma = new PrismaClient()
const run = Date.now().toString(36)
const candidateEmail = `qa-candidate-${run}@example.com`
const employerEmail = `qa-employer-${run}@example.com`
const password = 'QaJourneyOnly!2026'
const candidateName = `Anshika QA ${run}`
const organizationName = `Fictional QA Employer ${run}`
const jobTitle = `Fictional Marketing Coordinator ${run}`
let profileId: string
let handle: string
let jobId: string
const errors: string[] = []

/**
 * Sign-in and registration both stop at /verify-email. Every QA address is on a
 * reserved example domain, so the code is displayed on that screen rather than
 * emailed — which is what lets a journey drive the second step at all.
 */
async function completeCode(page: Page, submit: 'Verify and sign in' | 'Confirm and continue' = 'Verify and sign in') {
  await expect(page).toHaveURL(/\/verify-email/)
  const preview = page.locator('#verification-preview-code')
  await expect(preview).toBeVisible()
  const code = ((await preview.textContent()) ?? '').replace(/\D/g, '')
  expect(code).toMatch(/^\d{6}$/)
  await page.getByLabel('Six-digit code', { exact: true }).fill(code)
  await page.getByRole('button', { name: submit, exact: true }).click()
  await expect(page).not.toHaveURL(/\/verify-email/)
}

async function login(page: Page, email: string, secret = 'QaDemoOnly!2026') {
  await page.goto('/login')
  await page.getByLabel('Email address', { exact: true }).fill(email)
  await page.getByLabel('Password', { exact: true }).fill(secret)
  await page.locator('main').getByRole('button', { name: 'Sign in', exact: true }).click()
  await completeCode(page)
}
async function choose(page: Page, trigger: Locator, option: string | RegExp) {
  await trigger.click()
  await page.getByRole('option', { name: option, exact: typeof option === 'string' }).click()
}
async function send(page: Page, nextSelector: string) {
  await page.getByRole('button', { name: 'Send answer', exact: true }).click()
  await expect(page.locator(nextSelector)).toBeVisible()
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
}

test.describe.serial('real persisted candidate, employer and administrator journeys', () => {
  test.beforeEach(async ({ page }) => {
    page.on('pageerror', (error) => errors.push(error.message))
  })
  test.afterAll(async () => {
    // Sweep by name pattern as well as by identifier: a run interrupted before
    // its own cleanup (database restart, machine sleep) leaves its role and
    // organisation behind, and those would pile up on a demo database.
    const users = await prisma.user.findMany({ where: { email: { in: [candidateEmail, employerEmail] } }, select: { id: true } })
    await prisma.organization.deleteMany({ where: { OR: [{ ownerUserId: { in: users.map((user) => user.id) } }, { name: { startsWith: 'Fictional QA Employer ' } }] } })
    await prisma.job.deleteMany({ where: { title: { startsWith: 'Fictional Marketing Coordinator ' } } })
    await prisma.user.deleteMany({ where: { id: { in: users.map((user) => user.id) } } })
    await prisma.weightProfile.deleteMany({ where: { version: { startsWith: 'qa-' } } })
    await prisma.$disconnect()
  })

  test('candidate registers, onboards, confirms skills, edits graph, learns and applies', async ({ page }, info) => {
    await page.goto('/register')
    await page.getByLabel('Full name', { exact: true }).fill(candidateName)
    await page.locator('#candidate-email').fill(candidateEmail)
    await page.locator('#candidate-password').fill(password)
    await page.locator('#candidate-confirm-password').fill(password)
    await page.getByRole('checkbox').check()
    await page.getByRole('button', { name: 'Create candidate account' }).click()
    await completeCode(page, 'Confirm and continue')
    await expect(page).toHaveURL(/\/candidate\/onboarding/)
    await page.locator('#onboarding-inferenceConsent-yes').check()
    await send(page, '#onboarding-months')
    await page.locator('#onboarding-months').fill('36')
    await choose(page, page.locator('#onboarding-timeline'), 'Within three months')
    await send(page, '#onboarding-title')
    await page.locator('#onboarding-title').fill('Marketing analyst')
    await page.locator('#onboarding-organization').fill('Fictional previous employer')
    await page.locator('#onboarding-years').fill('4')
    await page.locator('#onboarding-description').fill('I analysed data in Excel, built weekly reports, managed budgets and coordinated stakeholder communications.')
    await send(page, '#onboarding-notes')
    await page.getByRole('checkbox').first().check()
    await page.locator('#onboarding-notes').fill('I managed schedules and tracked a household budget during caregiving.')
    await send(page, '#onboarding-volunteering')
    await page.locator('#onboarding-volunteering').fill('I coordinated volunteers and planned community events.')
    await send(page, '#onboarding-targetRole')
    await page.locator('#onboarding-targetRole').fill('Marketing coordinator')
    await choose(page, page.locator('#onboarding-workPreference'), 'Remote')
    await page.locator('#onboarding-availability').fill('30')
    await page.locator('#onboarding-city').fill('Pune')
    await send(page, '#onboarding-anonymizedSharing-yes')
    await page.locator('#onboarding-anonymizedSharing-yes').check()
    await page.locator('#onboarding-employerContact-yes').check()
    await page.locator('#onboarding-research-no').check()
    await page.getByRole('button', { name: 'Send answer', exact: true }).click()
    await page.getByRole('button', { name: 'Finish onboarding' }).click()
    await expect(page.getByText('Onboarding complete', { exact: true })).toBeVisible()
    const profile = await prisma.candidateProfile.findFirstOrThrow({ where: { user: { email: candidateEmail } }, include: { skills: true, experiences: true } })
    profileId = profile.id; handle = profile.anonymousHandle
    expect(profile.onboardingComplete).toBe(true)
    expect(profile.skills.length).toBeGreaterThan(0)
    expect(profile.experiences.length).toBeGreaterThanOrEqual(3)

    await page.goto('/candidate/skills')
    await page.getByRole('button', { name: 'Edit skill', exact: true }).first().click()
    await page.getByRole('dialog').getByLabel('Why this skill belongs on your profile').fill('I confirm this skill from my documented work.')
    await page.getByRole('button', { name: 'Save changes', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    expect(await prisma.candidateSkill.count({ where: { candidateProfileId: profileId, note: 'I confirm this skill from my documented work.', validationStatus: 'SELF_REPORTED' } })).toBe(1)

    await page.goto('/candidate/graph')
    await expect(page.locator('.react-flow__node').first()).toBeVisible()
    await page.getByRole('button', { name: 'Fit the graph to the view' }).click()
    const node = page.locator('.react-flow__node[data-id^="skill:"]').first()
    await node.click()
    await page.getByLabel('Your note about this node').fill('Saved through the real graph inspector.')
    await page.getByRole('button', { name: 'Save node', exact: true }).click()
    await expect.poll(() => prisma.graphAnnotation.count({ where: { candidateProfileId: profileId, note: 'Saved through the real graph inspector.' } })).toBe(1)
    await page.reload()
    await node.click()
    await expect(page.getByLabel('Your note about this node')).toHaveValue('Saved through the real graph inspector.')
    const box = await node.boundingBox()
    expect(box).not.toBeNull()
    await page.mouse.move(box!.x + box!.width / 2, box!.y + 15)
    await page.mouse.down()
    await page.mouse.move(box!.x + box!.width / 2 + 40, box!.y + 45, { steps: 12 })
    await page.mouse.up()
    await expect.poll(() => prisma.graphAnnotation.count({ where: { candidateProfileId: profileId, positionX: { not: null } } })).toBeGreaterThan(0)
    await page.screenshot({ path: info.outputPath('candidate-graph.png'), fullPage: true })

    await page.goto('/candidate/pathways')
    await page.getByRole('button', { name: 'Build pathway', exact: true }).click()
    await expect.poll(() => prisma.learningPlan.count({ where: { candidateProfileId: profileId } })).toBeGreaterThan(0)
    await page.goto('/candidate/jobs')
    await page.getByRole('button', { name: 'Why this score', exact: true }).first().click()
    await expect(page.getByRole('dialog')).toContainText('The calculation')
    await page.keyboard.press('Escape')
    const match = await prisma.match.findFirstOrThrow({ where: { candidateProfileId: profileId, job: { status: 'PUBLISHED' } }, orderBy: { score: 'desc' } })
    await page.goto(`/candidate/jobs/${match.jobId}`)
    await page.getByRole('button', { name: 'Apply', exact: true }).click()
    await page.getByRole('button', { name: 'Submit application', exact: true }).click()
    await expect(page.getByRole('alert').first()).toContainText(/consent/i)
    await page.getByRole('checkbox', { name: /I consent to share/ }).check()
    await page.getByRole('button', { name: 'Submit application', exact: true }).click()
    await expect.poll(() => prisma.application.count({ where: { candidateProfileId: profileId, jobId: match.jobId, identityConsentAt: { not: null } } })).toBe(1)
    await page.goto('/candidate/applications')
    await expect(page.locator('main')).toContainText(/Submitted/i)
    expect(errors).toEqual([])
  })

  test('employer registers, creates a role, gains moderation, shortlists and requests consent', async ({ page, browser }, info) => {
    await page.goto('/register?role=employer')
    await page.locator('#employer-name').fill('Fictional hiring reviewer')
    await page.locator('#employer-email').fill(employerEmail)
    await page.locator('#organization-name').fill(organizationName)
    await page.locator('#industry').fill('Media')
    await page.locator('#employer-password').fill(password)
    await page.locator('#employer-confirm-password').fill(password)
    await page.getByRole('checkbox').check()
    await page.getByRole('button', { name: 'Register organisation', exact: true }).click()
    await completeCode(page, 'Confirm and continue')
    await expect(page).toHaveURL(/\/employer\/profile/)
    await page.goto('/employer/jobs/new')
    await page.getByLabel('Role title', { exact: true }).fill(jobTitle)
    await page.getByLabel('What the role does', { exact: true }).fill('Coordinate weekly marketing reports and stakeholder communications. We assess skills and welcome career returners. This is a fictional QA role.')
    await page.getByLabel('Search the skill catalogue').fill('excel')
    await page.getByRole('button', { name: 'Add Excel to the role', exact: true }).click()
    await page.getByRole('button', { name: 'Create draft role', exact: true }).click()
    await expect(page).not.toHaveURL(/\/employer\/jobs\/new/)
    await expect(page).toHaveURL(/\/employer\/jobs\/[^/?]+/)
    const job = await prisma.job.findFirstOrThrow({ where: { title: jobTitle } }); jobId = job.id
    expect(job.status).toBe('DRAFT')
    const adminContext = await browser.newContext({ baseURL: 'http://localhost:3100' })
    const admin = await adminContext.newPage()
    try {
      await login(admin, 'admin@syprus.example.com')
      await admin.goto('/admin/organisations')
      const organization = admin.locator('[data-slot="card"]').filter({ hasText: organizationName }).last()
      await choose(admin, organization.getByRole('combobox'), /Verified/)
      await organization.getByRole('textbox').fill('Fictional QA organisation verified for isolated browser testing.')
      await organization.getByRole('button', { name: 'Record decision' }).click()
      await expect.poll(async () => (await prisma.organization.findUniqueOrThrow({ where: { id: job.organizationId } })).verificationStatus).toBe('VERIFIED')
      await page.reload()
      await page.getByRole('button', { name: 'Submit for moderation', exact: true }).click()
      await expect.poll(async () => (await prisma.job.findUniqueOrThrow({ where: { id: jobId } })).status).toBe('PENDING_MODERATION')
      await admin.goto('/admin/moderation')
      const moderation = admin.locator('form').filter({ hasText: jobTitle })
      await moderation.getByRole('textbox').fill('Fictional skills-based role reviewed in isolated QA.')
      await moderation.getByRole('button', { name: 'Record decision' }).click()
      await expect.poll(async () => (await prisma.job.findUniqueOrThrow({ where: { id: jobId } })).status).toBe('PUBLISHED')
      await expect.poll(() => prisma.match.count({ where: { jobId, candidateProfileId: profileId } })).toBe(1)
      await page.reload()
      const candidate = page.locator('[data-slot="card"]').filter({ hasText: handle }).last()
      await expect(candidate).not.toContainText(candidateName)
      await expect(candidate).not.toContainText(candidateEmail)
      await candidate.getByRole('button', { name: /Add to shortlist/ }).click()
      await expect.poll(() => prisma.shortlistEntry.count({ where: { candidateProfileId: profileId, jobId } })).toBe(1)
      await candidate.getByRole('button', { name: 'Ask to see who this is' }).click()
      await page.getByRole('dialog').getByRole('textbox').fill('We would like to arrange a skills conversation about this fictional role.')
      await page.getByRole('button', { name: 'Send the request', exact: true }).click()
      await expect.poll(() => prisma.identityDisclosureRequest.count({ where: { candidateProfileId: profileId, organizationId: job.organizationId, status: 'PENDING' } })).toBe(1)
      await page.reload()
      await expect(page.locator('main')).not.toContainText(candidateEmail)
      const context = await browser.newContext({ baseURL: 'http://localhost:3100' })
      const candidatePage = await context.newPage()
      try {
        await login(candidatePage, candidateEmail, password)
        await candidatePage.goto('/candidate/disclosures')
        await candidatePage.getByRole('button', { name: 'Share my identity', exact: true }).click()
        await candidatePage.getByRole('button', { name: 'Confirm: share my identity', exact: true }).click()
        await expect.poll(() => prisma.identityDisclosureRequest.count({ where: { candidateProfileId: profileId, organizationId: job.organizationId, status: 'APPROVED' } })).toBe(1)
        await page.reload()
        await expect(page.locator('main')).toContainText(candidateEmail)
        await candidatePage.getByRole('button', { name: 'Withdraw identity grant', exact: true }).click()
        await expect.poll(() => prisma.identityDisclosureRequest.count({ where: { candidateProfileId: profileId, organizationId: job.organizationId, status: 'WITHDRAWN' } })).toBe(1)
        await page.reload()
        await expect(page.locator('main')).not.toContainText(candidateEmail)
        await candidatePage.goto(`/candidate/jobs/${jobId}`)
        await candidatePage.getByRole('button', { name: 'Apply', exact: true }).click()
        await candidatePage.getByRole('checkbox', { name: /I consent to share/ }).check()
        await candidatePage.getByRole('button', { name: 'Submit application', exact: true }).click()
        await expect.poll(() => prisma.application.count({ where: { candidateProfileId: profileId, jobId } })).toBe(1)
        await page.reload()
        await page.getByRole('tab', { name: /Applications/ }).click()
        await choose(page, page.getByRole('combobox', { name: 'Move to' }), 'Shortlisted')
        await page.getByRole('button', { name: 'Update stage' }).click()
        await expect.poll(async () => (await prisma.application.findFirstOrThrow({ where: { candidateProfileId: profileId, jobId } })).status).toBe('SHORTLISTED')
        await choose(page, page.getByRole('combobox', { name: 'Move to' }), 'Interview invited')
        await page.getByLabel('Interview slot (invitations)').fill('2026-12-01T10:00')
        await page.getByRole('button', { name: 'Update stage' }).click()
        await expect.poll(async () => (await prisma.application.findFirstOrThrow({ where: { candidateProfileId: profileId, jobId } })).status).toBe('INTERVIEW_INVITED')
        await candidatePage.goto('/candidate/applications')
        await expect(candidatePage.locator('main')).toContainText(/Interview invited/i)
      } finally { await context.close() }
      await page.screenshot({ path: info.outputPath('employer-pipeline.png'), fullPage: true })
      expect(await prisma.profileView.count({ where: { candidateProfileId: profileId, revealedIdentity: true } })).toBeGreaterThan(0)
    } finally { await adminContext.close() }
    expect(errors).toEqual([])
  })

  test('assessment redirect, administration, access control and responsive accessibility', async ({ page }, info) => {
    await login(page, candidateEmail, password)
    await page.goto('/candidate/assessments')
    await page.getByRole('button', { name: 'Start this assessment', exact: true }).first().click()
    await expect(page).toHaveURL(/\/candidate\/assessments\/[^/]+$/)
    const attemptId = new URL(page.url()).pathname.split('/').pop()!
    const attempt = await prisma.assessmentAttempt.findUniqueOrThrow({ where: { id: attemptId }, include: { assessment: { include: { questions: true } } } })
    for (const question of attempt.assessment.questions) await page.locator(`input[name="answer:${question.id}"][value="${question.correctIndex}"]`).check()
    await page.getByRole('button', { name: 'Submit my answers' }).click()
    await expect.poll(async () => (await prisma.assessmentAttempt.findUniqueOrThrow({ where: { id: attemptId } })).passed).toBe(true)
    await page.goto('/admin')
    await expect(page).not.toHaveURL(/\/admin$/)
    await page.context().clearCookies()
    await login(page, 'admin@syprus.example.com')
    for (const route of ['/admin/moderation', '/admin/review', '/admin/audit', '/admin/reporting', '/admin/fairness', '/admin/engines']) {
      const response = await page.goto(route)
      expect(response?.status()).toBe(200)
      await expect(page.getByRole('heading', { name: 'Something went wrong' })).toHaveCount(0)
    }
    await page.goto('/admin/weights')
    await page.getByRole('textbox', { name: 'Version tag *', exact: true }).fill(`qa-${run}`)
    await page.getByRole('checkbox', { name: /Make this the active set/ }).uncheck()
    await page.getByRole('button', { name: 'Save weight set' }).click()
    await expect.poll(async () => (await prisma.weightProfile.findUnique({ where: { version: `qa-${run}` } }))?.required).toBe(.5)
    expect(await prisma.auditEvent.count({ where: { action: 'admin.weights.save' } })).toBeGreaterThan(0)
    await page.context().clearCookies()
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      for (const route of ['/', '/login', '/register']) {
        await page.goto(route)
        await noOverflow(page)
        const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
        expect(audit.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.map((n) => n.target) }))).toEqual([])
      }
      await page.screenshot({ path: info.outputPath(`registration-${width}.png`), fullPage: true })
    }
    expect(errors).toEqual([])
  })

  test('navigation has no dead links and failure states render', async ({ page }, info) => {
    // Every internal link reachable from the public site and from each portal's
    // own navigation is requested. A link that resolves to 4xx/5xx, or a page
    // that renders the error boundary, is a defect a reviewer hits immediately.
    const seen = new Set<string>()
    const broken: { from: string; href: string; status: number }[] = []
    const errored: string[] = []
    const crawl = async (entry: string) => {
      await page.goto(entry)
      if (await page.getByRole('heading', { name: 'Something went wrong' }).count()) errored.push(entry)
      const hrefs = await page.evaluate(() =>
        [...document.querySelectorAll('main a[href], header a[href], nav a[href]')]
          .map((anchor) => anchor.getAttribute('href') ?? '')
          .filter((href) => href.startsWith('/') && !href.startsWith('//') && !href.includes('#')))
      for (const href of [...new Set(hrefs)]) {
        if (seen.has(href)) continue
        seen.add(href)
        const response = await page.request.get(href)
        if (response.status() >= 400) broken.push({ from: entry, href, status: response.status() })
      }
    }

    for (const entry of ['/', '/login', '/register']) await crawl(entry)
    const publicLinks = seen.size

    await login(page, candidateEmail, password)
    await crawl('/candidate')
    await page.context().clearCookies()
    await login(page, employerEmail, password)
    await crawl('/employer')
    await page.context().clearCookies()
    await login(page, 'admin@syprus.example.com')
    await crawl('/admin')

    expect(broken, JSON.stringify(broken)).toEqual([])
    expect(errored, JSON.stringify(errored)).toEqual([])
    expect(publicLinks, 'the public site should link to its own screens').toBeGreaterThan(4)
    expect(seen.size, 'the three portals should be covered').toBeGreaterThan(28)

    // Unknown address, wrong role and signed out each have their own outcome.
    await page.context().clearCookies()
    await login(page, candidateEmail, password)
    await page.goto('/candidate/definitely-not-a-route')
    await expect(page.getByRole('heading', { name: 'This page does not exist' })).toBeVisible()
    await page.goto('/admin')
    await expect(page).toHaveURL(/no-access/)
    await page.screenshot({ path: info.outputPath('wrong-role-access.png'), fullPage: true })

    // The authenticated surfaces get the same accessibility rules as the public
    // ones, at both a phone and a desktop viewport.
    const auditScreens = async (emails: [string, string], routes: string[]) => {
      const [email, secret] = emails
      await page.context().clearCookies()
      await login(page, email, secret)
      await page.setViewportSize({ width: 1440, height: 1000 })
      for (const route of routes) {
        await page.goto(route)
        await noOverflow(page)
        const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
        expect(audit.violations.map((v) => ({ id: v.id, impact: v.impact, route, nodes: v.nodes.map((n) => n.target) })), route).toEqual([])
      }
      await page.setViewportSize({ width: 390, height: 844 })
      for (const route of routes) {
        await page.goto(route)
        await noOverflow(page)
      }
    }
    await auditScreens([candidateEmail, password], ['/candidate', '/candidate/jobs', '/candidate/profile'])
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/candidate/graph')
    await expect(page.locator('.react-flow__node').first()).toBeVisible()
    await noOverflow(page)
    await page.screenshot({ path: info.outputPath('candidate-graph-mobile.png'), fullPage: true })

    await page.context().clearCookies()
    await page.goto('/candidate/graph')
    await expect(page).toHaveURL(/login/)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')
    await noOverflow(page)
    await page.screenshot({ path: info.outputPath('public-mobile.png'), fullPage: true })
    expect(errors).toEqual([])
  })
})

/**
 * SYPRUS Sona, the in-portal assistant. This suite runs against the QA build,
 * which has AI switched off, so every answer must arrive from the deterministic
 * record reader and say so — the fallback is a product feature, not an outage.
 */
test.describe('sona assistant panel', () => {
  test('candidate: opens, answers from stored records, persists, and closes on Escape', async ({ page }, info) => {
    await login(page, 'anshika@example.com')
    await page.goto('/candidate')

    const launcher = page.getByRole('button', { name: 'Ask SYPRUS Sona' })
    await expect(launcher).toBeVisible()
    await launcher.click()

    const panel = page.locator('#syprus-sona-panel')
    await expect(panel).toBeVisible()
    await expect(panel.getByText('Not a person, and not a hiring decision.')).toBeVisible()

    // A previous run may have left this account a transcript; start from a known
    // empty state rather than depending on history.
    const clear = panel.getByRole('button', { name: 'Clear this conversation' })
    if (await clear.count()) {
      await clear.click()
      await expect(panel.getByText('Nothing asked yet')).toBeVisible()
    }
    await expect(panel.getByText('Nothing asked yet')).toBeVisible()

    const starter = panel.getByRole('button', { name: 'What is still missing from my profile?' })
    await expect(starter).toBeVisible()
    await starter.click()

    await expect(panel.getByText(/Profile completion|Skills on file/).first()).toBeVisible({ timeout: 40_000 })
    await expect(panel.getByText('rule engine').first(), 'the engine that answered is labelled').toBeVisible()
    await expect(panel.getByText(/automated assistant/i).first(), 'the honesty caveat is shown').toBeVisible()
    await page.screenshot({ path: info.outputPath('sona-candidate.png') })

    // The transcript is stored, not kept in memory.
    await page.reload()
    await page.goto('/candidate')
    await page.getByRole('button', { name: 'Close Sona' }).click().catch(() => {})
    await launcher.click()
    await expect(panel.getByText(/Profile completion|Skills on file/).first()).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(panel).toHaveCount(0)
    await expect(launcher).toBeFocused()

    // Open again at phone width: the panel must fit without pushing the page sideways.
    await page.setViewportSize({ width: 375, height: 820 })
    await launcher.click()
    await expect(panel).toBeVisible()
    await noOverflow(page)
    await page.screenshot({ path: info.outputPath('sona-mobile.png') })

    await page.getByRole('button', { name: 'Clear this conversation' }).click()
    await expect(panel.getByText('Nothing asked yet')).toBeVisible()
  })

  test('employer and administrator get their own scoped answers', async ({ page }) => {
    await login(page, 'people@meridian.example.com')
    await page.goto('/employer')
    await page.getByRole('button', { name: 'Ask SYPRUS Sona' }).click()
    const panel = page.locator('#syprus-sona-panel')
    const before = await panel.getByText(/rule engine|model ·/).count()
    await panel.getByRole('button', { name: 'How many applicants are waiting on a decision?' }).click()
    await expect(panel.getByText(/Applications across your roles|Roles:/).first()).toBeVisible({ timeout: 40_000 })
    await expect
      .poll(async () => panel.getByText(/rule engine|model ·/).count(), { message: 'a new answer was appended' })
      .toBeGreaterThan(before)
    await page.keyboard.press('Escape')

    await page.context().clearCookies()
    await login(page, 'admin@syprus.example.com')
    await page.goto('/admin')
    await page.getByRole('button', { name: 'Ask SYPRUS Sona' }).click()
    await expect(panel).toBeVisible()
    await panel.getByRole('button', { name: 'What is in the review queue right now?' }).click()
    await expect(panel.getByText(/Open human review tasks|Stored records:/).first()).toBeVisible({ timeout: 40_000 })
    // An administrator must not be handed candidate transcripts or identities.
    expect(await panel.innerText()).not.toMatch(/anshika@example\.com/)
  })
})

/**
 * Focused regression for the account-menu crash. Base UI builds its group
 * context only inside Menu.Group / Menu.RadioGroup, and Menu.GroupLabel throws
 * when it is mounted without one. The shared label wrapper used to render the
 * label bare, so opening the menu replaced the whole page with the error
 * boundary — in every portal, because every portal shares this shell.
 */
test.describe('shared account menu across the three portals', () => {
  const menus = [
    { portal: 'candidate', email: 'anshika@example.com', home: '/candidate', other: '/candidate/suggestions', name: 'Anshika (demonstration)' },
    { portal: 'employer', email: 'people@meridian.example.com', home: '/employer', other: '/employer/shortlist', name: 'Rohit Verma (demonstration)' },
    { portal: 'administrator', email: 'admin@syprus.example.com', home: '/admin', other: '/admin/engines', name: 'Platform Administrator (demonstration)' },
  ]

  for (const menu of menus) {
    test(`${menu.portal}: opens by pointer and keyboard, stays accessible, and signs out`, async ({ page }, info) => {
      const thrown: string[] = []
      page.on('pageerror', (error) => thrown.push(error.message))
      await login(page, menu.email)
      const trigger = page.locator('[data-slot="dropdown-menu-trigger"]')

      for (const route of [menu.home, menu.other]) {
        await page.goto(route)
        await expect(trigger).toContainText(menu.name)
        await trigger.click()
        const popup = page.getByRole('menu')
        await expect(popup, `${route} should open the account menu`).toBeVisible()
        await expect(popup.getByText(menu.name).first()).toBeVisible()
        await expect(popup.getByText(menu.email).first()).toBeVisible()
        await expect(popup.getByRole('menuitem', { name: 'Notifications' })).toBeVisible()
        await expect(popup.getByRole('menuitem', { name: 'Sign out' })).toBeVisible()
        await expect(page.locator('main')).not.toContainText('Something went wrong')
        if (route === menu.home) {
          const audit = await new AxeBuilder({ page })
            .include('[data-slot="dropdown-menu-content"]')
            .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
            .analyze()
          expect(audit.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.map((n) => n.target) }))).toEqual([])
          await page.screenshot({ path: info.outputPath(`account-menu-${menu.portal}.png`) })
        }
        await page.keyboard.press('Escape')
        await expect(popup, `${route} should close on Escape`).toHaveCount(0)
      }

      // Pointer-free operation: the menu must open from the keyboard alone and
      // every action in it must be reachable without a mouse. The Appearance
      // radio group sits between Notifications and Sign out, so the walk has to
      // keep going rather than assume the second item is an action.
      await trigger.focus()
      await page.keyboard.press('Enter')
      await expect(page.getByRole('menu')).toBeVisible()
      const focusedItem = () => page.evaluate(() => document.activeElement?.textContent?.trim() ?? '')
      await expect.poll(focusedItem, 'the first item is the first action').toMatch(/Notifications/)
      const seen: string[] = [await focusedItem()]
      for (let step = 0; step < 8; step += 1) {
        await page.keyboard.press('ArrowDown')
        seen.push(await focusedItem())
      }
      const walk = seen.join(' → ')
      expect(walk).toMatch(/Use device setting/)
      expect(walk).toMatch(/Light/)
      expect(walk).toMatch(/Dark/)
      expect(walk).toMatch(/Sign out/)
      await expect(page.getByRole('menuitemradio', { name: 'Dark' })).toBeVisible()
      await page.keyboard.press('Escape')

      await trigger.click()
      await page.getByRole('menuitem', { name: 'Sign out' }).click()
      await expect(page).toHaveURL(/\/$/, { timeout: 30_000 })
      await page.goto(menu.home)
      await expect(page, 'the session must really be gone').toHaveURL(/login/)
      expect(thrown, thrown.join('\n')).toEqual([])
    })
  }
})

test.describe('visualisation regressions on real stored data', () => {
  test('gap report arithmetic reconciles and the requirement filter stays honest', async ({ page }) => {
    await login(page, 'anshika@example.com')
    await page.goto('/candidate/gap-report')
    await expect(page.getByRole('heading', { name: 'Skill gaps' })).toBeVisible()

    // Generate against a published role so the report has a named target. The
    // first option is the automatic union, so step down once and take the role.
    await page.locator('#targetJobId').click()
    await page.waitForTimeout(300)
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await page.getByRole('button', { name: 'Generate report' }).click()
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('img', { name: /^Readiness components/ })).toBeVisible({ timeout: 30_000 })

    // One pass over the table, so the components and the total are read from the
    // same render — a report that has just been regenerated would otherwise let
    // the two halves of the check disagree for a moment and pass nothing.
    const parsed = await page
      .locator('table', { hasText: 'Share of total' })
      .first()
      .evaluate((node) => {
        const rows = Array.from(node.querySelectorAll('tbody tr')).map((row) => {
          const cells = Array.from(row.querySelectorAll('th, td')).map((cell) => (cell.textContent ?? '').replace(/\s+/g, ' ').trim())
          return { label: cells[0] ?? '', weight: Number.parseInt(cells[2] ?? '0', 10), added: Number.parseFloat(cells[3] ?? '0') }
        })
        const totals = rows[rows.length - 1]
        const components = rows.slice(0, -1)
        return {
          components,
          totals,
          addedSum: components.reduce((sum, row) => sum + row.added, 0),
          weightSum: components.reduce((sum, row) => sum + row.weight, 0),
          sentence: (node.closest('[data-slot="card"]')?.textContent ?? '').replace(/\s+/g, ' '),
        }
      })
    expect(parsed.components.length).toBeGreaterThanOrEqual(2)
    expect(Math.abs(parsed.addedSum - parsed.totals.added)).toBeLessThanOrEqual(0.2)
    expect(parsed.weightSum).toBe(parsed.totals.weight)
    expect(parsed.sentence).toContain(`sums to the ${parsed.totals.added.toFixed(1)} points`)
    // The engine substitutes a placeholder when no experience range is compared,
    // and the screen must label that component instead of presenting it as measured.
    expect(parsed.components.some((row) => row.label.includes('Experience fit'))).toBe(true)
    expect(/no data|assumed data/i.test(parsed.sentence)).toBe(true)

    const chart = page.locator('[data-slot="card"]').filter({ hasText: 'Current level against the level each gap skill needs' }).first()
    if (await chart.count()) {
      const status = chart.getByRole('status')
      for (const filter of [/^Required/, /^Preferred/, /^All gaps/]) {
        await chart.getByRole('button', { name: filter }).click()
        await page.waitForTimeout(400)
        const visible = await chart.locator('table tbody tr').count()
        await expect(status, 'the announcement must match the rows on screen').toContainText(
          new RegExp(`^${visible} of \\d+ gap skills shown`),
        )
      }
    }
    await noOverflow(page)
  })

  test('admin composition charts add up to the counts they claim', async ({ page }) => {
    await login(page, 'admin@syprus.example.com')
    await page.goto('/admin')
    await expect(page.getByRole('heading', { name: 'Platform overview' })).toBeVisible()

    for (const title of ['Applications by pipeline stage', 'Accounts by role', 'Roles by moderation status']) {
      const card = page.locator('[data-slot="card"]').filter({ hasText: title }).first()
      if ((await card.count()) === 0) continue
      const listed = await card.locator('ul li').evaluateAll((nodes) =>
        nodes.map((node) => {
          const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim()
          const match = /^(.*?)(\d+)$/.exec(text)
          return { label: match?.[1]?.trim() ?? text, count: Number.parseInt(match?.[2] ?? 'NaN', 10) }
        }),
      )
      const body = listed.filter((row) => row.label !== 'Total')
      const total = listed.find((row) => row.label === 'Total')?.count
      expect(body.reduce((sum, row) => sum + row.count, 0)).toBe(total)
      const note = (await card.locator('p').filter({ hasText: /add to|adds to/ }).first().textContent()) ?? ''
      expect(note.replace(/\s+/g, ' ')).toContain(String(total))
    }

    // A trend is only drawn when the window contains rows.
    const signups = page.locator('[data-slot="card"]').filter({ hasText: 'New accounts, last 30 days' }).first()
    const window = Number(/(\d+) in the window/.exec(((await signups.textContent()) ?? '').replace(/\s+/g, ' '))?.[1] ?? -1)
    expect(window).toBeGreaterThanOrEqual(0)
    if (window === 0) {
      await expect(signups.getByText(/no trend is drawn/i)).toBeVisible()
    } else {
      await expect(signups.locator('.recharts-surface')).toBeVisible()
    }
    await noOverflow(page)
  })
})

test.describe('the email code screen, on a server that requires it', () => {
  test('refuses a wrong code, takes the right one from the keyboard, and stays legible at 375 px', async ({ page }, info) => {
    // The QA cluster pins DEMO_SKIP_EMAIL_CODE=false, so this is the gated path.
    const thrown: string[] = []
    page.on('pageerror', (error) => thrown.push(error.message))

    await page.goto('/login')
    await page.getByLabel('Email address', { exact: true }).fill('anshika@example.com')
    await page.getByLabel('Password', { exact: true }).fill('QaDemoOnly!2026')
    await page.locator('main').getByRole('button', { name: 'Sign in', exact: true }).click()

    await expect(page).toHaveURL(/\/verify-email/)
    await expect(page.getByText('Confirm it is you')).toBeVisible()
    await expect(page.locator('#verification-preview-code').locator('xpath=..')).toContainText(
      'Demonstration delivery — this code was not emailed',
    )

    const issued = ((await page.locator('#verification-preview-code').textContent()) ?? '').replace(/\D/g, '')
    expect(issued).toMatch(/^\d{6}$/)

    // Starting over from this screen leaves nothing behind: it drops the ticket
    // and comes back to a fresh one, still carrying the code already in flight.
    await page.getByRole('button', { name: 'Go back to sign-in' }).click()
    await expect(page).toHaveURL(/\/login/)
    await page.getByLabel('Email address', { exact: true }).fill('anshika@example.com')
    await page.getByLabel('Password', { exact: true }).fill('QaDemoOnly!2026')
    await page.locator('main').getByRole('button', { name: 'Sign in', exact: true }).click()
    await expect(page).toHaveURL(/\/verify-email/, { timeout: 60_000 })
    await expect(page.locator('#verification-preview-code')).toHaveText(issued)

    // A wrong code is refused with the attempts it has left, and it is refused
    // without issuing another: the digits on screen have not changed.
    const wrong = `${(Number(issued[0] ?? '0') + 1) % 10}${issued.slice(1)}`
    await page.getByLabel('Six-digit code', { exact: true }).fill(wrong)
    await page.getByRole('button', { name: 'Verify and sign in' }).click()
    await expect(page.locator('#main').getByRole('alert')).toContainText(/That code is not right\. 4 attempts left/)
    await expect(page.locator('#verification-preview-code')).toHaveText(issued)
    await expect(page).toHaveURL(/\/verify-email/)

    const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
    expect(
      audit.violations.map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        nodes: violation.nodes.map((node) => node.target),
      })),
    ).toEqual([])

    await page.setViewportSize({ width: 375, height: 812 })
    await noOverflow(page)
    await page.screenshot({ path: info.outputPath('verify-email-mobile.png') })
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.screenshot({ path: info.outputPath('verify-email-desktop.png') })

    // Keyboard only: Tab from the field reaches the submit control, and the right
    // code typed with the keyboard opens the portal.
    await page.getByLabel('Six-digit code', { exact: true }).click()
    await page.keyboard.press('Tab')
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.textContent?.trim() ?? ''))
      .toMatch(/Verify and sign in/)
    await page.keyboard.press('Shift+Tab')
    await page.getByLabel('Six-digit code', { exact: true }).fill('')
    await page.keyboard.type(issued)
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/candidate/, { timeout: 60_000 })

    // The session that resulted is a real one.
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
    await page.context().clearCookies()
    expect(thrown, thrown.join('\n')).toEqual([])
  })
})

test.describe('a rejected submit keeps what was typed', () => {
  test('registration holds its fields, drops only the password, and then completes', async ({ page }) => {
    const email = `qa-retained-${run}@example.com`
    await page.goto('/register')
    await page.getByLabel('Full name', { exact: true }).fill('Fictional Returner')
    await page.locator('#candidate-email').fill(email)
    await page.locator('#candidate-password').fill('onlylettersandnodigits')
    await page.locator('#candidate-confirm-password').fill('onlylettersandnodigits')
    await page.getByRole('checkbox').check()
    await page.getByRole('button', { name: 'Create candidate account' }).click()

    await expect(page.locator('#main [role="alert"]').first()).toContainText(/letter and one number/)
    await expect(page.locator('#candidate-password')).toHaveAttribute('aria-describedby', 'candidate-password-error')
    await expect(page.locator('#candidate-password')).toHaveAttribute('aria-invalid', 'true')
    await expect(page.locator('#candidate-password')).toHaveAccessibleDescription(/letter and one number/)
    await expect(page.locator('aside img')).toHaveAttribute('loading', 'eager')
    await expect(page.locator('#candidate-name')).toHaveValue('Fictional Returner')
    await expect(page.locator('#candidate-email')).toHaveValue(email)
    // A password that failed its own rule is retyped, never echoed back.
    await expect(page.locator('#candidate-password')).toHaveValue('')
    await expect(page.locator('#candidate-confirm-password')).toHaveValue('')
    // The consent box is the deliberate act they just made, and correcting a
    // typo in the password is the same submission — so it stays ticked. Asserted
    // on the real input, because that is what the browser will actually submit.
    await expect(page.locator('input#core-consent')).toBeChecked()

    // Only the password is retyped. The consent box is not touched again, so this
    // submit proves the tick survived in the form data and not just on screen.
    await page.locator('#candidate-password').fill(password)
    await page.locator('#candidate-confirm-password').fill(password)
    await page.getByRole('button', { name: 'Create candidate account' }).click()
    await completeCode(page, 'Confirm and continue')
    await expect(page).toHaveURL(/\/candidate\/onboarding/)

    await prisma.user.delete({ where: { email } })
  })

  test('preview delivery does not claim to email a non-reserved address', async ({ page }) => {
    const email = `qa-preview-copy-${run}@syprus-demo.invalid`
    try {
      await page.goto('/register')
      await page.getByLabel('Full name', { exact: true }).fill('Preview Copy Test')
      await page.locator('#candidate-email').fill(email)
      await page.locator('#candidate-password').fill(password)
      await page.locator('#candidate-confirm-password').fill(password)
      await page.getByRole('checkbox').check()
      await page.getByRole('button', { name: 'Create candidate account' }).click()
      await expect(page).toHaveURL(/\/verify-email/)
      await expect(page.getByText(/Enter the code shown below/)).toBeVisible()
      await expect(page.getByText(/This is a screen-only preview; no email was sent/)).toBeVisible()
      await expect(page.locator('main')).not.toContainText('A six-digit code went to')
      await expect(page.locator('main')).not.toContainText('sits on a reserved example domain')
      expect((await page.request.get('/api/skills')).status()).toBe(401)
      await completeCode(page, 'Confirm and continue')
      await expect(page).toHaveURL(/\/candidate\/onboarding/)
    } finally {
      await page.context().clearCookies()
      await prisma.user.deleteMany({ where: { email } })
    }
  })

  test('sign-in holds the address, and the code screen does not hold the code', async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel('Email address', { exact: true }).fill('anshika@example.com')
    await page.getByLabel('Password', { exact: true }).fill('definitely-not-the-password-1')
    await page.locator('main').getByRole('button', { name: 'Sign in', exact: true }).click()

    await expect(page.locator('#main [role="alert"]').first()).toContainText(/Email or password is incorrect/)
    await expect(page.getByLabel('Email address', { exact: true })).toHaveValue('anshika@example.com')
    await expect(page.getByLabel('Password', { exact: true })).toHaveValue('')

    // The failed-attempt counter this leaves behind is undone by the correct
    // sign-in below, so the seeded account is handed back as it was found.
    await page.getByLabel('Password', { exact: true }).fill('QaDemoOnly!2026')
    await page.locator('main').getByRole('button', { name: 'Sign in', exact: true }).click()
    await expect(page).toHaveURL(/\/verify-email/, { timeout: 60_000 })
    await page.getByLabel('Six-digit code', { exact: true }).fill('000001')
    await page.getByRole('button', { name: 'Verify and sign in' }).click()
    await expect(page.locator('#main [role="alert"]').first()).toContainText(/That code is not right/)
    // A wrong code is not kept on screen: it is a credential, not a typo to fix.
    await expect(page.getByLabel('Six-digit code', { exact: true })).toHaveValue('')
    // An incomplete entry is refused by the field itself, before anything is
    // sent: the screen never tells someone their code was wrong when they had
    // typed four digits of it.
    await page.getByLabel('Six-digit code', { exact: true }).fill('1234')
    await page.getByRole('button', { name: 'Verify and sign in' }).click()
    expect(
      await page.getByLabel('Six-digit code', { exact: true }).evaluate((element) => (element as HTMLInputElement).validity.valid),
    ).toBe(false)
    await expect(page).toHaveURL(/\/verify-email/)

    const preview = page.locator('#verification-preview-code')
    await preview.waitFor({ state: 'visible', timeout: 30_000 })
    await page.getByLabel('Six-digit code', { exact: true }).fill(((await preview.textContent()) ?? '').replace(/\D/g, ''))
    await page.getByRole('button', { name: 'Verify and sign in' }).click()
    await expect(page).toHaveURL(/\/candidate/, { timeout: 60_000 })
  })
})

test.describe('the password reveal and the verification link', () => {
  test('the reveal button shows and hides what was typed, on both screens', async ({ page }, info) => {
    await page.goto('/register')
    const field = page.locator('#candidate-password')
    await field.fill('Showing123')

    const show = page.getByRole('button', { name: 'Show the password' })
    const hide = page.getByRole('button', { name: 'Hide the password' })
    await expect(field).toHaveAttribute('type', 'password')
    await expect(show).toHaveAttribute('aria-pressed', 'false')

    await show.click()
    await expect(field).toHaveAttribute('type', 'text')
    await expect(field).toHaveValue('Showing123')
    await expect(hide).toHaveAttribute('aria-pressed', 'true')
    await page.screenshot({ path: info.outputPath('register-password-shown.png') })

    await hide.click()
    await expect(field).toHaveAttribute('type', 'password')
    await expect(field).toHaveValue('Showing123')

    // Each field has its own button, so the two are not ambiguous.
    await expect(page.getByRole('button', { name: 'Show the confirm password' })).toBeVisible()

    // The new control is audited where it lives, with the field revealed.
    await show.click()
    const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
    expect(
      audit.violations.map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        nodes: violation.nodes.map((node) => node.target),
      })),
    ).toEqual([])

    await page.goto('/login')
    await expect(page.getByRole('button', { name: 'Show the password' })).toBeVisible()
  })

  test('the link in the panel opens the session without typing the code', async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel('Email address', { exact: true }).fill('anshika@example.com')
    await page.getByLabel('Password', { exact: true }).fill('QaDemoOnly!2026')
    await page.locator('main').getByRole('button', { name: 'Sign in', exact: true }).click()
    await expect(page).toHaveURL(/\/verify-email/, { timeout: 60_000 })

    const link = page.getByRole('link', { name: 'open the verification link' })
    await expect(link).toBeVisible()
    await expect(link).toHaveAttribute('href', /\/verify-email\?token=/)
    await link.click()

    // The link screen posts the token itself, so one click is the whole step.
    await expect(page).toHaveURL(/\/candidate/, { timeout: 60_000 })
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
  })

  test('a link that has been used once is refused, not retried', async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel('Email address', { exact: true }).fill('people@meridian.example.com')
    await page.getByLabel('Password', { exact: true }).fill('QaDemoOnly!2026')
    await page.locator('main').getByRole('button', { name: 'Sign in', exact: true }).click()
    await expect(page).toHaveURL(/\/verify-email/, { timeout: 60_000 })

    const href = await page.getByRole('link', { name: 'open the verification link' }).getAttribute('href')
    await page.goto(href ?? '/login')
    await expect(page).toHaveURL(/\/employer/, { timeout: 60_000 })

    // Same URL again: the token is spent, and the screen says so instead of
    // quietly issuing a second session.
    await page.context().clearCookies()
    await page.goto(href ?? '/login')
    await expect(page).toHaveURL(/\/verify-email\?token=/)
    await expect(page.locator('#main [role="alert"]').first()).toContainText(/already been used/)
    await expect(page).toHaveURL(/\/verify-email\?token=/)
  })
})
