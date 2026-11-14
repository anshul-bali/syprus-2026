import { z } from 'zod'
import { demoEnvironment } from '@/lib/demo-mode'

/**
 * Mail configuration. The service-role key is read from the server environment
 * only and is never rendered, logged or returned from a route — the same rule
 * the AI providers follow.
 *
 * There is no mail credential in this application any more. The letter is handed
 * to an Edge Function inside the operator's own Supabase project, and that
 * function holds the provider secret. What this process needs is the project URL
 * and a key that proves the call comes from a trusted server.
 */
const mailEnvSchema = z.object({
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20, 'SUPABASE_SERVICE_ROLE_KEY looks truncated.').optional(),
  /** Name of the Edge Function that does the send. See supabase/functions/. */
  SUPABASE_MAIL_FUNCTION: z.string()
    .regex(/^[a-z0-9][a-z0-9_-]{0,63}$/, 'SUPABASE_MAIL_FUNCTION must be a function slug.')
    .default('send-email'),
  MAIL_TIMEOUT_MS: z.coerce.number().int().min(1000).max(30_000).default(8000),
  /**
   * `auto` (default) posts through the Supabase Edge Function and only shows a
   * code on screen for a reserved demonstration address, which no mailer could
   * deliver to anyway. `supabase` refuses that fallback for every address.
   * `preview` shows every code on screen and calls the function not at all.
   *
   * All three are read as requests, not as permissions: outside an isolated
   * demonstration environment the effective mode is always `supabase`, so
   * neither `preview` nor `auto`'s reserved-domain branch can put a code on a
   * public server's screen. See `src/lib/demo-mode.ts`.
   */
  MAIL_MODE: z.enum(['auto', 'supabase', 'preview']).default('auto'),
})

export type MailConfig = {
  /** The real transport a send would use, or null when nothing can deliver. */
  mailer: 'supabase' | null
  /** Why it is not configured, in terms a reviewer can act on. */
  missing: string[]
  /** Absolute Edge Function URL, or null when the project URL is unusable. */
  functionUrl: string | null
  // Configuration presence does not prove function deployment or inbox delivery.
  delivery: 'function-configured' | 'screen-only' | 'not-configured'
  timeoutMs: number
  /** The mode actually in force, after the demonstration-environment gate. */
  mode: 'auto' | 'supabase' | 'preview'
}

/**
 * Hosts the service-role key may be sent to. A `SUPABASE_URL` outside this list
 * is dropped rather than called, exactly as `ALLOWED_AI_HOSTS` treats an
 * `AI_BASE_URL` — one mis-set variable must never carry a credential to a host
 * nobody configured it for. `localhost` is allowed because the CLI's local
 * project runs the same function shape on http.
 */
export const ALLOWED_MAIL_HOSTS = ['supabase.co', 'supabase.in', '127.0.0.1', 'localhost'] as const

export function allowedMailUrl(raw: string | undefined | null): string | null {
  if (!raw) return null
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return null
  }
  if (parsed.protocol === 'https:') {
    if (!ALLOWED_MAIL_HOSTS.some((host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`))) {
      return null
    }
    return parsed.origin
  }
  if (parsed.protocol === 'http:' && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')) {
    return parsed.origin
  }
  return null
}

let cached: MailConfig | undefined

export function mailConfig(): MailConfig {
  if (cached) return cached
  const parsed = mailEnvSchema.safeParse(process.env)
  if (!parsed.success) {
    cached = {
      mailer: null,
      missing: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
      functionUrl: null,
      delivery: 'not-configured',
      timeoutMs: 8000,
      // Not `auto`: an unreadable configuration must not select the mode that
      // has an on-screen branch in it.
      mode: 'supabase',
    }
    return cached
  }
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_MAIL_FUNCTION, MAIL_TIMEOUT_MS, MAIL_MODE } = parsed.data
  const origin = allowedMailUrl(SUPABASE_URL)
  const missing: string[] = []
  if (!SUPABASE_URL) missing.push('SUPABASE_URL')
  else if (!origin) missing.push('SUPABASE_URL is not a Supabase project URL, so the key was not sent to it')
  if (!SUPABASE_SERVICE_ROLE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY')

  // Every on-screen path is a demonstration shortcut, so every one of them is
  // refused here rather than at each call site. `auto` is included: its
  // reserved-domain branch would otherwise hand a screen-only code to the seeded
  // administrator on a public deployment without anyone having asked for it.
  const isolated = demoEnvironment()
  const mode = isolated ? MAIL_MODE : 'supabase'
  // Reported only when a mode was actually asked for: the untouched default is
  // not a misconfiguration, it is just a server that sends mail.
  if (!isolated && process.env.MAIL_MODE !== undefined && MAIL_MODE !== 'supabase') {
    missing.push(`MAIL_MODE=${MAIL_MODE} was refused: this is not an isolated demonstration environment`)
  }

  const mailer = origin && SUPABASE_SERVICE_ROLE_KEY ? 'supabase' : null
  cached = {
    mailer,
    missing,
    functionUrl: origin ? `${origin}/functions/v1/${SUPABASE_MAIL_FUNCTION}` : null,
    delivery: mode === 'preview' ? 'screen-only' : mailer ? 'function-configured' : 'not-configured',
    timeoutMs: MAIL_TIMEOUT_MS,
    mode,
  }
  return cached
}

/**
 * Domains that cannot receive mail — the seeded demonstration accounts live on
 * them (including on subdomains such as `meridian.example.com`). Sending there
 * would either bounce or, worse, deliver a stranger's verification code to a
 * real mailbox, so those recipients take the preview path and the screen says
 * the code was not emailed. RFC 2606 reserves `example.*` for exactly this.
 */
const RESERVED_DOMAINS = ['example.com', 'example.org', 'example.net', 'syprus.test', 'localhost']

export function reservedDomainFor(email: string) {
  const domain = email.split('@')[1]?.toLowerCase().replace(/\.$/, '') ?? ''
  return RESERVED_DOMAINS.find((reserved) => domain === reserved || domain.endsWith(`.${reserved}`)) ?? null
}

/** Reset once per process in tests. */
export function resetMailConfigCache() {
  cached = undefined
}
