/**
 * Builds Supabase connection URIs from .env.supabase and, with --apply, writes
 * them into .env for Prisma. The password is never printed: only the host, port
 * and user are shown.
 *
 *   node scripts/apply-supabase-env.mjs              # preview, masked
 *   node scripts/apply-supabase-env.mjs --apply      # direct URI -> DATABASE_URL
 *   node scripts/apply-supabase-env.mjs --apply --target pooler
 *   node scripts/apply-supabase-env.mjs --revert     # back to the local cluster
 *
 * Note on endpoints: `prisma migrate` needs the direct (or session-pooled)
 * endpoint. Transaction pooling on 6543 rejects the prepared statements
 * migrations rely on, so it is only offered as the runtime URL.
 */

import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs'

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const envPath = `${ROOT}/.env`
const secretPath = `${ROOT}/.env.supabase`

function parse(file) {
  if (!existsSync(file)) return {}
  const out = {}
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const index = trimmed.indexOf('=')
    if (index < 1) continue
    out[trimmed.slice(0, index)] = trimmed.slice(index + 1).replace(/^["']|["']$/g, '')
  }
  return out
}

const secrets = parse(secretPath)
const current = parse(envPath)

const ref = secrets.SUPABASE_PROJECT_REF
const password = secrets.SUPABASE_DB_PASSWORD
const user = secrets.SUPABASE_DB_USER || 'postgres'
const database = secrets.SUPABASE_DB_NAME || 'postgres'

if (!existsSync(secretPath)) {
  console.error('.env.supabase is missing. Add SUPABASE_PROJECT_REF and SUPABASE_DB_PASSWORD there.')
  process.exit(1)
}
if (!ref || !password) {
  console.error('.env.supabase must define SUPABASE_PROJECT_REF and SUPABASE_DB_PASSWORD.')
  process.exit(1)
}

/** '@' in a password would otherwise split userinfo from host. */
const encoded = encodeURIComponent(password)

const directHost = `db.${ref}.supabase.co`
const direct = `postgresql://${user}:${encoded}@${directHost}:5432/${database}?sslmode=require&connection_limit=10`
const pooler = secrets.SUPABASE_POOLER_HOST
  ? `postgresql://${secrets.SUPABASE_POOLER_USER || `postgres.${ref}`}:${encoded}@${secrets.SUPABASE_POOLER_HOST}:${secrets.SUPABASE_POOLER_PORT || 6543}/${database}?sslmode=require&pgbouncer=true&connection_limit=1`
  : null

function mask(uri) {
  return uri.replace(/:[^:@/]+@/, ':***@')
}

const args = process.argv.slice(2)
const apply = args.includes('--apply')
const revert = args.includes('--revert')
const target = args.includes('--target') ? args[args.indexOf('--target') + 1] : 'direct'

const LOCAL_URL = 'postgresql://syprus:syprus_local_dev@localhost:55432/syprus'

if (revert) {
  rewrite({ DATABASE_URL: LOCAL_URL, DIRECT_DATABASE_URL: '' })
  console.log('DATABASE_URL restored to the local embedded cluster.')
  process.exit(0)
}

console.log('\nSupabase connection targets (password masked)')
console.log(`  project   ${ref}`)
console.log(`  direct    ${mask(direct)}`)
console.log(`  pooler    ${pooler ? mask(pooler) : 'not configured (set SUPABASE_POOLER_HOST)'}`)
console.log(`  current DATABASE_URL host: ${current.DATABASE_URL ? new URL(current.DATABASE_URL).host : 'unset'}`)

if (!apply) {
  console.log('\nDry run only. Re-run with --apply to write these into .env (a backup is taken first).\n')
  process.exit(0)
}

if (target === 'pooler' && !pooler) {
  console.error('\n--target pooler requested but SUPABASE_POOLER_HOST is not set. Aborting without changes.')
  process.exit(1)
}

const chosen = target === 'pooler' ? pooler : direct
// Migrations always go through the direct endpoint; the pooler URL, if used for
// runtime, still needs a direct URL for DDL.
rewrite({ DATABASE_URL: chosen, DIRECT_DATABASE_URL: direct })

console.log(`\nApplied --target ${target}:`)
console.log(`  DATABASE_URL         = ${mask(chosen)}`)
console.log(`  DIRECT_DATABASE_URL  = ${mask(direct)}`)
console.log('  Backup written to .env.backup-before-supabase\n')

function rewrite(values) {
  copyFileSync(envPath, `${ROOT}/.env.backup-before-supabase`)
  const lines = readFileSync(envPath, 'utf8').split(/\r?\n/)
  const kept = lines.filter((line) => !/^(DATABASE_URL|DIRECT_DATABASE_URL)=/.test(line.trim()))

  const additions = []
  for (const [key, value] of Object.entries(values)) {
    if (!value) continue
    additions.push(`${key}="${value}"`)
  }

  const header = kept.findIndex((line) => /^# --- Database/.test(line))
  if (header >= 0) {
    kept.splice(header + 1, 0, ...additions)
  } else {
    kept.push('', '# Added by scripts/apply-supabase-env.mjs', ...additions)
  }

  writeFileSync(envPath, kept.join('\n').replace(/\n{3,}/g, '\n\n'))
}
