/**
 * Where the demonstration seed is allowed to write.
 *
 * `prisma/seed.ts` opens with a transaction that deletes every table in the
 * database. That is correct for a disposable cluster and catastrophic anywhere
 * else, and `DATABASE_URL` is the same variable name in both places — so the
 * script cannot be allowed to run on the strength of being invoked. Three
 * separate assertions are required, and all three are checked before the script
 * opens a connection, let alone writes:
 *
 *  1. the operator says this environment is disposable (`SYPRUS_DEMO_ENV`);
 *  2. the operator says the wipe is intended (`SEED_ALLOW_RESET`), because
 *     seeding and destroying are not the same decision;
 *  3. the target itself is a loopback database with a name of its own.
 *
 * The third is the one that does not depend on anyone remembering to set a
 * variable: a Supabase URL is refused on its host alone.
 */

/** Loopback only. A disposable cluster is reached locally or through a forward. */
const DISPOSABLE_HOSTS = ['localhost', '127.0.0.1', '::1']

export type SeedTarget =
  | { allowed: true; host: string; port: number; database: string }
  | { allowed: false; reason: string }

export type SeedTargetInput = {
  connectionString: string | undefined
  demoEnv: string | undefined
  allowReset: string | undefined
  vercelEnv: string | undefined
}

function refuse(reason: string): SeedTarget {
  return { allowed: false, reason }
}

export function evaluateSeedTarget(input: SeedTargetInput): SeedTarget {
  if (input.vercelEnv === 'production') {
    return refuse('VERCEL_ENV=production: the demonstration seed never runs on a deployed environment.')
  }
  if (input.demoEnv !== 'true') {
    return refuse('SYPRUS_DEMO_ENV=true is required. This seed writes invented people and organisations, so it may only run against an environment declared disposable.')
  }
  if (input.allowReset !== 'true') {
    return refuse('SEED_ALLOW_RESET=true is required. This seed deletes every table before writing, so the wipe has to be asked for separately from the seed.')
  }
  if (!input.connectionString) {
    return refuse('DATABASE_URL is not set, so there is no target to judge. Refusing rather than guessing.')
  }

  let url: URL
  try {
    url = new URL(input.connectionString)
  } catch {
    return refuse('DATABASE_URL is not a parseable URL, so its target cannot be judged.')
  }
  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') {
    return refuse(`DATABASE_URL has protocol ${url.protocol}, which is not PostgreSQL.`)
  }

  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (!DISPOSABLE_HOSTS.includes(host)) {
    return refuse(`DATABASE_URL points at "${host}", which is not a loopback host. Point it at a disposable local cluster; a managed or shared database is never a seed target.`)
  }
  // Supabase's pooler authenticates as `postgres.<project-ref>`. Seeing that form
  // on a loopback address means a tunnel to a managed project, not a local one.
  if (decodeURIComponent(url.username).includes('.')) {
    return refuse('DATABASE_URL uses a tenanted username (user.project), which is a managed Supabase project even when the host is loopback.')
  }

  const database = url.pathname.replace(/^\//, '')
  if (!database) {
    return refuse('DATABASE_URL names no database, so the target is ambiguous.')
  }
  if (database === 'postgres') {
    return refuse('DATABASE_URL targets "postgres", the default maintenance database every managed project also has. Name the disposable database explicitly.')
  }

  return { allowed: true, host, port: Number(url.port || 5432), database }
}

/** The decision for this process, read from the environment. */
export function seedTargetFromEnv(env: NodeJS.ProcessEnv = process.env): SeedTarget {
  return evaluateSeedTarget({
    connectionString: env.DATABASE_URL,
    demoEnv: env.SYPRUS_DEMO_ENV,
    allowReset: env.SEED_ALLOW_RESET,
    vercelEnv: env.VERCEL_ENV,
  })
}