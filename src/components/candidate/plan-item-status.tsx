'use client'

import { ActionSubmit } from '@/components/candidate/action-submit'
import { PLAN_ITEM_STATUSES, label } from '@/lib/options'
import { setPlanItemStatusAction } from '@/server/actions/candidate'

const STATUSES = [...PLAN_ITEM_STATUSES]

/**
 * One row of status buttons per plan step. Each button posts its own form with
 * the item id and the status as hidden fields; the service re-checks that the
 * step belongs to this candidate before writing. The current status is disabled
 * so a completed step cannot be completed twice and spam the skill with evidence.
 */
export function PlanItemStatus({ itemId, current }: { itemId: string; current: string }) {
  return (
    <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Set the status of this step">
      {STATUSES.map((status) => (
        <ActionSubmit
          key={status}
          action={setPlanItemStatusAction}
          fields={{ itemId, status }}
          label={label(status)}
          pendingLabel="Saving…"
          size="xs"
          variant={status === current ? 'default' : 'ghost'}
          className={status === current ? 'bg-brand-600 hover:bg-brand-600' : 'text-muted-foreground'}
          disabled={status === current}
          showStatus={false}
          formClassName="contents"
        />
      ))}
    </div>
  )
}
