import { describe, it, expect } from './harness'
import { createFailoverProvider, describeChain } from '../src/lib/ai/providers/failover'
import {
  ProviderError,
  type AiProvider,
  type ProviderRequest,
  type ProviderResult,
} from '../src/lib/ai/provider'
import { acquireTokenBudget, resetRateLimitState } from '../src/lib/ai/rate-limit'
import { runAgent } from '../src/lib/ai/client'
import type { AiConfig } from '../src/lib/ai/config'
import { z } from 'zod'

/**
 * Provider failover. The behaviour that matters is attribution: which endpoint
 * answered, and that a failure on the primary is reported as a failover rather
 * than silently becoming a Groq result or a rule-engine fallback.
 */

type Outcome = 'ok' | 'rate-limit' | 'timeout' | 'unavailable' | 'schema' | 'disabled'

const OUTCOME_ERROR: Record<Exclude<Outcome, 'ok'>, ProviderError['category']> = {
  'rate-limit': 'rate-limit',
  timeout: 'timeout',
  unavailable: 'unavailable',
  schema: 'schema',
  disabled: 'disabled',
}

function stub(name: string, outcome: Outcome, model = 'stub-model'): AiProvider & { calls: number } {
  const provider = {
    name,
    model,
    live: true,
    calls: 0,

    async complete(_request: ProviderRequest): Promise<ProviderResult> {
      provider.calls += 1
      if (outcome !== 'ok') {
        throw new ProviderError(OUTCOME_ERROR[outcome], `${name} scripted ${outcome}`, {
          retryable: outcome !== 'disabled',
          status: outcome === 'rate-limit' ? 429 : undefined,
        })
      }
      return {
        json: { answer: 'from ' + name },
        rawText: '{"answer":"from ' + name + '"}',
        model,
        provider: name,
        usage: { promptTokens: 40, completionTokens: 10, totalTokens: 50 },
        latencyMs: 2,
        finishReason: 'stop',
        attempts: 1,
      }
    },
  }
  return provider
}

function request(overrides: Partial<ProviderRequest> = {}): ProviderRequest {
  return {
    agent: 'SKILLS_DISCOVERY',
    messages: [{ role: 'user', content: 'hello' }],
    outputContract: '{}',
    temperature: 0,
    maxTokens: 200,
    timeoutMs: 5000,
    maxRetries: 0,
    ...overrides,
  }
}

describe('provider failover chain', () => {
  it('answers from the primary and never touches the failover', async () => {
    resetRateLimitState()
    const primary = stub('groq', 'ok', 'openai/gpt-oss-120b')
    const secondary = stub('openrouter', 'ok')
    const chain = createFailoverProvider({ providers: [primary, secondary] })

    const result = await chain.complete(request())

    expect.equal(result.provider, 'groq', 'primary answered')
    expect.equal(secondary.calls, 0, 'failover was not called')
    expect.equal(chain.attempts.length, 1)
    expect.equal(chain.attempts[0].outcome, 'SUCCESS')
  })

  it('moves to the next endpoint when the primary is rate-limited', async () => {
    resetRateLimitState()
    const primary = stub('groq', 'rate-limit')
    const secondary = stub('openrouter', 'ok')
    const trace: string[] = []
    const chain = createFailoverProvider({
      providers: [primary, secondary],
      onAttempt: (attempt) => trace.push(`${attempt.provider}:${attempt.outcome}`),
    })

    const result = await chain.complete(request())

    expect.equal(result.provider, 'openrouter', 'the failover served the answer')
    expect.equal(primary.calls, 1, 'the primary was tried once')
    expect.equal(secondary.calls, 1)
    expect.equal(trace.join(' '), 'groq:FAILED openrouter:SUCCESS', 'the trace is ordered and complete')
  })

  it('keeps moving through every configured endpoint', async () => {
    resetRateLimitState()
    const a = stub('groq', 'timeout')
    const b = stub('openrouter', 'unavailable')
    const c = stub('gemini', 'ok')
    const chain = createFailoverProvider({ providers: [a, b, c] })

    const result = await chain.complete(request())

    expect.equal(result.provider, 'gemini')
    expect.equal(chain.attempts.filter((attempt) => attempt.outcome === 'FAILED').length, 2)
    expect.true(
      chain.attempts[1].detail.includes('unavailable'),
      'each attempt keeps its own reason rather than collapsing into one',
    )
  })

  it('does not fail over when an endpoint is not configured at all', async () => {
    resetRateLimitState()
    const a = stub('groq', 'disabled')
    const b = stub('openrouter', 'ok')
    const chain = createFailoverProvider({ providers: [a, b] })

    await expect.throws(() => chain.complete(request()), /no credential|disabled/)
    expect.equal(b.calls, 0, 'a missing credential is a configuration fault, not a traffic problem')
  })

  it('throws when every endpoint failed, naming those endpoints', async () => {
    resetRateLimitState()
    const a = stub('groq', 'rate-limit')
    const b = stub('openrouter', 'schema')
    const chain = createFailoverProvider({ providers: [a, b] })

    const error = (await expect.throws(() => chain.complete(request()), /groq/)) as ProviderError & {
      providerName?: string
    }
    expect.true(error instanceof ProviderError, 'typed provider error, not a string')
    expect.true((error.providerName ?? '').includes('openrouter'), 'the error names every endpoint it tried')
  })

  it('reports no-endpoint configuration as disabled rather than trying the network', async () => {
    resetRateLimitState()
    const chain = createFailoverProvider({ providers: [] })
    await expect.throws(() => chain.complete(request()), /No allow-listed AI endpoint/)
  })

  it('skips an endpoint whose token window is already full', async () => {
    resetRateLimitState()
    const primary = stub('groq', 'ok')
    const secondary = stub('gemini', 'ok')
    acquireTokenBudget('groq:stub-model', 10, 10)
    const chain = createFailoverProvider({
      providers: [primary, secondary],
      windows: [10, 100_000],
    })

    const result = await chain.complete(request())

    expect.equal(primary.calls, 0, 'the window was checked before sending')
    expect.equal(result.provider, 'gemini')
    expect.equal(
      chain.attempts.some((attempt) => attempt.outcome === 'SKIPPED_WINDOW_FULL'),
      true,
      'a skipped endpoint is recorded as skipped, not failed',
    )
  })

  it('describes the chain without credentials for the admin screen', () => {
    const listed = describeChain([
      {
        name: 'groq',
        baseUrl: 'https://api.groq.com/openai/v1',
        apiKey: 'secret-value',
        model: 'openai/gpt-oss-120b',
        tokensPerMinute: 8000,
        jsonMode: true,
      },
      {
        name: 'gemini',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
        apiKey: undefined,
        model: 'models/gemini-flash-lite-latest',
        tokensPerMinute: 100000,
        jsonMode: true,
      },
    ])

    expect.equal(listed.length, 2)
    expect.equal(listed[0].host, 'api.groq.com')
    expect.equal(JSON.stringify(listed).includes('secret-value'), false, 'no credential in the description')
  })
})

const answerSchema = z.object({ answer: z.string() })

describe('agent outcomes through the chain', () => {
  const config: AiConfig = {
    enabled: true,
    provider: 'openai-compatible',
    baseUrl: 'https://api.groq.com/openai/v1',
    apiKey: 'test-key',
    model: 'openai/gpt-oss-120b',
    temperature: 0,
    maxTokens: 200,
    timeoutMs: 5000,
    maxRetries: 0,
    rateLimitPerMinute: 60,
    tokensPerMinute: 1_000_000,
    dailyTokenBudget: 10_000_000,
    liveAvailable: true,
  }

  function call(provider: AiProvider) {
    return runAgent<{ text: string }, { answer: string }>({
      agent: 'SKILLS_DISCOVERY',
      subjectKey: 'failover-test',
      input: { text: 'a phrase' },
      contract: answerSchema,
      contractSketch: '{"answer": string}',
      schemaVersion: 'test',
      guard: (raw) => ({ output: raw as { answer: string }, blocked: [], warnings: [] }),
      deterministic: () => ({ answer: 'from the rule engine' }),
      provider,
      config,
    })
  }

  it('records the failover endpoint as the one that answered', async () => {
    resetRateLimitState()
    const chain = createFailoverProvider({ providers: [stub('groq', 'rate-limit'), stub('openrouter', 'ok')] })

    const outcome = await call(chain)

    expect.equal(outcome.mode, 'AI')
    expect.equal(outcome.provider, 'openrouter', 'the audit row will say who served it')
    expect.equal(outcome.fallbackReason, null)
    expect.equal(outcome.usage.totalTokens, 50)
  })

  it('falls back to the rule engine only after the whole chain failed', async () => {
    resetRateLimitState()
    const chain = createFailoverProvider({ providers: [stub('groq', 'rate-limit'), stub('openrouter', 'timeout')] })

    const outcome = await call(chain)

    expect.equal(outcome.mode, 'DETERMINISTIC')
    expect.equal(outcome.provider, 'deterministic-rule-engines')
    expect.true(outcome.fallbackReason === 'provider-rate-limit' || outcome.fallbackReason === 'provider-timeout')
    expect.true(
      outcome.providerError !== null && /groq|openrouter/.test(outcome.providerError),
      'the stored reason names the endpoints that failed',
    )
  })

  it('never sends a request when no endpoint is live', async () => {
    resetRateLimitState()
    const chain = createFailoverProvider({ providers: [] })

    const outcome = await call(chain)

    expect.equal(outcome.mode, 'DETERMINISTIC')
    expect.equal(outcome.fallbackReason, 'provider-not-configured')
  })
})
