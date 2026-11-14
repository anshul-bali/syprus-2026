import type { RequirementSource } from './schemas'

/**
 * Job-requirement source interface.
 *
 * The MVP reads postings from the platform database. A live jobs API can be
 * added later by implementing this same interface — which is the point: the
 * matching and market-intelligence code never learns whether the requirement set
 * came from inside the platform or from an external feed, so it cannot quietly
 * start treating one as if it were the other.
 */

export type RequirementSet = {
  /** Identifier from the source: a database id, or the feed's own id. */
  externalId: string
  title: string
  organizationName: string
  source: RequirementSource
  /** Timestamp as reported by the source, not "now". */
  asOf: Date
  skills: {
    slug: string
    requirement: 'REQUIRED' | 'PREFERRED'
    level: string
    weight: number
  }[]
  experienceYearsMin: number | null
  experienceYearsMax: number | null
  url?: string | null
}

export type RequirementQuery = {
  skillSlugs?: string[]
  titleContains?: string
  limit?: number
}

export interface JobRequirementSource {
  readonly key: string
  readonly label: string
  readonly kind: 'database' | 'http' | 'file'
  readonly sourceType: RequirementSource
  /**
   * Only true for a connector that is enabled AND credentialed. A source that
   * cannot reach its feed reports unavailable rather than returning invented
   * postings, so "no data" is distinguishable from "fabricated data".
   */
  isLive(): boolean
  available(): Promise<boolean>
  fetch(query: RequirementQuery): Promise<RequirementSet[]>
  describe(): { key: string; label: string; kind: string; sourceType: string; live: boolean; reason?: string }
}

/**
 * Adapter over the platform's own postings. The loader is injected so this file
 * stays free of database imports and the same adapter can be used in tests.
 */
export function createDatabaseRequirementSource(
  load: (query: RequirementQuery) => Promise<RequirementSet[]>,
): JobRequirementSource {
  return {
    key: 'platform-database',
    label: 'Platform job postings',
    kind: 'database',
    sourceType: 'DATABASE_POSTINGS',
    isLive: () => false,
    async available() {
      return true
    },
    fetch: (query) => load(query),
    describe: () => ({
      key: 'platform-database',
      label: 'Platform job postings',
      kind: 'database',
      sourceType: 'DATABASE_POSTINGS',
      live: false,
      reason: 'Internal postings. Market coverage is limited to what employers have published here.',
    }),
  }
}

export type HttpSourceConfig = {
  key: string
  label: string
  baseUrl: string
  apiKey?: string
  /** Maps the feed's payload into the shared RequirementSet shape. */
  mapResponse: (payload: unknown) => RequirementSet[]
  timeoutMs?: number
}

/**
 * Live connector scaffold. Deliberately refuses to run without valid access, and
 * refuses to return anything when the feed fails — an empty result is honest, an
 * invented posting is not.
 */
export function createHttpRequirementSource(config: HttpSourceConfig): JobRequirementSource {
  const credentialed = Boolean(config.apiKey)
  const reason = !credentialed
    ? `No credential configured for ${config.key}; connector disabled rather than falling back to invented data.`
    : undefined

  return {
    key: config.key,
    label: config.label,
    kind: 'http',
    sourceType: 'LIVE_PROVIDER',
    isLive: () => credentialed,
    async available() {
      return credentialed
    },
    async fetch(query) {
      if (!credentialed) {
        throw new Error(reason ?? 'Live job connector is not available.')
      }
      const url = new URL(config.baseUrl)
      url.searchParams.set('limit', String(query.limit ?? 50))
      if (query.titleContains) url.searchParams.set('q', query.titleContains)

      const response = await fetch(url, {
        headers: { authorization: `Bearer ${config.apiKey}`, accept: 'application/json' },
        signal: AbortSignal.timeout(config.timeoutMs ?? 15000),
      })
      if (!response.ok) {
        // Surfaced as an error so the caller can report "feed unavailable",
        // never silently substituted with local data presented as live.
        throw new Error(`Live job feed responded ${response.status}.`)
      }
      const mapped = config.mapResponse(await response.json())
      return mapped.map((set) => ({ ...set, source: 'LIVE_PROVIDER' as const, asOf: new Date() }))
    },
    describe: () => ({
      key: config.key,
      label: config.label,
      kind: 'http',
      sourceType: 'LIVE_PROVIDER',
      live: credentialed,
      reason,
    }),
  }
}

/** Registry the market-intelligence service resolves against. */
export class RequirementSourceRegistry {
  private readonly sources = new Map<string, JobRequirementSource>()

  register(source: JobRequirementSource) {
    this.sources.set(source.key, source)
    return this
  }

  get(key: string) {
    return this.sources.get(key) ?? null
  }

  default(): JobRequirementSource | null {
    return this.sources.get('platform-database') ?? [...this.sources.values()][0] ?? null
  }

  list() {
    return [...this.sources.values()].map((source) => source.describe())
  }

  /**
   * Resolves a live source only if it can genuinely be reached; otherwise the
   * caller falls back to the database source and says so in the output.
   */
  async resolvePreferred(preferredKey?: string | null) {
    const preferred = preferredKey ? this.get(preferredKey) : null
    if (preferred?.isLive() && (await preferred.available())) {
      return { source: preferred, usedLive: true }
    }
    const fallback = this.default()
    if (!fallback) throw new Error('No job requirement source is registered.')
    return { source: fallback, usedLive: false }
  }
}
