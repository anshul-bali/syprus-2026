import { Skeleton } from '@/components/ui/skeleton'

/** Shared loading shapes for the data-heavy candidate screens. */
export function ListSkeleton({
  rows = 4,
  header = true,
  columns,
}: {
  rows?: number
  header?: boolean
  columns?: number
}) {
  return (
    <div className="space-y-6">
      {header ? (
        <div className="space-y-2">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-4 w-full max-w-2xl" />
        </div>
      ) : null}

      {columns ? (
        <div className={`grid gap-4 sm:grid-cols-2 ${columns > 2 ? 'lg:grid-cols-3' : ''}`}>
          {Array.from({ length: columns }).map((_, index) => (
            <Skeleton key={index} className="h-24 w-full rounded-xl" />
          ))}
        </div>
      ) : null}

      <div className={columns ? 'grid gap-4 lg:grid-cols-2' : 'space-y-4'}>
        {Array.from({ length: rows }).map((_, index) => (
          <Skeleton key={index} className="h-44 w-full rounded-xl" />
        ))}
      </div>
    </div>
  )
}
