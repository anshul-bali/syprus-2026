// Single class-merger for the whole app: the same `cn` the shadcn components
// (Base UI wrappers) import, so overrides resolve identically everywhere.
export { cn } from 'cn'


export function formatDate(value: Date | string | null | undefined, fallback = 'Not set') {
  if (!value) return fallback
  const date = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(date.getTime())) return fallback
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function formatDateTime(value: Date | string | null | undefined, fallback = 'Not set') {
  if (!value) return fallback
  const date = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(date.getTime())) return fallback
  return date.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Clock time only, for short-lived deadlines such as a verification code. */
export function formatClock(value: Date | string | null | undefined, fallback = 'Not set') {
  if (!value) return fallback
  const date = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(date.getTime())) return fallback
  return date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
}

export function relativeTime(value: Date | string | null | undefined) {
  if (!value) return 'No date'
  const date = typeof value === 'string' ? new Date(value) : value
  const diffMs = Date.now() - date.getTime()
  const minutes = Math.round(diffMs / 60_000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hr ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`
  const months = Math.round(days / 30)
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`
  return `${Math.round(months / 12)} year${months < 18 ? '' : 's'} ago`
}

export function formatMonths(months: number | null | undefined) {
  if (months == null) return 'Not recorded'
  if (months === 0) return 'No career break recorded'
  if (months < 12) return `${months} month${months === 1 ? '' : 's'}`
  const years = Math.floor(months / 12)
  const remainder = months % 12
  if (remainder === 0) return `${years} year${years === 1 ? '' : 's'}`
  return `${years} year${years === 1 ? '' : 's'} ${remainder} month${remainder === 1 ? '' : 's'}`
}

export function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function titleCase(value: string) {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

export function initials(name: string | null | undefined, fallback = 'SY') {
  if (!name) return fallback
  const parts = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
  return parts.map((part) => part[0]?.toUpperCase() ?? '').join('') || fallback
}

export function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value))
}

export function toPercent(value: number, digits = 0) {
  return `${(value * 100).toFixed(digits)}%`
}

export function round1(value: number) {
  return Math.round(value * 10) / 10
}

/**
 * Produces a stable, human-readable anonymous handle such as `SYPR-7F3K`.
 * Employer-facing screens show this instead of names while sharing is anonymous.
 */
export function anonymousHandle(seed: string) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let hash = 0
  for (let index = 0; index < seed.length; index++) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0
  }
  let suffix = ''
  for (let index = 0; index < 4; index++) {
    suffix += alphabet[hash % alphabet.length]
    hash = Math.floor(hash / alphabet.length) + index * 977
  }
  return `SYPR-${suffix}`
}

export function groupBy<T>(items: T[], keyFor: (item: T) => string) {
  return items.reduce<Record<string, T[]>>((accumulator, item) => {
    const key = keyFor(item)
    ;(accumulator[key] ||= []).push(item)
    return accumulator
  }, {})
}
