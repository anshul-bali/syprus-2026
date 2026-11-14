import assert from 'node:assert/strict'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { chromium, type APIRequestContext, type Browser, type BrowserContext } from '@playwright/test'
import { prisma } from '../src/lib/db'
import type { Principal } from '../src/lib/authz'
import { registerCandidate } from '../src/server/accounts'
import { issueVerificationCode, redeemVerificationCode, redeemVerificationLink, verificationSummaryFor, sendLimit, DEFAULT_MAX_SENDS_PER_HOUR } from '../src/server/verification'
import { verifyCredentials } from '../src/server/credentials'
import { resetMailConfigCache } from '../src/lib/mail/config'
import { MailError } from '../src/lib/mail/supabase'
import { candidateSignupSchema, jobSchema } from '../src/lib/validation'
import { addSkill, removeSkill, setConsent } from '../src/server/candidate'
import { hasConsent } from '../src/server/skill-catalog'
import { createJob, updateJob } from '../src/server/jobs'
import { candidatesForJob, computeMatchesForProfile, recommendedJobs } from '../src/server/matching'
import { loadGraphModel, saveGraphNodeEdit } from '../src/server/graph'
import { canRevealIdentity, toAnonymizedProfile } from '../src/server/anonymize'
import { decideDisclosure, requestIdentityDisclosure, revokeDisclosure } from '../src/server/disclosure'
import { applyToJob, withdrawApplication, updateApplicationStatus, organizationApplications, shortlistCandidate, shortlistForJob } from '../src/server/applications'
import { buildDiscoveryInput, runSkillsDiscovery, runMarketIntelligence } from '../src/server/ai/agents'
import { decideProposal } from '../src/server/ai/proposals'
import { askSona, sonaTranscript } from '../src/server/ai/assistant'
import { startAttempt, openAttempt, submitAttempt } from '../src/server/ai/assessments'
import { saveEvidenceUpload, readUploadForPrincipal, removeUpload, decideUpload } from '../src/server/ai/uploads'
import { saveWeightProfile } from '../src/server/weights'

const url = new URL(process.env.DATABASE_URL || 'http://invalid')
if (url.hostname !== 'localhost' || url.port !== '55433' || url.pathname !== '/syprus_qa') throw new Error('Use scripts/qa.ts integration; remote databases are refused.')
const run = Date.now().toString(36)
const emails = [`qa-integration-one-${run}@example.com`, `qa-integration-two-${run}@example.com`]
const password = 'QaIntegration!2026'
let passed = 0
let failed = 0
const clients: APIRequestContext[] = []
let browser: Browser
let server: ChildProcess | null = null
const contexts: BrowserContext[] = []
const userIds: string[] = []
const uploads: { principal: Principal; id: string }[] = []
const jobs: string[] = []

async function check(name: string, body: () => Promise<void>) {
  try { await body(); passed++; console.log(`PASS ${name}`) }
  catch (error) { failed++; console.error(`FAIL ${name}: ${error instanceof Error ? error.message : 'unexpected error'}`) }
}
async function principalFor(email: string): Promise<Principal> {
  const user = await prisma.user.findUniqueOrThrow({ where: { email }, include: { candidateProfile: true, ownedOrganization: true, memberships: true } })
  const role = await prisma.roleDefinition.findUniqueOrThrow({ where: { role: user.role }, include: { permissions: true } })
  const org = user.ownedOrganization ?? user.memberships[0]
  return { userId: user.id, email: user.email, name: user.name, role: user.role, status: user.status,
    candidateProfileId: user.candidateProfile?.id ?? null, organizationId: org?.id ?? null, organizationName: org?.name ?? null,
    organizationVerification: org?.verificationStatus ?? null, permissions: role.permissions.map((p) => p.key) as Principal['permissions'] }
}
/**
 * Sessions are established through the real sign-in screen. Driving the Auth.js
 * callback directly is not representative: sign-in is a browser flow whose
 * cookies must carry the same path and SameSite attributes a visitor receives,
 * and the code step needs a live ticket cookie to be spent against. The returned
 * request context shares those cookies, so the API checks below exercise an
 * authenticated session rather than a hand-built one.
 *
 * Every address used here is on a reserved example domain, so the six-digit code
 * is displayed on the entry screen instead of emailed; that is what makes the
 * second step drivable without a mail provider.
 */
async function clientFor(email?: string, secret = password) {
  const context = await browser.newContext({ baseURL: 'http://localhost:3100' })
  contexts.push(context)
  if (email) {
    const page = await context.newPage()
    await page.goto('/login')
    await page.getByLabel('Email address', { exact: true }).fill(email)
    await page.getByLabel('Password', { exact: true }).fill(secret)
    await page.locator('main').getByRole('button', { name: 'Sign in', exact: true }).click()
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 })
    if (new URL(page.url()).pathname.startsWith('/verify-email')) {
      const preview = page.locator('#verification-preview-code')
      await preview.waitFor({ state: 'visible', timeout: 30_000 })
      const code = ((await preview.textContent()) ?? '').replace(/\D/g, '')
      assert.match(code, /^\d{6}$/, 'the on-screen demonstration code should be six digits')
      await page.getByLabel('Six-digit code', { exact: true }).fill(code)
      await page.getByRole('button', { name: 'Verify and sign in' }).click()
      await page.waitForURL((url) => !url.pathname.startsWith('/verify-email'), { timeout: 30_000 })
    }
    await page.close()
  }
  clients.push(context.request)
  return context.request
}

/**
 * The API half of this suite talks to a running application. It reuses whatever
 * is already on the QA port, and otherwise builds and starts the *production*
 * server: the dev server re-compiles and hot-reloads underneath a request, which
 * has previously turned a working page into a detached-element failure. Either
 * way a reviewer can run `npm run test:integration` alone and get the same
 * result, and a server this suite started is shut down again at the end.
 */
function runQa(command: string) {
  const result = spawnSync(process.execPath, [path.join('node_modules', 'tsx/dist/cli.mjs'), 'scripts/qa.ts', command], {
    stdio: 'ignore',
    env: process.env,
  })
  if (result.status !== 0) throw new Error(`QA step "${command}" failed: ${result.error?.message ?? `exit ${result.status}`}`)
}

async function healthy() {
  try {
    return (await fetch('http://localhost:3100/api/health')).ok
  } catch {
    return false
  }
}

async function ensureServer() {
  if (await healthy()) return null
  if (!existsSync(path.join('.next-qa-build'))) runQa('build')
  const child = spawn(process.execPath, [path.join('node_modules', 'tsx/dist/cli.mjs'), 'scripts/qa.ts', 'start'], {
    stdio: 'ignore',
    env: process.env,
  })
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    if (await healthy()) return child
    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }
  child.kill()
  throw new Error('The QA application never became reachable on port 3100.')
}

async function main() {
  server = await ensureServer()
  browser = await chromium.launch()
  for (const email of emails) {
    const user = await registerCandidate(candidateSignupSchema.parse({ email, name: 'Fictional integration candidate', password, confirmPassword: password, coreConsent: true }))
    userIds.push(user.id)
  }
  const one = await principalFor(emails[0]); const two = await principalFor(emails[1])
  const employer = await principalFor('talent@northwind.example.com')
  const foreign = await principalFor('recruitment@ashford.example.com')
  const admin = await principalFor('admin@syprus.example.com')
  const oneId = one.candidateProfileId!; const twoId = two.candidateProfileId!
  await setConsent(one, { type: 'RULE_BASED_INFERENCE', granted: true })
  await setConsent(one, { type: 'ANONYMIZED_PROFILE_SHARING', granted: true })
  await prisma.candidateProfile.update({ where: { id: oneId }, data: { visibleToEmployers: true, sharingMode: 'ANONYMOUS_WITH_APPLY', headline: emails[0], summary: emails[0], targetRole: emails[0], targetIndustry: emails[0], educationSummary: emails[0], locationCity: emails[0] } })
  await prisma.experience.create({ data: { candidateProfileId: oneId, title: emails[0], description: 'I built Excel reporting and analysed data for stakeholders.', type: 'PAID_EMPLOYMENT' } })
  const skill = await addSkill(one, { skillSlug: 'excel', level: 'PROFICIENT', validationStatus: 'SELF_REPORTED', note: 'Fictional work evidence.' })
  const otherSkill = await addSkill(two, { skillSlug: 'excel', level: 'FUNCTIONAL', validationStatus: 'SELF_REPORTED' })
  await computeMatchesForProfile(oneId)
  const match = await prisma.match.findFirstOrThrow({ where: { candidateProfileId: oneId, job: { organizationId: employer.organizationId! } }, include: { job: true } })

  await check('anonymous projection withholds identity from every free-text field', async () => {
    const profile = await prisma.candidateProfile.findUniqueOrThrow({ where: { id: oneId }, include: { user: { select: { name: true, email: true } }, skills: { include: { skill: true } }, experiences: true } })
    const view = await toAnonymizedProfile(profile)
    assert.equal(view.email, null); assert.equal(view.summary, null); assert.equal(view.educationSummary, null)
    assert.equal(JSON.stringify(view).includes(emails[0]), false)
    const listed = await candidatesForJob(employer, match.jobId)
    const own = listed.find((row) => row.profile.candidateProfileId === oneId)
    assert.ok(own); assert.equal(JSON.stringify(own).includes(emails[0]), false)
  })
  await check('foreign organisation cannot read matches or edit a role', async () => {
    await assert.rejects(() => candidatesForJob(foreign, match.jobId), /another organisation/)
    await assert.rejects(() => updateJob(foreign, match.jobId, jobSchema.parse({ title: 'Forged', description: 'Forged role edit', workMode: 'REMOTE', employmentType: 'FULL_TIME', skills: [{ skillSlug: 'excel', level: 'PROFICIENT', weight: 3, requirement: 'REQUIRED' }] })), /another organisation/)
  })
  await check('invalid skill catalogue cannot leave a partial draft', async () => {
    const title = `invalid-qa-${run}`
    const before = await prisma.job.count({ where: { title } })
    await assert.rejects(() => createJob(employer, jobSchema.parse({ title, description: 'Fictional invalid skill role', workMode: 'REMOTE', employmentType: 'FULL_TIME', skills: [{ skillSlug: 'not-a-skill', level: 'PROFICIENT', weight: 3, requirement: 'REQUIRED' }] })), /not in the catalogue/)
    assert.equal(await prisma.job.count({ where: { title } }), before)
  })
  await check('cross-account graph edits remain rejected even with hidden nodes', async () => {
    const graph = await loadGraphModel(one)
    const node = graph.nodes.find((node) => node.kind === 'SKILL')!
    assert.ok(node)
    await saveGraphNodeEdit(one, { nodeKey: node.key, hidden: true })
    const otherGraph = await loadGraphModel(two)
    const foreignNode = otherGraph.nodes.find((node) => node.kind === 'SKILL')!
    await assert.rejects(() => saveGraphNodeEdit(one, { nodeKey: foreignNode.key, note: 'forged' }), /no longer on your graph/)
    await saveGraphNodeEdit(one, { nodeKey: node.key, hidden: false })
    assert.equal((await loadGraphModel(one)).hiddenCount, 0)
  })
  await check('another candidate cannot remove an owned skill', async () => {
    await assert.rejects(() => removeSkill(one, otherSkill.id), /not on your profile/)
    assert.ok(await prisma.candidateSkill.findUnique({ where: { id: otherSkill.id } }))
  })
  await check('candidate cannot self-declare assessed status', async () => {
    await assert.rejects(() => addSkill(one, { skillSlug: 'reporting', level: 'EXPERT', validationStatus: 'ASSESSMENT_VERIFIED' } as never), /cannot be self-declared/)
  })
  await check('discovery uses real experience and persists reviewable proposals', async () => {
    const input = await buildDiscoveryInput(one, oneId)
    assert.ok(input.blocks.some((block) => block.text.includes('Excel reporting')))
    const result = await runSkillsDiscovery(one)
    assert.equal(result.mode, 'DETERMINISTIC'); assert.ok(result.created > 0)
    const proposal = await prisma.aiProposal.findFirstOrThrow({ where: { candidateProfileId: oneId, status: 'PROPOSED' } })
    await assert.rejects(() => decideProposal(two, { proposalId: proposal.id, decision: 'CONFIRMED' }), /not on your account/)
    await decideProposal(one, { proposalId: proposal.id, decision: 'EDITED', level: 'DEVELOPING', note: 'Lower level chosen in QA.' })
    const stored = await prisma.candidateSkill.findUniqueOrThrow({ where: { candidateProfileId_skillId: { candidateProfileId: oneId, skillId: proposal.skillId } } })
    assert.equal(stored.level, 'DEVELOPING'); assert.equal(stored.validationStatus, 'USER_CONFIRMED')
  })
  await check('employer cannot request private candidate intelligence', async () => {
    await assert.rejects(() => runMarketIntelligence(employer, match.jobId, oneId), /private to the candidate/)
  })
  await check('expired identity requests cannot be approved through direct service calls', async () => {
    const result = await requestIdentityDisclosure(employer, { candidateProfileId: oneId, jobId: match.jobId, reason: 'Fictional skills conversation requested for QA.' })
    assert.ok(result.requestId)
    await prisma.identityDisclosureRequest.update({ where: { id: result.requestId }, data: { expiresAt: new Date(0) } })
    await assert.rejects(() => decideDisclosure(one, { requestId: result.requestId!, decision: 'APPROVED' }), /expired/)
    assert.equal(await canRevealIdentity(oneId, employer.organizationId!), false)
  })
  await check('consent grants stay organisation-scoped and can be revoked', async () => {
    const result = await requestIdentityDisclosure(employer, { candidateProfileId: oneId, jobId: match.jobId, reason: 'Fictional renewed skills conversation requested for QA.' })
    assert.ok(result.requestId)
    await assert.rejects(() => decideDisclosure(two, { requestId: result.requestId!, decision: 'APPROVED' }), /not yours/)
    await decideDisclosure(one, { requestId: result.requestId, decision: 'APPROVED' })
    assert.equal(await canRevealIdentity(oneId, employer.organizationId!), true)
    assert.equal(await canRevealIdentity(oneId, foreign.organizationId!), false)
    await revokeDisclosure(one, result.requestId)
    assert.equal(await canRevealIdentity(oneId, employer.organizationId!), false)
    assert.equal(await prisma.consentRecord.count({ where: { userId: one.userId, scope: `disclosure:${result.requestId}:org:${employer.organizationId}` } }), 2)
  })
  await check('application consent, status ownership and withdrawal are enforced', async () => {
    await assert.rejects(() => applyToJob(one, { jobId: match.jobId } as never), /consent/i)
    const application = await applyToJob(one, { jobId: match.jobId, identityConsent: true })
    assert.ok(application.identityConsentAt)
    await assert.rejects(() => withdrawApplication(two, application.id), /not yours/)
    await assert.rejects(() => updateApplicationStatus(foreign, { applicationId: application.id, status: 'SHORTLISTED' }), /another organisation/)
    await assert.rejects(() => updateApplicationStatus(employer, { applicationId: application.id, status: 'HIRED' }), /Cannot move/)
    await withdrawApplication(one, application.id)
    assert.equal(await canRevealIdentity(oneId, employer.organizationId!), false)
  })
  await check('assessment ownership, complete answers and single submission are enforced', async () => {
    const assessment = await prisma.assessment.findFirstOrThrow({ where: { isActive: true }, include: { questions: true } })
    const started = await startAttempt(one, assessment.id)
    await assert.rejects(() => openAttempt(two, started.attemptId), /not on your account/)
    assert.equal(JSON.stringify(await openAttempt(one, started.attemptId)).includes('correctIndex'), false)
    await assert.rejects(() => submitAttempt(one, { attemptId: started.attemptId, responses: [] }), /Answer all/)
    const responses = assessment.questions.map((q) => ({ questionId: q.id, selectedIndex: q.correctIndex }))
    assert.equal((await submitAttempt(one, { attemptId: started.attemptId, responses })).passed, true)
    await assert.rejects(() => submitAttempt(one, { attemptId: started.attemptId, responses }), /not open/)
  })
  await check('uploads reject spoofed MIME, empty files and other-owned skills', async () => {
    const pdf = Buffer.from('%PDF-1.4\nFictional QA document\n%%EOF')
    await assert.rejects(() => saveEvidenceUpload(one, { filename: 'bad.pdf', mimeType: 'application/pdf', bytes: Buffer.from('<script>bad</script>') }), /do not match/)
    await assert.rejects(() => saveEvidenceUpload(one, { filename: 'empty.pdf', mimeType: 'application/pdf', bytes: Buffer.alloc(0) }), /empty/)
    await assert.rejects(() => saveEvidenceUpload(one, { filename: 'wrong.pdf', mimeType: 'application/pdf', bytes: pdf, candidateSkillId: otherSkill.id }), /not on your profile/)
  })
  const upload = await saveEvidenceUpload(one, { filename: 'fictional-qa.pdf', mimeType: 'application/pdf', bytes: Buffer.from('%PDF-1.4\nFictional QA document\n%%EOF'), candidateSkillId: skill.id })
  uploads.push({ principal: one, id: upload.id })
  await check('real stored document cannot be downloaded by another candidate or employer', async () => {
    await assert.rejects(() => readUploadForPrincipal(two, upload.id), /Only the owner/)
    await assert.rejects(() => readUploadForPrincipal(employer, upload.id), /Only the owner/)
    assert.equal((await readUploadForPrincipal(one, upload.id)).sha256, upload.sha256)
    await decideUpload(admin, { uploadId: upload.id, decision: 'REJECTED', note: 'Fixture not accepted as evidence.' })
    assert.notEqual((await prisma.candidateSkill.findUniqueOrThrow({ where: { id: skill.id } })).validationStatus, 'DISPUTED')
  })
  await check('weight versions are immutable and invalid totals rejected', async () => {
    const input = { version: `qa-int-${run}`, label: 'QA only', required: .5, preferred: .2, evidence: .2, preferences: .1, activate: false }
    await saveWeightProfile(admin, input)
    await assert.rejects(() => saveWeightProfile(admin, { ...input, required: .4, preferred: .3 }), /already exists/)
    await assert.rejects(() => saveWeightProfile(admin, { ...input, version: `qa-bad-${run}`, required: .9 }), /add up/)
  })
  const anonymous = await clientFor(); const ownerHttp = await clientFor(emails[0]); const otherHttp = await clientFor(emails[1]); const adminHttp = await clientFor('admin@syprus.example.com', 'QaDemoOnly!2026')
  await check('API authentication and query validation return actual 401/400 responses', async () => {
    assert.equal((await anonymous.get('/api/jobs')).status(), 401)
    assert.equal((await anonymous.get('/api/skills')).status(), 401)
    assert.equal((await ownerHttp.get('/api/jobs?take=1000')).status(), 400)
    assert.equal((await ownerHttp.get('/api/jobs?workMode=INVALID')).status(), 400)
    const data = await (await ownerHttp.get('/api/jobs?take=2')).json()
    assert.equal(data.jobs.length, 2); assert.ok(data.jobs.every((job: { skills: unknown[] }) => job.skills.length > 0))
    assert.equal(JSON.stringify(data).includes('passwordHash'), false)
  })
  await check('HTTP document endpoint enforces isolation and secure download headers', async () => {
    assert.equal((await anonymous.get(`/api/evidence/${upload.id}`)).status(), 401)
    assert.equal((await otherHttp.get(`/api/evidence/${upload.id}`)).status(), 404)
    const response = await ownerHttp.get(`/api/evidence/${upload.id}`)
    assert.equal(response.status(), 200); assert.match(response.headers()['content-disposition'], /^attachment/)
    assert.equal(response.headers()['x-content-type-options'], 'nosniff')
    assert.equal(response.headers()['cache-control'], 'private, no-store')
  })
  await check('match API rejects non-admin, malformed JSON and cross-origin requests', async () => {
    assert.equal((await ownerHttp.post('/api/matches/recompute', { data: { candidateProfileId: oneId } })).status(), 403)
    assert.equal((await adminHttp.post('/api/matches/recompute', { data: '{bad', headers: { 'content-type': 'application/json' } })).status(), 400)
    assert.equal((await adminHttp.post('/api/matches/recompute', { data: { candidateProfileId: oneId }, headers: { origin: 'https://untrusted.invalid' } })).status(), 403)
    assert.equal((await adminHttp.post('/api/matches/recompute', { data: { candidateProfileId: oneId } })).status(), 200)
  })
  await check('consent history is append-only and withdrawal prevents further inference', async () => {
    const before = await prisma.consentRecord.count({ where: { userId: one.userId, type: 'RULE_BASED_INFERENCE', scope: null } })
    await setConsent(one, { type: 'RULE_BASED_INFERENCE', granted: false })
    assert.equal(await hasConsent(one.userId, 'RULE_BASED_INFERENCE'), false)
    await assert.rejects(() => runSkillsDiscovery(one), /consent/)
    await setConsent(one, { type: 'RULE_BASED_INFERENCE', granted: true })
    assert.equal(await prisma.consentRecord.count({ where: { userId: one.userId, type: 'RULE_BASED_INFERENCE', scope: null } }), before + 2)
  })
  await check('removing all skills clears stale matches', async () => {
    await prisma.candidateSkill.deleteMany({ where: { candidateProfileId: twoId } })
    await computeMatchesForProfile(twoId)
    assert.equal((await recommendedJobs(two)).length, 0)
  })
  await check('consented text is revealed, unconsented text stays withheld', async () => {
    // Anonymity must not become over-redaction: fields the candidate agreed to
    // share are shown, and the same fields are hidden when no consent exists.
    await prisma.candidateProfile.update({ where: { id: oneId }, data: { headline: `Headline ${run}` } })
    const application = await applyToJob(one, { jobId: match.jobId, identityConsent: true })
    const listed = await organizationApplications(employer, { jobId: match.jobId })
    assert.equal(listed.find((row) => row.id === application.id)?.candidateProfile.headline, `Headline ${run}`)
    const withdrawn = await withdrawApplication(one, application.id)
    const afterWithdraw = await organizationApplications(employer, { jobId: match.jobId })
    assert.equal(afterWithdraw.find((row) => row.id === withdrawn.id)?.candidateProfile.headline, null)
    await shortlistCandidate(employer, { jobId: match.jobId, candidateProfileId: oneId, note: 'Anonymous shortlist.' })
    const shortlisted = await shortlistForJob(employer, match.jobId)
    assert.ok(!shortlisted[0]?.candidateProfile.headline, 'a shortlist entry must not carry profile text')

    // The other consent route is a disclosure grant, and it must actually reveal
    // what it claims to reveal.
    const granted = await requestIdentityDisclosure(employer, { candidateProfileId: oneId, jobId: match.jobId, reason: 'Fictional reveal check for QA.' })
    assert.ok(granted.requestId)
    await decideDisclosure(one, { requestId: granted.requestId, decision: 'APPROVED' })
    const employerProfile = await prisma.candidateProfile.findUniqueOrThrow({
      where: { id: oneId },
      include: { user: { select: { name: true, email: true } }, skills: { include: { skill: true } }, experiences: true },
    })
    const revealedView = await toAnonymizedProfile(employerProfile, { organizationId: employer.organizationId! })
    assert.equal(revealedView.headline, `Headline ${run}`)
    assert.equal(revealedView.realName, employerProfile.user.name)
    await revokeDisclosure(one, granted.requestId)
    const revokedView = await toAnonymizedProfile(employerProfile, { organizationId: employer.organizationId! })
    assert.equal(revokedView.headline, null)
    assert.equal(revokedView.realName, null)
  })
  await check('sona answers from this account’s own records and stores which engine answered', async () => {
    const result = await askSona(await principalFor(emails[0]), 'What is still missing from my profile?')
    assert.equal(result.transcript.length, 2, 'one question and one answer')
    const answer = result.transcript[1]
    assert.equal(answer.role, 'ASSISTANT')
    // scripts/qa.ts runs this suite with AI disabled, so the honest expectation
    // is the deterministic record reader, labelled as such.
    assert.equal(answer.mode, 'DETERMINISTIC', 'the stored turn names the engine that produced it')
    assert.ok(answer.citations.length > 0, 'the answer cites the facts it read')
    assert.ok(/Profile completion|Skills on file/.test(answer.content), `answer quotes stored records: ${answer.content.slice(0, 90)}`)
    const run = await prisma.aiRun.findUniqueOrThrow({ where: { id: (await prisma.assistantMessage.findFirstOrThrow({ where: { id: answer.id } })).aiRunId ?? '' } })
    assert.equal(run.agent, 'ASSISTANT_CHAT')
    assert.equal(run.mode, 'DETERMINISTIC')
    const events = await prisma.auditEvent.findMany({ where: { actorUserId: (await principalFor(emails[0])).userId, action: 'sona.ask' } })
    assert.ok(events.length === 1, 'the turn is audited once, to the person themselves')
  })
  await check("sona's transcript is not readable by another account", async () => {
    const other = await principalFor(emails[1])
    assert.equal((await sonaTranscript(other)).length, 0, 'a second candidate sees no transcript')
    await askSona(other, 'How many applicants are waiting on a decision?')
    const mine = await sonaTranscript(await principalFor(emails[0]))
    const theirs = await sonaTranscript(other)
    assert.ok(mine.length === 2 && theirs.length === 2, 'each account keeps only its own turns')
    assert.ok(!theirs.some((turn) => turn.content.includes('What is still missing from my profile?')), 'no leakage across sessions')
  })
  await check('audit trail contains actual consent, application and document events', async () => {
    const events = await prisma.auditEvent.findMany({ where: { actorUserId: one.userId }, select: { action: true } })
    for (const action of ['candidate.application.create', 'candidate.application.withdraw', 'disclosure.approved', 'disclosure.revoked', 'ai.evidence.upload']) assert.ok(events.some((event) => event.action === action), action)
  })

  // --- Email verification: the second factor that gates both doors. ----------
  const verificationEmail = `qa-verification-${run}@example.com`
  const verificationUser = await registerCandidate(candidateSignupSchema.parse({ email: verificationEmail, name: 'Fictional verification candidate', password, confirmPassword: password, coreConsent: true }))
  userIds.push(verificationUser.id)

  await check('creating an account leaves it unverified and does not sign anybody in', async () => {
    const fresh = await prisma.user.findUniqueOrThrow({ where: { id: verificationUser.id }, select: { emailVerifiedAt: true } })
    assert.equal(fresh.emailVerifiedAt, null, 'registration alone never confirms an address')
  })

  await check('mail failures retain their reason and leave no redeemable code', async () => {
    const names = ['MAIL_MODE', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'] as const
    const saved = new Map(names.map((name) => [name, process.env[name]]))
    const originalFetch = globalThis.fetch
    try {
      process.env.MAIL_MODE = 'supabase'
      process.env.SUPABASE_URL = 'https://unit-test-project.supabase.co'
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture-service-role-key-not-a-real-credential'
      resetMailConfigCache()
      for (const [status, code, reason] of [
        [404, 'NOT_FOUND', 'function-not-deployed'],
        [503, 'mail-not-configured', 'provider-not-configured'],
        [502, 'provider-rate-limited', 'rate-limited'],
      ] as const) {
        globalThis.fetch = async () => Response.json({ code }, { status })
        await assert.rejects(
          () => issueVerificationCode({ userId: verificationUser.id, email: verificationEmail, name: verificationUser.name, purpose: 'SIGNUP' }),
          (error: unknown) => error instanceof MailError && error.reason === reason,
        )
        assert.equal(await prisma.emailVerification.count({ where: { userId: verificationUser.id } }), 0)
        assert.ok(await prisma.auditEvent.findFirst({ where: {
          action: 'auth.verification_send_failed', targetUserId: verificationUser.id,
          metadata: { path: ['failure'], equals: reason },
        } }))
      }
      assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: verificationUser.id } })).emailVerifiedAt, null)
    } finally {
      globalThis.fetch = originalFetch
      for (const name of names) {
        const value = saved.get(name)
        if (value === undefined) delete process.env[name]
        else process.env[name] = value
      }
      resetMailConfigCache()
    }
  })

  await check('a code is delivered to the screen for a reserved address and kept as a digest', async () => {
    const issued = await issueVerificationCode({ userId: verificationUser.id, email: verificationEmail, name: verificationUser.name, purpose: 'SIGNUP' })
    assert.equal(issued.status, 'sent', `expected a demonstration delivery, got ${issued.status}`)
    if (issued.status !== 'sent') return
    const previewCode = 'previewCode' in issued ? issued.previewCode : null
    assert.match(previewCode ?? '', /^\d{6}$/, 'the on-screen code is six digits')
    const row = await prisma.emailVerification.findUniqueOrThrow({ where: { id: issued.verificationId } })
    assert.match(row.codeHash, /^[0-9a-f]{64}$/, 'only a hex digest of the code is stored')
    assert.equal(row.codeHash.includes(previewCode ?? '§'), false, 'the code never appears inside its own digest column')
    assert.equal(row.transport, 'PREVIEW')
    assert.equal(row.purpose, 'SIGNUP')
    assert.ok(row.expiresAt.getTime() > Date.now(), 'a fresh code is not already expired')
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: verificationUser.id }, select: { emailVerifiedAt: true } })).emailVerifiedAt, null, 'issuing a code verifies nothing')
    const sent = await prisma.auditEvent.findFirstOrThrow({ where: { action: 'auth.verification_sent', targetUserId: verificationUser.id }, orderBy: { createdAt: 'desc' } })
    assert.equal((sent.metadata as { transport?: string } | null)?.transport, 'PREVIEW', 'the audit row uses the schema spelling of the transport')
    assert.equal(JSON.stringify(sent.metadata).includes(previewCode ?? '§'), false, 'and never carries the code itself')
    assert.equal(JSON.stringify(sent.metadata).includes(verificationEmail), false, 'nor the address')
  })

  await check('a second request inside the cooldown returns the code already in flight', async () => {
    const again = await issueVerificationCode({ userId: verificationUser.id, email: verificationEmail, name: verificationUser.name, purpose: 'SIGNUP' })
    assert.equal(again.status, 'cooldown', 'the 30-second gap is enforced')
    if (again.status !== 'cooldown') return
    assert.ok(again.retryAfterSeconds > 0 && again.retryAfterSeconds <= 30, `retry hint was ${again.retryAfterSeconds}s`)
    assert.ok(again.verificationId, 'the live code is handed back so the screen can still be used')
    assert.equal(await prisma.emailVerification.count({ where: { userId: verificationUser.id } }), 1, 'a refused request sends no second mail')
  })

  await check('five wrong entries burn a code and the right one afterwards no longer works', async () => {
    const live = await prisma.emailVerification.findFirstOrThrow({ where: { userId: verificationUser.id, consumedAt: null }, orderBy: { createdAt: 'desc' } })
    const real = live.previewCode ?? '000000'
    // Five codes that differ from the live one in their first digit, so the loop
    // can never accidentally redeem the code it is meant to be failing on.
    const wrongCodes = [1, 2, 3, 4, 5].map((shift) => `${(Number(real[0]) + shift) % 10}${real.slice(1)}`)
    for (const [index, candidate] of wrongCodes.entries()) {
      const wrong = await redeemVerificationCode({ userId: verificationUser.id, purpose: 'SIGNUP', verificationId: live.id, code: candidate })
      assert.equal(wrong.status, 'invalid', `attempt ${index + 1} should be a plain rejection`)
      if (wrong.status !== 'invalid') return
      assert.equal(wrong.remainingAttempts, 4 - index, 'the screen is told how many tries are left')
    }
    const spent = await redeemVerificationCode({ userId: verificationUser.id, purpose: 'SIGNUP', verificationId: live.id, code: live.previewCode ?? '000000' })
    assert.equal(spent.status, 'absent', 'a code that ran out of attempts is dead even to its owner')
    const retired = await prisma.emailVerification.findUniqueOrThrow({ where: { id: live.id } })
    assert.ok(retired.consumedAt, 'the exhausted row is retired')
    assert.equal(retired.verifiedAt, null, 'an exhausted row never looks like a redemption')
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: verificationUser.id }, select: { emailVerifiedAt: true } })).emailVerifiedAt, null, 'and the account stays unverified')
  })

  await check('the correct code verifies once, and a replay of it verifies nothing', async () => {
    // Age the exhausted row out of the cooldown rather than sleeping for it.
    await prisma.emailVerification.updateMany({ where: { userId: verificationUser.id }, data: { createdAt: new Date(Date.now() - 60_000) } })
    const issued = await issueVerificationCode({ userId: verificationUser.id, email: verificationEmail, name: verificationUser.name, purpose: 'SIGNUP' })
    assert.equal(issued.status, 'sent')
    if (issued.status !== 'sent') return
    const code = 'previewCode' in issued ? issued.previewCode : ''
    const wrongAccount = await redeemVerificationCode({ userId: one.userId, purpose: 'SIGNUP', verificationId: issued.verificationId, code })
    assert.equal(wrongAccount.status, 'absent', 'another account cannot spend this code with the same digits')
    const good = await redeemVerificationCode({ userId: verificationUser.id, purpose: 'SIGNUP', verificationId: issued.verificationId, code })
    assert.equal(good.status, 'verified')
    assert.ok((await prisma.user.findUniqueOrThrow({ where: { id: verificationUser.id }, select: { emailVerifiedAt: true } })).emailVerifiedAt, 'the address is now confirmed')
    const replay = await redeemVerificationCode({ userId: verificationUser.id, purpose: 'SIGNUP', verificationId: issued.verificationId, code })
    assert.equal(replay.status, 'absent', 'a code works exactly once')
    const row = await prisma.emailVerification.findUniqueOrThrow({ where: { id: issued.verificationId } })
    assert.ok(row.verifiedAt && row.consumedAt, 'a redemption is recorded as spent and as earned')
    const failedEvents = await prisma.auditEvent.count({ where: { targetUserId: verificationUser.id, action: 'auth.verification_failed' } })
    assert.ok(failedEvents >= 5, 'every wrong entry is audited')
  })

  await check('a code that has been used up does not block the next sign-in', async () => {
    // Row by row: the code redeemed a moment ago is spent, so asking again inside
    // the 30-second window is a fresh request, not a resend. Signing out and back
    // in is ordinary behaviour and must not be refused with "a code is on its way".
    const afterUse = await issueVerificationCode({ userId: verificationUser.id, email: verificationEmail, name: verificationUser.name, purpose: 'LOGIN' })
    assert.equal(afterUse.status, 'sent', `expected a new code, got ${afterUse.status}`)
    assert.equal((await prisma.emailVerification.count({ where: { userId: verificationUser.id, purpose: 'LOGIN' } })), 1, 'and it is the only live login code for the account')
  })

  await check('the send ceiling bites and says when it clears', async () => {
    const email = `qa-verification-cap-${run}@example.com`
    const capped = await registerCandidate(candidateSignupSchema.parse({ email, name: 'Fictional capped candidate', password, confirmPassword: password, coreConsent: true }))
    userIds.push(capped.id)
    // The cluster runs a higher ceiling than production so a suite of sign-ins
    // cannot exhaust it; the rule itself is measured here at a number small
    // enough to reach on purpose.
    const saved = process.env.VERIFICATION_MAX_SENDS_PER_HOUR
    process.env.VERIFICATION_MAX_SENDS_PER_HOUR = '3'
    try {
      for (let index = 0; index < 3; index += 1) {
        // Backdated requests, so only the window is being tested, not the gap.
        await prisma.emailVerification.create({ data: { userId: capped.id, purpose: 'LOGIN', codeHash: 'x'.repeat(64), transport: 'SUPABASE', expiresAt: new Date(Date.now() + 600_000), consumedAt: new Date(), createdAt: new Date(Date.now() - (index + 1) * 60_000) } })
      }
      const refused = await issueVerificationCode({ userId: capped.id, email, name: capped.name, purpose: 'LOGIN' })
      assert.equal(refused.status, 'limited', 'the hourly ceiling bites')
      if (refused.status !== 'limited') return
      assert.equal(refused.verificationId, null, 'nothing usable is left, so nobody is walked to the entry screen')
      assert.ok(refused.retryAfterSeconds > 2400 && refused.retryAfterSeconds <= 3600, `the wait should name the real clearing time, got ${refused.retryAfterSeconds}s`)
      assert.equal(await prisma.emailVerification.count({ where: { userId: capped.id } }), 3, 'a refused request writes nothing')
    } finally {
      if (saved === undefined) delete process.env.VERIFICATION_MAX_SENDS_PER_HOUR
      else process.env.VERIFICATION_MAX_SENDS_PER_HOUR = saved
    }
  })

  await check('the send ceiling keeps its production default and refuses a value it cannot read', async () => {
    const saved = process.env.VERIFICATION_MAX_SENDS_PER_HOUR
    try {
      delete process.env.VERIFICATION_MAX_SENDS_PER_HOUR
      assert.equal(sendLimit(), DEFAULT_MAX_SENDS_PER_HOUR, 'six per hour when nobody says otherwise')
      process.env.VERIFICATION_MAX_SENDS_PER_HOUR = '40'
      assert.equal(sendLimit(), 40, 'a string from the environment is read as a number')
      process.env.VERIFICATION_MAX_SENDS_PER_HOUR = 'often'
      assert.throws(() => sendLimit(), /VERIFICATION_MAX_SENDS_PER_HOUR/, 'a value that is not a number fails loudly')
      process.env.VERIFICATION_MAX_SENDS_PER_HOUR = '0'
      assert.throws(() => sendLimit(), /VERIFICATION_MAX_SENDS_PER_HOUR/, 'and a ceiling of zero is not a ceiling')
    } finally {
      if (saved === undefined) delete process.env.VERIFICATION_MAX_SENDS_PER_HOUR
      else process.env.VERIFICATION_MAX_SENDS_PER_HOUR = saved
    }
  })

  await check('the password step alone reaches no portal page, no API and no data', async () => {
    // Its own account: the send cooldown belongs to whoever last asked, and this
    // check has to be able to ask.
    const gateEmail = `qa-verification-gate-${run}@example.com`
    const gateUser = await registerCandidate(candidateSignupSchema.parse({ email: gateEmail, name: 'Fictional gate candidate', password, confirmPassword: password, coreConsent: true }))
    userIds.push(gateUser.id)

    const context = await browser.newContext({ baseURL: 'http://localhost:3100' })
    contexts.push(context)
    const page = await context.newPage()
    await page.goto('/login')
    await page.getByLabel('Email address', { exact: true }).fill(gateEmail)
    await page.getByLabel('Password', { exact: true }).fill(password)
    await page.locator('main').getByRole('button', { name: 'Sign in', exact: true }).click()
    try {
      await page.waitForURL((url) => url.pathname.startsWith('/verify-email'), { timeout: 40_000 })
    } catch {
      const seen = (await page.locator('#main').innerText()).replace(/\s+/g, ' ').slice(0, 300)
      assert.fail(`the password step never reached the code screen; url=${page.url()} said "${seen}"`)
    }
    assert.ok((await page.locator('#main').innerText()).includes('Confirm it is you'), 'the screen says what is still missing')

    const portal = await context.request.get('/candidate/jobs', { maxRedirects: 0 })
    assert.ok([302, 303, 307, 308].includes(portal.status()), `a portal page must bounce, got ${portal.status()}`)
    assert.match(portal.headers().location ?? '', /\/login/, 'and bounce it to sign-in, not into the portal')
    const api = await context.request.get('/api/skills')
    assert.equal(api.status(), 401, 'the API is closed to a password-only visitor')
    const pageData = await context.request.get('/candidate')
    assert.ok(new URL(pageData.url()).pathname.startsWith('/login'), 'following redirects still lands outside the portal')

    // Now finish properly and show the same session opens the portal.
    const preview = page.locator('#verification-preview-code')
    await preview.waitFor({ state: 'visible', timeout: 30_000 })
    await page.getByLabel('Six-digit code', { exact: true }).fill(((await preview.textContent()) ?? '').replace(/\D/g, ''))
    await page.getByRole('button', { name: 'Verify and sign in' }).click()
    await page.waitForURL((url) => url.pathname.startsWith('/candidate'), { timeout: 40_000 })
    const granted = await prisma.emailVerification.findFirstOrThrow({ where: { userId: gateUser.id, purpose: 'LOGIN' }, orderBy: { createdAt: 'desc' } })
    assert.equal(granted.verifiedAt, null, 'the session spent the grant, so the same ticket cannot open a second one')
    assert.ok(granted.consumedAt, 'and the code is retired behind it')
    const skills = await context.request.get('/api/skills')
    assert.equal(skills.status(), 200, 'the same browser, with the code entered, is served')
    await page.close()
  })

  await check('the link in the mail spends the same grant as the code, once', async () => {
    const email = `qa-verification-link-${run}@example.com`
    const linked = await registerCandidate(candidateSignupSchema.parse({ email, name: 'Fictional link candidate', password, confirmPassword: password, coreConsent: true }))
    userIds.push(linked.id)

    const issued = await issueVerificationCode({ userId: linked.id, email, name: linked.name, purpose: 'LOGIN' })
    assert.equal(issued.status, 'sent')
    if (issued.status !== 'sent') return
    const summary = await verificationSummaryFor(issued.verificationId)
    const token = summary?.previewToken
    const code = summary?.previewCode ?? ''
    assert.ok(token && token.length > 20, 'a demonstration row carries the link token it would have emailed')
    assert.ok((summary?.previewLink ?? '').includes('/verify-email?token='), 'the link points at the confirm screen')

    const unknown = await redeemVerificationLink({ token: 'a'.repeat(48) })
    assert.equal(unknown.status, 'rejected', 'a token this server never issued is refused')
    if (unknown.status !== 'rejected') return
    assert.equal(unknown.reason, 'unknown')

    const redeemed = await redeemVerificationLink({ token: token ?? '' })
    assert.deepEqual(redeemed, { status: 'verified', userId: linked.id, purpose: 'LOGIN', verificationId: issued.verificationId })
    const row = await prisma.emailVerification.findUniqueOrThrow({ where: { id: issued.verificationId } })
    assert.ok(row.verifiedAt && row.consumedAt, 'the link redemption stamps the same grant the code would have')
    assert.ok((await prisma.user.findUniqueOrThrow({ where: { id: linked.id }, select: { emailVerifiedAt: true } })).emailVerifiedAt, 'and confirms the address')

    // One grant, one use: the code beside the link is now dead, and so is the link.
    const codeAfterLink = await redeemVerificationCode({ userId: linked.id, purpose: 'LOGIN', verificationId: issued.verificationId, code })
    assert.equal(codeAfterLink.status, 'absent', 'the code cannot be spent after the link was')
    const replay = await redeemVerificationLink({ token: token ?? '' })
    assert.equal(replay.status, 'rejected', 'the link works once')
    if (replay.status !== 'rejected') return
    assert.equal(replay.reason, 'spent')

    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { action: 'auth.verified', targetUserId: linked.id }, orderBy: { createdAt: 'desc' } })
    assert.equal((audit.metadata as { method?: string } | null)?.method, 'link', 'the audit row says the link was the way in')
    assert.equal(JSON.stringify(audit.metadata).includes(token ?? '§'), false, 'and never carries the token')
  })

  await check('an expired link is refused and says so', async () => {
    const email = `qa-verification-expiry-${run}@example.com`
    const expired = await registerCandidate(candidateSignupSchema.parse({ email, name: 'Fictional expired-link candidate', password, confirmPassword: password, coreConsent: true }))
    userIds.push(expired.id)
    const issued = await issueVerificationCode({ userId: expired.id, email, name: expired.name, purpose: 'SIGNUP' })
    if (issued.status !== 'sent') return
    const token = (await verificationSummaryFor(issued.verificationId))?.previewToken
    await prisma.emailVerification.update({ where: { id: issued.verificationId }, data: { expiresAt: new Date(Date.now() - 1000) } })
    const result = await redeemVerificationLink({ token: token ?? '' })
    assert.equal(result.status, 'rejected')
    if (result.status !== 'rejected') return
    assert.equal(result.reason, 'expired', 'a past-due link is not a key')
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: expired.id }, select: { emailVerifiedAt: true } })).emailVerifiedAt, null, 'and it verified nothing')
  })

  await check('a locked account is not unlocked by knowing the password', async () => {
    const email = `qa-verification-lock-${run}@example.com`
    const locked = await registerCandidate(candidateSignupSchema.parse({ email, name: 'Fictional locked candidate', password, confirmPassword: password, coreConsent: true }))
    userIds.push(locked.id)
    await prisma.user.update({ where: { id: locked.id }, data: { failedLoginCount: 5, lockedUntil: new Date(Date.now() + 900_000), emailVerifiedAt: new Date() } })
    const outcome = await verifyCredentials(email, password)
    assert.equal(outcome.status, 'locked', 'the correct password is acknowledged, then refused')
    if (outcome.status !== 'locked') return
    assert.ok(outcome.retryAfterMinutes >= 1 && outcome.retryAfterMinutes <= 15, `retry hint was ${outcome.retryAfterMinutes} minutes`)
    const wrong = await verifyCredentials(email, 'not-the-password-1')
    assert.equal(wrong.status, 'invalid', 'a wrong password on a locked account says nothing more')
    const missing = await verifyCredentials(`nobody-${run}@example.com`, password)
    assert.equal(missing.status, 'invalid', 'an unknown address is indistinguishable from a wrong password')
  })
}

main().catch((error) => { failed++; console.error(error instanceof Error ? error.message : 'Integration setup failed') }).finally(async () => {
  await browser?.close()
  if (server) {
    // The QA launcher re-execs Node, so killing the direct child is not enough
    // to release the port for the next run.
    server.kill()
    const deadline = Date.now() + 30_000
    while (Date.now() < deadline && (await healthy())) await new Promise((resolve) => setTimeout(resolve, 1_000))
  }
  for (const upload of uploads) await removeUpload(upload.principal, upload.id)
  await prisma.job.deleteMany({ where: { id: { in: jobs } } })
  await prisma.user.deleteMany({ where: { id: { in: userIds } } })
  await prisma.weightProfile.deleteMany({ where: { version: `qa-int-${run}` } })
  await prisma.$disconnect()
  console.log(`Integration results: ${passed} passed, ${failed} failed`)
  process.exitCode = failed ? 1 : 0
})
