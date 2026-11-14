import { z } from 'zod'

/**
 * Is this an isolated demonstration environment?
 *
 * Two shortcuts exist so a reviewer can walk through the seeded accounts: the
 * sign-in code waiver, and showing a verification code on screen instead of
 * mailing it. Both are authentication bypasses for the accounts they cover, so
 * neither may be reachable on a deployment the public can use.
 *
 * `DEMO_SKIP_EMAIL_CODE` and `MAIL_MODE` alone are not enough to decide that.
 * They say what the operator wants the shortcut to do, not where it is running,
 * and `MAIL_MODE=auto` granted a screen-only code to every reserved-domain
 * address without anyone asking for it — including the seeded administrator, on
 * a server whose database is shared with production.
 *
 * So the shortcuts additionally require this one deliberate assertion that the
 * environment is disposable. It is never inferred from `NODE_ENV`: the QA
 * cluster runs a production build and still has to be isolated, and a production
 * build is exactly what a public deployment runs.
 */
const schema = z.object({
  SYPRUS_DEMO_ENV: z.enum(['true', 'false']).default('false'),
  /** Read as a plain string so an unexpected value cannot throw in a request. */
  VERCEL_ENV: z.string().optional(),
})

export function demoEnvironment(): boolean {
  const parsed = schema.parse({
    SYPRUS_DEMO_ENV: process.env.SYPRUS_DEMO_ENV,
    VERCEL_ENV: process.env.VERCEL_ENV,
  })
  // Vercel injects this itself, so it cannot be forged by the application's own
  // configuration. A public production deployment is never a demo environment,
  // whatever SYPRUS_DEMO_ENV was set to.
  if (parsed.VERCEL_ENV === 'production') return false
  return parsed.SYPRUS_DEMO_ENV === 'true'
}