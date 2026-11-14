import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import tls from 'node:tls'
import { describe, it, expect } from './harness'
import { redact, containsSecret } from '../scripts/lib/redact'
import { probeDataApi } from '../scripts/lib/supabase-probe'
import { SUPABASE_ROOT_CA_PEM, supabaseTlsOptions } from '../src/lib/db/supabase-pooler'
import { evaluateSeedTarget } from '../src/lib/db/seed-guard'
import { demoEnvironment } from '../src/lib/demo-mode'
import { waiverEnabled, waivedFor } from '../src/lib/demo-waiver'
import { mailConfig, resetMailConfigCache, reservedDomainFor } from '../src/lib/mail/config'

/**
 * The boundaries a security fix has to keep, proved rather than asserted.
 *
 * Each case here corresponds to a way this application could leak a credential
 * or hand over an account: a key in a URL, a database connection that accepts any
 * certificate, a demonstration shortcut reachable from a public deployment, and
 * a seed script that wipes a database it was never meant to touch.
 */

const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiJ9.fixture-service-role-value-not-a-real-key.sig'
const DB_PASSWORD = 'fixture-db-password-not-real'

async function withEnv(values: Record<string, string | undefined>, body: () => void | Promise<void>) {
  const keys = Object.keys(values)
  const saved = new Map(keys.map((key) => [key, process.env[key]]))
  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    resetMailConfigCache()
    await body()
  } finally {
    for (const key of keys) {
      const value = saved.get(key)
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    resetMailConfigCache()
  }
}

// ---------------------------------------------------------------------------
// Credentials in URLs and logs
// ---------------------------------------------------------------------------

describe('Data API probe keeps the credential out of the URL', () => {
  it('sends the key in headers, refuses redirects, and puts no query on the URL', async () => {
    const original = globalThis.fetch
    let seenUrl = ''
    let seen: RequestInit | undefined
    globalThis.fetch = (async (url: string | URL | Request, options?: RequestInit) => {
      seenUrl = String(url)
      seen = options
      return new Response('{}', { status: 200 })
    }) as typeof fetch
    try {
      const result = await probeDataApi({ ref: 'fixture-ref', serviceKey: SERVICE_KEY })
      expect.true(result.ok, 'a 200 is a pass')
      expect.false(seenUrl.includes('?'), 'the URL must carry no query string at all')
      expect.false(seenUrl.includes(SERVICE_KEY), 'and certainly not the key')
      expect.equal(seenUrl, 'https://fixture-ref.supabase.co/rest/v1/')
      const headers = seen?.headers as Record<string, string>
      expect.equal(headers.apikey, SERVICE_KEY, 'PostGREST reads the key from this header')
      expect.equal(headers.authorization, `Bearer ${SERVICE_KEY}`)
      expect.equal(seen?.redirect, 'error', 'a redirect would replay both headers to another host')
    } finally {
      globalThis.fetch = original
    }
  })

  it('reports a rejection by status, without reading the body', async () => {
    const original = globalThis.fetch
    globalThis.fetch = (async () => new Response('the key is ' + SERVICE_KEY, { status: 401 })) as typeof fetch
    try {
      const result = await probeDataApi({ ref: 'fixture-ref', serviceKey: SERVICE_KEY })
      expect.false(result.ok)
      expect.equal('status' in result && result.status, 401)
      expect.false(JSON.stringify(result).includes(SERVICE_KEY), 'the provider body is never carried onward')
    } finally {
      globalThis.fetch = original
    }
  })

  it('redacts the key even when the transport error quotes it back', async () => {
    const original = globalThis.fetch
    globalThis.fetch = (async () => {
      throw new TypeError(`fetch failed for https://fixture-ref.supabase.co/rest/v1/ with apikey=${SERVICE_KEY}`)
    }) as typeof fetch
    try {
      await withEnv({ SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY }, async () => {
        const result = await probeDataApi({ ref: 'fixture-ref', serviceKey: SERVICE_KEY })
        expect.false(result.ok)
        const text = 'error' in result ? result.error : ''
        expect.true(text.length > 0, 'the operator still gets a reason')
        expect.false(text.includes(SERVICE_KEY), 'but never the credential')
      })
    } finally {
      globalThis.fetch = original
    }
  })
})

describe('Output redaction', () => {
  const env = {
    SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
    SUPABASE_DB_PASSWORD: DB_PASSWORD,
    SMTP_PASS: 'fixture-app-password-value',
    DATABASE_URL: `postgresql://postgres.ref:${DB_PASSWORD}@aws-0-region.pooler.supabase.com:6543/postgres`,
  }

  it('strips URL userinfo, apikey parameters, bearer headers and JWTs', () => {
    for (const text of [
      `connection failed: postgresql://user:${DB_PASSWORD}@db.example.co:5432/postgres`,
      `GET https://x.supabase.co/rest/v1/?apikey=${SERVICE_KEY} failed`,
      `authorization: Bearer ${SERVICE_KEY} was rejected`,
      `upstream said token=${SERVICE_KEY}`,
    ]) {
      const clean = redact(text, env)
      expect.false(clean.includes(DB_PASSWORD), `password survived: ${clean}`)
      expect.false(clean.includes(SERVICE_KEY), `key survived: ${clean}`)
      expect.true(clean.includes('[redacted]'), 'and the reader can see something was withheld')
    }
  })

  it('removes a secret the environment knows even when it appears in bare prose', () => {
    const clean = redact(new Error(`535 authentication failed for ${env.SMTP_PASS}`), env)
    expect.false(clean.includes(env.SMTP_PASS), 'an app password echoed by SMTP must not be printed')
    expect.true(clean.includes('535'), 'the diagnostic itself survives')
  })

  it('leaves ordinary diagnostics alone', () => {
    const text = 'ECONNREFUSED 127.0.0.1:5432 — connection refused'
    expect.equal(redact(text, {}), text)
    expect.false(containsSecret(text, {}))
  })

  it('recognises what it has redacted', () => {
    expect.true(containsSecret(`?apikey=${SERVICE_KEY}`, env))
    expect.true(containsSecret(DB_PASSWORD, env))
    expect.false(containsSecret('HTTP 401', env))
  })
})

// ---------------------------------------------------------------------------
// TLS
// ---------------------------------------------------------------------------

/** A throwaway self-signed peer, generated per run so no key is ever committed. */
function selfSignedPeer() {
  try {
    execFileSync('openssl', ['version'], { stdio: 'pipe' })
  } catch {
    throw new Error('openssl is required to run the TLS rejection tests; it was not found on PATH')
  }
  const dir = mkdtempSync(path.join(tmpdir(), 'syprus-tls-'))
  const key = path.join(dir, 'key.pem')
  const cert = path.join(dir, 'cert.pem')
  execFileSync(
    'openssl',
    ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1',
      '-subj', '/CN=other-host', '-addext', 'subjectAltName=DNS:other-host', '-addext', 'basicConstraints=critical,CA:TRUE'],
    { stdio: 'pipe' },
  )
  return { dir, key: readFileSync(key), cert: readFileSync(cert) }
}

/** Resolves with the failure code, or rejects if the peer was accepted. */
function expectRejection(options: tls.ConnectionOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ ...options, timeout: 8000 }, () => {
      socket.destroy()
      reject(new Error('the peer was accepted — verification did not reject it'))
    })
    socket.on('error', (error: NodeJS.ErrnoException) => {
      socket.destroy()
      resolve(error.code ?? error.message)
    })
    socket.on('timeout', () => {
      socket.destroy()
      reject(new Error('the TLS attempt timed out instead of failing'))
    })
  })
}

describe('Database TLS verification', () => {
  it('asks for certificate and hostname verification against the pinned root', () => {
    const options = supabaseTlsOptions('aws-0-region.pooler.supabase.com')
    expect.equal(options.rejectUnauthorized, true, 'there is no unverified branch')
    expect.equal(options.servername, 'aws-0-region.pooler.supabase.com', 'the name checked is the host dialled')
    expect.equal(options.ca, SUPABASE_ROOT_CA_PEM)
  })

  it('refuses a self-signed peer, and refuses a certificate issued for another host', async () => {
    const peer = selfSignedPeer()
    const server = tls.createServer({ key: peer.key, cert: peer.cert }, (socket) => socket.end())
    // The client hanging up mid-handshake is the expected outcome here.
    server.on('tlsClientError', () => {})
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as { port: number }).port
    try {
      const untrusted = await expectRejection({ host: '127.0.0.1', port, ...supabaseTlsOptions('127.0.0.1') })
      expect.true(
        /SELF_SIGNED|UNABLE_TO_VERIFY|DEPTH_ZERO|CERT/.test(untrusted),
        `expected a certificate-verification failure, got ${untrusted}`,
      )

      // Trusting the certificate explicitly isolates the second guarantee: even
      // a peer we trust must be presenting a certificate for the host we asked
      // for. Only `ca` is overridden; the verification flags are the real ones.
      const wrongHost = await expectRejection({
        host: '127.0.0.1',
        port,
        ...supabaseTlsOptions('localhost'),
        ca: peer.cert,
      })
      expect.true(
        /ALTNAME|Hostname\/IP does not match/.test(wrongHost),
        `expected a hostname mismatch, got ${wrongHost}`,
      )
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
      rmSync(peer.dir, { recursive: true, force: true })
    }
  })
})

// ---------------------------------------------------------------------------
// Demonstration shortcuts
// ---------------------------------------------------------------------------

const clearDemo = { SYPRUS_DEMO_ENV: undefined, VERCEL_ENV: undefined, DEMO_SKIP_EMAIL_CODE: undefined, MAIL_MODE: undefined }
const declaredDemo = { SYPRUS_DEMO_ENV: 'true', VERCEL_ENV: undefined }

describe('Demonstration shortcuts fail closed off the demo environment', () => {
  it('needs the environment declaration, not just the waiver flag', async () => {
    await withEnv({ ...clearDemo, DEMO_SKIP_EMAIL_CODE: 'true' }, () => {
      expect.false(demoEnvironment(), 'no declaration means not a demo environment')
      expect.false(waiverEnabled(), 'the flag alone must not waive a code')
      expect.false(waivedFor('admin@syprus.example.com'))
    })
    await withEnv({ ...clearDemo, SYPRUS_DEMO_ENV: 'false', DEMO_SKIP_EMAIL_CODE: 'true' }, () => {
      expect.false(waiverEnabled())
    })
    await withEnv({ ...declaredDemo, DEMO_SKIP_EMAIL_CODE: 'true' }, () => {
      expect.true(waiverEnabled(), 'a declared demo environment still gets the walkthrough')
      expect.true(waivedFor('anshika@example.com'))
    })
  })

  it('is refused on Vercel production even when every flag is set', async () => {
    await withEnv({ SYPRUS_DEMO_ENV: 'true', VERCEL_ENV: 'production', DEMO_SKIP_EMAIL_CODE: 'true', MAIL_MODE: 'preview' }, () => {
      expect.false(demoEnvironment(), 'the platform variable outranks the application flag')
      expect.false(waiverEnabled())
      expect.false(waivedFor('admin@syprus.example.com'))
      expect.equal(mailConfig().mode, 'supabase')
      expect.notEqual(mailConfig().delivery, 'screen-only')
    })
  })

  it('refuses MAIL_MODE=preview outside a demo environment and says so', async () => {
    await withEnv({ ...clearDemo, MAIL_MODE: 'preview' }, () => {
      const config = mailConfig()
      expect.equal(config.mode, 'supabase', 'preview is a request, not a permission')
      expect.notEqual(config.delivery, 'screen-only')
      expect.true(config.missing.some((entry) => entry.includes('was refused')), 'the refusal is reported, not silent')
    })
    await withEnv({ ...declaredDemo, MAIL_MODE: 'preview' }, () => {
      expect.equal(mailConfig().mode, 'preview', 'and it is honoured where it belongs')
    })
  })

  it('closes the auto-mode reserved-domain path that exposed the seeded administrator', async () => {
    // The account is undeliverable, which is exactly why `auto` used to show its
    // code on screen. Being undeliverable is not a permission.
    expect.equal(reservedDomainFor('admin@syprus.example.com'), 'example.com')
    await withEnv({ ...clearDemo, MAIL_MODE: 'auto' }, () => {
      expect.equal(mailConfig().mode, 'supabase', 'so the reserved-domain branch is unreachable here')
    })
    await withEnv({ ...clearDemo }, () => {
      expect.equal(mailConfig().mode, 'supabase', 'including when MAIL_MODE is unset')
    })
    await withEnv({ ...declaredDemo, MAIL_MODE: 'auto' }, () => {
      expect.equal(mailConfig().mode, 'auto', 'the walkthrough keeps working on a demo machine')
    })
  })

  it('does not fall back to a screen-only mode when the configuration is unreadable', async () => {
    await withEnv({ ...declaredDemo, MAIL_MODE: 'carrier-pigeon' }, () => {
      expect.equal(mailConfig().mode, 'supabase', 'even on a demo machine, a bad mode fails closed')
      expect.equal(mailConfig().delivery, 'not-configured')
    })
  })
})

// ---------------------------------------------------------------------------
// Seed target
// ---------------------------------------------------------------------------

const QA_URL = 'postgresql://syprus:syprus_qa_local@localhost:55433/syprus_qa'
const allFlags = { demoEnv: 'true', allowReset: 'true', vercelEnv: undefined }

describe('Seed target guard', () => {
  it('allows the isolated local cluster when all three assertions are present', () => {
    const decision = evaluateSeedTarget({ ...allFlags, connectionString: QA_URL })
    expect.true(decision.allowed, decision.allowed ? '' : decision.reason)
    if (decision.allowed) {
      expect.equal(decision.host, 'localhost')
      expect.equal(decision.port, 55433)
      expect.equal(decision.database, 'syprus_qa')
    }
  })

  it('refuses every managed or remote target, whatever the flags say', () => {
    for (const connectionString of [
      'postgresql://postgres.ref:pw@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres',
      'postgresql://postgres:pw@db.ref.supabase.co:5432/postgres',
      'postgresql://user:pw@10.0.0.5:5432/syprus',
      'postgresql://user:pw@localhost.attacker.tld:5432/syprus_qa',
      'postgresql://user:pw@127.0.0.1.evil.tld:5432/syprus_qa',
      // A tunnel to a managed project still authenticates as user.project.
      'postgresql://postgres.ref:pw@localhost:5432/syprus_qa',
    ]) {
      const decision = evaluateSeedTarget({ ...allFlags, connectionString })
      expect.false(decision.allowed, `${connectionString} must be refused`)
    }
  })

  it('refuses an ambiguous or absent target', () => {
    for (const connectionString of [
      undefined,
      '',
      'not a url',
      'mysql://user:pw@localhost:3306/syprus',
      'postgresql://user:pw@localhost:5432/',
      'postgresql://user:pw@localhost:5432/postgres',
    ]) {
      expect.false(evaluateSeedTarget({ ...allFlags, connectionString }).allowed, `${connectionString ?? 'absent'} must be refused`)
    }
  })

  it('requires the environment declaration and the reset acknowledgement separately', () => {
    expect.false(evaluateSeedTarget({ ...allFlags, demoEnv: undefined, connectionString: QA_URL }).allowed)
    expect.false(evaluateSeedTarget({ ...allFlags, demoEnv: 'false', connectionString: QA_URL }).allowed)
    expect.false(evaluateSeedTarget({ ...allFlags, allowReset: undefined, connectionString: QA_URL }).allowed)
    expect.false(evaluateSeedTarget({ ...allFlags, allowReset: 'false', connectionString: QA_URL }).allowed)
    expect.false(
      evaluateSeedTarget({ ...allFlags, vercelEnv: 'production', connectionString: QA_URL }).allowed,
      'a deployed environment is never a seed target',
    )
  })
})

describe('Seed script refuses before it writes', () => {
  /**
   * The child gets the parent environment because Node on Windows needs it to
   * initialise, with every variable the guard reads set explicitly. DATABASE_URL
   * is always present, so the seed never loads `.env` and the case decides the
   * outcome rather than the developer's own configuration.
   */
  function runSeed(connectionString: string, overrides: Record<string, string | undefined> = {}) {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      DATABASE_URL: connectionString,
      SYPRUS_DEMO_ENV: 'true',
      SEED_ALLOW_RESET: 'true',
      SEED_DEMO_PASSWORD: 'fixture-password-not-a-real-one',
    }
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) delete env[key]
      else env[key] = value
    }
    return spawnSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'prisma/seed.ts'], {
      cwd: process.cwd(),
      env,
      encoding: 'utf8',
      timeout: 90_000,
    })
  }

  it('exits non-zero on a managed target and reports that nothing was written', () => {
    const result = runSeed('postgresql://postgres.ref:pw@aws-0-region.pooler.supabase.com:6543/postgres')
    expect.equal(result.status, 1, `expected exit 1, got ${result.status}: ${result.stderr}`)
    const output = `${result.stdout}${result.stderr}`
    expect.true(output.includes('Seed refused'), 'the operator is told why')
    expect.true(output.includes('nothing was written'), 'and told that no write happened')
    expect.false(output.includes('Seed complete'), 'the seed must not have run')
    expect.false(output.includes('writing DEMONSTRATION data'), 'it must refuse before main() starts')
  })

  it('exits non-zero without the reset acknowledgement, even on a local target', () => {
    const result = runSeed(QA_URL, { SEED_ALLOW_RESET: undefined })
    expect.equal(result.status, 1, `expected exit 1, got ${result.status}: ${result.stderr}`)
    expect.true(`${result.stdout}${result.stderr}`.includes('SEED_ALLOW_RESET'))
  })

  it('refuses a weak or empty password rather than falling back to a published one', () => {
    // An explicit value is used rather than an unset variable: `@prisma/client`
    // loads `.env` on import, so an unset one would be filled from the developer's
    // own file and the case would measure that file instead of the rule.
    for (const password of ['', 'short', 'SyprusDemo!']) {
      const result = runSeed(QA_URL, { SEED_DEMO_PASSWORD: password })
      expect.equal(result.status, 1, `expected exit 1 for a ${password.length}-character password, got ${result.status}`)
      const output = `${result.stdout}${result.stderr}`
      expect.true(output.includes('SEED_DEMO_PASSWORD'), 'the operator is told which setting to fix')
      expect.true(output.includes('nothing was written'), 'and that no write happened')
      expect.false(output.includes('Seed complete'), 'the seed must not have run')
    }
  })
})