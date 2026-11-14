import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { AccessDeniedError, assertPermission, type Principal } from '@/lib/authz'
import {
  assistantInputSchema,
  assistantOutputSchema,
  type AssistantInput,
  type AssistantOutput,
} from '@/lib/ai/schemas'
import { guardAssistant } from '@/lib/ai/guardrails'
import { agentRun, type RecordedOutcome } from '@/server/ai/runs'
import { recordAudit } from '@/server/audit'
import { getCandidateOverview } from '@/server/candidate'
import { reportingDashboard } from '@/server/admin'
import { label as enumLabel } from '@/lib/options'

/**
 * SYPRUS Sona — the assistant that answers from this account's own records.
 *
 * Three properties hold on every turn:
 * 1. The facts are read server-side, scoped to the signed-in principal, and are
 *    the only figures Sona may state. Names, email addresses and credentials
 *    never enter the prompt.
 * 2. The turn goes through the same agent pipeline as every other AI feature:
 *    rate limit, schema contract, guardrails, and a deterministic answer when
 *    the model path is unavailable. The mode that produced the reply is stored
 *    with it.
 * 3. The transcript belongs to the person who created it. Another account —
 *    including an administrator — cannot read it through these functions.
 */

const SCHEMA_VERSION = 'sona-1'

const OUTPUT_SKETCH = `{
  "answer": string (20-1200 chars, plain text, no markdown),
  "citations": string[] (ids taken from the supplied facts, empty if none were used),
  "caveats": string[] (at most 4 short honest limits),
  "followUps": string[] (at most 3 questions this person might ask next)
}`

export type SonaTurn = {
  id: string
  role: 'USER' | 'ASSISTANT'
  content: string
  createdAt: string
  mode: 'AI' | 'DETERMINISTIC' | null
  provider: string | null
  model: string | null
  fallbackReason: string | null
  citations: string[]
}

export type SonaReply = SonaTurn & { caveats: string[]; followUps: string[] }

type Context = { facts: AssistantInput['facts']; limits: string[] }

async function candidateContext(principal: Principal): Promise<Context> {
  assertPermission(principal, 'candidate.profile.read')
  if (!principal.candidateProfileId) throw new AccessDeniedError('No candidate profile is attached to this account.')
  const overview = await getCandidateOverview(principal.userId)
  if (!overview) throw new AccessDeniedError('No candidate profile is attached to this account.')

  const { profile, checklist, applicationTotal, consent } = overview
  const facts: AssistantInput['facts'] = []

  facts.push({
    id: 'completion',
    label: 'Profile completion',
    value: `${checklist.percent}% — ${checklist.items.filter((item) => !item.done).length} of ${checklist.items.length} steps outstanding${
      checklist.items.filter((item) => !item.done).length
        ? ` (${checklist.items.filter((item) => !item.done).map((item) => item.label).join(', ')})`
        : ''
    }`,
  })

  const evidenced = profile.skills.filter((skill) => skill.evidenceCount > 0).length
  const inferred = profile.skills.filter((skill) => skill.validationStatus === 'RULE_INFERRED').length
  facts.push({
    id: 'skills',
    label: 'Skills on file',
    value: `${profile.skills.length} total, ${evidenced} with evidence, ${inferred} suggested from own wording`,
  })

  for (const match of profile.matches.slice(0, 3)) {
    const missing = ((match.explanation as { missingRequired?: string[] }).missingRequired ?? []).slice(0, 3).join(', ')
    facts.push({
      id: `match:${match.job.id}`,
      label: `Closest role: ${match.job.title}`,
      value: `${Math.round(match.score * 100)}% match${missing ? `, missing ${missing}` : ', no required skill missing'}`,
    })
  }

  const byStatus = profile.applications.reduce<Record<string, number>>((accumulator, application) => {
    accumulator[application.status] = (accumulator[application.status] ?? 0) + 1
    return accumulator
  }, {})
  facts.push({
    id: 'applications',
    label: 'Applications',
    value: applicationTotal
      ? `${applicationTotal} on record: ${Object.entries(byStatus)
          .map(([status, count]) => `${enumLabel(status)} ${count}`)
          .join(', ')}`
      : 'none submitted yet',
  })

  const plan = profile.learningPlans[0]
  facts.push({
    id: 'pathway',
    label: 'Learning pathway',
    value: plan
      ? `${plan.title}: ${plan.items.filter((item) => item.status === 'COMPLETED').length}/${plan.items.length} steps done`
      : 'no active plan built yet',
  })

  const report = profile.gapReports[0]
  facts.push({
    id: 'readiness',
    label: 'Latest readiness report',
    value: report ? `${enumLabel(report.readiness)} at ${Math.round(report.readinessScore * 100)}%` : 'not generated yet',
  })

  facts.push({
    id: 'consent:sharing',
    label: 'Anonymised employer sharing',
    value: consent.get('ANONYMIZED_PROFILE_SHARING')?.granted ? 'on' : 'off',
  })
  facts.push({
    id: 'consent:inference',
    label: 'Skill-inference consent',
    value: consent.get('RULE_BASED_INFERENCE')?.granted ? 'on' : 'off',
  })

  return {
    facts: facts.slice(0, 24),
    limits: [
      'Career-break length and reason are deliberately absent from these facts and are never inputs to matching.',
      'Sona cannot read employer internal notes, other candidates, or any live labour-market feed.',
      'Sona cannot change records; it can only point at the screen that does.',
    ],
  }
}

async function employerContext(principal: Principal): Promise<Context> {
  assertPermission(principal, 'employer.job.read')
  if (!principal.organizationId) throw new AccessDeniedError('No organisation is attached to this account.')
  const organizationId = principal.organizationId

  const [roles, applications, shortlist, disclosures, openReviews, organization] = await Promise.all([
    prisma.job.groupBy({ by: ['status'], where: { organizationId }, _count: { _all: true } }),
    prisma.application.groupBy({ by: ['status'], where: { job: { organizationId } }, _count: { _all: true } }),
    prisma.shortlistEntry.count({ where: { job: { organizationId } } }),
    prisma.identityDisclosureRequest.count({ where: { organizationId, status: 'PENDING' } }),
    prisma.reviewTask.count({ where: { organizationId, status: 'OPEN' } }),
    prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true, verificationStatus: true } }),
  ])

  const roleTotal = roles.reduce((total, row) => total + row._count._all, 0)
  const applicationTotal = applications.reduce((total, row) => total + row._count._all, 0)

  return {
    facts: [
      {
        id: 'org',
        label: 'Organisation',
        value: `${organization?.name ?? 'unnamed'} — verification ${enumLabel(organization?.verificationStatus ?? 'UNVERIFIED')}`,
      },
      {
        id: 'roles',
        label: 'Roles',
        value: roleTotal
          ? `${roleTotal} total: ${roles.map((row) => `${enumLabel(row.status)} ${row._count._all}`).join(', ')}`
          : 'none created yet',
      },
      {
        id: 'applications',
        label: 'Applications across your roles',
        value: applicationTotal
          ? `${applicationTotal}: ${applications.map((row) => `${enumLabel(row.status)} ${row._count._all}`).join(', ')}`
          : 'none yet',
      },
      { id: 'shortlist', label: 'Shortlisted profiles', value: `${shortlist}` },
      { id: 'disclosures', label: 'Identity requests awaiting your decision', value: `${disclosures}` },
      { id: 'reviews', label: 'Open review tasks about your roles', value: `${openReviews}` },
    ].slice(0, 24),
    limits: [
      'Candidate identities stay withheld until the candidate consents; Sona was not given any name, email or profile text.',
      'Scores are the deterministic weighted-skill calculation, not a prediction of performance.',
      'Sona cannot publish, moderate or shortlist anything; it points at the screen that does.',
    ],
  }
}

async function adminContext(principal: Principal): Promise<Context> {
  assertPermission(principal, 'admin.reporting.read')
  const report = await reportingDashboard(principal)
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const [runs, aiRuns, fallbackRuns, openReviews, pendingModeration, activeWeights] = await Promise.all([
    prisma.aiRun.count({ where: { startedAt: { gte: since } } }),
    prisma.aiRun.count({ where: { startedAt: { gte: since }, mode: 'AI' } }),
    prisma.aiRun.count({ where: { startedAt: { gte: since }, status: 'FALLBACK' } }),
    prisma.reviewTask.count({ where: { status: 'OPEN' } }),
    prisma.job.count({ where: { status: 'PENDING_MODERATION' } }),
    prisma.weightProfile.findFirst({ where: { active: true }, select: { version: true } }),
  ])

  return {
    facts: [
      {
        id: 'totals',
        label: 'Stored records',
        value: `${report.totals.candidates + report.totals.employers + report.totals.admins} accounts, ${report.totals.organisations} organisations (${report.totals.verifiedOrganisations} verified), ${report.totals.publishedJobs} published roles, ${report.totals.applications} applications, ${report.totals.matches} stored match scores`,
      },
      {
        id: 'ai-24h',
        label: 'Agent runs in the last 24 hours',
        value: `${runs} total — ${aiRuns} answered by a model, ${fallbackRuns} fell back to the rule engines`,
      },
      { id: 'queue:review', label: 'Open human review tasks', value: `${openReviews}` },
      { id: 'queue:moderation', label: 'Roles awaiting moderation', value: `${pendingModeration}` },
      {
        id: 'weights',
        label: 'Active scoring weights',
        value: activeWeights ? `version ${activeWeights.version}` : 'no active weight profile recorded',
      },
    ].slice(0, 24),
    limits: [
      'These are counts from this database only; there is no live labour-market feed and no placement outcome is recorded.',
      'Candidate transcripts, consent decisions and personal contact details were not supplied to Sona.',
      'Fairness figures are measured on stored scores and are never proof of absence of bias.',
    ],
  }
}

/**
 * The answer Sona gives when no model path produced one. Built from the same
 * facts, so the fallback is a real answer rather than an apology.
 */
export function deterministicAssistant(input: AssistantInput): AssistantOutput {
  const headline = input.facts.slice(0, 4)
  const lines = headline.map((fact) => `${fact.label}: ${fact.value}`)
  const answer = lines.length
    ? `From what is stored on your account right now — ${lines.join('. ')}. I answered this directly from your records because the language-model path was unavailable, so nothing here is a model's interpretation.`
    : 'There are no stored records for this account yet, so there is nothing for me to answer from. Start with the guided onboarding for a candidate account, or create a role for an employer account.'
  return {
    answer,
    citations: headline.map((fact) => fact.id),
    caveats: [
      'Sona is an automated assistant. It reads only the records stored on this account, and its wording is not a verification, an assessment result, or a hiring decision.',
      ...input.limits.slice(0, 2),
    ].slice(0, 4),
    followUps: input.facts.length
      ? ['Which of my skills is closest to the role I want?', 'What is still missing from my profile?', 'How is my match score calculated?']
      : ['How does onboarding work?', 'What evidence should I add?'],
  }
}

async function ensureSession(principal: Principal) {
  const existing = await prisma.assistantSession.findFirst({
    where: { userId: principal.userId },
    orderBy: { lastMessageAt: 'desc' },
  })
  if (existing) return existing
  return prisma.assistantSession.create({
    data: { userId: principal.userId, role: principal.role },
  })
}

export async function sonaTranscript(principal: Principal): Promise<SonaTurn[]> {
  const session = await prisma.assistantSession.findFirst({
    where: { userId: principal.userId },
    orderBy: { lastMessageAt: 'desc' },
  })
  if (!session) return []
  const messages = await prisma.assistantMessage.findMany({
    where: { sessionId: session.id },
    orderBy: { createdAt: 'asc' },
    take: 60,
  })
  return messages.map(toTurn)
}

function toTurn(message: {
  id: string
  role: string
  content: string
  createdAt: Date
  mode: 'AI' | 'DETERMINISTIC' | null
  provider: string | null
  model: string | null
  fallbackReason: string | null
  citations: unknown
}): SonaTurn {
  return {
    id: message.id,
    role: message.role === 'USER' ? 'USER' : 'ASSISTANT',
    content: message.content,
    createdAt: message.createdAt.toISOString(),
    mode: message.mode,
    provider: message.provider,
    model: message.model,
    fallbackReason: message.fallbackReason,
    citations: Array.isArray(message.citations) ? (message.citations as string[]) : [],
  }
}

export type SonaAskResult = {
  reply: SonaReply
  transcript: SonaTurn[]
  /** True when the answer came from a model rather than the deterministic path. */
  usedModel: boolean
}

export async function askSona(principal: Principal, question: string): Promise<SonaAskResult> {
  const context =
    principal.role === 'CANDIDATE'
      ? await candidateContext(principal)
      : principal.role === 'EMPLOYER'
        ? await employerContext(principal)
        : await adminContext(principal)

  const session = await ensureSession(principal)

  const previous = await prisma.assistantMessage.findMany({
    where: { sessionId: session.id },
    orderBy: { createdAt: 'desc' },
    take: 8,
  })

  const input = assistantInputSchema.parse({
    role: principal.role,
    question,
    history: previous
      .reverse()
      .map((message) => ({ role: message.role === 'USER' ? 'USER' : 'ASSISTANT', content: message.content })),
    facts: context.facts,
    limits: context.limits,
  }) satisfies AssistantInput

  const outcome: RecordedOutcome<AssistantOutput> = await agentRun<AssistantInput, AssistantOutput>(
    {
      agent: 'ASSISTANT_CHAT',
      subjectKey: principal.userId,
      input,
      contract: assistantOutputSchema as never,
      contractSketch: OUTPUT_SKETCH,
      schemaVersion: SCHEMA_VERSION,
      guard: (raw, value) => guardAssistant(raw, value),
      deterministic: deterministicAssistant,
    },
    {
      userId: principal.userId,
      candidateProfileId: principal.candidateProfileId ?? null,
      organizationId: principal.organizationId ?? null,
    },
    {
      inputSummary: { facts: input.facts.length, history: input.history.length, questionLength: input.question.length },
      outputSummary: (output) => ({ citations: output.citations.length, characters: output.answer.length }),
    },
  )

  const now = new Date()
  const [assistantMessage] = await prisma.$transaction([
    prisma.assistantMessage.create({
      data: {
        sessionId: session.id,
        role: 'ASSISTANT',
        content: outcome.output.answer,
        mode: outcome.mode,
        provider: outcome.provider,
        model: outcome.model,
        fallbackReason: outcome.fallbackReason,
        citations: outcome.output.citations as unknown as Prisma.InputJsonValue,
        aiRunId: outcome.aiRunId,
        createdAt: new Date(now.getTime() + 1),
      },
    }),
    prisma.assistantMessage.create({
      data: { sessionId: session.id, role: 'USER', content: input.question, createdAt: now },
    }),
    prisma.assistantSession.update({ where: { id: session.id }, data: { lastMessageAt: now } }),
  ])

  await recordAudit({
    actor: principal,
    action: 'sona.ask',
    entityType: 'assistant_sessions',
    entityId: session.id,
    targetUserId: principal.userId,
    // The person's own transcript is visible to them, not to the whole platform.
    visibility: 'USER',
    metadata: { mode: outcome.mode, provider: outcome.provider, citations: outcome.output.citations.length },
  })

  const transcript = await sonaTranscript(principal)
  return {
    reply: {
      ...toTurn(assistantMessage),
      caveats: outcome.output.caveats,
      followUps: outcome.output.followUps,
    },
    transcript,
    usedModel: outcome.mode === 'AI',
  }
}

export async function clearSonaTranscript(principal: Principal) {
  const sessions = await prisma.assistantSession.findMany({ where: { userId: principal.userId }, select: { id: true } })
  if (sessions.length === 0) return { cleared: 0 }
  await prisma.assistantSession.deleteMany({ where: { id: { in: sessions.map((row) => row.id) } } })
  await recordAudit({
    actor: principal,
    action: 'sona.clear',
    entityType: 'assistant_sessions',
    entityId: null,
    targetUserId: principal.userId,
    visibility: 'USER',
    metadata: { sessions: sessions.length },
  })
  return { cleared: sessions.length }
}

/** Suggested opening questions, per role, so the panel is never a blank void. */
export function sonaStarters(role: Principal['role']) {
  if (role === 'CANDIDATE') {
    return [
      'What is still missing from my profile?',
      'Which role am I closest to, and why?',
      'How is my match score calculated?',
      'What can employers see about me right now?',
    ]
  }
  if (role === 'EMPLOYER') {
    return [
      'How many applicants are waiting on a decision?',
      'Which of my roles is closest to being published?',
      'What can I see about a candidate before they consent?',
    ]
  }
  return [
    'What is in the review queue right now?',
    'How many agent runs fell back in the last day?',
    'Which organisations are still unverified?',
  ]
}
