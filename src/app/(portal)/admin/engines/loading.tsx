import { Skeleton } from '@/components/ui/skeleton'

export default function AdminEnginesLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading agent health">
      <div className="space-y-2">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-full max-w-2xl" />
      </div>
      <Skeleton className="h-9 w-72" />
      <Skeleton className="h-24 rounded-xl" />
      <Skeleton className="h-96 rounded-xl" />
      <Skeleton className="h-56 rounded-xl" />
    </div>
  )
}
