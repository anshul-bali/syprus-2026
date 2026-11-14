import { Info } from 'lucide-react'
import { WAIVER_NOTICE, waiverEnabled } from '@/lib/demo-waiver'

/**
 * Rendered only when this server actually skips codes for demonstration
 * addresses. It says so on the door the waiver applies to, rather than leaving a
 * reviewer to discover that the second factor is switched off here and only here.
 */
export function DemoWaiverNotice() {
  if (!waiverEnabled()) return null
  return (
    <p className="flex w-full items-start gap-2 rounded-lg border border-dashed border-amber-300 bg-amber-50 px-3.5 py-2.5 text-xs leading-relaxed text-amber-950 dark:border-amber-700/70 dark:bg-amber-950/40 dark:text-amber-100">
      <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{WAIVER_NOTICE}</span>
    </p>
  )
}
