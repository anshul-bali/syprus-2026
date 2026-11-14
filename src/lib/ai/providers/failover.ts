import { aiEndpoints, type AiEndpoint } from '../config'
import {
  ProviderError,
  type AiProvider,
  type ProviderRequest,
  type ProviderResult,
} from '../provider'
import { acquireTokenBudget, estimateTokens, RateLimitExceeded } from '../rate-limit'
import { createOpenAiCompatibleProvider } from './openai-compatible'

/**
 * Ordered provider chain.
 *
 * Groq is the configured primary. If it is rate-limited, timed out, unreachable
 * or returns output its own contract rejects, the request is offered to the next
 * allow-listed endpoint before the agent falls back to the rule engines. The
 * endpoint that answers is the one recorded in `ai_runs.provider`, so a
 * failover is visible in the audit trail rather than disguised as Groq.
 *
 * Tokens-per-minute is reserved per endpoint here, because each provider has its
 * own window — spending Groq's allowance must not stop a configured failover.
 */

export type ChainAttempt = {
  provider: string
  model: string
  outcome: 'SUCCESS' | 'FAILED' | 'SKIPPED_WINDOW_FULL'
  detail: string
}

type EndpointError = ProviderError & { providerName?: string }

/** A failover is only worth trying where the failure was transport-shaped. */
function shouldMoveOn(error: ProviderError) {
  return error.category !== 'disabled'
}

function summarise(error: ProviderError) {
  const status = error.status ? ` (${error.status})` : ''
  const text = error.message.replace(/\s+/g, ' ').trim()
  return `${error.category}${status}: ${text.slice(0, 220)}`
}

export function createFailoverProvider(options: {
  endpoints?: AiEndpoint[]
  /** Test seam: supply providers directly instead of building them from endpoints. */
  providers?: AiProvider[]
  /** Windows that pair with `providers`, index for index. */
  windows?: number[]
  onAttempt?: (attempt: ChainAttempt) => void
} = {}): AiProvider & { attempts: ChainAttempt[] } {
  const endpoints = (options.endpoints ?? aiEndpoints()).filter(
    (endpoint) => Boolean(endpoint.apiKey) && endpoint.baseUrl.startsWith('https://'),
  )
  const providers = options.providers ?? endpoints.map((endpoint) => createOpenAiCompatibleProvider(endpoint))
  const attempts: ChainAttempt[] = []
  // A provider with no configured window is treated as unlimited; the caller's
  // daily budget still applies.
  const windows = providers.map(
    (_, index) => options.windows?.[index] ?? endpoints[index]?.tokensPerMinute ?? Number.MAX_SAFE_INTEGER,
  )

  const only = providers[0]

  const chain: AiProvider & { attempts: ChainAttempt[] } = {
    name: endpoints.length > 1 ? 'provider-chain' : (endpoints[0]?.name ?? 'provider-chain'),
    model: endpoints.map((endpoint) => endpoint.model).join(' → ') || 'none-configured',
    live: providers.length > 0,
    attempts,

    async complete(request: ProviderRequest): Promise<ProviderResult> {
      if (providers.length === 0) {
        throw new ProviderError('disabled', 'No allow-listed AI endpoint is configured.', { retryable: false })
      }

      // A single endpoint keeps its exact error category, so the recorded
      // fallback reason stays as specific as it was before failover existed.
      if (providers.length === 1 && only) {
        try {
          const estimate = estimateTokens(request.messages) + request.maxTokens
          acquireTokenBudget(`${only.name}:${only.model}`, estimate, windows[0])
        } catch (error) {
          if (error instanceof RateLimitExceeded) {
            attempts.push({
              provider: only.name,
              model: only.model,
              outcome: 'SKIPPED_WINDOW_FULL',
              detail: error.message,
            })
            throw new ProviderError('rate-limit', `${only.name}: ${error.message}`, {
              retryable: true,
              retryAfterMs: error.retryAfterMs,
            })
          }
          throw error
        }
        try {
          const result = await only.complete(request)
          attempts.push({ provider: result.provider, model: result.model, outcome: 'SUCCESS', detail: '' })
          options.onAttempt?.({ provider: result.provider, model: result.model, outcome: 'SUCCESS', detail: '' })
          return result
        } catch (error) {
          if (error instanceof ProviderError) {
            attempts.push({
              provider: only.name,
              model: only.model,
              outcome: 'FAILED',
              detail: summarise(error),
            })
            const tagged: EndpointError = error
            tagged.providerName = only.name
            throw tagged
          }
          throw error
        }
      }

      let lastError: ProviderError | null = null

      for (let index = 0; index < providers.length; index++) {
        const provider = providers[index]
        const window = windows[index]

        try {
          const estimate = estimateTokens(request.messages) + request.maxTokens
          acquireTokenBudget(`${provider.name}:${provider.model}`, estimate, window)
        } catch (error) {
          if (error instanceof RateLimitExceeded) {
            attempts.push({
              provider: provider.name,
              model: provider.model,
              outcome: 'SKIPPED_WINDOW_FULL',
              detail: error.message,
            })
            options.onAttempt?.(attempts[attempts.length - 1])
            lastError = new ProviderError('rate-limit', `${provider.name}: ${error.message}`, {
              retryable: true,
              retryAfterMs: error.retryAfterMs,
            })
            continue
          }
          throw error
        }

        try {
          const result = await provider.complete(request)
          const record: ChainAttempt = {
            provider: result.provider,
            model: result.model,
            outcome: 'SUCCESS',
            detail: index > 0 ? `served after ${index} endpoint${index === 1 ? '' : 's'} failed` : '',
          }
          attempts.push(record)
          options.onAttempt?.(record)
          return result
        } catch (error) {
          if (!(error instanceof ProviderError)) throw error
          const record: ChainAttempt = {
            provider: provider.name,
            model: provider.model,
            outcome: 'FAILED',
            detail: summarise(error),
          }
          attempts.push(record)
          options.onAttempt?.(record)
          lastError = error
          if (!shouldMoveOn(error)) break
        }
      }

      if (!lastError) {
        lastError = new ProviderError('unavailable', 'Every configured AI endpoint failed.', { retryable: false })
      }
      // Report the whole chain, not just the last failure, so the stored fallback
      // reason says what each endpoint actually did.
      const summary = attempts
        .map((attempt) => `${attempt.provider}: ${attempt.outcome === 'SUCCESS' ? 'ok' : attempt.detail || attempt.outcome}`)
        .join(' · ')
      const aggregated: EndpointError = new ProviderError(
        lastError.category,
        `${providers.length} endpoint(s) tried, none answered — ${summary}`.slice(0, 900),
        { retryable: false, status: lastError.status, cause: lastError },
      )
      aggregated.providerName = attempts.map((attempt) => attempt.provider).join(',')
      return Promise.reject(aggregated)
    },
  }

  return chain
}

/** Short, credential-free description of the chain for the admin screen. */
export function describeChain(endpoints: AiEndpoint[] = aiEndpoints()) {
  return endpoints.map((endpoint) => ({
    name: endpoint.name,
    model: endpoint.model,
    host: (() => {
      try {
        return new URL(endpoint.baseUrl).host
      } catch {
        return 'invalid'
      }
    })(),
    jsonMode: endpoint.jsonMode,
  }))
}
