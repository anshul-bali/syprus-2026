/**
 * Provider boundary. Every agent talks to this interface only, so a live LLM,
 * the deterministic rule engines and a test fixture are interchangeable.
 */

export type ProviderMessage = { role: 'system' | 'user' | 'assistant'; content: string }

export type ProviderRequest = {
  /** Stable identifier for logs and audit; not a prompt secret. */
  agent: string
  messages: ProviderMessage[]
  /** JSON Schema the caller expects. Injected into the prompt, and used to validate the reply. */
  outputContract: string
  temperature: number
  maxTokens: number
  timeoutMs: number
  /** Transport-level attempts beyond the first. The caller owns this budget. */
  maxRetries: number
  signal?: AbortSignal
  /** Passed on retry so the model can fix a schema violation instead of guessing again. */
  repairOf?: string
}

export type ProviderUsage = {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  reasoningTokens?: number
}

export type ProviderResult = {
  /** Parsed JSON object as returned by the model. Not yet validated against the agent schema. */
  json: unknown
  rawText: string
  model: string
  provider: string
  usage: ProviderUsage
  latencyMs: number
  finishReason: string
  attempts: number
}

export interface AiProvider {
  readonly name: string
  readonly model: string
  /** True when calling this provider performs outbound network I/O. */
  readonly live: boolean
  complete(request: ProviderRequest): Promise<ProviderResult>
}

export class ProviderError extends Error {
  readonly category: 'unavailable' | 'timeout' | 'rate-limit' | 'schema' | 'refused' | 'disabled'
  readonly retryable: boolean
  readonly status?: number
  readonly retryAfterMs?: number

  constructor(
    category: ProviderError['category'],
    message: string,
    options: { retryable?: boolean; status?: number; retryAfterMs?: number; cause?: unknown } = {},
  ) {
    super(message)
    this.name = 'ProviderError'
    this.category = category
    this.retryable = options.retryable ?? false
    this.status = options.status
    this.retryAfterMs = options.retryAfterMs
    if (options.cause !== undefined) (this as { cause?: unknown }).cause = options.cause
  }
}

export function isProviderError(error: unknown): error is ProviderError {
  return error instanceof ProviderError
}

/** Reason a run fell back. Recorded verbatim so the admin screen can explain itself. */
export type FallbackReason =
  | 'provider-disabled'
  | 'provider-not-configured'
  | 'provider-unavailable'
  | 'provider-timeout'
  | 'provider-rate-limit'
  | 'provider-schema-violation'
  | 'guardrail-rejected'
  | 'daily-budget-exhausted'

export function describeFallback(reason: FallbackReason) {
  switch (reason) {
    case 'provider-disabled':
      return 'The live provider is switched off, so the deterministic rule engine produced this result.'
    case 'provider-not-configured':
      return 'No AI credential is configured, so the deterministic rule engine produced this result.'
    case 'provider-unavailable':
      return 'The provider could not be reached after the configured retries, so the deterministic rule engine produced this result.'
    case 'provider-timeout':
      return 'The provider exceeded its timeout, so the deterministic rule engine produced this result.'
    case 'provider-rate-limit':
      return 'The provider rate limit was hit, so the deterministic rule engine produced this result.'
    case 'provider-schema-violation':
      return 'The provider returned output that failed its schema contract, so the deterministic rule engine produced this result.'
    case 'guardrail-rejected':
      return 'The provider output was rejected by the guardrails (unknown skills, unquoted evidence or disallowed inference), so the deterministic rule engine produced this result.'
    case 'daily-budget-exhausted':
      return 'The configured daily token budget is spent, so the deterministic rule engine produced this result.'
  }
}
