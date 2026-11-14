'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { TextAreaField } from '@/components/candidate/field'
import { ActionForm, HiddenFields, SubmitButton } from '@/components/candidate/action-form'
import { requestDisclosureAction } from '@/server/actions/disclosure'

/**
 * The employer's only route to a candidate's identity that does not depend on
 * the candidate applying. Sending this asks; it reveals nothing. The candidate
 * answers on their own disclosure screen, and both halves are audited.
 */
export function DisclosureRequestButton({
  candidateProfileId,
  anonymousHandle,
  jobId,
  applied,
}: {
  candidateProfileId: string
  anonymousHandle: string
  jobId?: string
  applied: boolean
}) {
  const [open, setOpen] = useState(false)

  if (applied) {
    // Applying already disclosed their identity, so there is nothing to ask for.
    return (
      <span className="text-xs text-muted-foreground">
        Identity available under the candidate’s consent.
      </span>
    )
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>Ask to see who this is</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Request identity disclosure · {anonymousHandle}</DialogTitle>
          <DialogDescription>
            The candidate decides. Nothing in this request unlocks their name, contact details or experience
            descriptions by itself, and a decline is a complete answer that leaves their skills readable to you.
          </DialogDescription>
        </DialogHeader>
        <ActionForm
          action={requestDisclosureAction}
          className="gap-4"
          onSuccess={(message) => {
            setOpen(false)
            toast.success(message ?? 'Request sent to the candidate.')
          }}
        >
          {({ state, pending }) => (
            <>
              <HiddenFields fields={{ candidateProfileId, ...(jobId ? { jobId } : {}) }} />
              <TextAreaField
                id="reason"
                label="Why you need their identity (at least 20 characters)"
                rows={4}
                required
                state={state}
                placeholder="For example: we would like to arrange a conversation about the coordination work in their profile and need to send a calendar invitation."
              />
              <div className="flex flex-wrap items-center gap-3">
                <SubmitButton pending={pending} variant="outline" size="sm">
                  Send the request
                </SubmitButton>
                <span className="text-xs text-muted-foreground">
                  Your organisation name and this text are all the candidate sees.
                </span>
              </div>
            </>
          )}
        </ActionForm>
      </DialogContent>
    </Dialog>
  )
}
