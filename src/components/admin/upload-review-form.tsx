'use client'

import { ActionForm, HiddenFields } from '@/components/candidate/action-form'
import { TextAreaField } from '@/components/candidate/field'
import { Button } from '@/components/ui/button'
import { decideUploadAction } from '@/server/actions/ai'

export function UploadReviewForm({ uploadId }: { uploadId: string }) {
  return (
    <ActionForm action={decideUploadAction} className="mt-2 gap-2">
      {({ state, pending }) => (
        <>
          <HiddenFields fields={{ uploadId }} />
          <a href={`/api/evidence/${uploadId}`} target="_blank" rel="noopener noreferrer" className="text-xs underline">
            Open evidence document
          </a>
          <TextAreaField id={`upload-note-${uploadId}`} name="note" label="Reviewer note (at least 5 characters)" rows={2} required state={state} />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" name="decision" value="ACCEPTED" size="xs" disabled={pending}>Accept</Button>
            <Button type="submit" name="decision" value="REJECTED" size="xs" variant="outline" disabled={pending}>Reject</Button>
          </div>
        </>
      )}
    </ActionForm>
  )
}
