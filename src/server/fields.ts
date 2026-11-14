import { Prisma } from '@prisma/client'
import type { Prisma as PrismaTypes } from '@prisma/client'

/**
 * Small Prisma input adapters shared by every service, so JSON and blank-string
 * handling is written once instead of re-cast at each call site.
 */

/** For non-nullable `Json` columns: never NULL, empty becomes an empty object. */
export function json(value: unknown): PrismaTypes.InputJsonValue {
  if (value === undefined || value === null) return {} as PrismaTypes.InputJsonValue
  return value as PrismaTypes.InputJsonValue
}

/** For nullable `Json` columns: omit the key entirely rather than writing NULL. */
export function jsonOrNull(value: unknown): PrismaTypes.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined
  return value as PrismaTypes.InputJsonValue
}

export const DB_NULL = Prisma.DbNull

/** Optional string column: trims and converts empty to NULL. */
export function nullableString(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

/** Optional number column. */
export function nullableNumber(value: number | null | undefined): number | null {
  return value == null || Number.isNaN(value) ? null : value
}

/** Optional date column, rejecting invalid dates rather than writing `Invalid Date`. */
export function nullableDate(value: Date | null | undefined): Date | null {
  if (!value) return null
  return Number.isNaN(value.getTime()) ? null : value
}
