import { z } from 'zod'
import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import { cookies, headers } from 'next/headers'
import { prisma } from '@/lib/db'
import { env } from '@/lib/env'
import { recordAudit } from '@/server/audit'
import type { Principal } from '@/lib/authz'
import { mailConfig, reservedDomainFor } from '@/lib/mail/config'
import { demoEnvironment } from '@/lib/demo-mode'
import { MailError, sendMail } from '@/lib/mail/supabase'
import {
  createVerificationTicket,
  readVerificationTicket,
  TICKET_COOKIE,
  TICKET_TTL_MS,
  type TicketPurpose,
  type VerificationTicket as VerificationTicketInput,
} from '@/lib/verification-ticket'

/**
 * Email verification codes.
 *
 * Rules this file owns, in one place:
 *  - the code is six digits from the CSPRNG, lives ten minutes, and is stored
 *    only as a digest bound to the account that requested it;
 *  - five wrong entries burn a code, a ceiling of sends per hour per account
 *    (six unless `VERIFICATION_MAX_SENDS_PER_HOUR` says otherwise) and a
 *    thirty-second gap between sends, so the endpoint is not a mail cannon;
 *  - issuing a code retires the previous one, so an old message cannot be
 *    traded in after a newer one was requested;
 *  - a correct code never opens a session by itself. It stamps the row
 *    `verifiedAt`, and `src/lib/auth.ts` mints a session only for a ticket that
 *    names that exact row — a ticket handed out after the password step, or
 *    after an account was created;
 *  - on an isolated demonstration server, an address that no mailer will accept
 *    is delivered to the screen instead, and says plainly that it was not
 *    emailed; anywhere else every address goes through the mail function.
 */

export const CODE_TTL_MS = 10 * 60_000
export const RESEND_COOLDOWN_MS = 30_000
export const MAX_ATTEMPTS = 5
export const DEFAULT_MAX_SENDS_PER_HOUR = 6
export const SEND_WINDOW_MS = 60 * 60_000

const sendLimitSchema = z.object({
  VERIFICATION_MAX_SENDS_PER_HOUR: z.coerce.number().int().min(1).max(1000).default(DEFAULT_MAX_SENDS_PER_HOUR),
})

/**
 * A ceiling on sends, not on sign-ins: six codes an hour is far more than one
 * person needs to get in, and it is what stops the form being used as a mail
 * cannon. The 30-second gap between sends is the other half.
 *
 * The number is configurable for one reason: a shared test cluster signs the
 * same seeded accounts in dozens of times an hour, and a limit that only ever
 * bites in CI is a limit nobody has measured. `scripts/qa.ts` raises it there;
 * production never reads anything but the default unless an operator sets it.
 */
export function sendLimit() {
  const parsed = sendLimitSchema.safeParse({ VERIFICATION_MAX_SENDS_PER_HOUR: process.env.VERIFICATION_MAX_SENDS_PER_HOUR })
  if (!parsed.success) {
    throw new Error(`VERIFICATION_MAX_SENDS_PER_HOUR is not a whole number between 1 and 1000: ${parsed.error.issues[0]?.message ?? ''}`)
  }
  return parsed.data.VERIFICATION_MAX_SENDS_PER_HOUR
}
export type VerificationPurpose = TicketPurpose

export type IssueResult =
  | { status: 'sent'; transport: 'supabase'; verificationId: string; expiresAt: Date }
  | {
      status: 'sent'
      transport: 'preview'
      verificationId: string
      previewCode: string
      previewLink: string
      expiresAt: Date
    }
  /** A code is already in flight; `verificationId` is null when none can be used. */
  | { status: 'cooldown'; retryAfterSeconds: number; verificationId: string | null; expiresAt: Date | null }
  | { status: 'limited'; retryAfterSeconds: number; verificationId: string | null; expiresAt: Date | null }

/** A wait hint that never claims more than the rule allows, and never zero. */
function clampSeconds(seconds: number, ceiling: number) {
  return Math.min(ceiling, Math.max(1, Math.ceil(seconds)))
}

function sixDigitCode() {
  // randomInt is uniform over the range; padding keeps every code six digits.
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

/** Digest bound to the account: a leaked table row cannot be replayed elsewhere. */
function digest(userId: string, code: string) {
  return createHmac('sha256', env().AUTH_SECRET).update(`${userId}:${code}`).digest('hex')
}

/**
 * The link token is looked up by its digest, so the server has to find the row
 * from the token alone — which means the digest cannot be bound to the user id
 * the way the code's is. It is bound to nothing but the secret, and it is worth
 * exactly one redemption: 288 bits of CSPRNG, single use, ten-minute expiry.
 */
function linkToken() {
  return randomBytes(36).toString('base64url')
}

function digestLink(token: string) {
  return createHmac('sha256', env().AUTH_SECRET).update(`link:${token}`).digest('hex')
}

function safeEqualHex(a: string, b: string) {
  if (a.length !== b.length) return false
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'))
}

function subject(purpose: VerificationPurpose) {
  return purpose === 'SIGNUP' ? 'Confirm your SYPRUS account' : 'Your SYPRUS sign-in code'
}

/**
 * Where a verification link should point. The request's own host wins over
 * `NEXT_PUBLIC_APP_URL`, so a preview running on another port still produces a
 * link that works; the variable is the fallback when there is no request to ask.
 */
export async function appOrigin() {
  let host: string | null = null
  let forwardedProto: string | null = null
  try {
    const list = await headers()
    host = list.get('x-forwarded-host')?.split(',')[0]?.trim() || list.get('host')
    forwardedProto = list.get('x-forwarded-proto')?.split(',')[0]?.trim() ?? null
  } catch {
    // No request to ask — a code issued from a script, a queue worker or a test
    // still has to produce a link, so the configured public URL is used below.
  }
  if (host) {
    const local = host.startsWith('localhost') || host.startsWith('127.0.0.1')
    const proto = forwardedProto ?? (local ? 'http' : 'https')
    return `${proto}://${host}`
  }
  return env().NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
}

function linkFor(origin: string, token: string) {
  return `${origin.replace(/\/$/, '')}/verify-email?token=${token}`
}

function body(purpose: VerificationPurpose, code: string, name: string, link: string) {
  const opening =
    purpose === 'SIGNUP'
      ? `Hello ${name},\n\nOpen your SYPRUS account by clicking the link below, or enter this code where you are:`
      : `Hello ${name},\n\nSomeone signed in to your SYPRUS account with the correct password. Confirm it is you by\nclicking the link below, or enter this code:`
  return [
    opening,
    '',
    `    ${code}`,
    '',
    'Or open this one-time link:',
    '',
    `    ${link}`,
    '',
    'Either works once and expires in 10 minutes.',
    '',
    'Nobody at SYPRUS will ever ask you for this code or send you a link like this unsolicited.',
    'If you did not request it, finish signing in, or recognise the device, change your password',
    'and tell us.',
    '',
    'SYPRUS — skills-first career re-entry',
  ].join('\n')
}

export async function issueVerificationCode(input: {
  userId: string
  email: string
  name: string
  purpose: VerificationPurpose
  actor?: Principal | null
}): Promise<IssueResult> {
  const { userId, email, purpose } = input
  const now = Date.now()
  const limit = sendLimit()

  const [live, recent] = await Promise.all([
    prisma.emailVerification.findFirst({
      where: { userId, consumedAt: null, expiresAt: { gt: new Date(now) }, attempts: { lt: MAX_ATTEMPTS } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, createdAt: true, expiresAt: true },
    }),
    prisma.emailVerification.aggregate({
      where: { userId, createdAt: { gte: new Date(now - SEND_WINDOW_MS) } },
      _count: { _all: true },
      _min: { createdAt: true },
    }),
  ])

  // Only a code that could still be used makes a resend unnecessary. A code that
  // was entered, expired or burned out is not "on its way", and refusing the next
  // request over it would strand the person — signing out and back in inside half
  // a minute is ordinary behaviour, not abuse.
  if (live) {
    const sinceSend = now - live.createdAt.getTime()
    if (sinceSend < RESEND_COOLDOWN_MS) {
      // PostgreSQL stamps the row and this process measures the gap, so the two
      // clocks can disagree by a second. The hint must never promise more wait
      // than the rule itself.
      return {
        status: 'cooldown',
        retryAfterSeconds: clampSeconds((RESEND_COOLDOWN_MS - sinceSend) / 1000, RESEND_COOLDOWN_MS / 1000),
        verificationId: live.id,
        expiresAt: live.expiresAt,
      }
    }
  }
  if (recent._count._all >= limit) {
    // The window is full, so nothing new may go out — but if a code from it is
    // still usable, hand its id back rather than turning the person away.
    const clearsAt = (recent._min.createdAt?.getTime() ?? now) + SEND_WINDOW_MS
    return {
      status: 'limited',
      retryAfterSeconds: clampSeconds((clearsAt - now) / 1000, SEND_WINDOW_MS / 1000),
      verificationId: live?.id ?? null,
      expiresAt: live?.expiresAt ?? null,
    }
  }

  const domain = reservedDomainFor(email)
  const config = mailConfig()
  // A reserved demonstration address can never receive a real mail, so it takes
  // the on-screen path — but only on an isolated demonstration server. Being
  // undeliverable is not a permission: on a public deployment the seeded
  // administrator is a reserved-domain account too, and showing its code on
  // screen would hand over the account to anyone who read the documented
  // password. `mailConfig()` already forces `supabase` off-demo; the explicit
  // check here keeps the rule legible at the point where it is decided.
  const preview =
    demoEnvironment() && (config.mode === 'preview' || (config.mode === 'auto' && domain !== null))
  const transport = preview ? 'preview' : 'supabase'
  // One spelling for the audit trail and the row: the database's own enum value.
  const transportValue = transport === 'preview' ? 'PREVIEW' : 'SUPABASE'
  const code = sixDigitCode()
  const token = linkToken()
  const origin = await appOrigin()
  const link = linkFor(origin, token)
  const expiresAt = new Date(now + CODE_TTL_MS)

  // Only the newest code for an account can be redeemed.
  await prisma.emailVerification.updateMany({
    where: { userId, consumedAt: null },
    data: { consumedAt: new Date(now) },
  })

  const row = await prisma.emailVerification.create({
    data: {
      userId,
      purpose,
      codeHash: digest(userId, code),
      linkTokenHash: digestLink(token),
      // Present only for a demonstration address; a real code is never stored.
      previewCode: transport === 'preview' ? code : null,
      previewToken: transport === 'preview' ? token : null,
      transport: transportValue,
      expiresAt,
    },
    select: { id: true },
  })

  let delivered: 'sent' | 'failed' = 'sent'
  let deliveryError: MailError | null = null
  if (transport === 'supabase') {
    try {
      await sendMail({ to: email, subject: subject(purpose), text: body(purpose, code, input.name, link) })
    } catch (error) {
      delivered = 'failed'
      deliveryError = error instanceof MailError ? error : new MailError('network', 'Email delivery failed.')
      // A code nobody received must not sit there redeemable, and it must not
      // eat a place in the hourly send window either. The audit entry below is
      // what survives, with the row id and the reason.
      await prisma.emailVerification.delete({ where: { id: row.id } })
    }
  }

  await recordAudit({
    actor: input.actor ?? null,
    action: delivered === 'sent' ? 'auth.verification_sent' : 'auth.verification_send_failed',
    entityType: 'email_verifications',
    entityId: row.id,
    targetUserId: userId,
    visibility: 'ADMIN',
    // Never the code, never the address: the row id and the reason are enough.
    metadata: { purpose, transport: transportValue, delivered, failure: deliveryError?.reason ?? null, expiresAt: expiresAt.toISOString() },
  })

  if (deliveryError) throw deliveryError

  return transport === 'preview'
    ? { status: 'sent', transport: 'preview', verificationId: row.id, previewCode: code, previewLink: link, expiresAt }
    : { status: 'sent', transport: 'supabase', verificationId: row.id, expiresAt }
}

export type RedeemResult =
  | { status: 'verified'; verificationId: string }
  | { status: 'invalid'; remainingAttempts: number }
  | { status: 'expired' }
  | { status: 'exhausted' }
  | { status: 'absent' }

export async function redeemVerificationCode(input: {
  userId: string
  purpose: VerificationPurpose
  /** The row the caller's ticket was issued for; a code for another row never works. */
  verificationId: string
  code: string
  actor?: Principal | null
}): Promise<RedeemResult> {
  const now = Date.now()
  const active = await prisma.emailVerification.findFirst({
    where: { id: input.verificationId, userId: input.userId, purpose: input.purpose },
  })

  if (!active) return { status: 'absent' }
  if (active.expiresAt.getTime() < now) {
    if (!active.consumedAt) {
      await prisma.emailVerification.update({ where: { id: active.id }, data: { consumedAt: new Date(now) } })
    }
    return { status: 'expired' }
  }
  if (active.consumedAt) return { status: 'absent' }
  if (active.attempts >= MAX_ATTEMPTS) return { status: 'exhausted' }

  const matches = safeEqualHex(active.codeHash, digest(input.userId, input.code))
  if (!matches) {
    const attempts = active.attempts + 1
    await prisma.emailVerification.update({
      where: { id: active.id },
      data: { attempts, ...(attempts >= MAX_ATTEMPTS ? { consumedAt: new Date(now) } : {}) },
    })
    await recordAudit({
      actor: input.actor ?? null,
      action: 'auth.verification_failed',
      entityType: 'email_verifications',
      entityId: active.id,
      targetUserId: input.userId,
      visibility: 'ADMIN',
      metadata: { purpose: input.purpose, attempts },
    })
    return { status: 'invalid', remainingAttempts: Math.max(0, MAX_ATTEMPTS - attempts) }
  }

  // Atomic single-use claim: if two requests race on the same code, exactly one
  // sees `count === 1` and only that one can go on to open a session.
  const claimed = await prisma.emailVerification.updateMany({
    where: { id: active.id, consumedAt: null },
    data: { consumedAt: new Date(now), verifiedAt: new Date(now) },
  })
  if (claimed.count === 0) return { status: 'absent' }

  await prisma.user.update({
    where: { id: input.userId },
    data: { emailVerifiedAt: new Date(now), failedLoginCount: 0, lockedUntil: null },
  })
  await recordAudit({
    actor: input.actor ?? null,
    action: 'auth.verified',
    entityType: 'email_verifications',
    entityId: active.id,
    targetUserId: input.userId,
    visibility: 'USER',
    metadata: { purpose: input.purpose, transport: active.transport },
  })

  return { status: 'verified', verificationId: active.id }
}

/** The link a demonstration screen shows, built from the request's own origin. */
export async function verificationLinkUrl(token: string) {
  return linkFor(await appOrigin(), token)
}

export type LinkRedeemResult =
  | { status: 'verified'; userId: string; purpose: VerificationPurpose; verificationId: string }
  /**
   * `unknown` is a token this server never issued, `spent` one already clicked,
   * `expired` one past its ten minutes. To the person holding the link all three
   * mean the same thing — this will not open a session — and none of them
   * confirms to anybody else that an address exists here.
   */
  | { status: 'rejected'; reason: 'unknown' | 'expired' | 'spent' }

/**
 * The clickable half of the same verification. One link, one redemption, and it
 * stamps `verifiedAt` exactly as a typed code does, so the door that opens a
 * session is unchanged whichever way the person arrived.
 */
export async function redeemVerificationLink(input: {
  token: string
  actor?: Principal | null
}): Promise<LinkRedeemResult> {
  const now = Date.now()
  // Cheap length gate first: a random probe should not cost a digest and a query.
  if (input.token.length < 20 || input.token.length > 200) return { status: 'rejected', reason: 'unknown' }

  const row = await prisma.emailVerification.findUnique({
    where: { linkTokenHash: digestLink(input.token) },
    select: { id: true, userId: true, purpose: true, expiresAt: true, consumedAt: true },
  })
  if (!row) return { status: 'rejected', reason: 'unknown' }
  if (row.expiresAt.getTime() < now) return { status: 'rejected', reason: 'expired' }
  if (row.consumedAt) return { status: 'rejected', reason: 'spent' }

  // Atomic, so two clicks — or a click and a link-preview prefetch — cannot both be honoured.
  const claimed = await prisma.emailVerification.updateMany({
    where: { id: row.id, consumedAt: null },
    data: { consumedAt: new Date(now), verifiedAt: new Date(now) },
  })
  if (claimed.count === 0) return { status: 'rejected', reason: 'spent' }

  await prisma.user.update({
    where: { id: row.userId },
    data: { emailVerifiedAt: new Date(now), failedLoginCount: 0, lockedUntil: null },
  })
  await recordAudit({
    actor: input.actor ?? null,
    action: 'auth.verified',
    entityType: 'email_verifications',
    entityId: row.id,
    targetUserId: row.userId,
    visibility: 'USER',
    metadata: { purpose: row.purpose, method: 'link' },
  })

  return { status: 'verified', userId: row.userId, purpose: row.purpose, verificationId: row.id }
}

/**
 * What the entry screen needs about the code behind a ticket: when it dies, and
 * the value itself only when it was never emailed. A mailed code is not readable
 * from here, by design.
 */
export async function verificationSummaryFor(verificationId: string) {
  const row = await prisma.emailVerification.findUnique({
    where: { id: verificationId },
    select: {
      createdAt: true,
      expiresAt: true,
      transport: true,
      attempts: true,
      previewCode: true,
      previewToken: true,
    },
  })
  if (!row) return null
  // Anything that is not the on-screen path left this server in a real mail, so
  // the code must never be readable from here. Keyed on PREVIEW rather than on
  // one provider's name: a transport added later fails closed by default.
  const emailed = row.transport !== 'PREVIEW'
  return {
    ...row,
    emailed,
    expired: row.expiresAt.getTime() < Date.now(),
    resendFrom: new Date(row.createdAt.getTime() + RESEND_COOLDOWN_MS),
    // The link is shown on screen only where the code is: an address that could
    // receive mail gets its link in the mail, never on this screen.
    previewLink: !emailed && row.previewToken ? await verificationLinkUrl(row.previewToken) : null,
  }
}

// ---------------------------------------------------------------------------
// Ticket cookie: proves "this browser passed the password step" without a session.
// The signed format lives in `src/lib/verification-ticket.ts`, where the Auth.js
// provider can read it without importing request-scoped code.
// ---------------------------------------------------------------------------

/** Scoped to the one screen that may spend it, so it rides on no other request. */
const TICKET_PATH = '/verify-email'

export async function setVerificationTicket(input: VerificationTicketInput) {
  const store = await cookies()
  store.set(TICKET_COOKIE, createVerificationTicket(input), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: TICKET_PATH,
    maxAge: Math.floor(TICKET_TTL_MS / 1000),
  })
}

export async function clearVerificationTicket() {
  const store = await cookies()
  // Deletion has to repeat the path the cookie was written with, or it is a no-op.
  store.delete({ name: TICKET_COOKIE, path: TICKET_PATH })
}

/**
 * The ticket for this request, parsed and raw. The raw string is what
 * `signIn('email-code', { ticket })` is given, so the provider re-verifies the
 * signature instead of trusting a caller that had already decoded it.
 */
export async function currentVerificationTicket() {
  const store = await cookies()
  const raw = store.get(TICKET_COOKIE)?.value
  const ticket = readVerificationTicket(raw)
  return ticket && raw ? { ...ticket, raw } : null
}
