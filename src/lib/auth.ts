import NextAuth from 'next-auth'
import type { NextAuthConfig } from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import { prisma } from '@/lib/db'
import { waivedFor, waiverEnabled } from '@/lib/demo-waiver'
import { verifyCredentials } from '@/server/credentials'
import { readVerificationTicket, SESSION_GRACE_MS } from '@/lib/verification-ticket'

/**
 * Auth.js with a code as the way in.
 *
 * The password is checked outside this file, by `verifyCredentials` in
 * `src/server/credentials.ts`, which hands out a signed ticket instead of a
 * session. That ticket is what arrives here, so the only path to a session
 * cookie — including a direct POST to the Auth.js callback — runs the code
 * check. A ticket that was never paired with a correctly entered code buys
 * nothing, because the row it names has to carry a `verifiedAt` stamp.
 *
 * The one exception is `demo-password` below: inert unless the server opts into
 * the demonstration waiver, and unable to sign in an address that could receive
 * a real code even then.
 *
 * Sessions stay JWTs carrying only the user id; role, status, organisation and
 * permissions are re-read from PostgreSQL on every request (see
 * `src/lib/authz.ts`), so suspending an account or changing a role takes effect
 * immediately rather than at next login.
 */
export const authConfig = {
  trustHost: true,
  session: {
    strategy: 'jwt',
    maxAge: 60 * 60 * 12,
  },
  pages: {
    signIn: '/login',
    error: '/login',
  },
  providers: [
    Credentials({
      id: 'email-code',
      name: 'Password plus emailed code',
      credentials: {
        ticket: { label: 'Verification ticket', type: 'string' },
      },
      async authorize(credentials) {
        const raw = typeof credentials?.ticket === 'string' ? credentials.ticket : null
        const ticket = readVerificationTicket(raw)
        if (!ticket) return null

        const user = await prisma.user.findUnique({
          where: { id: ticket.userId },
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            status: true,
            emailVerifiedAt: true,
            lockedUntil: true,
          },
        })
        if (!user || user.status !== 'ACTIVE') return null
        if (!user.emailVerifiedAt) return null
        if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) return null

        // The ticket only proves the password step. The code has to have been
        // entered correctly, for this exact row, moments ago — and claiming it is
        // one atomic write, so two requests racing on the same grant cannot both
        // turn it into a session.
        const claimed = await prisma.emailVerification.updateMany({
          where: {
            id: ticket.verificationId,
            userId: ticket.userId,
            purpose: ticket.purpose,
            verifiedAt: { gte: new Date(Date.now() - SESSION_GRACE_MS) },
          },
          data: { verifiedAt: null },
        })
        if (claimed.count !== 1) return null

        await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })

        return { id: user.id, email: user.email, name: user.name, role: user.role }
      },
    }),
    /**
     * The demonstration waiver, and the only way in that does not ask for a code.
     *
     * It returns null for everyone unless `DEMO_SKIP_EMAIL_CODE=true` is set on
     * this server, and even then it refuses any address a mail service could
     * deliver to — it exists so the seeded `@example.com` accounts, which have no
     * mailbox behind them, stay usable in a walkthrough. `loginAction` re-checks
     * the same condition rather than trusting this ordering, and the sign-in
     * screen says out loud when the waiver is active.
     */
    Credentials({
      id: 'demo-password',
      name: 'Password only (demonstration accounts)',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!waiverEnabled()) return null
        const email = typeof credentials?.email === 'string' ? credentials.email : ''
        const password = typeof credentials?.password === 'string' ? credentials.password : ''
        if (!email || !password) return null

        const outcome = await verifyCredentials(email, password)
        if (outcome.status !== 'ok') return null
        if (!waivedFor(outcome.user.email)) return null

        await prisma.user.update({ where: { id: outcome.user.id }, data: { lastLoginAt: new Date() } })
        return { id: outcome.user.id, email: outcome.user.email, name: outcome.user.name, role: outcome.user.role }
      },
    }),
  ],
  callbacks: {
    jwt({ token, user, trigger }) {
      if (user) {
        token.userId = user.id
        token.role = user.role
      }
      if (trigger === 'update' && user) {
        token.userId = user.id
        token.role = user.role
      }
      return token
    },
    session({ session, token }) {
      // The JWT payload is an open record, so narrow before copying into the
      // session rather than asserting the shape.
      if (typeof token.userId === 'string') session.user.id = token.userId
      if (token.role === 'CANDIDATE' || token.role === 'EMPLOYER' || token.role === 'ADMIN') {
        session.user.role = token.role
      }
      return session
    },
  },
} satisfies NextAuthConfig

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig)
