import { ProviderError, type AiProvider, type ProviderRequest, type ProviderResult } from '../provider'

/**
 * Scripted provider for tests.
 *
 * Every scenario the guardrails are meant to survive can be replayed without a
 * network call or a credential: valid replies, malformed JSON, hallucinated
 * identifiers, invented evidence, unsafe inference and transport failures.
 */

export type FixtureReply = unknown | (() => never)

/** Wraps a per-call script so it cannot be confused with an array reply value. */
export type FixtureSequence = { sequence: unknown[] }

export function sequence(replies: unknown[]): FixtureSequence {
  return { sequence: replies }
}

function isSequence(value: unknown): value is FixtureSequence {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && Array.isArray((value as FixtureSequence).sequence)
}

export type FixtureOptions = {
  /**
   * Replies by agent name. A single value is reused on every call; a `sequence`
   * is consumed one entry per call, which is how the schema-repair path is
   * tested. A function entry throws, simulating a transport or provider fault.
   */
  replies: Record<string, FixtureReply | FixtureSequence>
  model?: string
  latencyMs?: number
  tokensPerCall?: number
}

export function createFixtureProvider(options: FixtureOptions): AiProvider & {
  calls: ProviderRequest[]
} {
  const calls: ProviderRequest[] = []
  const cursor = new Map<string, number>()

  const provider = {
    name: 'fixture',
    model: options.model ?? 'fixture-model',
    live: false,
    calls,

    async complete(request: ProviderRequest): Promise<ProviderResult> {
      calls.push(request)
      const configured = options.replies[request.agent]
      const index = cursor.get(request.agent) ?? 0
      cursor.set(request.agent, index + 1)

      const reply = isSequence(configured)
        ? (configured.sequence[index] ?? configured.sequence[configured.sequence.length - 1])
        : configured

      if (typeof reply === 'function') {
        // A throwing fixture stands in for a transport or provider fault.
        reply()
        throw new ProviderError('unavailable', 'Fixture exhausted its scripted reply.', { retryable: false })
      }

      const tokens = options.tokensPerCall ?? 120
      return {
        json: reply ?? {},
        rawText: JSON.stringify(reply ?? {}),
        model: provider.model,
        provider: 'fixture',
        usage: {
          promptTokens: tokens,
          completionTokens: tokens,
          totalTokens: tokens * 2,
        },
        latencyMs: options.latencyMs ?? 1,
        finishReason: 'stop',
        attempts: 1,
      }
    },
  }

  return provider
}

/** Throws a ProviderError of the given category when called. */
export function failWith(category: ProviderError['category'], message = 'scripted failure'): () => never {
  return () => {
    throw new ProviderError(category, message, { retryable: category !== 'disabled' })
  }
}

/** Returns text that is not JSON, to exercise the schema-repair path. */
export function malformedJson(): FixtureReply {
  return () => {
    throw new ProviderError('schema', 'Provider returned malformed JSON.', { retryable: true })
  }
}
