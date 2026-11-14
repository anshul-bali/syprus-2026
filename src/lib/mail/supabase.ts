import { mailConfig } from './config'

export type MailReason =
  | 'not-configured'
  | 'function-not-deployed'
  | 'provider-not-configured'
  | 'rejected-credential'
  | 'unverified-sender'
  | 'rate-limited'
  | 'rejected-content'
  | 'timeout'
  | 'network'
  | 'redirect-refused'

export class MailError extends Error {
  readonly reason: MailReason
  readonly status?: number

  constructor(reason: MailReason, message: string, status?: number) {
    super(message)
    this.name = 'MailError'
    this.reason = reason
    this.status = status
  }
}

export type MailMessage = {
  to: string
  subject: string
  text: string
  html?: string
}

// A syntactically valid code can still contain a secret.
const SAFE_CODES = new Set([
  'mail-not-configured',
  'credential-refused',
  'function-not-found',
  'unverified-sender',
  'provider-rate-limited',
  'provider-rejected',
  'method-not-allowed',
  'body-not-an-object',
  'recipient-invalid',
  'subject-invalid',
  'body-invalid',
  'html-invalid',
])

function safeCode(value: unknown): string | null {
  return typeof value === 'string' && SAFE_CODES.has(value) ? value : null
}

function classify(status: number, code: string | null): MailError {
  if (status === 404 || code === 'function-not-found') {
    return new MailError(
      'function-not-deployed',
      'The Supabase mail function was not found. Deploy it, or correct SUPABASE_MAIL_FUNCTION.',
      status,
    )
  }
  if (code === 'mail-not-configured') {
    return new MailError(
      'provider-not-configured',
      'The Supabase mail function has no delivery configured. Set RESEND_API_KEY, or SMTP_HOST with SMTP_PORT, SMTP_USER, SMTP_PASS and MAIL_FROM_ADDRESS, as secrets in the Supabase project.',
      status,
    )
  }
  if (code === 'credential-refused' || status === 401 || status === 403) {
    return new MailError(
      'rejected-credential',
      `The Supabase mail function refused this server's key (${status}). Check SUPABASE_SERVICE_ROLE_KEY and that SUPABASE_URL names the project the function is deployed to.`,
      status,
    )
  }
  if (code === 'unverified-sender') {
    return new MailError(
      'unverified-sender',
      'The sender address this function mails from is not verified on the mail provider. Fix the sender in the Supabase project secrets.',
      status,
    )
  }
  if (code === 'provider-rate-limited' || status === 429) {
    return new MailError('rate-limited', 'The mail provider is rate limiting this Supabase project.', status)
  }
  if (status >= 400 && status < 500) {
    return new MailError(
      'rejected-content',
      `The Supabase mail function rejected the message (${status}).`,
      status,
    )
  }
  return new MailError('network', `The Supabase mail function returned ${status}.`, status)
}

export async function sendMail(message: MailMessage): Promise<{ accepted: true; messageId: string | null }> {
  const config = mailConfig()
  if (!config.mailer || !config.functionUrl) {
    throw new MailError(
      'not-configured',
      'Mail is not configured. Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the server environment.',
    )
  }

  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) throw new MailError('not-configured', 'SUPABASE_SERVICE_ROLE_KEY is not present in this process.')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), config.timeoutMs)

  let response: Response
  let payload: unknown
  try {
    response = await fetch(config.functionUrl, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        to: message.to,
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
      }),
      redirect: 'error',
      signal: controller.signal,
    })
    // Keep the deadline active until the response body has been consumed.
    try {
      payload = await response.json()
    } catch (error) {
      if (!(error instanceof SyntaxError) || controller.signal.aborted) throw error
      payload = null
    }
  } catch (error) {
    if (controller.signal.aborted || (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError'))) {
      throw new MailError('timeout', `The Supabase mail function did not answer within ${config.timeoutMs} ms.`)
    }
    if (error instanceof TypeError && /redirect/i.test(error.message)) {
      throw new MailError(
        'redirect-refused',
        'The Supabase mail function answered with a redirect; the key was not sent anywhere else.',
      )
    }
    throw new MailError('network', 'The Supabase mail function request failed.')
  } finally {
    clearTimeout(timer)
  }

  const detail = typeof payload === 'object' && payload !== null && !Array.isArray(payload)
    ? payload as { ok?: unknown; code?: unknown; message_id?: unknown }
    : null

  if (!response.ok) throw classify(response.status, safeCode(detail?.code))
  if (detail?.ok !== true || (detail.message_id !== null && typeof detail.message_id !== 'string')) {
    throw new MailError('network', 'The Supabase mail function returned an invalid delivery response.', response.status)
  }

  return { accepted: true, messageId: typeof detail.message_id === 'string' ? detail.message_id.slice(0, 128) : null }
}
