import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { env } from '@/lib/env'

/**
 * The short-lived proof that a browser finished the password step (or created an
 * account) and is now allowed to redeem a code.
 *
 * It is a signed string, not a session: it carries no permissions, is only ever
 * written to a cookie scoped to `/verify-email`, and is exchanged for a real
 * session by `auth.ts` only after the matching code row is stamped `verifiedAt`.
 * Keeping the format here — with no database or cookie imports — lets the Auth.js
 * provider verify a ticket without dragging request-scoped code into its config.
 */

export const TICKET_TTL_MS = 15 * 60_000
export const TICKET_COOKIE = 'syprus_verify'
/**
 * How long a redeemed code may still buy a session. The window is short because
 * its only legitimate use is the request that follows the correct entry; after
 * it, a stolen ticket string is worthless on its own.
 */
export const SESSION_GRACE_MS = 5 * 60_000

export type TicketPurpose = 'SIGNUP' | 'LOGIN'

export type VerificationTicket = {
  userId: string
  purpose: TicketPurpose
  verificationId: string
}

function sign(payload: string) {
  return createHmac('sha256', env().AUTH_SECRET).update(payload).digest('base64url')
}

export function createVerificationTicket(input: VerificationTicket) {
  const expiresAt = Date.now() + TICKET_TTL_MS
  // A nonce makes two tickets for the same account distinct, so a ticket cannot
  // be recognised — or replayed as — one issued for a different code.
  const body = [input.userId, input.purpose, input.verificationId, expiresAt, randomBytes(8).toString('hex')].join('.')
  return `${body}.${sign(body)}`
}

export function readVerificationTicket(raw: string | undefined | null): VerificationTicket | null {
  if (!raw) return null
  const parts = raw.split('.')
  if (parts.length !== 6) return null
  const [userId, purpose, verificationId, expiresAtRaw, , signature] = parts as [
    string,
    string,
    string,
    string,
    string,
    string,
  ]
  if (!userId || !verificationId || (purpose !== 'SIGNUP' && purpose !== 'LOGIN')) return null
  const expiresAt = Number(expiresAtRaw)
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return null

  const body = parts.slice(0, 5).join('.')
  const expected = sign(body)
  if (expected.length !== signature.length) return null
  if (!timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return null

  return { userId, purpose, verificationId }
}
