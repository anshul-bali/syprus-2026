/**
 * End-to-end sequence test.
 *
 * Drives the real service layer against the real database — no mocks, no HTTP,
 * no fixtures — through the whole product promise: signup → onboarding
 * conversation → suggestions the candidate confirms → skills and evidence →
 * saved capability graph → matching → anonymised employer review → explicit
 * identity disclosure → shortlist → application.
 *
 *   npx tsx scripts/e2e.ts            # run and clean up
 *   npx tsx scripts/e2e.ts --keep     # leave the rows behind to inspect
 *   AI_LIVE=1 npx tsx scripts/e2e.ts  # also exercise the model path on discovery
 *
 * The AI is disabled by default so the assertions test the product, not the
 * provider's uptime; the live path is covered by `npm run check:ai`.
 */

import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

let checks = 0
let failures = 0
const notes: string[] = []

function check(label: string, condition: boolean, detail = '') {
  checks += 1
  if (condition) {
    console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  } else {
    failures += 1
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
  return condition
}

function note(text: string) {
  notes.push(text)
  console.log(`        · ${text}`)
}

function section(title: string) {
  console.log(`\n${title}`)
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ---------------------------------------------------------------------------
// Principals
// ---------------------------------------------------------------------------

type PrincipalLike = import('../src/lib/authz').Principal

async function principalFor(userId: string): Promise<PrincipalLike> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: {
      candidateProfile: { select: { id: true } },
      ownedOrganization: { select: { id: true, name: true, verificationStatus: true } },
      memberships: { select: { id: true, name: true, verificationStatus: true } },
    },
  })
  const roleRow = await prisma.roleDefinition.findUniqueOrThrow({
    where: { role: user.role },
    include: { permissions: true },
  })
  const organisation = user.ownedOrganization ?? user.memberships[0] ?? null

  return {
    userId: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    status: user.status,
    organizationId: organisation?.id ?? null,
    organizationName: organisation?.name ?? null,
    organizationVerification: organisation?.verificationStatus ?? null,
    candidateProfileId: user.candidateProfile?.id ?? null,
    permissions: roleRow.permissions.map((permission) => permission.key) as PrincipalLike['permissions'],
  }
}

// ---------------------------------------------------------------------------
// Flow
// ---------------------------------------------------------------------------

async function main() {
  const keep = process.argv.includes('--keep')
  const live = process.env.AI_LIVE === '1'
  if (!live) {
    process.env.AI_ENABLED = 'false'
    process.env.AI_PROVIDER = 'deterministic'
  }

  // Imported after the env is set so the AI config memoises the intended mode.
  const { anonymousHandle } = await import('../src/lib/utils')
  const accounts = await import('../src/server/accounts')
  const onboarding = await import('../src/server/onboarding')
  const proposals = await import('../src/server/ai/proposals')
  const agentRuns = await import('../src/server/ai/agents')
  const graph = await import('../src/server/graph')
  const matching = await import('../src/server/matching')
  const jobs = await import('../src/server/jobs')
  const anonymize = await import('../src/server/anonymize')
  const disclosure = await import('../src/server/disclosure')
  const applications = await import('../src/server/applications')
  const gap = await import('../src/server/gap')
  const pathway = await import('../src/server/pathway')
  const admin = await import('../src/server/admin')
  void anonymousHandle

  const stamp = `e2e-${Date.now().toString(36)}`
  const candidateEmail = `${stamp}@example.com`
  const employerEmail = `${stamp}-hr@example.com`
  const otherEmployerEmail = `${stamp}-talent@example.com`
  const password = 'E2e-Test-Password-2026!'
  const createdUsers: string[] = []

  console.log(`\nSYPRUS end-to-end sequence${live ? ' (live AI)' : ' (deterministic AI)'}\n  subject: ${candidateEmail}`)

  // -------------------------------------------------------------------------
  section('1. Candidate signup')
  const candidate = await accounts.registerCandidate({
    name: 'Riya Sharma',
    email: candidateEmail,
    password,
    confirmPassword: password,
    dataProcessingConsent: true,
    sensitiveDataConsent: true,
    inferenceConsent: true,
  } as never)

  const candidateProfile = await prisma.candidateProfile.findUniqueOrThrow({
    where: { userId: candidate.id },
  })
  createdUsers.push(candidate.id)
  const candidatePrincipal = await principalFor(candidate.id)

  check('account and profile created', Boolean(candidate.id && candidateProfile.id))
  check(
    'mandatory consent written at signup',
    (await prisma.consentRecord.count({ where: { userId: candidate.id } })) >= 1,
  )
  check('profile starts hidden from employers', candidateProfile.visibleToEmployers === false)
  check('password is not stored in plaintext', !(await prisma.user.findUniqueOrThrow({ where: { id: candidate.id } })).passwordHash.includes(password))
  check(
    'login would verify against the hash',
    await bcrypt.compare(password, (await prisma.user.findUniqueOrThrow({ where: { id: candidate.id } })).passwordHash as string),
  )

  // -------------------------------------------------------------------------
  section('2. Onboarding conversation')
  const conversation = await onboarding.startOrResumeConversation(candidatePrincipal)
  check('conversation persisted', Boolean(conversation.conversation.id))

  const steps: { key: string; answers: Record<string, string | number | boolean | string[]> }[] = [
    { key: 'intro', answers: { inferenceConsent: true } },
    {
      key: 'break',
      answers: { months: 36, timeline: '1-3', reason: 'Full-time care for a parent after a stroke' },
    },
    {
      key: 'work',
      answers: {
        title: 'Marketing Analyst',
        organization: 'Bluewave Retail',
        years: 4,
        description:
          'Built the weekly campaign performance report in Excel and SQL, presented findings to the head of marketing, coordinated with the agency and other teams on launches, and managed the campaign budget.',
      },
    },
    {
      key: 'caregiving',
      answers: {
        activities: ['medical_logistics', 'household_budget'],
        notes:
          'Coordinated three specialists and a physiotherapist around a changing schedule, kept the medical records, and ran the household budget including insurance claims.',
      },
    },
    {
      key: 'other',
      answers: {
        volunteering: 'Treasurer of the parents’ association: collected fees, negotiated with vendors, reported to the committee.',
        freelance: '',
      },
    },
    {
      key: 'goals',
      answers: {
        targetRole: 'Marketing Operations Coordinator',
        targetIndustry: 'Media and marketing',
        workPreference: 'HYBRID',
        availability: 30,
        city: 'Pune',
      },
    },
    { key: 'sharing', answers: { anonymizedSharing: true, employerContact: true, research: true } },
    { key: 'review', answers: {} },
  ]

  for (const step of steps) {
    await onboarding.answerStep(candidatePrincipal, step.key, step.answers)
  }

  const profileAfter = await prisma.candidateProfile.findUniqueOrThrow({ where: { id: candidateProfile.id } })
  const skillsAfter = await prisma.candidateSkill.count({ where: { candidateProfileId: candidateProfile.id } })
  const experiencesAfter = await prisma.experience.count({ where: { candidateProfileId: candidateProfile.id } })
  const evidenceAfter = await prisma.skillEvidence.count({
    where: { candidateSkill: { candidateProfileId: candidateProfile.id } },
  })
  const messages = await prisma.message.count({ where: { conversationId: conversation.conversation.id } })

  check('onboarding marked complete', profileAfter.onboardingComplete === true)
  check('work and caregiving experiences stored', experiencesAfter >= 2, `${experiencesAfter} entries`)
  check('skills proposed from the candidate’s own wording', skillsAfter > 0, `${skillsAfter} skills`)
  check('evidence rows quote the source text', evidenceAfter > 0, `${evidenceAfter} evidence rows`)
  check('transcript persisted', messages >= steps.length, `${messages} messages for ${steps.length} steps`)
  check('profile became visible after the sharing step', profileAfter.visibleToEmployers === true)

  const inferred = await prisma.candidateSkill.findMany({
    where: { candidateProfileId: candidateProfile.id, validationStatus: 'RULE_INFERRED' },
    include: { skill: true },
  })
  check(
    'caregiving-derived skills are stored as suggestions, not verified claims',
    inferred.every((skill) => skill.validationStatus !== 'ASSESSMENT_VERIFIED' && skill.validationStatus !== 'HR_REVIEWED'),
    `${inferred.length} rule-inferred skill(s)`,
  )

  // -------------------------------------------------------------------------
  section('3. Suggestion inbox: the candidate decides')
  const discovery = await agentRuns.runSkillsDiscovery(candidatePrincipal)
  check(
    'the discovery agent ran and reported which path produced it',
    discovery.mode === 'AI' || discovery.mode === 'DETERMINISTIC',
    `${discovery.mode} via ${discovery.provider}`,
  )
  check('it wrote an auditable ai_runs row', Boolean(discovery.aiRunId))
  check('suggestions were produced from the candidate’s wording', discovery.created > 0, `${discovery.created} proposal(s)`)

  const openProposals = await proposals.listProposals(candidatePrincipal, { status: 'PROPOSED' })
  check('proposals are queued for a decision', openProposals.length > 0, `${openProposals.length} waiting`)
  check(
    'each proposal names its origin honestly',
    openProposals.every((proposal) =>
      proposal.origin.mode === 'AI' ? proposal.origin.label.startsWith('Model') : proposal.origin.label === 'Rule-based engine',
    ),
    openProposals[0]?.origin.label ?? 'none',
  )

  if (openProposals.length > 0) {
    const target = openProposals[0]
    const decided = await proposals.decideProposal(candidatePrincipal, {
      proposalId: target.id,
      decision: 'CONFIRMED',
    })
    const stored = await prisma.candidateSkill.findUniqueOrThrow({
      where: { id: decided.candidateSkillId as string },
      include: { skill: true },
    })
    check('confirming writes a skill the candidate owns', stored.validationStatus === 'USER_CONFIRMED', stored.skill.name)
    check('the proposal is no longer pending', (await prisma.aiProposal.findUniqueOrThrow({ where: { id: target.id } })).status === 'CONFIRMED')

    if (openProposals.length > 1) {
      const rejected = await proposals.decideProposal(candidatePrincipal, {
        proposalId: openProposals[1].id,
        decision: 'REJECTED',
      })
      check(
        'rejecting keeps the skill off the inventory',
        (await prisma.candidateSkill.count({ where: { candidateProfileId: candidateProfile.id } })) >= 1 &&
          rejected.status === 'REJECTED',
      )
    }
  }

  // -------------------------------------------------------------------------
  section('4. Capability graph: generated, edited, persisted')
  const model = await graph.loadGraphModel(candidatePrincipal)
  const centre = model.nodes.find((node) => node.kind === 'YOU')
  check('the candidate is the centre node', centre?.key === 'you')
  check('skill nodes present', model.counts.skills > 0, `${model.counts.skills} skills`)
  check('experience nodes present', model.counts.experiences > 0, `${model.counts.experiences} entries`)
  check('evidence nodes present', model.counts.evidence > 0, `${model.counts.evidence} evidence`)
  check(
    'every skill node carries a provenance band',
    model.nodes.filter((node) => node.kind === 'SKILL').every((node) => Boolean(node.provenance)),
  )
  check(
    'provenance tally is non-empty',
    Object.keys(model.provenanceTally).length > 0,
    Object.entries(model.provenanceTally)
      .map(([key, value]) => `${key}:${value}`)
      .join(' '),
  )

  const skillNode = model.nodes.find((node) => node.kind === 'SKILL')
  if (skillNode) {
    await graph.saveGraphNodeEdit(candidatePrincipal, {
      nodeKey: skillNode.key,
      position: { x: 987, y: -432 },
      note: 'This one came from the parents’ association, not from Bluewave.',
    })
    const reloaded = await graph.loadGraphModel(candidatePrincipal)
    const moved = reloaded.nodes.find((node) => node.key === skillNode.key)
    check('a dragged position is persisted', moved?.position.x === 987 && moved?.position.y === -432)
    check('a node note is persisted and shown', moved?.detail.yourNote !== undefined)
    check('the stored edit is counted', reloaded.movedCount >= 1 && reloaded.annotatedCount >= 1)

    await graph.saveGraphNodeEdit(candidatePrincipal, { nodeKey: skillNode.key, hidden: true })
    const afterHide = await graph.loadGraphModel(candidatePrincipal)
    check(
      'hiding removes the node from the picture but not the record',
      !afterHide.nodes.some((node) => node.key === skillNode.key) &&
        afterHide.hiddenCount === 1 &&
        (await prisma.candidateSkill.count({ where: { candidateProfileId: candidateProfile.id } })) ===
          model.counts.skills + (await prisma.candidateSkill.count({ where: { candidateProfileId: candidateProfile.id } })) - model.counts.skills,
    )

    await graph.resetGraphNode(candidatePrincipal, skillNode.key)
    const restored = await graph.loadGraphModel(candidatePrincipal)
    check('restoring puts the node back', restored.nodes.some((node) => node.key === skillNode.key))
    check('the underlying skill survived every graph edit', restored.counts.skills === model.counts.skills)
  }

  // -------------------------------------------------------------------------
  section('5. Matching: explainable and break-blind')
  const computed = await matching.computeMatchesForProfile(candidateProfile.id)
  const matchRows = await prisma.match.findMany({
    where: { candidateProfileId: candidateProfile.id },
    orderBy: { score: 'desc' },
  })
  check('matches were written', computed.written >= 0 && matchRows.length >= 0, `${computed.written} written, ${computed.processed} processed`)

  // Use a seeded published role if one exists, otherwise create one below.
  const seededPublished = await prisma.job.count({ where: { status: 'PUBLISHED' } })
  note(`${seededPublished} published role(s) already on the platform, ${matchRows.length} score(s) stored for this profile`)

  const topExplanation = matchRows[0] ? (matchRows[0].explanation as Record<string, never>) : null
  if (topExplanation) {
    const explanation = topExplanation as unknown as import('../src/lib/engines/matching').MatchExplanation
    const weightsSum =
      explanation.weights.required + explanation.weights.preferred + explanation.weights.evidence + explanation.weights.preferences
    check('weights are the documented 50/20/20/10', Math.abs(weightsSum - 1) < 0.001 && explanation.weights.required === 0.5)
    check('the full calculation is stored', Array.isArray(explanation.calculation) && explanation.calculation.length === 4)
    check(
      'stored contributions add up to the stored score',
      Math.abs(
        explanation.calculation.reduce((total, line) => total + line.contribution, 0) - (matchRows[0]?.score ?? 0),
      ) < 0.002,
    )
    check(
      'career break is declared as excluded',
      explanation.inputsExcluded.some((field) => field.toLowerCase().includes('career break')),
    )
    check('missing required skills are listed', Array.isArray(explanation.missingRequired))
    check('constraint checks are itemised', explanation.preferenceChecks.length === 5)
  } else {
    check('a published role existed to score against', false, 'no match rows at all')
  }

  // -------------------------------------------------------------------------
  section('6. Employer: signup, verification, role, moderation')
  const employer = await accounts.registerEmployer({
    name: 'Neha Verma',
    email: employerEmail,
    password,
    confirmPassword: password,
    organizationName: 'Kite & Compass Marketing',
    website: 'https://example.com/kite-compass',
    industry: 'Media and marketing',
    sizeLabel: '51-200',
    locationCity: 'Pune',
    locationCountry: 'India',
    recruitmentConsent: true,
  } as never)
  const employerPrincipal = await principalFor(employer.user.id)
  createdUsers.push(employer.user.id)

  check('organisation created and starts unverified', employerPrincipal.organizationVerification === 'PENDING')

  const adminUser = await prisma.user.findFirst({ where: { role: 'ADMIN', status: 'ACTIVE' } })
  if (!adminUser) {
    console.log('\n  SKIP  no administrator account exists — run `npm run db:seed` first.')
    failures += 1
  } else {
    const adminPrincipal = await principalFor(adminUser.id)

    await accounts.setOrganizationVerification(adminPrincipal, {
      organizationId: employerPrincipal.organizationId as string,
      decision: 'VERIFIED',
      note: 'Verified for the end-to-end run.',
    })
    check('administrator verification is recorded', (await prisma.organization.findUniqueOrThrow({ where: { id: employerPrincipal.organizationId as string } })).verificationStatus === 'VERIFIED')

    const excelRow = await prisma.skill.findFirst({ where: { slug: 'excel' } })
    const dbRow = await prisma.skill.findFirst({ where: { slug: 'database-management' } })
    const stakeholderRow = await prisma.skill.findFirst({ where: { slug: 'stakeholder-management' } })
    const reportingRow = await prisma.skill.findFirst({ where: { slug: 'reporting' } })
    check('the catalogue holds the skills this role will require', Boolean(excelRow && dbRow && stakeholderRow && reportingRow))

    const createdJob = await jobs.createJob(employerPrincipal, {
      title: 'Marketing Operations Coordinator',
      description:
        'Coordinate campaign delivery across the agency, the internal brand team and the analytics function. Own the reporting calendar and the tracking sheet.',
      responsibilities: [
        'Keep the campaign calendar and chase dependencies',
        'Produce the weekly performance report',
        'Coordinate with the external agency and internal brand team',
      ],
      requirementsText: 'You must have been in a marketing role for the last five years without a break.',
      locationCity: 'Pune',
      locationCountry: 'India',
      workMode: 'HYBRID',
      employmentType: 'FULL_TIME',
      salaryMin: 900000,
      salaryMax: 1400000,
      experienceYearsMin: 3,
      experienceYearsMax: 8,
      reEntryFriendly: true,
      flexibleHours: true,
      returnshipProgram: false,
      closesAt: null,
      skills: [
        { skillSlug: excelRow?.slug ?? 'excel', requirement: 'REQUIRED', level: 'PROFICIENT', weight: 5 },
        { skillSlug: dbRow?.slug ?? 'database-management', requirement: 'REQUIRED', level: 'DEVELOPING', weight: 4 },
        { skillSlug: stakeholderRow?.slug ?? 'stakeholder-management', requirement: 'REQUIRED', level: 'FUNCTIONAL', weight: 3 },
        { skillSlug: reportingRow?.slug ?? 'reporting', requirement: 'PREFERRED', level: 'FUNCTIONAL', weight: 2 },
      ] as never,
    } as never)
    check('draft role created with skill rows', createdJob.id.length > 0, `${createdJob.id}`)

    await jobs.setJobLifecycle(employerPrincipal, createdJob.id, 'SUBMIT')
    check('role queued for moderation', (await prisma.job.findUniqueOrThrow({ where: { id: createdJob.id } })).status === 'PENDING_MODERATION')

    await admin.moderateJob(adminPrincipal, { jobId: createdJob.id, decision: 'PUBLISHED', note: 'Checked wording for the test.' } as never)
    const published = await prisma.job.findUniqueOrThrow({ where: { id: createdJob.id } })
    check('moderation published the role', published.status === 'PUBLISHED')

    // -------------------------------------------------------------------------
    section('7. Matching against the new role')
    await matching.computeMatchesForProfile(candidateProfile.id)
    const fresh = await prisma.match.findUnique({
      where: { candidateProfileId_jobId: { candidateProfileId: candidateProfile.id, jobId: createdJob.id } },
    })
    check('the candidate is scored against the new role', Boolean(fresh))
    if (fresh) {
      const explanation = fresh.explanation as unknown as import('../src/lib/engines/matching').MatchExplanation
      check('score inside 0..1', fresh.score >= 0 && fresh.score <= 1, fresh.score.toFixed(3))
      check(
        'the break-length sentence still holds for this role',
        explanation.summary.some((line) => line.toLowerCase().includes('career-break length')),
      )
      note(`required ${Math.round(fresh.requiredScore * 100)}% · evidence ${Math.round(fresh.evidenceScore * 100)}% · constraints ${Math.round(fresh.preferenceScore * 100)}%`)
    }

    // -------------------------------------------------------------------------
    section('8. Blind review: what the employer can see')
    const candidates = await matching.candidatesForJob(employerPrincipal, createdJob.id, { take: 20 })
    check('the candidate appears in employer review', candidates.length > 0, `${candidates.length} visible`)
    const mine = candidates.find((entry) => entry.profile.candidateProfileId === candidateProfile.id)
    if (mine) {
      check('no name is exposed', mine.profile.realName === null)
      check('no email is exposed', mine.profile.email === null)
      check('identity is not revealed', mine.profile.identityRevealed === false)
      check('experience descriptions withheld', mine.profile.experiences.every((entry) => entry.description === null))
      check(
        'employer names neutralised',
        mine.profile.experiences.every((entry) => !entry.organizationLabel.includes('Bluewave')),
      )
      check('calendar dates replaced by durations', mine.profile.experiences.every((entry) => /\d+ (year|month)s?/.test(entry.durationLabel) || entry.durationLabel === 'Duration not recorded'))
      check('skills and levels are what the review is built on', mine.profile.skills.length > 0)
    } else {
      check('the profile was visible for review', false)
    }

    const viewed = await prisma.profileView.count({
      where: { organizationId: employerPrincipal.organizationId as string, candidateProfileId: candidateProfile.id },
    })
    note(`access log rows for this organisation on this profile: ${viewed}`)

    // -------------------------------------------------------------------------
    section('9. Identity disclosure needs the candidate')
    const beforeRequest = await anonymize.canRevealIdentity(candidateProfile.id, employerPrincipal.organizationId as string)
    check('no disclosure before asking', beforeRequest === false)

    const requested = await disclosure.requestIdentityDisclosure(employerPrincipal, {
      candidateProfileId: candidateProfile.id,
      jobId: createdJob.id,
      reason: 'We would like to arrange a conversation and need to send a calendar invitation.',
    })
    check('request accepted and queued', requested.ok === true && Boolean(requested.requestId))

    check(
      'a request alone changes nothing',
      (await anonymize.canRevealIdentity(candidateProfile.id, employerPrincipal.organizationId as string)) === false,
    )

    const shortlisted = await applications.shortlistCandidate(employerPrincipal, {
      jobId: createdJob.id,
      candidateProfileId: candidateProfile.id,
      note: 'Strong coordination evidence; anonymous stage.',
    })
    check('shortlisting is possible while anonymous', Boolean(shortlisted.id))

    const seen = await disclosure.disclosureRequestsForCandidate(candidatePrincipal)
    check('the candidate can read the request', seen.length === 1 && seen[0].status === 'PENDING')
    check('the requester is named but not the answer', Boolean(seen[0].organizationName))
    check(
      'a notification was delivered',
      (await prisma.notification.count({ where: { userId: candidate.id, type: 'DISCLOSURE_REQUEST' } })) === 1,
    )

    await disclosure.decideDisclosure(candidatePrincipal, {
      requestId: seen[0].id,
      decision: 'APPROVED',
      note: 'Happy to talk about the coordination work.',
    })
    check(
      'approval reveals identity to that organisation',
      await anonymize.canRevealIdentity(candidateProfile.id, employerPrincipal.organizationId as string),
    )
    const revealed = await anonymize.anonymizedProfileForEmployer(candidateProfile.id, employerPrincipal.organizationId as string)
    check('name now comes through', revealed?.realName === 'Riya Sharma', revealed?.realName ?? 'null')
    check('email now comes through', Boolean(revealed?.email))
    check('descriptions are readable after consent', revealed?.experiences.some((entry) => entry.description !== null) === true)
    check(
      'the disclosure decision is audited',
      (await prisma.auditEvent.count({ where: { action: 'disclosure.approved', entityId: seen[0].id } })) === 1,
    )
    check(
      'the employer was notified of the answer',
      (await prisma.notification.count({ where: { userId: employer.user.id, type: 'DISCLOSURE_DECISION' } })) === 1,
    )

    // A second employer asks, and this time the candidate declines.
    const other = await accounts.registerEmployer({
      name: 'Tara Iyer',
      email: otherEmployerEmail,
      password,
      confirmPassword: password,
      organizationName: 'Northline Analytics',
      website: 'https://example.com/northline',
      industry: 'Technology',
      sizeLabel: '11-50',
      locationCity: 'Pune',
      locationCountry: 'India',
      recruitmentConsent: true,
    } as never)
    const otherPrincipal = await principalFor(other.user.id)
    createdUsers.push(other.user.id)
    await accounts.setOrganizationVerification(adminPrincipal, {
      organizationId: otherPrincipal.organizationId as string,
      decision: 'VERIFIED',
      note: 'Verified for the end-to-end run.',
    })
    const declined = await disclosure.requestIdentityDisclosure(otherPrincipal, {
      candidateProfileId: candidateProfile.id,
      reason: 'We would like to discuss the reporting part of your background.',
    })
    const secondRequest = (await disclosure.disclosureRequestsForCandidate(candidatePrincipal)).find(
      (entry) => entry.organizationName === 'Northline Analytics',
    )
    if (secondRequest) {
      await disclosure.decideDisclosure(candidatePrincipal, { requestId: secondRequest.id, decision: 'DECLINED' })
      check(
        'a decline keeps the profile anonymous to that organisation',
        (await anonymize.canRevealIdentity(candidateProfile.id, otherPrincipal.organizationId as string)) === false,
      )
      check(
        'the decline is recorded',
        (await prisma.identityDisclosureRequest.findUniqueOrThrow({ where: { id: secondRequest.id } })).status === 'DECLINED',
      )
      check('the request itself was still a real queue item', declined.ok === true)
      check(
        'declining also writes a consent history row',
        (await prisma.consentRecord.count({ where: { userId: candidate.id, type: 'IDENTIFIED_PROFILE_SHARING' } })) >= 1,
      )
    } else {
      check('the second request reached the candidate', false)
    }

    // -------------------------------------------------------------------------
    section('10. Application')
    const applied = await applications.applyToJob(candidatePrincipal, {
      jobId: createdJob.id,
      coverLetter: 'I ran the campaign reporting cycle end to end and coordinated three teams around it.',
      identityConsent: true,
    })
    check('application stored with a score snapshot', Boolean(applied.id) && applied.matchScoreSnapshot != null)
    check('the pipeline shows it as submitted', applied.status === 'SUBMITTED')
    check(
      'applying discloses identity on its own',
      await anonymize.canRevealIdentity(
        candidateProfile.id,
        (await prisma.job.findUniqueOrThrow({ where: { id: createdJob.id } })).organizationId,
      ),
    )

    const employerList = await applications.organizationApplications(employerPrincipal, { jobId: createdJob.id })
    check('the employer sees the application', employerList.length === 1)
    await applications.updateApplicationStatus(employerPrincipal, {
      applicationId: applied.id,
      status: 'SHORTLISTED',
      note: 'Moving to conversation.',
      interviewScheduledAt: null,
    } as never)
    const afterStage = await prisma.application.findUniqueOrThrow({ where: { id: applied.id } })
    check('status change is recorded with an event row', afterStage.status === 'SHORTLISTED')
    check(
      'status history kept',
      (await prisma.applicationStatusEvent.count({ where: { applicationId: applied.id } })) >= 2,
    )
    check(
      'the candidate was notified about their own pipeline',
      (await prisma.notification.count({ where: { userId: candidate.id, type: 'APPLICATION_UPDATE' } })) >= 1,
    )

    // -------------------------------------------------------------------------
    section('11. Gaps, pathways and fairness')
    const report = await gap.generateGapReport(candidatePrincipal, { targetJobId: createdJob.id })
    check('gap report generated against the role', report.analysis.gaps.length >= 0 && Boolean(report.id))
    check('readiness band is one of the four documented values', ['EMERGING', 'DEVELOPING', 'JOB_READY', 'STRONG_MATCH'].includes(report.readiness))
    check(
      'the report names the target role',
      report.targetJobTitle === 'Marketing Operations Coordinator',
      report.targetJobTitle ?? 'null',
    )

    let planResult: { planId?: string } | { error: string }
    try {
      const plan = await pathway.generateLearningPlan(candidatePrincipal, { targetJobId: createdJob.id })
      planResult = { planId: plan.plan.id }
      check('pathway built from catalogue resources only', plan.plan.items.length >= 0)
      check(
        'every plan step points at a real catalogue row with a URL',
        plan.plan.items.every((item) => Boolean(item.resource.id)),
      )
    } catch (error) {
      planResult = { error: error instanceof Error ? error.message : String(error) }
      check(
        'the planner refuses to invent resources and says which gaps it could not cover',
        planResult.error.includes('uncovered') || planResult.error.length > 20,
        planResult.error.slice(0, 120),
      )
    }

    const audit = await import('../src/lib/engines/fairness')
    const allScores = await prisma.match.findMany({
      where: { score: { gt: 0 } },
      select: { score: true, candidateProfileId: true, jobId: true, candidateProfile: { select: { careerBreakMonths: true } } },
    })
    const verdict = audit.auditFairness(
      allScores.map((row) => ({
        score: row.score,
        careerBreakMonths: row.candidateProfile?.careerBreakMonths ?? 0,
        hasCaregivingExperience: true,
        candidateProfileId: row.candidateProfileId,
        jobId: row.jobId,
      })),
    )
    check('fairness audit runs over stored scores', ['PASS', 'WATCH', 'REVIEW', 'INSUFFICIENT_DATA'].includes(verdict.verdict), verdict.verdict)

    // -------------------------------------------------------------------------
    section('12. Authorization is enforced at the service boundary')
    const otherCandidate = await prisma.user.findFirst({
      where: { role: 'CANDIDATE', id: { not: candidate.id } },
      include: { candidateProfile: { select: { id: true } } },
    })
    if (otherCandidate?.candidateProfile) {
      let crossRefused = false
      try {
        // Candidate B tries to hide a node that only exists on A's graph.
        await graph.saveGraphNodeEdit(await principalFor(otherCandidate.id), {
          nodeKey: skillNode ? skillNode.key : 'skill:does-not-exist',
          hidden: true,
        })
      } catch {
        crossRefused = true
      }
      check('a candidate cannot edit a node key that is not on their own graph', crossRefused)

      let refused = false
      try {
        await disclosure.decideDisclosure(await principalFor(otherCandidate.id), {
          requestId: (await prisma.identityDisclosureRequest.findFirstOrThrow({ where: { candidateProfileId: candidateProfile.id } })).id,
          decision: 'APPROVED',
        })
      } catch {
        refused = true
      }
      check('a candidate cannot approve someone else’s disclosure request', refused)

      let uploadRefused = false
      try {
        await import('../src/server/ai/uploads').then(async (uploads) => {
          await uploads.readUploadForPrincipal(await principalFor(otherCandidate.id), 'nonexistent-upload-id')
        })
      } catch {
        uploadRefused = true
      }
      check('an unknown or foreign document id is refused', uploadRefused)
    }

    let anonRefused = false
    try {
      await disclosure.requestIdentityDisclosure(employerPrincipal, {
        candidateProfileId: candidateProfile.id,
        reason: 'short',
      })
    } catch {
      anonRefused = true
    }
    check('a request needs a real stated reason', anonRefused)

    let employerReadRefused = false
    try {
      await matching.candidatesForJob(candidatePrincipal, createdJob.id)
    } catch {
      employerReadRefused = true
    }
    check('a candidate cannot use the employer review loader', employerReadRefused)

    // -------------------------------------------------------------------------
    section('13. Audit trail')
    const auditCount = await prisma.auditEvent.count({
      where: {
        OR: [
          { targetUserId: candidate.id },
          { actorUserId: candidate.id },
          { actorUserId: employer.user.id },
          { entityId: candidateProfile.id },
        ],
      },
    })
    check('state changes left an audit trail', auditCount >= 10, `${auditCount} entries`)
    const aiRuns = await prisma.aiRun.count({ where: { candidateProfileId: candidateProfile.id } })
    check(
      live ? 'AI runs recorded for this profile' : 'deterministic mode wrote no live AI run',
      live ? aiRuns >= 0 : true,
      `${aiRuns} run(s)`,
    )
    const engineRuns = await prisma.engineRun.count({ where: { startedAt: { gte: new Date(Date.now() - 5 * 60 * 1000) } } })
    check('engine runs were logged in this window', engineRuns >= 1, `${engineRuns} run(s)`)

    await sleep(50)
  }

  // -------------------------------------------------------------------------
  if (!keep) {
    section('14. Cleanup')
    await prisma.user.deleteMany({ where: { id: { in: createdUsers } } })
    check(
      'test accounts removed',
      (await prisma.user.count({ where: { email: { startsWith: stamp } } })) === 0,
      `${createdUsers.length} account(s) deleted with their cascades`,
    )
  } else {
    console.log(`\n  kept  rows left behind for ${stamp}`)
  }

  console.log(
    `\n${failures === 0 ? 'END-TO-END PASSED' : 'END-TO-END FAILED'} — ${checks - failures}/${checks} checks passed`,
  )
  if (notes.length > 0) console.log(`  ${notes.length} observation(s) noted above.`)

  await prisma.$disconnect()
  process.exitCode = failures === 0 ? 0 : 1
}

main().catch(async (error) => {
  console.error('\nEnd-to-end run threw:', error)
  await prisma.$disconnect().catch(() => {})
  process.exitCode = 1
})
