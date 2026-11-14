'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ConfirmAction } from '@/components/employer/confirm-action'
import { runJobLifecycleAction } from '@/server/actions/employer'

/**
 * Mirrors the server-side state machine in `setJobLifecycle` only for which
 * buttons to show. Every click still calls the service, which re-checks
 * ownership, permissions, the lifecycle rule and the verification gate, and the
 * reason comes back as the message.
 */
const ACTIONS_BY_STATUS: Record<string, string[]> = {
  DRAFT: ['SUBMIT', 'DELETE'],
  REJECTED: ['SUBMIT'],
  PENDING_MODERATION: ['CLOSE'],
  PUBLISHED: ['PAUSE', 'CLOSE'],
  PAUSED: ['RESUME', 'CLOSE'],
  CLOSED: [],
}

const ACTION_LABELS: Record<string, string> = {
  SUBMIT: 'Submit for moderation',
  PAUSE: 'Pause',
  RESUME: 'Resume',
  CLOSE: 'Close role',
  DELETE: 'Delete draft',
}

const CONFIRM_COPY: Record<string, { title: string; description: string; confirmLabel: string }> = {
  CLOSE: {
    title: 'Close this role?',
    description:
      'Candidates in the pipeline for this role will be notified, and the role stops appearing to candidates. Closed roles cannot be reopened.',
    confirmLabel: 'Close role',
  },
  DELETE: {
    title: 'Delete this draft?',
    description: 'The draft and its required-skill rows are removed. This cannot be undone.',
    confirmLabel: 'Delete draft',
  },
}

const VERIFICATION_BLOCKED = new Set(['SUBMIT', 'RESUME'])

export function JobLifecycleActions({
  jobId,
  status,
  title,
  verificationStatus,
  dense = false,
}: {
  jobId: string
  status: string
  title: string
  verificationStatus: string
  dense?: boolean
}) {
  const [pending, start] = useTransition()
  const router = useRouter()
  const actions = ACTIONS_BY_STATUS[status] ?? []

  function run(action: string) {
    start(async () => {
      const result = await runJobLifecycleAction(jobId, action)
      if (result.ok) {
        toast.success(result.message)
        if (result.navigateTo) router.push(result.navigateTo)
        return
      }
      toast.error(result.message)
    })
  }

  if (actions.length === 0) {
    return status === 'CLOSED' ? (
      <p className="text-xs text-muted-foreground">Closed — read only</p>
    ) : null
  }

  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${dense ? '' : 'gap-2'}`}>
      {actions.map((action) => {
        const size = dense ? 'xs' : 'sm'
        const needsVerification = verificationStatus !== 'VERIFIED' && VERIFICATION_BLOCKED.has(action)
        const hint = needsVerification
          ? 'An administrator must verify your organisation before this role reaches candidates.'
          : undefined

        if (action in CONFIRM_COPY) {
          const copy = CONFIRM_COPY[action]
          return (
            <ConfirmAction
              key={action}
              triggerLabel={ACTION_LABELS[action]}
              title={copy.title}
              description={`${copy.description} Role: ${title}.`}
              confirmLabel={copy.confirmLabel}
              pendingLabel="Applying"
              variant={action === 'DELETE' ? 'destructive' : 'outline'}
              size={size}
              action={() => runJobLifecycleAction(jobId, action)}
            />
          )
        }

        return (
          <Button
            key={action}
            type="button"
            size={size}
            variant={action === 'SUBMIT' ? 'default' : 'outline'}
            disabled={pending}
            onClick={() => run(action)}
            title={hint}
            className={action === 'SUBMIT' ? 'bg-brand-600 hover:bg-brand-700' : undefined}
          >
            {pending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
            {ACTION_LABELS[action]}
          </Button>
        )
      })}
    </div>
  )
}
