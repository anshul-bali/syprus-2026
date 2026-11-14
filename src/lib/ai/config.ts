import { z } from 'zod'

/**
 * Server-side AI configuration. Read only from process.env — never bundled to
 * the client, never logged with the key. Nothing in this file performs I/O.
 */

const aiEnvSchema = z.object({
  AI_ENABLED: z.enum(['true', 'false']).default('true'),
  AI_PROVIDER: z.enum(['openai-compatible', 'deterministic', 'disabled']).default('openai-compatible'),
  AI_BASE_URL: z.string().url().default('https://api.groq.com/openai/v1'),
  AI_API_KEY: z.preprocess((value) => typeof value === 'string' && !value.trim() ? undefined : value, z.string().min(8).optional()),
  AI_MODEL: z.string().min(1).default('openai/gpt-oss-120b'),
  AI_TEMPERATURE: z.coerce.number().min(0).max(1).default(0),
  AI_MAX_TOKENS: z.coerce.number().int().min(256).max(8000).default(1600),
  AI_TIMEOUT_MS: z.coerce.number().int().min(2000).max(120000).default(20000),
  AI_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(3),
  AI_RATE_LIMIT_PER_MIN: z.coerce.number().int().min(1).max(600).default(30),
  /**
   * Tokens-per-minute allowance for the *primary* endpoint (Groq allows 8,000 on
   * this organisation's chat models; the OpenRouter and Google slots are far
   * larger). Reserving against that window, rather than a request count, is what
   * actually prevents hammering a 429. Failover slots carry their own value.
   */
  AI_TOKENS_PER_MINUTE: z.coerce.number().int().min(1000).default(8000),
  AI_BUDGET_TOKENS_PER_DAY: z.coerce.number().int().min(1000).default(200000),
})

export type AiConfig = {
  enabled: boolean
  provider: 'openai-compatible' | 'deterministic' | 'disabled'
  baseUrl: string
  apiKey: string | undefined
  model: string
  temperature: number
  maxTokens: number
  timeoutMs: number
  maxRetries: number
  rateLimitPerMinute: number
  tokensPerMinute: number
  dailyTokenBudget: number
  /** True only when a live provider is both enabled and credentialed. */
  liveAvailable: boolean
}

/**
 * Hosts a credential may be sent to. Which one is *primary* is an operator
 * choice (`AI_BASE_URL` in the `AI_*` block); the others are failover and are
 * read from their own `*_API_KEY`. A base URL outside this list is dropped
 * rather than called, so a mis-set variable cannot ship an API key to an
 * unrelated host, and one key can never be sent to another provider's host.
 */
export const ALLOWED_AI_HOSTS = [
  'api.groq.com',
  'openrouter.ai',
  'generativelanguage.googleapis.com',
] as const

const PROVIDER_BASES: Record<string, string> = {
  groq: 'https://api.groq.com/openai/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
}

/** Which approved provider a base URL belongs to, or undefined for an unknown host. */
export function providerNameForBaseUrl(baseUrl: string): string | undefined {
  try {
    const normalised = baseUrl.replace(/\/+$/, '')
    return Object.keys(PROVIDER_BASES).find((name) => PROVIDER_BASES[name] === normalised)
  } catch {
    return undefined
  }
}

export function endpointIsAllowed(name: string, baseUrl: string) {
  try {
    const url = new URL(baseUrl)
    return !url.username && !url.password && !url.search && !url.hash &&
      url.href.replace(/\/+$/, '') === PROVIDER_BASES[name]
  } catch {
    return false
  }
}

let cached: AiConfig | undefined

export function aiConfig(): AiConfig {
  if (cached) return cached

  const parsed = aiEnvSchema.safeParse({
    AI_ENABLED: process.env.AI_ENABLED,
    AI_PROVIDER: process.env.AI_PROVIDER,
    AI_BASE_URL: process.env.AI_BASE_URL,
    AI_API_KEY: process.env.AI_API_KEY,
    AI_MODEL: process.env.AI_MODEL,
    AI_TEMPERATURE: process.env.AI_TEMPERATURE,
    AI_MAX_TOKENS: process.env.AI_MAX_TOKENS,
    AI_TIMEOUT_MS: process.env.AI_TIMEOUT_MS,
    AI_MAX_RETRIES: process.env.AI_MAX_RETRIES,
    AI_RATE_LIMIT_PER_MIN: process.env.AI_RATE_LIMIT_PER_MIN,
    AI_TOKENS_PER_MINUTE: process.env.AI_TOKENS_PER_MINUTE,
    AI_BUDGET_TOKENS_PER_DAY: process.env.AI_BUDGET_TOKENS_PER_DAY,
  })

  if (!parsed.success) {
    // A misconfigured AI block must not take the app down: fall back to the
    // deterministic provider and report the reason through health.
    return {
      enabled: false,
      provider: 'deterministic',
      baseUrl: '',
      apiKey: undefined,
      model: 'deterministic-fallback',
      temperature: 0,
      maxTokens: 0,
      timeoutMs: 0,
      maxRetries: 0,
      rateLimitPerMinute: 0,
      tokensPerMinute: 0,
      dailyTokenBudget: 0,
      liveAvailable: false,
    }
  }

  const value = parsed.data
  const wantsLive = value.AI_ENABLED === 'true' && value.AI_PROVIDER === 'openai-compatible'
  const primaryName = providerNameForBaseUrl(value.AI_BASE_URL)
  const primaryReady = Boolean(value.AI_API_KEY) && primaryName !== undefined && endpointIsAllowed(primaryName, value.AI_BASE_URL)

  cached = {
    enabled: value.AI_ENABLED === 'true',
    provider: value.AI_PROVIDER,
    baseUrl: value.AI_BASE_URL.replace(/\/+$/, ''),
    apiKey: value.AI_API_KEY,
    model: value.AI_MODEL,
    temperature: value.AI_TEMPERATURE,
    maxTokens: value.AI_MAX_TOKENS,
    timeoutMs: value.AI_TIMEOUT_MS,
    maxRetries: value.AI_MAX_RETRIES,
    rateLimitPerMinute: value.AI_RATE_LIMIT_PER_MIN,
    tokensPerMinute: value.AI_TOKENS_PER_MINUTE,
    dailyTokenBudget: value.AI_BUDGET_TOKENS_PER_DAY,
    // True when at least one allow-listed endpoint can serve: the primary, or a
    // configured failover. The chain itself is built by `aiEndpoints()`.
    liveAvailable: wantsLive && (primaryReady || hasFailoverCredential()),
  }
  return cached
}

/** Reset the memoised config. Used by tests. */
export function resetAiConfig() {
  cached = undefined
  endpointsCached = undefined
}

// ---------------------------------------------------------------------------
// Provider chain: Groq first, then any configured failover
// ---------------------------------------------------------------------------

export type AiEndpoint = {
  /** Recorded in `ai_runs.provider`, so an audit can say who actually answered. */
  name: string
  baseUrl: string
  apiKey: string | undefined
  model: string
  tokensPerMinute: number
  /** Some gateways reject `response_format`; those endpoints answer on prompt alone. */
  jsonMode: boolean
}

/**
 * Non-primary slots. Each provider keeps its own credential variables, so the
 * operator can promote any one of them to primary in the `AI_*` block without
 * moving secrets, and the others still serve as failover.
 */
const FAILOVER_SLOTS = [
  { name: 'groq', keyVar: 'GROQ_API_KEY', modelVar: 'GROQ_MODEL', baseVar: 'GROQ_BASE_URL', model: 'openai/gpt-oss-120b', tokensPerMinute: 8_000 },
  { name: 'openrouter', keyVar: 'OPENROUTER_API_KEY', modelVar: 'OPENROUTER_MODEL', baseVar: 'OPENROUTER_BASE_URL', model: 'google/gemini-2.5-flash-lite', tokensPerMinute: 200_000 },
  { name: 'gemini', keyVar: 'GEMINI_API_KEY', modelVar: 'GEMINI_MODEL', baseVar: 'GEMINI_BASE_URL', model: 'models/gemini-flash-lite-latest', tokensPerMinute: 100_000 },
] as const

let endpointsCached: AiEndpoint[] | undefined

/** The provider named by the primary `AI_BASE_URL`, when it is an approved host. */
function primaryProviderName() {
  return providerNameForBaseUrl(aiConfig().baseUrl)
}

function slotBaseUrl(slot: { name: string; baseVar: string }) {
  return (process.env[slot.baseVar]?.trim() || PROVIDER_BASES[slot.name]).replace(/\/+$/, '')
}

function slotReady(slot: { name: string; keyVar: string }, baseUrl: string) {
  return Boolean(process.env[slot.keyVar]?.trim()) && endpointIsAllowed(slot.name, baseUrl)
}

/** True when any non-primary approved slot holds a credential. */
function hasFailoverCredential() {
  if (process.env.AI_FAILOVER_ENABLED === 'false') return false
  const primary = primaryProviderName()
  return FAILOVER_SLOTS.some((slot) => slot.name !== primary && slotReady(slot, slotBaseUrl(slot)))
}

/**
 * Ordered list of live endpoints: the configured primary first, then every other
 * approved provider that holds a credential. A slot without a credential, or on
 * a host that is not its own, is skipped and never attempted.
 */
export function aiEndpoints(): AiEndpoint[] {
  if (endpointsCached) return endpointsCached
  const config = aiConfig()
  const list: AiEndpoint[] = []

  if (!config.liveAvailable) return []
  const primary = providerNameForBaseUrl(config.baseUrl)
  if (config.apiKey && primary && endpointIsAllowed(primary, config.baseUrl)) {
    list.push({
      name: primary,
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      model: config.model,
      tokensPerMinute: config.tokensPerMinute,
      jsonMode: true,
    })
  }

  if (process.env.AI_FAILOVER_ENABLED !== 'false') {
    for (const slot of FAILOVER_SLOTS) {
      if (slot.name === primary) continue
      const baseUrl = slotBaseUrl(slot)
      if (!slotReady(slot, baseUrl)) continue
      list.push({
        name: slot.name,
        baseUrl,
        apiKey: process.env[slot.keyVar]?.trim(),
        model: (process.env[slot.modelVar]?.trim() || slot.model).trim(),
        tokensPerMinute: Number(process.env[`${slot.name.toUpperCase()}_TOKENS_PER_MINUTE`] ?? slot.tokensPerMinute),
        jsonMode: process.env[`${slot.name.toUpperCase()}_JSON_MODE`] !== 'false',
      })
    }
  }

  endpointsCached = list
  return list
}

export function resetAiEndpoints() {
  endpointsCached = undefined
}

/** Redacted view safe to return from an API or render in the admin UI. */
export function aiConfigSummary() {
  const config = aiConfig()
  return {
    enabled: config.enabled,
    provider: config.provider,
    model: config.model,
    baseUrl: config.baseUrl ? new URL(config.baseUrl).host : null,
    // Presence only — the key itself is never serialised anywhere.
    credentialConfigured: Boolean(config.apiKey),
    liveAvailable: config.liveAvailable,
    temperature: config.temperature,
    maxTokens: config.maxTokens,
    timeoutMs: config.timeoutMs,
    maxRetries: config.maxRetries,
    rateLimitPerMinute: config.rateLimitPerMinute,
    tokensPerMinute: config.tokensPerMinute,
    dailyTokenBudget: config.dailyTokenBudget,
    fallback: 'deterministic rule engines',
    /** Ordered live chain, credentials never included. */
    chain: aiEndpoints().map((endpoint) => ({
      name: endpoint.name,
      host: new URL(endpoint.baseUrl).host,
      model: endpoint.model,
      tokensPerMinute: endpoint.tokensPerMinute,
      jsonMode: endpoint.jsonMode,
      credentialConfigured: Boolean(endpoint.apiKey),
    })),
    failoverEnabled: process.env.AI_FAILOVER_ENABLED !== 'false',
  }
}
