import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/db'
import type { AccountStatus, UserRole } from '@prisma/client'

export const MAX_FAILED_LOGINS = 5
export const LOCK_MINUTES = 15

/** Constant-time stand-in so an unknown address costs the same as a wrong password. */
const DUMMY_HASH = '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidin'

export type CheckedAccount = { id: string; email: string; name: string; role: UserRole }

export type CredentialOutcome =
  | { status: 'ok'; user: CheckedAccount }
  /** Unknown address or wrong password — deliberately indistinguishable. */
  | { status: 'invalid' }
  | { status: 'locked'; retryAfterMinutes: number }
  | { status: 'inactive'; accountStatus: AccountStatus }

/**
 * The password step of sign-in, on its own.
 *
 * It never creates a session: the session belongs to `src/lib/auth.ts` and is
 * only minted once a emailed code has been redeemed. Splitting the two is what
 * lets the second factor be enforced by the one door that opens a session,
 * rather than by a page that could be navigated past.
 *
 * Only a correct password can produce `locked` or `inactive`, so the responses
 * leak nothing to somebody who is guessing.
 */
export async function verifyCredentials(email: string, password: string): Promise<CredentialOutcome> {
  const normalized = email.trim().toLowerCase()
  if (!normalized || !password) return { status: 'invalid' }

  const user = await prisma.user.findUnique({
    where: { email: normalized },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      status: true,
      passwordHash: true,
      failedLoginCount: true,
      lockedUntil: true,
    },
  })

  if (!user) {
    await bcrypt.compare(password, DUMMY_HASH)
    return { status: 'invalid' }
  }

  const lockedFor = user.lockedUntil ? user.lockedUntil.getTime() - Date.now() : 0
  if (lockedFor > 0) {
    const matches = await bcrypt.compare(password, user.passwordHash)
    if (!matches) return { status: 'invalid' }
    return { status: 'locked', retryAfterMinutes: Math.ceil(lockedFor / 60_000) }
  }

  const passwordMatches = await bcrypt.compare(password, user.passwordHash)
  if (!passwordMatches) {
    const failedLoginCount = user.failedLoginCount + 1
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount,
        lockedUntil:
          failedLoginCount >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCK_MINUTES * 60_000) : user.lockedUntil,
      },
    })
    return { status: 'invalid' }
  }

  if (user.status !== 'ACTIVE') return { status: 'inactive', accountStatus: user.status }

  return { status: 'ok', user: { id: user.id, email: user.email, name: user.name, role: user.role } }
}
