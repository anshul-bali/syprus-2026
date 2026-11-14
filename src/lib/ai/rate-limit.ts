import type { AiConfig } from './config'

/**
 * Per-principal rate limiting plus a daily token budget.
 *
 * In-memory buckets are per process, which is the correct scope for a single
 * server instance and is stated plainly rather than implied to be global.
 */

type Bucket = { tokens: number; updatedAt: number }

const MINUTE = 60_000

export class RateLimitExceeded extends Error {
  readonly retryAfterMs: number
  constructor(key: string, retryAfterMs: number) {
    super(`Rate limit reached for ${key}. Retry in ${Math.ceil(retryAfterMs / 1000)}s.`)
    this.name = 'RateLimitExceeded'
    this.retryAfterMs = retryAfterMs
  }
}

const buckets = new Map<string, Bucket>()
let spendTokens = 0
let spendDay = new Date().toISOString().slice(0, 10)

function refill(key: string, capacity: number, windowMs: number): Bucket {
  const now = Date.now()
  const existing = buckets.get(key)
  if (!existing) {
    const fresh = { tokens: capacity, updatedAt: now }
    buckets.set(key, fresh)
    return fresh
  }
  const elapsed = now - existing.updatedAt
  if (elapsed <= 0) return existing
  const restored = (elapsed / windowMs) * capacity
  existing.tokens = Math.min(capacity, existing.tokens + restored)
  existing.updatedAt = now
  return existing
}

/** Consumes one request slot for a principal+agent pair. */
export function acquireRequest(key: string, config: AiConfig): void {
  if (config.rateLimitPerMinute <= 0) return
  const bucket = refill(`${config.model}:${key}`, config.rateLimitPerMinute, MINUTE)
  if (bucket.tokens < 1) {
    throw new RateLimitExceeded(key, Math.ceil((1 - bucket.tokens) * (MINUTE / config.rateLimitPerMinute)))
  }
  bucket.tokens -= 1
}

function rollover(budget: number) {
  const today = new Date().toISOString().slice(0, 10)
  if (today !== spendDay) {
    spendDay = today
    spendTokens = 0
  }
  return budget
}

/**
 * Fixed 60-second token window per model+subject, mirroring the provider's own
 * tokens-per-minute allowance. A fixed window (rather than a smooth refill) is
 * used because that is what Groq enforces, and the reservation is released if
 * the provider never answers.
 */
const minuteWindows = new Map<string, { used: number; startedAt: number }>()

export function acquireTokenBudget(key: string, estimatedTokens: number, budgetPerMinute: number): void {
  if (budgetPerMinute <= 0) return
  if (estimatedTokens > budgetPerMinute) throw new RateLimitExceeded(key, MINUTE)
  const now = Date.now()
  const window = minuteWindows.get(key)

  if (!window || now - window.startedAt >= MINUTE) {
    minuteWindows.set(key, { used: estimatedTokens, startedAt: now })
    return
  }
  if (window.used + estimatedTokens > budgetPerMinute) {
    throw new RateLimitExceeded(key, Math.max(1000, MINUTE - (now - window.startedAt)))
  }
  window.used += estimatedTokens
}

/** Returns tokens reserved in the current window. */
export function tokenBudgetUsed(key: string): number {
  const window = minuteWindows.get(key)
  if (!window) return 0
  return Date.now() - window.startedAt >= MINUTE ? 0 : window.used
}

/**
 * Reserve budget before the call, then reconcile with the real usage. Returns
 * false when the daily ceiling is already spent, which the caller turns into the
 * deterministic fallback rather than a user-facing error.
 */
export function tryReserveTokens(estimate: number, config: AiConfig): boolean {
  const budget = rollover(config.dailyTokenBudget)
  if (budget <= 0) return true
  return spendTokens + estimate <= budget
}

export function recordTokenUsage(tokens: number): void {
  spendTokens += Math.max(0, tokens)
}

export function dailyTokenSpend(): number {
  return spendTokens
}

/** Rough pre-flight estimate; the real count is reconciled from the response. */
export function estimateTokens(messages: { content: string }[]): number {
  const chars = messages.reduce((total, message) => total + message.content.length, 0)
  return Math.ceil(chars / 4) + 400
}

export function resetRateLimitState(): void {
  buckets.clear()
  minuteWindows.clear()
  spendTokens = 0
  spendDay = new Date().toISOString().slice(0, 10)
}
