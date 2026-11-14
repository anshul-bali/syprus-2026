import nodemailer from 'npm:nodemailer@10.3.1'
import { timingSafeEqual } from 'node:crypto'

type Letter = { to: string; subject: string; text: string; html: string | null }

const MAX_SUBJECT = 200
const MAX_TEXT = 20_000
const MAX_HTML = 60_000

function constantTimeEqual(a: string, b: string) {
  const encoder = new TextEncoder()
  const left = encoder.encode(a)
  const right = encoder.encode(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })
}

function parseLetter(raw: unknown): Letter | string {
  if (typeof raw !== 'object' || raw === null) return 'body-not-an-object'
  const value = raw as Record<string, unknown>
  const to = value.to
  const subject = value.subject
  const text = value.text
  const html = value.html
  if (typeof to !== 'string' || to.length > 320 || !/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(to)) {
    return 'recipient-invalid'
  }
  if (typeof subject !== 'string' || subject.length === 0 || subject.length > MAX_SUBJECT || /[\r\n]/.test(subject)) return 'subject-invalid'
  if (typeof text !== 'string' || text.length === 0 || text.length > MAX_TEXT) return 'body-invalid'
  if (html !== undefined && html !== null && (typeof html !== 'string' || html.length > MAX_HTML)) {
    return 'html-invalid'
  }
  return { to, subject, text, html: typeof html === 'string' ? html : null }
}

async function throughResend(letter: Letter, apiKey: string, from: string) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from, to: [letter.to], subject: letter.subject, text: letter.text, html: letter.html ?? undefined }),
    redirect: 'error',
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) {
    // The provider's message may quote the address, so it is read for the shape
    // of the failure only and never passed on. The status the caller sees is
    // this function's own 502: a provider disagreement must not be mistaken for
    // a problem with the key that called us.
    const body = await response.text().catch(() => '')
    const code = /domain|verif|dkim|spf|dmarc|not authorised|not verified/i.test(body)
      ? 'unverified-sender'
      : response.status === 429 || /too many|rate/i.test(body)
        ? 'provider-rate-limited'
        : 'provider-rejected'
    return { ok: false as const, status: 502, code }
  }
  const body = (await response.json().catch(() => ({}))) as { id?: unknown }
  return { ok: true as const, messageId: typeof body.id === 'string' ? body.id : null }
}

async function throughSmtp(letter: Letter, from: string) {
  const port = Number(Deno.env.get('SMTP_PORT') ?? '465')
  const host = Deno.env.get('SMTP_HOST')
  const user = Deno.env.get('SMTP_USER')
  const pass = Deno.env.get('SMTP_PASS')
  if (!host || !user || !pass || ![465, 587].includes(port)) {
    return { ok: false as const, status: 503, code: 'mail-not-configured' }
  }
  const transport = nodemailer.createTransport({
    host, port, secure: port === 465, requireTLS: true,
    tls: { rejectUnauthorized: true, servername: host, minVersion: 'TLSv1.2' },
    auth: { user, pass },
    connectionTimeout: 5000, greetingTimeout: 5000, socketTimeout: 10000,
    disableFileAccess: true, disableUrlAccess: true, logger: false, debug: false,
  })
  const deadline = setTimeout(() => transport.close(), 20_000)
  try {
    const info = await transport.sendMail({ from, to: { name: '', address: letter.to }, subject: letter.subject, text: letter.text, html: letter.html ?? undefined })
    if (!info.accepted?.length) return { ok: false as const, status: 502, code: 'provider-rejected' }
    return { ok: true as const, messageId: info.messageId ?? null }
  } catch (error) {
    const responseCode = (error as { responseCode?: number }).responseCode
    return { ok: false as const, status: 502, code: responseCode === 421 || responseCode === 450 ? 'provider-rate-limited' : 'provider-rejected' }
  } finally {
    clearTimeout(deadline)
    transport.close()
  }
}

Deno.serve(async (request) => {
  const bearer = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  const secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!secret) return json(503, { code: 'mail-not-configured' })
  // The gateway accepts user JWTs too; only the server's service-role key can send mail.
  if (!constantTimeEqual(bearer, secret)) return json(401, { code: 'credential-refused' })
  if (request.method !== 'POST') return json(405, { code: 'method-not-allowed' })

  let raw: unknown
  try {
    const text = await request.text()
    if (text.length > 90_000) return json(413, { code: 'body-invalid' })
    raw = JSON.parse(text)
  } catch {
    return json(400, { code: 'body-invalid' })
  }
  const letter = parseLetter(raw)
  if (typeof letter === 'string') return json(400, { code: letter })
  const from = Deno.env.get('MAIL_FROM_ADDRESS')
  if (!from) return json(503, { code: 'mail-not-configured' })

  try {
    const resendKey = Deno.env.get('RESEND_API_KEY')
    const outcome = Deno.env.get('SMTP_HOST')
      ? await throughSmtp(letter, from)
      : resendKey
        ? await throughResend(letter, resendKey, from)
        : { ok: false as const, status: 503, code: 'mail-not-configured' }
    if (!outcome.ok) return json(outcome.status, { code: outcome.code })
    return json(200, { ok: true, message_id: outcome.messageId })
  } catch {
    return json(502, { code: 'provider-rejected' })
  }
})
