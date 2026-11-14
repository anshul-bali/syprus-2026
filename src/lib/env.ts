import { z } from 'zod'

const serverEnvSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required for PostgreSQL persistence.'),
  AUTH_SECRET: z
    .string()
    .min(16, 'AUTH_SECRET must be at least 16 characters. Generate one with `npx auth secret`.'),
  AUTH_TRUST_HOST: z.enum(['true', 'false']).optional(),
  NEXT_PUBLIC_APP_URL: z.string().url().optional(),
  POLICY_VERSION: z.string().default('2026-11-01'),
  MATCH_MODEL_VERSION: z.string().default('rules-2026-11-a'),
  SEED_DEMO_PASSWORD: z.string().optional(),
})

export type ServerEnv = z.infer<typeof serverEnvSchema>

let cached: ServerEnv | undefined

/**
 * Reads and validates server-side environment once per process. Surfaces the
 * missing variable names instead of an opaque runtime failure.
 */
export function env(): ServerEnv {
  if (cached) return cached
  const parsed = serverEnvSchema.safeParse(process.env)
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'env'}: ${issue.message}`)
      .join('\n  - ')
    throw new Error(
      `Invalid environment configuration.\n  - ${issues}\n\nCopy .env.example to .env and fill in the values.`,
    )
  }
  cached = parsed.data
  return cached
}

export const policyVersion = () => env().POLICY_VERSION
export const matchModelVersion = () => env().MATCH_MODEL_VERSION

/** Test seam, matching `resetMailConfigCache`: re-read the environment next time. */
export function resetEnvCache() {
  cached = undefined
}
