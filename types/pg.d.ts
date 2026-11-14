// Minimal typing for the `pg` client used only by scripts/check-supabase.ts.
// The package ships no types; this avoids pulling a dependency into the app.
declare module 'pg' {
  export class Client {
    constructor(config: {
      host: string
      port: number
      user: string
      password: string
      database: string
      ssl?: { rejectUnauthorized: boolean }
      connectionString?: string
      connectionTimeoutMillis?: number
    })
    connect(): Promise<void>
    query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>
    end(): Promise<void>
  }
}
