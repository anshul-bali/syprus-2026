'use client'

import { toast } from 'sonner'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { ActionForm, HiddenFields, SubmitButton } from '@/components/candidate/action-form'
import { SelectField } from '@/components/candidate/field'
import { uploadEvidenceAction } from '@/server/actions/ai'

/**
 * Evidence upload. The file element has to live in a client form; the bytes are
 * read by the server action, never held in client state.
 */
export function EvidenceUploadForm({
  skills,
  defaultSkillId,
}: {
  skills: { value: string; label: string }[]
  defaultSkillId?: string
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Attach a document</CardTitle>
        <CardDescription className="text-xs">
          PDF, PNG, JPG or WebP up to 5 MB. The file is stored on the server with a random name and a checksum; it goes
          into a queue for a reviewer and does not change any skill status by itself.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ActionForm
          action={uploadEvidenceAction}
          className="gap-4"
          onSuccess={(message) => toast.success(message ?? 'Document stored.')}
        >
          {({ state, pending }) => (
            <>
              {skills.length === 0 ? (
                <HiddenFields fields={{ candidateSkillId: '' }} />
              ) : (
                <SelectField
                  id="candidateSkillId"
                  label="Which skill does this support?"
                  items={skills}
                  required
                  state={state}
                  defaultValue={defaultSkillId ?? skills[0]?.value}
                  help="Choose the claim this document supports. A reviewer decides whether it is useful evidence."
                />
              )}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="file" className="text-[13px] font-medium">
                  File
                </Label>
                <input
                  id="file"
                  name="file"
                  type="file"
                  required
                  accept="application/pdf,image/png,image/jpeg,image/webp"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-brand-600 file:px-3 file:py-1.5 file:text-sm file:text-white"
                />
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Your original filename is kept for your own reference only; the stored path is randomised.
                </p>
              </div>
              <SubmitButton pending={pending}>Upload document</SubmitButton>
            </>
          )}
        </ActionForm>
      </CardContent>
    </Card>
  )
}
