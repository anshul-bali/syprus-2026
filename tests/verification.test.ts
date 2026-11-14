import { describe, it, expect } from './harness'
import {
  createVerificationTicket,
  readVerificationTicket,
  SESSION_GRACE_MS,
  TICKET_COOKIE,
  TICKET_TTL_MS,
} from '../src/lib/verification-ticket'
import { allowedMailUrl, mailConfig, resetMailConfigCache, reservedDomainFor } from '../src/lib/mail/config'
import { waivedFor, waiverEnabled, WAIVER_NOTICE } from '../src/lib/demo-waiver'
import { MailError, sendMail } from '../src/lib/mail/supabase'
import { resetEnvCache } from '../src/lib/env'
import { verificationCodeSchema } from '../src/lib/validation'

/**
 * Email verification, away from the database and away from the mail provider.
 *
 * These are the parts that have to hold whatever the mail service or the session
 * store does: a ticket that cannot be forged or stretched, a transport decision
 * that never quietly upgrades a demonstration address into a real send, an
 * outbound request that cannot leak the key or the code, and a code field that
 * accepts what a password manager actually pastes.
 */

const SECRET = 'unit-test-secret-at-least-16-characters'
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiJ9.unit-test-service-role-value-not-a-real-key'
const PROJECT_URL = 'https://unit-test-project.supabase.co'
const FUNCTION_URL = `${PROJECT_URL}/functions/v1/send-email`
/**
 * Every mail setting starts cleared, so a case below states what it relies on.
 * The environment declaration is cleared too: `@prisma/client` loads `.env` when
 * it is imported, so a developer's own demo flag would otherwise decide these
 * results instead of the case.
 */
const clearMailEnv: Record<string, undefined> = Object.fromEntries(
  ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_MAIL_FUNCTION', 'MAIL_MODE', 'MAIL_TIMEOUT_MS', 'SYPRUS_DEMO_ENV', 'VERCEL_ENV'].map((name) => [
    name,
    undefined,
  ]),
)

/** The declaration that makes this an isolated demonstration environment. */
const demoEnv = { SYPRUS_DEMO_ENV: 'true', VERCEL_ENV: undefined }

async function withEnv(values: Record<string, string | undefined>, body: () => void | Promise<void>) {
  const keys = Object.keys(values)
  const saved = new Map(keys.map((key) => [key, process.env[key]]))
  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    resetEnvCache()
    resetMailConfigCache()
    await body()
  } finally {
    for (const key of keys) {
      const value = saved.get(key)
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    resetEnvCache()
    resetMailConfigCache()
  }
}

const claims = { userId: 'user_unit_1', purpose: 'LOGIN' as const, verificationId: 'vrf_unit_1' }

describe('Verification ticket', () => {
  it('reads back only under the secret that signed it', async () => {
    let signed = ''
    await withEnv({ AUTH_SECRET: SECRET }, () => {
      signed = createVerificationTicket(claims)
      const parsed = readVerificationTicket(signed)
      expect.equal(parsed?.userId, 'user_unit_1')
      expect.equal(parsed?.purpose, 'LOGIN')
      expect.equal(parsed?.verificationId, 'vrf_unit_1')
    })
    await withEnv({ AUTH_SECRET: 'a-completely-different-secret-value' }, () => {
      expect.equal(readVerificationTicket(signed), null, 'a ticket signed by another server must not read')
    })
  })

  it('refuses an edited claim, an unsigned string and a stretched expiry', async () => {
    await withEnv({ AUTH_SECRET: SECRET }, () => {
      const parts = createVerificationTicket(claims).split('.')
      expect.length(parts, 6, 'the ticket is five claims plus a signature')
      expect.equal(readVerificationTicket(['user_unit_2', ...parts.slice(1)].join('.')), null, 'a rewritten user id must not read')
      expect.equal(readVerificationTicket(parts.slice(0, 5).join('.')), null, 'an unsigned ticket must not read')
      expect.equal(readVerificationTicket(`${parts.slice(0, 5).join('.')}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`), null)
      expect.equal(readVerificationTicket(''), null)
      expect.equal(readVerificationTicket(null), null)
      expect.equal(readVerificationTicket(undefined), null)
      expect.equal(readVerificationTicket(`${parts.join('.')}.extra`), null, 'an appended segment must not read')

      const stretched = [parts[0], parts[1], parts[2], String(Date.now() + 86_400_000), parts[4], parts[5]].join('.')
      expect.equal(readVerificationTicket(stretched), null, 'a rewritten expiry is covered by the signature')
    })
  })

  it('rejects a ticket once its own expiry has passed', async () => {
    await withEnv({ AUTH_SECRET: SECRET }, () => {
      const signed = createVerificationTicket(claims)
      const clock = Date.now
      try {
        // The signature is intact; only the timestamp it carries has aged out.
        Date.now = () => clock() + TICKET_TTL_MS + 1000
        expect.equal(readVerificationTicket(signed), null, 'an expired ticket must not read')
      } finally {
        Date.now = clock
      }
      expect.true(readVerificationTicket(signed) !== null, 'and the same ticket reads again while it is live')
    })
  })

  it('issues a fresh value each time so two grants for one code differ', async () => {
    await withEnv({ AUTH_SECRET: SECRET }, () => {
      const first = createVerificationTicket(claims)
      const second = createVerificationTicket(claims)
      expect.notEqual(first, second, 'the nonce has to differ between identical claims')
      expect.equal(
        readVerificationTicket(first)?.verificationId,
        readVerificationTicket(second)?.verificationId,
        'the nonce is not a claim',
      )
    })
  })

  it('outlives the grace window that spends it', () => {
    expect.true(TICKET_TTL_MS > SESSION_GRACE_MS, 'a ticket must not outlive its own spend window')
    expect.equal(TICKET_COOKIE, 'syprus_verify')
  })
})

describe('Transport decision', () => {
  it('treats reserved demonstration domains, subdomains included, as undeliverable', () => {
    for (const address of ['a@example.com', 'a@meridian.example.com', 'a@sub.example.org', 'a@syprus.test', 'a@localhost']) {
      expect.true(reservedDomainFor(address) !== null, `${address} should be reserved`)
    }
    for (const address of ['a@syprus.app', 'a@notexample.com', 'a@evil-example.com']) {
      expect.equal(reservedDomainFor(address), null, `${address} must not pass as a demonstration domain`)
    }
    expect.equal(reservedDomainFor('no-at-sign'), null)
    expect.equal(
      reservedDomainFor('A@MERIDIAN.EXAMPLE.COM'),
      reservedDomainFor('a@meridian.example.com'),
      'matching is case-folded',
    )
    expect.equal(reservedDomainFor('a@EXAMPLE.COM'), 'example.com')
  })

  it('reports precisely what a real send would be missing', async () => {
    await withEnv(clearMailEnv, () => {
      const config = mailConfig()
      expect.equal(config.mailer, null, 'nothing is usable until the project is named')
      expect.equal(config.delivery, 'not-configured', 'missing credentials do not imply screen-only delivery')
      expect.includes(config.missing, 'SUPABASE_URL')
      expect.includes(config.missing, 'SUPABASE_SERVICE_ROLE_KEY')
      expect.equal(config.mode, 'supabase', 'with no demonstration declaration the only mode in force is the one that sends')
      expect.equal(config.functionUrl, null, 'and there is no endpoint to post to')
    })
    await withEnv({ ...clearMailEnv, SUPABASE_URL: PROJECT_URL, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY }, () => {
      const config = mailConfig()
      expect.equal(config.mailer, 'supabase')
      expect.equal(config.functionUrl, FUNCTION_URL, 'the endpoint is that project\'s own mail function')
      expect.equal(config.delivery, 'function-configured', 'configuration alone does not assert reachability or delivery')
      expect.length(config.missing, 0)
    })
    await withEnv(
      { ...clearMailEnv, SUPABASE_URL: `${PROJECT_URL}/`, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY, SUPABASE_MAIL_FUNCTION: 'syprus-mail' },
      () => {
        expect.equal(mailConfig().functionUrl, `${PROJECT_URL}/functions/v1/syprus-mail`, 'a trailing slash and a renamed function both resolve')
      },
    )
    await withEnv({ ...clearMailEnv, SUPABASE_URL: PROJECT_URL, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY.slice(0, 12) }, () => {
      const config = mailConfig()
      expect.equal(config.mailer, null, 'a truncated key is not a configuration')
      expect.equal(config.delivery, 'not-configured')
      expect.true(config.missing.some((entry) => entry.includes('SUPABASE_SERVICE_ROLE_KEY')))
    })
    await withEnv({ ...clearMailEnv, SUPABASE_URL: 'https://evil.example.com', SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY }, () => {
      const config = mailConfig()
      expect.equal(config.mailer, null, 'a host that is not a Supabase project is not a configuration')
      expect.equal(config.functionUrl, null, 'and it is never turned into an endpoint')
      expect.true(config.missing.some((entry) => entry.includes('not a Supabase project URL')))
    })
    await withEnv({ ...clearMailEnv, MAIL_MODE: 'carrier-pigeon' }, () => {
      expect.equal(mailConfig().mailer, null, 'an unknown mode fails closed rather than defaulting')
    })
    await withEnv({ ...clearMailEnv, ...demoEnv, SUPABASE_URL: PROJECT_URL, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY, MAIL_MODE: 'preview' }, () => {
      const config = mailConfig()
      expect.equal(config.mode, 'preview', 'the preview switch stays readable by the caller')
      expect.equal(config.delivery, 'screen-only', 'it overrides a project that is fully configured, and says so honestly')
    })
    await withEnv({ ...clearMailEnv, ...demoEnv, MAIL_MODE: 'preview' }, () => {
      expect.equal(mailConfig().delivery, 'screen-only', 'explicit preview does not require project credentials')
    })
    for (const partial of [{ SUPABASE_URL: PROJECT_URL }, { SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY }]) {
      await withEnv({ ...clearMailEnv, ...partial }, () => {
        expect.equal(mailConfig().delivery, 'not-configured', 'both the project and the key are required')
      })
    }
  })

  it('refuses to carry the service key to a host nobody configured', () => {
    for (const candidate of [
      'https://evil.example.com',
      'https://supabase.co.evil.io',
      'http://unit-test-project.supabase.co',
      'not-a-url',
      '',
    ]) {
      expect.equal(allowedMailUrl(candidate), null, `${candidate || 'empty'} must not receive the key`)
    }
    expect.equal(allowedMailUrl(PROJECT_URL), PROJECT_URL)
    expect.equal(allowedMailUrl('http://localhost:54321'), 'http://localhost:54321', 'the CLI local project runs over http')
  })
})

type Stubbed = {
  status: number
  body?: unknown
  headers?: Record<string, string>
  throws?: Error
  readBody?: (signal: AbortSignal) => Promise<unknown>
}

function stubFetch(response: Stubbed) {
  const calls: { url: string; init: RequestInit }[] = []
  const original = globalThis.fetch
  globalThis.fetch = (async (url: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(url), init })
    if (response.throws) throw response.throws
    const result = new Response(typeof response.body === 'string' ? response.body : JSON.stringify(response.body ?? {}), {
      status: response.status,
      headers: { 'content-type': 'application/json', ...(response.headers ?? {}) },
    })
    if (response.readBody) result.json = () => response.readBody!(init.signal as AbortSignal)
    return result
  }) as typeof fetch
  return { calls, restore: () => (globalThis.fetch = original) }
}

const letter = { to: 'person@somewhere-real.test', subject: 'Your SYPRUS sign-in code', text: 'Code: 491327' }

describe('Supabase mail function boundary', () => {
  const configured = { ...clearMailEnv, SUPABASE_URL: PROJECT_URL, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY }

  it('refuses to build a request when the server cannot mail', async () => {
    await withEnv({ ...clearMailEnv, SUPABASE_URL: undefined, SUPABASE_SERVICE_ROLE_KEY: undefined }, async () => {
      const probe = stubFetch({ status: 200 })
      try {
        const error = await expect.throws(() => sendMail(letter))
        expect.true(error instanceof MailError)
        expect.equal((error as MailError).reason, 'not-configured')
        expect.length(probe.calls, 0, 'nothing may leave the process')
      } finally {
        probe.restore()
      }
    })
  })

  it('posts one letter to the project\'s own function, refuses redirects and never picks the sender', async () => {
    await withEnv(configured, async () => {
      const probe = stubFetch({ status: 200, body: { ok: true, message_id: 'msg-1' } })
      try {
        const result = await sendMail({ ...letter, html: '<p>Code: 491327</p>' })
        expect.equal(result.accepted, true)
        expect.equal(result.messageId, 'msg-1')
        expect.length(probe.calls, 1)
        const call = probe.calls[0]
        expect.equal(call.url, FUNCTION_URL)
        expect.equal(call.init.redirect, 'error', 'a 3xx would carry the key to an unconfigured host')
        expect.equal((call.init.headers as Record<string, string>)['content-type'], 'application/json')
        expect.equal((call.init.headers as Record<string, string>).authorization, `Bearer ${SERVICE_KEY}`)

        const body = JSON.parse(String(call.init.body)) as Record<string, unknown>
        expect.equal(body.to, letter.to)
        expect.equal(body.subject, letter.subject)
        expect.true(String(body.text).includes('491327'), 'the code travels inside the letter')
        expect.equal(typeof body.html, 'string', 'the optional HTML part goes only when asked for')
        expect.equal(body.from, undefined, 'the sender is chosen by the function, not by whoever can post to it')
        expect.equal(Object.keys(body).sort().join(','), 'html,subject,text,to', 'and nothing else is offered')
      } finally {
        probe.restore()
      }
    })
  })

  const cases: { label: string; response: Stubbed; reason: string; matches: RegExp }[] = [
    {
      label: 'a key the function will not accept',
      response: { status: 401, body: { error: 'no', code: 'credential-refused' } },
      reason: 'rejected-credential',
      matches: /SUPABASE_SERVICE_ROLE_KEY/,
    },
    { label: 'a platform-level permission failure', response: { status: 403, body: {} }, reason: 'rejected-credential', matches: /403/ },
    { label: 'a deployed function that has no mail secrets', response: { status: 503, body: { code: 'mail-not-configured' } }, reason: 'provider-not-configured', matches: /RESEND_API_KEY/ },
    { label: 'a function that is not deployed at all', response: { status: 404, body: '<html>not found</html>' }, reason: 'function-not-deployed', matches: /Deploy it/ },
    { label: 'a missing function reported by machine code', response: { status: 502, body: { code: 'function-not-found' } }, reason: 'function-not-deployed', matches: /Deploy it/ },
    { label: 'a 404 even with a contradictory body code', response: { status: 404, body: { code: 'mail-not-configured' } }, reason: 'function-not-deployed', matches: /Deploy it/ },
    { label: 'a sender the provider has not verified', response: { status: 502, body: { code: 'unverified-sender' } }, reason: 'unverified-sender', matches: /sender address/i },
    { label: 'a provider throttle', response: { status: 502, body: { code: 'provider-rate-limited' } }, reason: 'rate-limited', matches: /rate limiting/i },
    { label: 'a letter the function would not parse', response: { status: 400, body: { code: 'recipient-invalid' } }, reason: 'rejected-content', matches: /rejected the message/ },
    { label: 'a provider that refused the letter', response: { status: 502, body: { code: 'provider-rejected' } }, reason: 'network', matches: /502/ },
    {
      label: 'a fetch exception containing private request data',
      response: { status: 200, throws: new Error(`${SERVICE_KEY} 491327 ${letter.to} ${PROJECT_URL}`) },
      reason: 'network',
      matches: /^The Supabase mail function request failed\.$/,
    },
    {
      label: 'a body read exception containing private request data',
      response: { status: 200, readBody: async () => { throw new Error(`${SERVICE_KEY} 491327 ${letter.to} ${PROJECT_URL}`) } },
      reason: 'network',
      matches: /^The Supabase mail function request failed\.$/,
    },
    {
      label: 'an upstream MailError containing private request data',
      response: { status: 200, throws: new MailError('network', `${SERVICE_KEY} 491327 ${letter.to}`) },
      reason: 'network',
      matches: /^The Supabase mail function request failed\.$/,
    },
    {
      label: 'a timeout',
      response: { status: 200, throws: Object.assign(new Error('This operation was aborted'), { name: 'AbortError' }) },
      reason: 'timeout',
      matches: /within/,
    },
    {
      label: 'a redirect',
      response: { status: 200, throws: new TypeError('redirect was forbidden') },
      reason: 'redirect-refused',
      matches: /redirect/i,
    },
  ]

  for (const testCase of cases) {
    it(`classifies ${testCase.label} without repeating the key, the code or the address`, async () => {
      await withEnv(configured, async () => {
        const probe = stubFetch(testCase.response)
        try {
          const error = (await expect.throws(() => sendMail(letter))) as MailError
          expect.equal(error.reason, testCase.reason as MailError['reason'])
          expect.true(testCase.matches.test(error.message), `message was: ${error.message}`)
          for (const secret of [SERVICE_KEY, '491327', letter.to, PROJECT_URL]) {
            expect.false(error.message.includes(secret), `error message leaked "${secret}"`)
          }
        } finally {
          probe.restore()
        }
      })
    })
  }

  it('accepts an explicit success with a nullable message id', async () => {
    await withEnv(configured, async () => {
      for (const messageId of [null, '', 'a'.repeat(150)]) {
        const probe = stubFetch({ status: 200, body: { ok: true, message_id: messageId } })
        try {
          const result = await sendMail(letter)
          expect.equal(result.accepted, true)
          expect.equal(result.messageId, messageId === null ? null : messageId.slice(0, 128))
        } finally {
          probe.restore()
        }
      }
    })
  })

  const invalidSuccesses = [
    { label: 'malformed JSON', body: '<html>success</html>' },
    { label: 'a null body', body: 'null' },
    { label: 'an array', body: [] },
    { label: 'an empty object', body: {} },
    { label: 'a missing ok field', body: { message_id: 'msg-1' } },
    { label: 'a missing message id', body: { ok: true } },
    { label: 'the legacy id field alone', body: { ok: true, id: 'msg-1' } },
    { label: 'a numeric message id', body: { ok: true, message_id: 1 } },
    { label: 'a string ok field', body: { ok: 'true', message_id: 'msg-1' } },
    { label: 'a false success', body: { ok: false, message_id: null } },
    { label: 'a failure code on HTTP 200', body: { ok: false, code: 'mail-not-configured' } },
  ]

  for (const { label, body } of invalidSuccesses) {
    it(`rejects HTTP 200 with ${label}`, async () => {
      await withEnv(configured, async () => {
        const probe = stubFetch({ status: 200, body })
        try {
          const error = (await expect.throws(() => sendMail(letter))) as MailError
          expect.true(error instanceof MailError)
          expect.equal(error.reason, 'network')
          expect.equal(error.status, 200)
          expect.equal(error.message, 'The Supabase mail function returned an invalid delivery response.')
        } finally {
          probe.restore()
        }
      })
    })
  }

  it('drops arbitrary machine codes even when they resemble valid codes or sender errors', async () => {
    await withEnv(configured, async () => {
      for (const code of ['private-provider-secret-token', 'private-sender-secret-token', SERVICE_KEY, '491327', letter.to]) {
        for (const status of [400, 502]) {
          const probe = stubFetch({ status, body: { code, error: `${SERVICE_KEY} 491327 ${letter.to}` } })
          try {
            const error = (await expect.throws(() => sendMail(letter))) as MailError
            expect.equal(error.reason, status === 400 ? 'rejected-content' : 'network')
            expect.equal(error.message, status === 400
              ? 'The Supabase mail function rejected the message (400).'
              : 'The Supabase mail function returned 502.')
            for (const secret of [code, SERVICE_KEY, '491327', letter.to]) {
              expect.false(error.message.includes(secret), 'upstream text must not be repeated')
            }
          } finally {
            probe.restore()
          }
        }
      }
    })
  })

  it('keeps the abort deadline active while reading the response body', async () => {
    await withEnv({ ...configured, MAIL_TIMEOUT_MS: '1000' }, async () => {
      let bodyStarted = false
      let deadline: ReturnType<typeof setTimeout> | undefined
      const probe = stubFetch({
        status: 200,
        readBody: (signal) => new Promise((_, reject) => {
          bodyStarted = true
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
          deadline = setTimeout(() => reject(new Error('response body deadline was cleared too early')), 2000)
        }),
      })
      try {
        const error = (await expect.throws(() => sendMail(letter))) as MailError
        expect.true(bodyStarted)
        expect.true(probe.calls[0].init.signal?.aborted, 'the request deadline must abort body consumption')
        expect.equal(error.reason, 'timeout')
        expect.true(error.message.includes('1000 ms'))
      } finally {
        clearTimeout(deadline)
        probe.restore()
      }
    })
  })

  it('keeps an upstream complaint from carrying the recipient into our own message', async () => {
    await withEnv(configured, async () => {
      const probe = stubFetch({ status: 400, body: '<html>we cannot deliver to person@somewhere-real.test</html>' })
      try {
        const error = (await expect.throws(() => sendMail(letter))) as MailError
        expect.equal(error.reason, 'rejected-content')
        expect.false(error.message.includes('person@somewhere-real.test'), 'the upstream body is not repeated')
      } finally {
        probe.restore()
      }
    })
  })
})

describe('Demonstration waiver', () => {
  it('is off unless the server switches it on', async () => {
    await withEnv({ ...demoEnv, DEMO_SKIP_EMAIL_CODE: undefined }, () => {
      expect.false(waiverEnabled(), 'no flag means codes are required')
      expect.false(waivedFor('anshika@example.com'), 'not even for a demonstration address')
    })
    await withEnv({ ...demoEnv, DEMO_SKIP_EMAIL_CODE: 'false' }, () => {
      expect.false(waivedFor('anshika@example.com'))
    })
  })

  it('covers reserved addresses and never a deliverable one', async () => {
    await withEnv({ ...demoEnv, DEMO_SKIP_EMAIL_CODE: 'true' }, () => {
      expect.true(waiverEnabled())
      expect.true(waivedFor('anshika@example.com'))
      expect.true(waivedFor('people@meridian.example.com'), 'a subdomain of a reserved domain counts')
      expect.true(waivedFor('admin@syprus.test'))
      expect.false(waivedFor('someone@somewhere-real.com'), 'a real mailbox is never waived')
      expect.false(waivedFor('a@notexample.com'), 'and neither is a lookalike domain')
      expect.false(waivedFor(''), 'an absent address waives nothing')
      expect.false(waivedFor(null))
      expect.false(waivedFor(undefined))
    })
  })

  it('refuses to guess at a value it does not understand', async () => {
    // `true` is the only spelling beside `false`. A typo must not read as "on",
    // and must not be waved through as "off" in silence either.
    await withEnv({ ...demoEnv, DEMO_SKIP_EMAIL_CODE: 'yes-please' }, async () => {
      await expect.throws(() => waiverEnabled(), /DEMO_SKIP_EMAIL_CODE/)
    })
    await withEnv({ ...demoEnv, DEMO_SKIP_EMAIL_CODE: 'TRUE' }, async () => {
      await expect.throws(() => waiverEnabled(), /DEMO_SKIP_EMAIL_CODE/)
    })
  })

  it('explains the demonstration exception without displaying an environment setting', () => {
    expect.false(WAIVER_NOTICE.includes('DEMO_SKIP_EMAIL_CODE'), 'internal setting names stay out of the notice')
    expect.true(WAIVER_NOTICE.includes('demonstration'), 'and say who it applies to')
    expect.true(WAIVER_NOTICE.includes('still require a code'), 'and who it does not')
  })
})

describe('Code field', () => {
  it('accepts what a password manager pastes and nothing shorter', () => {
    for (const value of ['491327', ' 491 327 ', '491-327', '491327\n']) {
      expect.equal(verificationCodeSchema.safeParse({ code: value }).data?.code, '491327', `"${value}" should normalise`)
    }
    for (const value of ['49132', '4913270', 'abcdef', '', '   ']) {
      expect.false(verificationCodeSchema.safeParse({ code: value }).success, `"${value}" must be rejected`)
    }
  })
})
