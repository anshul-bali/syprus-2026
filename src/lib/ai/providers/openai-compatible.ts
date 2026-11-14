import { aiConfig, endpointIsAllowed, providerNameForBaseUrl, type AiEndpoint } from '../config'
import {
  ProviderError,
  type AiProvider,
  type ProviderRequest,
  type ProviderResult,
  type ProviderUsage,
} from '../provider'

/**
 * OpenAI-compatible chat-completions adapter.
 *
 * Verified against `POST {base}/chat/completions` with
 * `response_format: { type: "json_object" }`. The endpoint descriptor comes from
 * `config.ts`, which only ever builds one for a host on the allow list, so a key
 * cannot be sent anywhere it was not configured for.
 */

type ChatCompletionResponse = {
  model?: string
  choices?: { message?: { content?: string | null }; finish_reason?: string }[]
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
    completion_tokens_details?: { reasoning_tokens?: number }
  }
  error?: { message?: string; type?: string; code?: string }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Equal jitter avoids a retry stampede when several agents fail together. */
function backoffMs(attempt: number, retryAfterMs?: number) {
  if (retryAfterMs && retryAfterMs > 0) return Math.min(retryAfterMs, 30_000)
  const base = Math.min(8000, 500 * 2 ** attempt)
  return Math.round(base / 2 + Math.random() * (base / 2))
}

function retryAfterMs(response: Response): number | undefined {
  const header = response.headers.get('retry-after')
  if (!header) return undefined
  const seconds = Number(header)
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000
  const date = Date.parse(header)
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now())
}

function classifyStatus(status: number, body: ChatCompletionResponse, retryAfter?: number): ProviderError {
  const message = `Provider responded ${status}.`
  if (status === 429) return new ProviderError('rate-limit', message, { retryable: true, status, retryAfterMs: retryAfter })
  if (status === 401 || status === 403) {
    // A rejected credential is a configuration problem; retrying wastes budget.
    return new ProviderError('unavailable', `Provider credential rejected (${status}). Check AI_API_KEY.`, {
      retryable: false,
      status,
    })
  }
  if (status === 404) {
    return new ProviderError('unavailable', `${message} Verify AI_MODEL is available to this key.`, {
      retryable: false,
      status,
    })
  }
  if (status === 400) {
    // Groq returns 400 json_validate_failed when the model cannot satisfy JSON mode.
    const schemaish = body.error?.code === 'json_validate_failed'
    return new ProviderError(schemaish ? 'schema' : 'unavailable', message, {
      retryable: true,
      status,
      retryAfterMs: retryAfter,
    })
  }
  return new ProviderError('unavailable', message, {
    retryable: status >= 500 || status === 408,
    status,
    retryAfterMs: retryAfter,
  })
}

function parseJsonObject(text: string): unknown {
  const trimmed = text.trim()
  // Some gateways wrap JSON in a fence even in json_object mode.
  const unfenced = trimmed.startsWith('```')
    ? trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
    : trimmed
  const start = unfenced.indexOf('{')
  const end = unfenced.lastIndexOf('}')
  if (start === -1 || end <= start) {
    throw new ProviderError('schema', 'Provider returned no JSON object.', { retryable: true })
  }
  try {
    return JSON.parse(unfenced.slice(start, end + 1))
  } catch (error) {
    throw new ProviderError('schema', 'Provider returned malformed JSON.', { retryable: true, cause: error })
  }
}

export function createOpenAiCompatibleProvider(endpoint?: AiEndpoint): AiProvider {
  const config = aiConfig()
  const target: AiEndpoint = endpoint ?? {
    name: providerNameForBaseUrl(config.baseUrl) ?? 'primary',
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    model: config.model,
    tokensPerMinute: config.tokensPerMinute,
    jsonMode: true,
  }

  return {
    name: target.name,
    model: target.model,
    live: true,

    async complete(request: ProviderRequest): Promise<ProviderResult> {
      if (!endpointIsAllowed(target.name, target.baseUrl)) {
        throw new ProviderError('disabled', 'Provider endpoint is not approved for this credential.', { retryable: false })
      }
      if (!target.apiKey) {
        throw new ProviderError('disabled', `${target.name}: no credential configured.`, { retryable: false })
      }

      const url = `${target.baseUrl}/chat/completions`
      const startedAt = Date.now()
      const maxAttempts = Math.max(0, request.maxRetries)

      for (let attempt = 0; ; attempt++) {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), request.timeoutMs)
        const relay = () => controller.abort()
        const outer = request.signal
        if (outer) {
          if (outer.aborted) controller.abort()
          else outer.addEventListener('abort', relay, { once: true })
        }

        try {
          const response = await fetch(url, {
            method: 'POST',
            redirect: 'error',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${target.apiKey}` },
            body: JSON.stringify({
              model: target.model,
              temperature: request.temperature,
              max_tokens: request.maxTokens,
              ...(target.jsonMode ? { response_format: { type: 'json_object' } } : {}),
              messages: request.messages.map(({ role, content }) => ({ role, content })),
            }),
            signal: controller.signal,
          })

          const text = await response.text()
          if (!response.ok) {
            let body: ChatCompletionResponse = {}
            try {
              body = JSON.parse(text) as ChatCompletionResponse
            } catch {
              // Non-JSON error body: the status code is still enough to classify.
            }
            throw classifyStatus(response.status, body, retryAfterMs(response))
          }

          let body: ChatCompletionResponse
          try {
            body = JSON.parse(text) as ChatCompletionResponse
          } catch (error) {
            throw new ProviderError('schema', 'Provider returned a non-JSON body.', {
              retryable: true,
              cause: error,
            })
          }

          const content = body.choices?.[0]?.message?.content
          if (!content) {
            throw new ProviderError('schema', 'Provider returned an empty completion.', { retryable: true })
          }

          const finishReason = body.choices?.[0]?.finish_reason ?? 'unknown'
          // Truncated output is recoverable by asking for more room, so treat it
          // as a schema failure rather than a mystery parse error downstream.
          if (finishReason === 'length') {
            throw new ProviderError('schema', 'Provider output was truncated at max_tokens.', { retryable: true })
          }

          const usage = body.usage ?? {}
          return {
            json: parseJsonObject(content),
            rawText: content,
            model: body.model ?? target.model,
            provider: target.name,
            usage: {
              promptTokens: usage.prompt_tokens ?? 0,
              completionTokens: usage.completion_tokens ?? 0,
              totalTokens: usage.total_tokens ?? 0,
              reasoningTokens: usage.completion_tokens_details?.reasoning_tokens,
            } satisfies ProviderUsage,
            latencyMs: Date.now() - startedAt,
            finishReason,
            attempts: attempt + 1,
          }
        } catch (error) {
          const providerError =
            error instanceof ProviderError
              ? error
              : error instanceof Error && error.name === 'AbortError'
                ? new ProviderError('timeout', `Provider exceeded ${request.timeoutMs}ms.`, { retryable: true })
                : new ProviderError('unavailable', 'Provider network request failed.', { retryable: true })

          // A caller-supplied abort is deliberate: surface it, never retry.
          if (outer?.aborted) {
            throw new ProviderError('timeout', 'Provider request was cancelled by the caller.', { retryable: false })
          }
          // A 429 on a tokens-per-minute allowance does not clear because we
          // retried three more times, and Groq often omits Retry-After. Back off
          // once if a delay was signalled, otherwise fall back immediately.
          const rateLimited = providerError.category === 'rate-limit'
          const retryAfter = providerError.retryAfterMs
          const canRetry =
            providerError.retryable &&
            attempt < maxAttempts &&
            (!rateLimited || (retryAfter != null && retryAfter <= 30_000))

          if (canRetry) {
            await sleep(backoffMs(attempt, retryAfter))
            continue
          }
          throw providerError
        } finally {
          clearTimeout(timer)
          if (outer) outer.removeEventListener('abort', relay)
        }
      }
    },
  }
}
