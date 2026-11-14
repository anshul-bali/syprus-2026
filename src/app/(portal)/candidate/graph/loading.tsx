import { Skeleton } from '@/components/ui/skeleton'

export default function GraphLoading() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-20 w-full rounded-xl" />
      <div className="flex flex-col gap-4 lg:flex-row">
        <Skeleton className="h-[600px] flex-1 rounded-xl" />
        <div className="flex w-full flex-col gap-4 lg:w-80">
          <Skeleton className="h-56 w-full rounded-xl" />
          <Skeleton className="h-40 w-full rounded-xl" />
        </div>
      </div>
    </div>
  )
}
