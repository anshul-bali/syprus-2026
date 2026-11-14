/**
 * Output redaction for the operator-facing check scripts.
 *
 * A diagnostic that prints the credential it was given is a leak with extra
 * steps: the whole point of these scripts is that their output can be pasted
 * into an issue. Two mechanisms, because either alone has a gap:
 *
 *  - every secret-shaped value actually present in the environment is replaced
 *    literally, which catches a key echoed back inside a provider's own error
 *    prose, where no pattern would recognise it;
 *  - the structural shapes a credential travels in — URL userinfo, `apikey` and
 *    `token` query parameters, bearer headers, JWTs — are scrubbed even when the
 *    value came from somewhere the environment never held.
 */

const REDACTED = '[redacted]'

/** Long enough that scrubbing it cannot mangle ordinary prose. */
const MIN_SECRET_LENGTH = 8

const SECRET_NAME = /(?:KEY|SECRET|PASSWORD|PASSWD|PASS|TOKEN|CREDENTIAL|DSN)$/i

type EnvMap = Record<string, string | undefined>

function environmentSecrets(env: EnvMap): string[] {
  const values = new Set<string>()
  for (const [name, value] of Object.entries(env)) {
    if (!value || value.length < MIN_SECRET_LENGTH) continue
    if (SECRET_NAME.test(name) || /^(DATABASE_URL|DIRECT_DATABASE_URL|.*_DATABASE_URL)$/.test(name)) {
      values.add(value)
    }
  }
  // Longest first: a password that is a substring of a connection URL must not
  // be replaced before the URL that contains it.
  return [...values].sort((a, b) => b.length - a.length)
}

function scrubShapes(text: string): string {
  return text
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^/\s@]*:[^/\s@]*@/gi, `$1${REDACTED}@`)
    .replace(/([?&](?:apikey|api_key|access_token|token|password|key)=)[^&\s'"]+/gi, `$1${REDACTED}`)
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, `$1${REDACTED}`)
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, REDACTED)
    .replace(/\b(sb_secret_|sbp_|ghp_|gho_|github_pat_|sk-|gsk_|AIza)[A-Za-z0-9_-]{10,}/g, REDACTED)
}

/**
 * Redacts a value for display. Accepts anything so it can wrap an `unknown`
 * caught error without the caller having to narrow it first.
 */
export function redact(value: unknown, env: EnvMap = process.env): string {
  let text = value instanceof Error ? `${value.name}: ${value.message}` : String(value)
  for (const secret of environmentSecrets(env)) {
    text = text.split(secret).join(REDACTED)
  }
  return scrubShapes(text)
}

/** True when nothing in `text` still matches a credential shape or a known secret. */
export function containsSecret(text: string, env: EnvMap = process.env): boolean {
  return environmentSecrets(env).some((secret) => text.includes(secret)) || scrubShapes(text) !== text
}