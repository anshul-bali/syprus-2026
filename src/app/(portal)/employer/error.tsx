'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { ErrorState, PageHeader } from '@/components/common'

export default function EmployerError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error('[employer-portal]', error)
  }, [error])

  // Same rule as src/app/error.tsx: a raw exception message can name a query, a
  // host or an internal field, so it is developer-only and never visitor-facing.
  const message =
    (process.env.NODE_ENV === 'development' && error instanceof Error && error.message
      ? error.message
      : null) ?? 'The employer screen could not be loaded. Your data is unchanged — try again.'

  return (
    <div className="space-y-6">
      <PageHeader title="Hiring portal" description="Something blocked this screen from loading." />
      <ErrorState
        title="This section could not load"
        description={message}
        action={
          <div className="flex flex-wrap gap-2">
            <Button onClick={retry} size="sm" className="bg-brand-600 hover:bg-brand-700">
              Try again
            </Button>
            <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/employer" />}>
              Hiring overview
            </Button>
          </div>
        }
      />
    </div>
  )
}
