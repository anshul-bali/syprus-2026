// The shared client, so this check reaches the database the same way the app
// does — including the pinned Supabase pooler certificate. A second bare
// PrismaClient here would fail TLS against the pooler and report a connectivity
// problem that the application does not have.
import { prisma } from '../src/lib/db'

async function main() {
  // Catalogue columns are Postgres's internal `name` type, which the pg driver
  // adapter cannot deserialize; casting to text is what makes them readable.
  const roles = await prisma.$queryRaw<{ rolname: string }[]>`SELECT rolname::text AS rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated')`
  const tables = await prisma.$queryRaw<{ name: string; rls: boolean }[]>`SELECT c.relname::text AS name, c.relrowsecurity AS rls FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY c.relname`
  console.log('Public tables:', tables.length, 'RLS enabled:', tables.filter((t) => t.rls).length)
  for (const role of roles) {
    const accessible = await prisma.$queryRaw<{ name: string; rls: boolean }[]>`SELECT c.relname::text AS name, c.relrowsecurity AS rls FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' AND has_table_privilege(${role.rolname}, c.oid, 'SELECT') ORDER BY c.relname`
    console.log(`${role.rolname}: tables with SELECT=${accessible.length}; without RLS=${accessible.filter((t) => !t.rls).length}`)
    if (accessible.some((t) => !t.rls)) { console.log('Unprotected table names:', accessible.filter((t) => !t.rls).map((t) => t.name).join(', ')); process.exitCode = 1 }
  }
  const policies = await prisma.$queryRaw<{ count: bigint }[]>`SELECT count(*) FROM pg_policies WHERE schemaname = 'public'`
  console.log('Public RLS policies:', String(policies[0].count))
  const migrations = await prisma.$queryRaw<{ migration_name: string }[]>`SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL ORDER BY migration_name`
  console.log('Applied migrations:', migrations.map((m) => m.migration_name).join(', '))
  const columns = await prisma.$queryRaw<{ exists: boolean }[]>`SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'applications' AND column_name = 'identityConsentAt') AS exists`
  console.log('Explicit application consent migration present:', columns[0].exists)
  if (!columns[0].exists) process.exitCode = 1
}
main().catch(() => { console.error('Security metadata check failed; inspect server-side database connectivity.'); process.exitCode = 1 }).finally(() => prisma.$disconnect())
