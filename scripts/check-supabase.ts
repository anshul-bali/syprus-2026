/**
 * Supabase reachability check.
 *
 * Reads credentials from .env and .env.supabase at runtime and prints only
 * outcomes: hosts, ports, HTTP status codes and error categories. Every line it
 * prints goes through `redact`, so a key or a password cannot reach the output
 * even when a provider or driver echoes one back inside its own error text.
 * Its output is safe to paste anywhere.
 *
 * Run with: npm run check:supabase
 */

import { readFileSync, existsSync } from 'node:fs'
import { redact } from './lib/redact'
import { probeDataApi } from './lib/supabase-probe'
import { supabaseTlsOptions } from '../src/lib/db/supabase-pooler'

if (!process.env.DATABASE_URL && existsSync('.env')) {
  process.loadEnvFile('.env')
}

/** Supabase credentials live in the separate, git-ignored .env.supabase. */
if (existsSync('.env.supabase')) {
  for (const line of readFileSync('.env.supabase', 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const index = trimmed.indexOf('=')
    if (index < 1) continue
    const key = trimmed.slice(0, index)
    const value = trimmed.slice(index + 1).replace(/^["']|["']$/g, '')
    if (key.startsWith('SUPABASE_')) process.env[key] = value
  }
}

let problems = 0

function pass(label: string, detail = '') {
  console.log(`  PASS  ${label}${detail ? ` — ${redact(detail)}` : ''}`)
}
function fail(label: string, detail = '') {
  problems += 1
  console.log(`  FAIL  ${label}${detail ? ` — ${redact(detail)}` : ''}`)
}
function hint(label: string) {
  console.log(`        ${redact(label)}`)
}

function classifyPgError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/password authentication failed|28P01|28000/i.test(message)) return 'authentication rejected (wrong password or user)'
  if (/ECONNREFUSED/i.test(message)) return 'connection refused (port closed, or an IP allowlist is blocking us)'
  if (/ENOTFOUND|getaddrinfo/i.test(message)) return 'host does not resolve (wrong project ref)'
  if (/timeout|ETIMEDOUT/i.test(message)) return 'timed out (direct connections may be disabled, or a firewall is in the way)'
  if (/requires SSL/i.test(message)) return 'server requires SSL'
  // A verification failure is a finding, not something to route around: the
  // certificate presented did not chain to the pinned Supabase root, or it was
  // issued for a different host. Both mean this is not the database we asked for.
  if (/SELF_SIGNED_CERT|UNABLE_TO_VERIFY|DEPTH_ZERO|CERT_HAS_EXPIRED/i.test(message)) {
    return 'TLS certificate did not chain to the pinned Supabase root — connection refused, not downgraded'
  }
  if (/ERR_TLS_CERT_ALTNAME_INVALID|Hostname\/IP does not match/i.test(message)) {
    return 'TLS certificate was issued for a different host — connection refused, not downgraded'
  }
  return redact(message).replace(/[\w.+-]+@/g, '***@').slice(0, 160)
}

async function tryPg(label: string, host: string, port: number, user: string, password: string, database = 'postgres') {
  const { Client } = await import('pg')
  const client = new Client({
    host,
    port,
    user,
    password,
    database,
    // Certificate and hostname verification, against the same pinned root the
    // application itself uses. There is no unverified branch to fall back to.
    ssl: supabaseTlsOptions(host),
    connectionTimeoutMillis: 12000,
  })
  try {
    await client.connect()
    const row = await client.query(
      'select current_user as u, count(*)::int as t from information_schema.tables where table_schema = $1',
      ['public'],
    )
    pass(`${label}: connected`, `user ${row.rows[0].u}, ${row.rows[0].t} public tables`)
    await client.end()
    return true
  } catch (error) {
    fail(`${label}: not connected`, classifyPgError(error))
    return false
  }
}

async function main() {
  const ref = process.env.SUPABASE_PROJECT_REF
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const password = process.env.SUPABASE_DB_PASSWORD
  const dbUser = process.env.SUPABASE_DB_USER || 'postgres'
  const poolerHost = process.env.SUPABASE_POOLER_HOST

  console.log('\nSupabase reachability')
  if (!ref) {
    fail('SUPABASE_PROJECT_REF is not set')
    process.exit(1)
  }
  console.log(`  project ref: ${ref}`)

  if (serviceKey) {
    const result = await probeDataApi({ ref, serviceKey })
    if (result.ok) pass('service key accepted by the Data API', `HTTP ${result.status}`)
    else if ('status' in result) fail('Data API rejected the service key', `HTTP ${result.status}`)
    else fail('Data API unreachable', result.error)
  } else {
    fail('SUPABASE_SERVICE_ROLE_KEY is not set')
  }

  if (!password) {
    fail('no database password', 'set SUPABASE_DB_PASSWORD in .env.supabase')
  } else {
    const direct = await tryPg('direct 5432', `db.${ref}.supabase.co`, 5432, dbUser, password)
    if (!direct && poolerHost) {
      await tryPg(
        'pooler',
        poolerHost,
        Number(process.env.SUPABASE_POOLER_PORT || 6543),
        process.env.SUPABASE_POOLER_USER || `postgres.${ref}`,
        password,
      )
    } else if (!direct) {
      hint('Pooler not attempted: set SUPABASE_POOLER_HOST to try the pooled endpoint.')
    }
  }

  console.log('')
  if (problems > 0) {
    console.log(`${problems} check(s) failed. Most common causes, in order of likelihood:\n`)
    console.log('  1. Wrong database password. Supabase shows it once at creation; if lost, use')
    console.log('     Project Settings → Database → Reset database password, then update .env.supabase.\n')
    console.log('  2. IP allowlist. Project Settings → Network Authorization / "Restrained" mode — if the')
    console.log("     allowlist is enabled, this machine's IP must be added, otherwise 5432 refuses us.\n")
    console.log('  3. Direct connections disabled. Use the pooler, but note transaction pooling (6543)')
    console.log('     cannot run Prisma migrations; use the direct or session endpoint for DDL.\n')
    process.exit(1)
  }
  console.log('Supabase is reachable for Prisma.\n')
}

main().catch((error) => {
  console.error('Check crashed:', redact(error))
  process.exit(1)
})
