import { z } from 'zod'
import { reservedDomainFor } from '@/lib/mail/config'
import { demoEnvironment } from '@/lib/demo-mode'

/**
 * The demonstration waiver.
 *
 * A reviewer walking through the seeded accounts has no mailbox to open, so on a
 * machine that opts in, an account whose address sits on a reserved example
 * domain signs in with its password alone. Four things are deliberately true of
 * that waiver and are worth stating plainly, because the second factor is the
 * point of the feature:
 *
 *  - it is off unless the server is an isolated demonstration environment
 *    (`SYPRUS_DEMO_ENV=true`, never on Vercel production) *and*
 *    `DEMO_SKIP_EMAIL_CODE=true` is set on it;
 *  - it can never cover a real address, because a reserved domain is part of the
 *    test and `example.*` cannot receive mail in the first place;
 *  - it is displayed on the sign-in screen when it is active, so nobody mistakes
 *    a demonstration machine for a hardened one.
 *
 * The environment gate is not redundant with the flag. The seeded accounts share
 * one documented password, an administrator among them, and that database is
 * reachable from the public deployment — so a flag alone would let anyone who
 * read the README sign in as the administrator there.
 */
const schema = z.object({
  DEMO_SKIP_EMAIL_CODE: z
    .enum(['true', 'false'])
    .default('false'),
})

export function waiverEnabled() {
  // Parsed per call, so a deployment cannot get a stale answer from a cached
  // config — but only this one variable is read, not all of `process.env`.
  const parsed = schema.parse({ DEMO_SKIP_EMAIL_CODE: process.env.DEMO_SKIP_EMAIL_CODE })
  return parsed.DEMO_SKIP_EMAIL_CODE === 'true' && demoEnvironment()
}

/** Only ever true for an address no mail service would deliver to. */
export function waivedFor(email: string | null | undefined) {
  if (!waiverEnabled()) return false
  if (!email) return false
  return reservedDomainFor(email) !== null
}

/** The sentence the sign-in and registration screens show when the waiver is on. */
export const WAIVER_NOTICE =
  'Sign-in codes are switched off on this server for demonstration accounts. Addresses that could receive mail still require a code.'
