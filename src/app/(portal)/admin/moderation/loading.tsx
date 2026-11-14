import { Skeleton } from '@/components/ui/skeleton'

export default function AdminModerationLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading moderation queue">
      <div className="space-y-2">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-4 w-full max-w-2xl" />
      </div>
      <Skeleton className="h-9 w-64" />
      {Array.from({ length: 2 }).map((_, index) => (
        <Skeleton key={index} className="h-72 rounded-xl" />
      ))}
    </div>
  )
}
