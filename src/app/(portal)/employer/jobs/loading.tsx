import { Skeleton } from '@/components/ui/skeleton'

export default function JobsLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-20 w-full max-w-sm" />
      <Skeleton className="h-8 w-64" />
      <div className="space-y-3 rounded-xl border border-border/70 p-4">
        <Skeleton className="h-16 w-full" />
        {Array.from({ length: 6 }).map((_, index) => (
          <Skeleton key={index} className="h-14 w-full" />
        ))}
      </div>
    </div>
  )
}
