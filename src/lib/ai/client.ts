import { z } from 'zod'
import { aiConfig, type AiConfig } from './config'
import { buildMessages, repairMessages, PROMPT_VERSION, type PromptAgent } from './prompts'
import {
  isProviderError,
  ProviderError,
  describeFallback,
  type AiProvider,
  type FallbackReason,
  type ProviderMessage,
  type ProviderUsage,
} from './provider'
import { GuardrailViolation, type BlockedItem } from './guardrails'
import {
  acquireRequest,
  estimateTokens,
  RateLimitExceeded,
  recordTokenUsage,
  tryReserveTokens,
} from './rate-limit'

/**
 * The single entry point every agent uses.
 *
 * Order of operations is the safety property: rate limit, live call, schema
 * validation with one repair retry, guardrails, then — only if any of those fail
 * — the deterministic rule engine. A caller always learns which path produced the
 * answer, so AI-inferred output can never be mistaken for a verified one.
 */

export type AgentOutcome<TOutput> = {
  output: TOutput
  mode: 'AI' | 'DETERMINISTIC'
  agent: PromptAgent
  provider: string
  model: string
  promptVersion: string
  schemaVersion: string
  fallbackReason: FallbackReason | null
  fallbackNote: string | null
  /** Verbatim provider failure, when one caused the fallback. Never a secret. */
  providerError: string | null
  blocked: BlockedItem[]
  warnings: BlockedItem[]
  usage: ProviderUsage
  latencyMs: number
  attempts: number
}

export type AgentCall<TInput, TOutput> = {
  agent: PromptAgent
  /** Stable subject key for rate limiting; a user id, never written to logs. */
  subjectKey: string
  input: TInput
  contract: z.ZodType<TOutput>
  /**
   * Short shape description sent to the model. Server-side validation always
   * uses `contract`; sending the full JSON Schema would cost thousands of
   * reasoning tokens that some models then spend before answering at all.
   */
  contractSketch?: string
  schemaVersion: string
  guard: (raw: unknown, input: TInput) => { output: TOutput; blocked: BlockedItem[]; warnings: BlockedItem[] }
  deterministic: (input: TInput) => TOutput
  provider?: AiProvider
  config?: AiConfig
}

function contractFor<TOutput>(schema: z.ZodType<TOutput>, sketch?: string): string {
  if (sketch) return sketch
  try {
    return JSON.stringify(z.toJSONSchema(schema, { io: 'output' }))
  } catch {
    return 'A JSON object with exactly the keys described in the task instructions.'
  }
}

function issueLines(error: z.ZodError): string[] {
  return error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
}

export async function runAgent<TInput, TOutput>(call: AgentCall<TInput, TOutput>): Promise<AgentOutcome<TOutput>> {
  const config = call.config ?? aiConfig()
  const startedAt = Date.now()
  const emptyUsage: ProviderUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }

  const finishDeterministic = (
    reason: FallbackReason,
    blocked: BlockedItem[] = [],
    warnings: BlockedItem[] = [],
    usage = emptyUsage,
    attempts = 0,
    providerError: string | null = null,
  ): AgentOutcome<TOutput> => ({
    output: call.deterministic(call.input),
    mode: 'DETERMINISTIC',
    agent: call.agent,
    provider: 'deterministic-rule-engines',
    model: 'rules',
    promptVersion: PROMPT_VERSION,
    schemaVersion: call.schemaVersion,
    fallbackReason: reason,
    fallbackNote: describeFallback(reason),
    providerError,
    blocked,
    warnings,
    usage,
    latencyMs: Date.now() - startedAt,
    attempts,
  })

  if (!config.enabled || config.provider === 'disabled') {
    return finishDeterministic(config.apiKey ? 'provider-disabled' : 'provider-not-configured')
  }
  // No credential anywhere in the chain: nothing is allowed to make a request.
  if (!config.liveAvailable) return finishDeterministic('provider-not-configured')

  const provider = call.provider
  // A chain is acceptable even when the primary alone is unconfigured, as long
  // as an allow-listed failover holds a credential. An empty chain throws
  // `disabled`, which is recorded as provider-not-configured below.
  if (!provider) return finishDeterministic('provider-not-configured')

  try {
    acquireRequest(`${call.agent}:${call.subjectKey}`, config)
  } catch (error) {
    if (error instanceof RateLimitExceeded) return finishDeterministic('provider-rate-limit')
    throw error
  }

  const contract = contractFor(call.contract, call.contractSketch)
  const payload = call.input
  let messages: ProviderMessage[] = buildMessages(call.agent, payload, contract)

  // The daily budget is a whole-platform guard. The per-minute token window is
  // reserved inside the provider chain, because each endpoint has its own.
  if (!tryReserveTokens(estimateTokens(messages), config)) {
    return finishDeterministic('daily-budget-exhausted')
  }

  const totalUsage: ProviderUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
  const blocked: BlockedItem[] = []
  const warnings: BlockedItem[] = []
  let attempts = 0

  for (let pass = 0; pass <= 1; pass++) {
    attempts++
    let result
    try {
      result = await provider.complete({
        agent: call.agent,
        messages,
        outputContract: contract,
        temperature: config.temperature,
        maxTokens: config.maxTokens,
        timeoutMs: config.timeoutMs,
        maxRetries: config.maxRetries,
      })
    } catch (error) {
      if (error instanceof ProviderError) {
        const reason: FallbackReason =
          error.category === 'timeout'
            ? 'provider-timeout'
            : error.category === 'rate-limit'
              ? 'provider-rate-limit'
              : error.category === 'schema'
                ? 'provider-schema-violation'
                : error.category === 'disabled'
                  ? 'provider-not-configured'
                  : 'provider-unavailable'
        return finishDeterministic(reason, blocked, warnings, totalUsage, attempts, error.message)
      }
      return finishDeterministic('provider-unavailable', blocked, warnings, totalUsage, attempts, String(error))
    }

    totalUsage.promptTokens += result.usage.promptTokens
    totalUsage.completionTokens += result.usage.completionTokens
    totalUsage.totalTokens += result.usage.totalTokens
    recordTokenUsage(result.usage.totalTokens)

    const parsed = call.contract.safeParse(result.json)
    if (!parsed.success) {
      const issues = issueLines(parsed.error)
      if (pass === 0) {
        // One repair attempt, quoting the exact failures back to the model.
        messages = repairMessages(messages, issues, result.rawText)
        continue
      }
      return finishDeterministic('provider-schema-violation', blocked, warnings, totalUsage, attempts)
    }

    try {
      const guarded = call.guard(parsed.data, call.input)
      blocked.push(...guarded.blocked)
      warnings.push(...guarded.warnings)
      return {
        output: guarded.output,
        mode: 'AI',
        agent: call.agent,
        provider: result.provider,
        model: result.model,
        promptVersion: PROMPT_VERSION,
        schemaVersion: call.schemaVersion,
        fallbackReason: null,
        fallbackNote: null,
        providerError: null,
        blocked: guarded.blocked,
        warnings: guarded.warnings,
        usage: totalUsage,
        latencyMs: Date.now() - startedAt,
        attempts,
      }
    } catch (error) {
      if (error instanceof GuardrailViolation) {
        blocked.push({ rule: error.rule, detail: error.detail })
        return finishDeterministic('guardrail-rejected', blocked, warnings, totalUsage, attempts, error.detail)
      }
      if (error instanceof z.ZodError) {
        if (pass === 0) {
          messages = repairMessages(messages, issueLines(error), result.rawText)
          continue
        }
        return finishDeterministic('provider-schema-violation', blocked, warnings, totalUsage, attempts)
      }
      throw error
    }
  }

  return finishDeterministic('provider-schema-violation', blocked, warnings, totalUsage, attempts)
}

export function isProviderErrorValue(error: unknown): error is ProviderError {
  return isProviderError(error)
}
