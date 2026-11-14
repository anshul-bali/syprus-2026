import { Skeleton } from '@/components/ui/skeleton'

export default function ShortlistLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-24 w-full max-w-lg" />
      <div className="space-y-3 rounded-xl border border-border/70 p-4">
        <Skeleton className="h-20 w-full" />
        {Array.from({ length: 3 }).map((_, index) => (
          <Skeleton key={index} className="h-40 w-full" />
        ))}
      </div>
    </div>
  )
}
