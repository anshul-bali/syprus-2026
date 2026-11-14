import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { supabaseTlsOptions, usesSupabasePooler } from './db/supabase-pooler'

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

// The shared pooler needs its private CA while retaining certificate and hostname verification.
function createClient() {
  const log: ('warn' | 'error')[] = process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error']
  const connectionString = process.env.DATABASE_URL
  if (!usesSupabasePooler(connectionString)) return new PrismaClient({ log })

  const parsed = new URL(connectionString as string)
  const host = parsed.hostname
  const adapter = new PrismaPg({
    // Field by field rather than `connectionString`: pg parses `sslmode` out of a
    // URL, and nothing written in one may be able to switch verification off.
    host,
    port: Number(parsed.port || 5432),
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.replace(/^\//, '') || 'postgres',
    ssl: supabaseTlsOptions(host),
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 15_000,
  })
  return new PrismaClient({ adapter, log })
}

export const prisma = globalForPrisma.prisma ?? createClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
