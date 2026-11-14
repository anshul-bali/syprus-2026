import { describe, it, expect } from './harness'
import { runAgent } from '../src/lib/ai/client'
import type { AiConfig } from '../src/lib/ai/config'
import { createFixtureProvider, failWith, sequence } from '../src/lib/ai/providers/fixture'
import { resetRateLimitState } from '../src/lib/ai/rate-limit'
import { buildMessages } from '../src/lib/ai/prompts'
import { GuardrailViolation, guardAssistant } from '../src/lib/ai/guardrails'
import { assistantInputSchema, assistantOutputSchema, type AssistantInput } from '../src/lib/ai/schemas'
import { deterministicAssistant, sonaStarters } from '../src/server/ai/assistant'

/**
 * SYPRUS Sona — the assistant's contract, guardrails and fallback.
 *
 * Nothing here reaches the network or the database: the provider is scripted and
 * the assertions are about the promises the product makes on screen — answers
 * traceable to stored records, no invented figures, no overstated claims, and a
 * real answer when the model path is unavailable.
 */

const config: AiConfig = {
  enabled: true,
  provider: 'openai-compatible',
  baseUrl: 'https://openrouter.ai/api/v1',
  apiKey: 'test-key-not-secret',
  model: 'fixture-model',
  temperature: 0,
  maxTokens: 900,
  timeoutMs: 5000,
  maxRetries: 1,
  rateLimitPerMinute: 1000,
  tokensPerMinute: 1_000_000,
  dailyTokenBudget: 10_000_000,
  liveAvailable: true,
}

const facts = [
  { id: 'completion', label: 'Profile completion', value: '67% — 3 of 9 steps outstanding (Write your summary, Add your location, Attach evidence to three skills)' },
  { id: 'skills', label: 'Skills on file', value: '13 total, 9 with evidence, 7 suggested from own wording' },
  { id: 'match:job-1', label: 'Closest role: Operations Coordinator', value: '83% match, missing Budgeting' },
]

function input(overrides: Partial<AssistantInput> = {}): AssistantInput {
  return assistantInputSchema.parse({
    role: 'CANDIDATE',
    question: 'What is still missing before I can apply?',
    history: [],
    facts,
    limits: ['Career-break length is not included in these facts.'],
    ...overrides,
  })
}

describe('sona guardrails', () => {
  it('keeps a grounded answer and always states the honesty caveat', () => {
    const result = guardAssistant(
      {
        answer: 'Three steps are outstanding: your summary, your location and evidence on three skills.',
        citations: ['completion'],
        caveats: [],
        followUps: ['Which role am I closest to?'],
      },
      input(),
    )

    expect.equal(result.blocked.length, 0, 'nothing should be blocked')
    expect.equal(result.output.citations[0], 'completion')
    expect.includes(result.output.caveats, result.output.caveats[0])
    expect.true(result.output.caveats[0].includes('automated assistant'), 'the standard caveat is prepended')
  })

  it('drops a citation that was never supplied, instead of trusting it', () => {
    const result = guardAssistant(
      {
        answer: 'Your closest role needs budgeting, which you have not shown yet.',
        citations: ['match:job-1', 'secret-salary-data'],
        caveats: [],
        followUps: [],
      },
      input(),
    )

    expect.equal(result.output.citations.length, 1, 'the invented id is removed')
    expect.equal(result.output.citations[0], 'match:job-1')
    expect.equal(result.blocked[0]?.rule, 'unknown-citation')
  })

  it('refuses a figure that is not in this account’s records', () => {
    expect.throws(
      () =>
        guardAssistant(
          {
            answer: 'You are in the top 4% of candidates for this role, with an average salary of 95000.',
            citations: ['skills'],
            caveats: [],
            followUps: [],
          },
          input(),
        ),
      /not present in this account/,
      'an invented statistic must not reach the user',
    )
  })

  it('refuses verification and placement claims', () => {
    for (const answer of [
      'Your budgeting skill is verified by employers now.',
      'Applying means you will be hired within weeks.',
    ]) {
      expect.throws(
        () => guardAssistant({ answer, citations: ['skills'], caveats: [], followUps: [] }, input()),
        /does not claim/,
        `expected refusal for: ${answer}`,
      )
    }
  })

  it('refuses to attribute a protected characteristic, but may explain the exclusion', () => {
    expect.throws(
      () =>
        guardAssistant(
          { answer: 'Because you are married, the model suggests part-time roles.', citations: [], caveats: [], followUps: [] },
          input(),
        ),
      /protected characteristic/,
    )

    const allowed = guardAssistant(
      { answer: 'Matching does not read age, marital status or your break length — those fields are excluded inputs.', citations: [], caveats: [], followUps: [] },
      input(),
    )
    expect.true(allowed.output.answer.includes('excluded inputs'), 'an honest explanation is kept')
  })
})

describe('sona deterministic answer', () => {
  it('answers from the facts when no model is available', () => {
    const output = deterministicAssistant(input())
    expect.true(output.answer.includes('Profile completion'), 'the answer quotes real records')
    expect.equal(output.citations[0], 'completion')
    expect.true(output.answer.includes('model path was unavailable'), 'it says which engine answered')
    expect.true(output.caveats[0].includes('automated assistant'))
  })

  it('says what to do first when the account has no records', () => {
    const output = deterministicAssistant(input({ facts: [] }))
    expect.true(output.answer.includes('no stored records'), 'it admits there is nothing to read')
    expect.true(output.answer.toLowerCase().includes('onboarding'), 'and names the next step')
    expect.length(output.followUps, 2)
  })

  it('produces output that satisfies the model contract', () => {
    const parsed = assistantOutputSchema.safeParse(deterministicAssistant(input()))
    expect.true(parsed.success, 'fallback output is contract-shaped')
  })
})

describe('sona through the agent pipeline', () => {
  it('records the model that answered', async () => {
    resetRateLimitState()
    const provider = createFixtureProvider({
      replies: {
        ASSISTANT_CHAT: {
          answer: 'Three steps are outstanding: your summary, your location and evidence on three skills.',
          citations: ['completion'],
          caveats: [],
          followUps: ['What evidence should I attach?'],
        },
      },
    })

    const outcome = await runAgent({
      agent: 'ASSISTANT_CHAT',
      subjectKey: 'user-sona-1',
      input: input(),
      contract: assistantOutputSchema,
      schemaVersion: 'sona-1',
      guard: (raw, value) => guardAssistant(raw, value),
      deterministic: deterministicAssistant,
      provider,
      config,
    })

    expect.equal(outcome.mode, 'AI')
    expect.equal(outcome.provider, 'fixture')
    expect.equal(outcome.fallbackReason, null)
    expect.true(outcome.output.caveats[0].includes('automated assistant'))
  })

  it('falls back to the record reader when the provider rate-limits', async () => {
    resetRateLimitState()
    const provider = createFixtureProvider({ replies: { ASSISTANT_CHAT: failWith('rate-limit') } })

    const outcome = await runAgent({
      agent: 'ASSISTANT_CHAT',
      subjectKey: 'user-sona-2',
      input: input(),
      contract: assistantOutputSchema,
      schemaVersion: 'sona-1',
      guard: (raw, value) => guardAssistant(raw, value),
      deterministic: deterministicAssistant,
      provider,
      config,
    })

    expect.equal(outcome.mode, 'DETERMINISTIC', 'the user still gets an answer')
    expect.equal(outcome.fallbackReason, 'provider-rate-limit')
    expect.true(outcome.output.answer.includes('Skills on file'), 'the fallback quotes stored facts')
  })

  it('repairs a malformed reply once before giving up on the model', async () => {
    resetRateLimitState()
    const provider = createFixtureProvider({
      replies: {
        ASSISTANT_CHAT: sequence([
          'not json at all',
          {
            answer: 'Your closest scored role is Operations Coordinator at 83%, missing Budgeting.',
            citations: ['match:job-1'],
            caveats: [],
            followUps: [],
          },
        ]),
      },
    })

    const outcome = await runAgent({
      agent: 'ASSISTANT_CHAT',
      subjectKey: 'user-sona-3',
      input: input(),
      contract: assistantOutputSchema,
      schemaVersion: 'sona-1',
      guard: (raw, value) => guardAssistant(raw, value),
      deterministic: deterministicAssistant,
      provider,
      config,
    })

    expect.equal(outcome.mode, 'AI', 'the repair retry produced a usable answer')
    expect.equal(outcome.attempts >= 2, true, 'a retry actually happened')
  })

  it('refuses the whole turn when a guardrail throws', async () => {
    resetRateLimitState()
    const provider = createFixtureProvider({
      replies: {
        ASSISTANT_CHAT: {
          answer: 'Your skills are verified by employers and you will be hired.',
          citations: ['skills'],
          caveats: [],
          followUps: [],
        },
      },
    })

    const outcome = await runAgent({
      agent: 'ASSISTANT_CHAT',
      subjectKey: 'user-sona-4',
      input: input(),
      contract: assistantOutputSchema,
      schemaVersion: 'sona-1',
      guard: (raw, value) => guardAssistant(raw, value),
      deterministic: deterministicAssistant,
      provider,
      config,
    })

    expect.equal(outcome.mode, 'DETERMINISTIC', 'an overstated model reply is never shown')
    expect.equal(outcome.fallbackReason, 'guardrail-rejected')
    expect.false(outcome.output.answer.includes('verified by employers'))
  })
})

describe('sona prompts and starters', () => {
  it('sends the citation rule and the contract to the model', () => {
    const messages = buildMessages('ASSISTANT_CHAT', input(), 'CONTRACT')
    expect.equal(messages.length, 2)
    expect.true(messages[0].content.includes('citations'), 'the system prompt states the citation rule')
    expect.true(messages[0].content.includes('CONTRACT'), 'and the response contract')
    expect.true(messages[1].content.includes('Profile completion'), 'the facts travel in the user payload')
  })

  it('offers different opening questions per role', () => {
    const candidate = sonaStarters('CANDIDATE')
    const employer = sonaStarters('EMPLOYER')
    const admin = sonaStarters('ADMIN')
    expect.true(candidate.some((entry) => entry.includes('profile')))
    expect.true(employer.some((entry) => entry.includes('applicants')))
    expect.true(admin.some((entry) => entry.includes('review queue')))
    expect.notEqual(candidate[0], employer[0])
  })

  it('is registered as a guardrail failure type rather than a silent pass', () => {
    let caught: unknown
    try {
      guardAssistant({ answer: 'Your skill is independently verified.', citations: [], caveats: [], followUps: [] }, input())
    } catch (error) {
      caught = error
    }
    expect.true(caught instanceof GuardrailViolation, 'guardrails raise a typed violation')
  })
})
