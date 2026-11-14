'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * Server-component errors are masked in production; the digest is the only
 * handle that matches a server log line.
 */
function readDigest(value: unknown): string | null {
  if (value && typeof value === 'object' && 'digest' in value) {
    const digest = (value as { digest?: unknown }).digest
    if (typeof digest === 'string') return digest
  }
  return null
}

function readDetail(value: unknown): string {
  const devDetail = value instanceof Error && value.message ? value.message : null
  return (
    (process.env.NODE_ENV === 'development' ? devDetail : null) ??
    'The page could not be rendered. Nothing was lost — try again, or return to the overview.'
  )
}

export default function AppError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error('SYPRUS render error', error)
  }, [error])

  const digest = readDigest(error)
  const detail = readDetail(error)

  return (
    <main
      id="main"
      className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-5 px-4 py-16 sm:px-6"
    >
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-amber-50 text-amber-700">
          <AlertTriangle className="size-5" aria-hidden />
        </span>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Something went wrong</h1>
          <p role="status" className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {detail}
          </p>
          {digest ? <p className="mt-2 font-mono text-xs text-muted-foreground">Reference {digest}</p> : null}
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <Button onClick={() => retry()} className="bg-brand-600 hover:bg-brand-700">
          Try again
        </Button>
        <Button variant="outline" nativeButton={false} render={<Link href="/" />}>
          Back to the overview
        </Button>
      </div>
    </main>
  )
}
