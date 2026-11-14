import { prisma } from '@/lib/db'
import { AccessDeniedError, assertPermission, type Principal } from '@/lib/authz'
import { CAREGIVING_ACTIVITIES } from '@/lib/taxonomy/skills'
import { inferSkills, type InferenceInput } from '@/lib/engines/inference'
import type { WorkPreference } from '@/lib/options'
import { json, nullableNumber, nullableString } from '@/server/fields'
import { recordAudit } from '@/server/audit'
import { computeMatchesForProfile } from '@/server/matching'
import { refreshEvidenceCount, recomputeYearsOfExperience } from '@/server/candidate'
import { policyVersion } from '@/lib/env'

/**
 * Conversational onboarding.
 *
 * A linear, persisted question flow. Each step writes real rows — experiences,
 * skills with evidence, profile fields or consent records — and the transcript is
 * stored in `conversations` / `messages`, so a candidate can leave and resume.
 */

export type FieldInput = 'text' | 'textarea' | 'number' | 'select' | 'multiselect' | 'consent' | 'activities'

export type FieldOption = { value: string; label: string }

export type StepField = {
  key: string
  label: string
  input: FieldInput
  options?: FieldOption[]
  required?: boolean
  help?: string
}

export type OnboardingStep = {
  key: string
  question: string
  help?: string
  fields: StepField[]
}

const WORK_PREFERENCE_OPTIONS: FieldOption[] = [
  { value: 'REMOTE', label: 'Remote' },
  { value: 'HYBRID', label: 'Hybrid' },
  { value: 'ONSITE', label: 'On-site' },
  { value: 'FLEXIBLE', label: 'Flexible hours' },
  { value: 'OPEN', label: 'Open to any' },
]

const TIMELINE_OPTIONS: FieldOption[] = [
  { value: 'now', label: 'Ready to start now' },
  { value: '1-3', label: 'Within three months' },
  { value: '3-6', label: 'In three to six months' },
  { value: 'later', label: 'Later, exploring options' },
]

const INDUSTRY_OPTIONS: FieldOption[] = [
  'Any sector',
  'Technology',
  'Banking and finance',
  'Healthcare',
  'Education',
  'Retail and e-commerce',
  'Manufacturing',
  'Non-profit and development',
  'Media and marketing',
  'Public sector',
].map((value) => ({ value, label: value }))

export const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    key: 'intro',
    question:
      'I will ask about your last role, what you have been doing since, and what you want next. I read your own words to suggest skills — you can accept, edit or remove every suggestion. May I use your answers to suggest skills?',
    help: 'Onboarding uses local keyword rules. If you later run AI discovery, matching summaries or learning agents, relevant profile text or skills may be sent to Groq and, if enabled, OpenRouter or Google as fallback. Do not include sensitive third-party details. You can decline and add skills manually.',
    fields: [
      {
        key: 'inferenceConsent',
        label: 'Use my own words to suggest skills',
        input: 'consent',
        required: true,
        help: 'You can change this any time under Privacy controls. Declining still lets you add skills yourself.',
      },
    ],
  },
  {
    key: 'break',
    question: 'How long has it been since your last paid role, and when do you want to be working again?',
    help: 'Break length is stored for your own records only. It is not an input to matching or scoring.',
    fields: [
      { key: 'months', label: 'Months since your last paid role', input: 'number', required: true },
      { key: 'timeline', label: 'Return timeline', input: 'select', options: TIMELINE_OPTIONS, required: true },
      { key: 'reason', label: 'Reason for the break (optional, private)', input: 'text' },
    ],
  },
  {
    key: 'work',
    question: 'Tell me about your most recent paid role. What was the title, and what did the work involve?',
    help: 'Plain description is fine — duties, tools, team size, anything you handled.',
    fields: [
      { key: 'title', label: 'Role title', input: 'text', required: true },
      { key: 'organization', label: 'Employer (optional)', input: 'text' },
      { key: 'years', label: 'How many years in that role?', input: 'number', required: true },
      { key: 'description', label: 'What did the work involve?', input: 'textarea', required: true },
    ],
  },
  {
    key: 'caregiving',
    question:
      'Now the part most systems ignore. During your break, which of these did you handle? Pick any that apply, then add anything I have missed.',
    help: 'Optional context can suggest transferable skills, not verified professional competence. Skip anything that does not apply.',
    fields: [
      { key: 'activities', label: 'What you handled during your break', input: 'activities' },
      { key: 'notes', label: 'Anything else worth describing', input: 'textarea' },
    ],
  },
  {
    key: 'other',
    question: 'Did you do any volunteering, freelancing, teaching or running your own work during that period?',
    help: 'Optional, but this is where a lot of transferable evidence hides.',
    fields: [
      { key: 'volunteering', label: 'Community or volunteering work', input: 'textarea' },
      { key: 'freelance', label: 'Freelance, tuition or small business', input: 'textarea' },
    ],
  },
  {
    key: 'goals',
    question: 'What are you aiming at next?',
    fields: [
      { key: 'targetRole', label: 'Target role', input: 'text', required: true },
      { key: 'targetIndustry', label: 'Target sector', input: 'select', options: INDUSTRY_OPTIONS },
      { key: 'workPreference', label: 'Work style', input: 'select', options: WORK_PREFERENCE_OPTIONS, required: true },
      { key: 'availability', label: 'Hours you can commit per week', input: 'number' },
      { key: 'city', label: 'City you are based in', input: 'text' },
    ],
  },
  {
    key: 'sharing',
    question:
      'Who should be able to see what you have built? Employers only ever see your handle, skills and durations — never your name, and never your break length.',
    help: 'You can switch this off at any time. Applying to a role is what reveals your name to that one organisation.',
    fields: [
      {
        key: 'anonymizedSharing',
        label: 'Show employers my anonymised profile',
        input: 'consent',
        required: true,
      },
      {
        key: 'employerContact',
        label: 'Let a verified employer contact me about a match',
        input: 'consent',
      },
      {
        key: 'research',
        label: 'Include my anonymised data in platform fairness reporting',
        input: 'consent',
        help: 'Used only for the aggregate monitoring an administrators see.',
      },
    ],
  },
  {
    key: 'review',
    question:
      'That is the last of it. Your skills inventory, capability graph and first set of matched roles are ready. You can correct anything the suggestions got wrong.',
    fields: [],
  },
]

export function stepByKey(key: string) {
  return ONBOARDING_STEPS.find((step) => step.key === key) ?? null
}

export function nextStepKey(key: string) {
  const index = ONBOARDING_STEPS.findIndex((step) => step.key === key)
  if (index < 0 || index >= ONBOARDING_STEPS.length - 1) return null
  return ONBOARDING_STEPS[index + 1].key
}

export async function startOrResumeConversation(principal: Principal) {
  assertPermission(principal, 'candidate.conversation.manage')
  if (!principal.candidateProfileId) throw new AccessDeniedError('No candidate profile attached to this account.')

  const active = await prisma.conversation.findFirst({
    where: { userId: principal.userId, channel: 'ONBOARDING', status: { in: ['IN_PROGRESS', 'COMPLETED'] } },
    orderBy: { startedAt: 'desc' },
    include: { messages: { orderBy: { createdAt: 'asc' } } },
  })
  if (active) return { conversation: active, step: active.status === 'COMPLETED' ? null : stepByKey(active.stepKey) ?? ONBOARDING_STEPS[0] }

  const first = ONBOARDING_STEPS[0]
  const conversation = await prisma.conversation.create({
    data: { userId: principal.userId, channel: 'ONBOARDING', stepKey: first.key, answers: {} },
  })
  const message = await prisma.message.create({
    data: {
      conversationId: conversation.id,
      role: 'ASSISTANT',
      content: first.question,
      stepKey: first.key,
    },
  })

  const created = await prisma.conversation.findUniqueOrThrow({
    where: { id: conversation.id },
    include: { messages: { orderBy: { createdAt: 'asc' } } },
  })

  return { conversation: created, step: first, firstMessage: message }
}

export type AnswerMap = Record<string, string | number | boolean | string[]>

function readableAnswer(step: OnboardingStep, answers: AnswerMap) {
  return step.fields
    .map((field) => {
      const value = answers[field.key]
      if (value === undefined || value === '' || value === null) return null
      if (field.input === 'activities' && Array.isArray(value)) {
        const labels = value
          .map((key) => CAREGIVING_ACTIVITIES.find((activity) => activity.key === key)?.label)
          .filter(Boolean)
        return labels.length ? `${field.label}: ${labels.join(', ')}` : null
      }
      if (field.input === 'consent') return `${field.label}: ${value ? 'Yes' : 'No'}`
      if (Array.isArray(value)) return `${field.label}: ${value.join(', ')}`
      return `${field.label}: ${String(value)}`
    })
    .filter(Boolean)
    .join('\n')
}

function requiredMissing(step: OnboardingStep, answers: AnswerMap) {
  return step.fields
    .filter((field) => field.required)
    .filter((field) => {
      const value = answers[field.key]
      if (field.input === 'consent') return value === undefined
      if (field.input === 'number') return value === undefined || value === '' || Number.isNaN(Number(value))
      if (Array.isArray(value)) return value.length === 0
      return value === undefined || String(value).trim() === ''
    })
    .map((field) => field.label)
}

export async function answerStep(principal: Principal, stepKey: string, answers: AnswerMap) {
  assertPermission(principal, 'candidate.conversation.manage')
  const profileId = principal.candidateProfileId
  if (!profileId) throw new AccessDeniedError('No candidate profile attached to this account.')

  const conversation = await prisma.conversation.findFirst({
    where: { userId: principal.userId, channel: 'ONBOARDING', status: 'IN_PROGRESS' },
    orderBy: { startedAt: 'desc' },
  })
  if (!conversation) throw new AccessDeniedError('Start the onboarding conversation first.')

  // Out-of-order answers are rejected rather than silently applied.
  if (conversation.stepKey !== stepKey) {
    throw new AccessDeniedError('That answer is for a different step of the conversation.')
  }

  const step = stepByKey(stepKey)
  if (!step) throw new AccessDeniedError('Unknown onboarding step.')

  const missing = requiredMissing(step, answers)
  if (missing.length > 0) {
    throw new AccessDeniedError(`Still needed: ${missing.join(', ')}.`)
  }

  const effects: string[] = []

  if (step.fields.length > 0) {
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: 'USER',
        content: readableAnswer(step, answers) || '(answered)',
        stepKey,
      },
    })
  }

  const mergedAnswers = { ...(conversation.answers as Record<string, unknown>), ...answers }
  const mergedKey = Object.keys(mergedAnswers).join(',')

  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { answers: json(mergedAnswers) },
  })

  switch (stepKey) {
    case 'intro':
      effects.push(await recordInferenceConsent(principal, Boolean(answers.inferenceConsent)))
      break
    case 'break':
      effects.push(await captureBreak(profileId, answers))
      break
    case 'work':
      effects.push(await captureWork(principal, profileId, answers, mergedAnswers as unknown as AnswerMap))
      break
    case 'caregiving':
      effects.push(await captureCaregiving(principal, profileId, answers))
      break
    case 'other':
      effects.push(...(await captureOtherExperience(principal, profileId, answers)))
      break
    case 'goals':
      effects.push(await captureGoals(profileId, answers))
      break
    case 'sharing':
      effects.push(...(await captureSharing(principal, answers)))
      break
    case 'review':
      effects.push('Onboarding marked complete.')
      break
  }

  const next = nextStepKey(stepKey)

  if (next) {
    const nextStep = stepByKey(next) as OnboardingStep
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { stepKey: next, updatedAt: new Date() },
    })
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: 'ASSISTANT',
        content: nextStep.question,
        stepKey: next,
      },
    })
  } else {
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { status: 'COMPLETED', updatedAt: new Date() },
    })
    await prisma.candidateProfile.update({
      where: { id: profileId },
      data: { onboardingComplete: true },
    })
    await computeMatchesForProfile(profileId)
  }

  await recordAudit({
    actor: principal,
    action: `candidate.onboarding.${stepKey}`,
    entityType: 'conversations',
    entityId: conversation.id,
    metadata: { effects, answeredKeys: mergedKey.split(',') },
  })

  const updated = await prisma.conversation.findUniqueOrThrow({
    where: { id: conversation.id },
    include: { messages: { orderBy: { createdAt: 'asc' } } },
  })

  return {
    conversation: updated,
    step: next ? stepByKey(next) : null,
    completed: !next,
    effects: effects.filter(Boolean),
  }
}

// ---------------------------------------------------------------------------
// Step effects — each writes real rows
// ---------------------------------------------------------------------------

async function recordInferenceConsent(principal: Principal, granted: boolean) {
  await prisma.consentRecord.create({
    data: {
      userId: principal.userId,
      type: 'RULE_BASED_INFERENCE',
      decision: granted ? 'GRANTED' : 'DECLINED',
      policyVersion: policyVersion(),
    },
  })
  return granted
    ? 'Skill suggestions enabled. I will read your wording and propose skills you can accept or remove.'
    : 'Skill suggestions are off. You can still add skills yourself at any time.'
}

async function captureWork(
  principal: Principal,
  profileId: string,
  answers: AnswerMap,
  context: AnswerMap,
) {
  const description = String(answers.description ?? '')
  const years = Math.max(0, Number(answers.years ?? 0))
  const monthsOut = Math.max(0, Number(context.months ?? 0))
  const monthMs = 30 * 24 * 60 * 60 * 1000

  const experience = await prisma.experience.create({
    data: {
      candidateProfileId: profileId,
      type: 'PAID_EMPLOYMENT',
      title: String(answers.title ?? ''),
      organization: nullableString(answers.organization ? String(answers.organization) : null),
      description,
      hoursPerWeek: 40,
      ongoing: false,
      endDate: new Date(Date.now() - monthsOut * monthMs),
      startDate: new Date(Date.now() - (monthsOut + years * 12) * monthMs),
    },
  })

  await recomputeYearsOfExperience(profileId)
  const suggested = await runInferenceFor(principal, profileId, [
    `${answers.title} ${experience.organization ?? ''} ${description}`,
  ])
  return `Saved your last role (${years} year${years === 1 ? '' : 's'}). ${suggested}`
}

async function captureCaregiving(principal: Principal, profileId: string, answers: AnswerMap) {
  const keys = Array.isArray(answers.activities) ? answers.activities : []
  const notes = nullableString(answers.notes ? String(answers.notes) : null)
  const activities = CAREGIVING_ACTIVITIES.filter((activity) => keys.includes(activity.key))

  const description = [
    ...activities.map((activity) => activity.evidence),
    notes ?? '',
  ]
    .filter(Boolean)
    .join(' ')

  const experience = await prisma.experience.create({
    data: {
      candidateProfileId: profileId,
      type: 'CAREGIVING',
      title: 'Caring and household responsibility',
      description: description || 'Caregiving period recorded during onboarding.',
      isCaregiving: true,
      ongoing: false,
    },
  })

  let created = 0
  for (const activity of activities) {
    for (const slug of activity.skillSlugs) {
      const skill = await prisma.skill.findUnique({ where: { slug }, select: { id: true, name: true } })
      if (!skill) continue

      const existing = await prisma.candidateSkill.findUnique({
        where: { candidateProfileId_skillId: { candidateProfileId: profileId, skillId: skill.id } },
      })

      const row =
        existing ??
        (await prisma.candidateSkill.create({
          data: {
            candidateProfileId: profileId,
            skillId: skill.id,
            level: 'PROFICIENT',
            confidence: 0.62,
            validationStatus: 'RULE_INFERRED',
            source: 'CAREGIVING_ACTIVITY',
            note: `Claimed from your answer: ${activity.label}.`,
          },
        }))

      await prisma.skillEvidence.create({
        data: {
          candidateSkillId: row.id,
          experienceId: experience.id,
          type: 'EXPERIENCE_DESCRIPTION',
          description: activity.evidence,
        },
      })
      await refreshEvidenceCount(row.id)
      created += 1
    }
  }

  const inferred = await runInferenceFor(principal, profileId, notes ? [notes] : [])
  return `Recorded ${activities.length} caregiving responsibility area${activities.length === 1 ? '' : 's'} as ${created} skill entries with evidence. ${inferred}`
}

async function captureOtherExperience(principal: Principal, profileId: string, answers: AnswerMap) {
  const effects: string[] = []

  const volunteering = nullableString(answers.volunteering ? String(answers.volunteering) : null)
  if (volunteering) {
    await prisma.experience.create({
      data: {
        candidateProfileId: profileId,
        type: 'VOLUNTEERING',
        title: 'Community or volunteering work',
        description: volunteering,
        ongoing: false,
      },
    })
    effects.push(`Saved your volunteering entry. ${await runInferenceFor(principal, profileId, [volunteering])}`)
  }

  const freelance = nullableString(answers.freelance ? String(answers.freelance) : null)
  if (freelance) {
    await prisma.experience.create({
      data: {
        candidateProfileId: profileId,
        type: 'FREELANCE',
        title: 'Freelance or self-employed work',
        description: freelance,
        ongoing: false,
      },
    })
    effects.push(`Saved your freelance entry. ${await runInferenceFor(principal, profileId, [freelance])}`)
  }

  if (effects.length === 0) effects.push('Nothing added for this step — you can fill it in later.')
  return effects
}

async function captureBreak(profileId: string, answers: AnswerMap) {
  const months = Number(answers.months ?? 0)
  await prisma.candidateProfile.update({
    where: { id: profileId },
    data: {
      careerBreakMonths: Number.isNaN(months) ? null : Math.max(0, Math.round(months)),
      returnTimeline: nullableString(answers.timeline ? String(answers.timeline) : null),
      breakReason: nullableString(answers.reason ? String(answers.reason) : null),
    },
  })
  return 'Break period recorded privately. It is not used in matching or ranking.'
}

async function captureGoals(profileId: string, answers: AnswerMap) {
  await prisma.candidateProfile.update({
    where: { id: profileId },
    data: {
      targetRole: nullableString(answers.targetRole ? String(answers.targetRole) : null),
      targetIndustry: nullableString(answers.targetIndustry ? String(answers.targetIndustry) : null),
      workPreference: (answers.workPreference ? String(answers.workPreference) : 'OPEN') as WorkPreference,
      availabilityHours: nullableNumber(answers.availability ? Number(answers.availability) : null),
      locationCity: nullableString(answers.city ? String(answers.city) : null),
    },
  })
  return 'Goals saved. Recommendations and gap reports use these.'
}

async function captureSharing(principal: Principal, answers: AnswerMap) {
  const anonymized = Boolean(answers.anonymizedSharing)
  const contact = Boolean(answers.employerContact)
  const research = Boolean(answers.research)

  const records = [
    { type: 'ANONYMIZED_PROFILE_SHARING' as const, granted: anonymized },
    { type: 'EMPLOYER_CONTACT' as const, granted: contact },
    { type: 'RESEARCH_CONTRIBUTION' as const, granted: research },
  ]

  for (const record of records) {
    await prisma.consentRecord.create({
      data: {
        userId: principal.userId,
        type: record.type,
        decision: record.granted ? 'GRANTED' : 'DECLINED',
        policyVersion: policyVersion(),
      },
    })
  }

  await prisma.candidateProfile.update({
    where: { userId: principal.userId },
    data: {
      visibleToEmployers: anonymized,
      sharingMode: anonymized ? 'ANONYMOUS_WITH_APPLY' : 'NOT_VISIBLE',
    },
  })

  return [
    anonymized
      ? 'Your anonymised profile is now discoverable by verified employers.'
      : 'Your profile stays hidden from employers until you switch sharing on.',
    contact ? 'Employers may contact you about matches.' : 'No employer contact.',
    research ? 'Included in aggregate fairness reporting.' : 'Excluded from fairness reporting.',
  ]
}

/** Runs the keyword engine over free text captured during the conversation. */
async function runInferenceFor(principal: Principal, profileId: string, texts: string[]) {
  const consent = await prisma.consentRecord.findFirst({
    where: { userId: principal.userId, type: 'RULE_BASED_INFERENCE', policyVersion: policyVersion() },
    orderBy: { decidedAt: 'desc' },
    select: { decision: true },
  })
  if (consent?.decision !== 'GRANTED') return 'Suggestions skipped: inference consent is off.'

  const usable = texts.filter((text) => text.trim().length > 12)
  if (usable.length === 0) return ''

  const catalog = await prisma.skill.findMany({
    select: { id: true, slug: true, name: true, category: true, transferable: true, aliases: true },
  })

  const inputs: InferenceInput[] = usable.map((text) => ({ text, context: 'WORK' }))
  const hits = inferSkills(
    inputs,
    catalog.map((skill) => ({
      slug: skill.slug,
      name: skill.name,
      category: skill.category,
      transferable: skill.transferable,
      aliases: skill.aliases,
    })),
  )

  let added = 0
  for (const hit of hits.slice(0, 8)) {
    const skill = catalog.find((entry) => entry.slug === hit.slug)
    if (!skill) continue
    const existing = await prisma.candidateSkill.findUnique({
      where: { candidateProfileId_skillId: { candidateProfileId: profileId, skillId: skill.id } },
    })
    if (existing) continue

    const created = await prisma.candidateSkill.create({
      data: {
        candidateProfileId: profileId,
        skillId: skill.id,
        level: hit.level,
        confidence: hit.confidence,
        validationStatus: 'RULE_INFERRED',
        source: 'INFERENCE',
        note: `Matched “${hit.phrases.slice(0, 2).join('”, “')}” in your own words.`,
      },
    })
    await prisma.skillEvidence.create({
      data: {
        candidateSkillId: created.id,
        type: 'ONBOARDING_ANSWER',
        description: `Suggested because your answer used ${hit.phrases.slice(0, 3).join(', ')}.`,
      },
    })
    await refreshEvidenceCount(created.id)
    added += 1
  }

  return added > 0 ? `I suggested ${added} skill${added === 1 ? '' : 's'} from your wording — check them on Skills.` : 'No new skills suggested from that answer.'
}

export async function conversationTranscript(principal: Principal) {
  assertPermission(principal, 'candidate.conversation.manage')
  return prisma.conversation.findFirst({
    where: { userId: principal.userId, channel: 'ONBOARDING' },
    orderBy: { startedAt: 'desc' },
    include: { messages: { orderBy: { createdAt: 'asc' } } },
  })
}
