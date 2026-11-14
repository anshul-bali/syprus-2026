'use client'

import Link from 'next/link'
import { useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { StatusBadge } from '@/components/common'
import { formatDate } from '@/lib/utils'
import { ActionForm, HiddenFields, SubmitButton } from '@/components/candidate/action-form'
import { decideDisclosureAction, revokeDisclosureAction } from '@/server/actions/disclosure'
import { ActionSubmit } from '@/components/candidate/action-submit'
import type { DisclosureRequestView } from '@/server/disclosure'

/**
 * One disclosure request and the candidate's decision on it. Approving is the
 * only action in this portal that turns a handle into a name for an outsider, so
 * the consequence is stated on the button, not buried in a tooltip.
 */
export function DisclosureDecisionCard({ request }: { request: DisclosureRequestView }) {
  const [decision, setDecision] = useState<'approve' | 'decline' | null>(null)

  if (request.status !== 'PENDING') {
    return (
      <Card className="border-border/70 bg-muted/20">
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <CardTitle className="text-sm">{request.organizationName}</CardTitle>
            <StatusBadge value={request.status} />
          </div>
          <CardDescription className="text-xs">
            {request.jobTitle ? `For ${request.jobTitle} · ` : ''}asked {formatDate(request.createdAt)}
            {request.decidedAt ? ` · decided ${formatDate(request.decidedAt)}` : ''}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-xs leading-relaxed">
          <p className="text-muted-foreground">{request.reason}</p>
          {request.decisionNote ? <p className="italic">Your note: “{request.decisionNote}”</p> : null}
          {request.status === 'APPROVED' ? (
            <div className="space-y-2">
              <p>Identity grant expires {formatDate(request.expiresAt)}. Withdrawing stops future access under this grant, not copies already read.</p>
              <ActionSubmit action={revokeDisclosureAction} fields={{ requestId: request.id }} label="Withdraw identity grant" variant="outline" size="sm" showStatus />
            </div>
          ) : null}
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="border-amber-300 bg-amber-50/50">
      <CardHeader className="pb-2.5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-sm">{request.organizationName}</CardTitle>
            <CardDescription className="mt-1 text-xs">
              {request.jobTitle ? `Asking for ${request.jobTitle} · ` : 'Asking about your profile · '}
              sent {formatDate(request.createdAt)}
              {request.expiresAt ? ` · expires ${formatDate(request.expiresAt)}` : ''}
            </CardDescription>
          </div>
          <Badge variant="outline" className="border-amber-400 text-[10px]">
            waiting on you
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="rounded-lg border border-border/70 bg-white/70 p-2.5">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Their stated reason</p>
          <p className="mt-1 text-sm leading-relaxed">{request.reason}</p>
          {request.requesterName ? (
            <p className="mt-1 text-[11px] text-muted-foreground">Recorded requester: {request.requesterName}</p>
          ) : null}
        </div>

        {decision === null ? (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" className="bg-brand-600 hover:bg-brand-700" onClick={() => setDecision('approve')}>
              Share my identity
            </Button>
            <Button size="sm" variant="outline" onClick={() => setDecision('decline')}>
              Decline
            </Button>
            <Button variant="ghost" size="sm" className="text-xs" nativeButton={false} render={<Link href="/candidate/jobs" />}>
              What I match with them
            </Button>
          </div>
        ) : (
          <ActionForm
            action={decideDisclosureAction}
            className="gap-3"
            onSuccess={(message) => {
              setDecision(null)
              toast.success(message ?? 'Decision recorded.')
            }}
          >
            {({ state, pending }) => (
              <>
                <HiddenFields fields={{ requestId: request.id, decision: decision === 'approve' ? 'APPROVED' : 'DECLINED' }} />
                <div className="flex flex-col gap-1.5">
                  <label htmlFor={`note-${request.id}`} className="text-[13px] font-medium">
                    {decision === 'approve' ? 'Anything to add? (optional)' : 'Reason you are declining (optional)'}
                  </label>
                  <Textarea
                    id={`note-${request.id}`}
                    name="note"
                    rows={3}
                    placeholder={
                      decision === 'approve'
                        ? 'For example: happy to talk about the coordination work, please call before emailing.'
                        : 'For example: I would rather keep this stage anonymous until there is a shortlist conversation.'
                    }
                    maxLength={400}
                  />
                </div>

                {decision === 'approve' ? (
                  <p className="rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-2 text-xs leading-relaxed text-amber-950">
                    Approving reveals your name, your email and your experience descriptions to{' '}
                    {request.organizationName} for 30 days. You can withdraw this grant here; active applications are
                    separate grants. Withdrawal cannot erase information already read.
                  </p>
                ) : (
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    Declining keeps you anonymous to {request.organizationName}. They can still read your skills, levels
                    and validation status while your profile stays visible.
                  </p>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <SubmitButton pending={pending} variant={decision === 'approve' ? 'default' : 'outline'}>
                    {decision === 'approve' ? 'Confirm: share my identity' : 'Confirm: decline this request'}
                  </SubmitButton>
                  <Button variant="ghost" size="sm" className="text-xs" onClick={() => setDecision(null)}>
                    Not yet
                  </Button>
                </div>

                {state.status === 'error' ? (
                  <p className="text-xs text-destructive" role="alert">
                    {state.message}
                  </p>
                ) : null}
              </>
            )}
          </ActionForm>
        )}
      </CardContent>
    </Card>
  )
}
