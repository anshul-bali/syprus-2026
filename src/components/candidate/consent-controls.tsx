'use client'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { FormStatus } from '@/components/forms/form-parts'
import { InfoNote } from '@/components/common'
import { formatDate } from '@/lib/utils'
import { ActionForm, HiddenFields, SubmitButton } from '@/components/candidate/action-form'
import { setConsentAction } from '@/server/actions/candidate'

export type ConsentRow = {
  type: string
  /** null when no decision has ever been recorded for this account. */
  granted: boolean | null
  decidedAt: string | null
  policyVersion: string | null
}

const CONSENT_COPY: Record<string, { title: string; enables: string; withdrawing: string }> = {
  DATA_PROCESSING: {
    title: 'Process my data to run this platform',
    enables: 'Your profile, skills, matches and applications exist because of this consent. It was given at sign-up.',
    withdrawing: 'Without it the platform has no basis to hold your records; ask support to close the account.',
  },
  SENSITIVE_DATA: {
    title: 'Store what I write about my break and caregiving',
    enables:
      'Lets the free-text answers about caregiving and the break be stored and read by the keyword rule that suggests skills.',
    withdrawing: 'The text stays in your records until you delete the entries; nothing new is captured.',
  },
  ANONYMIZED_PROFILE_SHARING: {
    title: 'Show verified employers my anonymised profile',
    enables:
      'Employers see your handle, skills, levels and durations of responsibility — never your name, email or break length.',
    withdrawing: 'Your profile disappears from employer browse and “visible to employers” is switched off.',
  },
  IDENTIFIED_PROFILE_SHARING: {
    title: 'Let an employer see who I am before I apply',
    enables:
      'Reveals your name and contact details to organisations you choose. Applying to a role discloses your identity for that role regardless.',
    withdrawing: 'Only anonymous browsing remains; identity is disclosed solely when you apply.',
  },
  RULE_BASED_INFERENCE: {
    title: 'Use my own wording to suggest skills',
    enables:
      'Runs the keyword rule over your experience descriptions and onboarding answers, and stores each suggestion with the phrase that produced it.',
    withdrawing: 'Skill entries created by the inference rule are deleted from your inventory. Skills you added by hand are untouched.',
  },
  EMPLOYER_CONTACT: {
    title: 'Let a verified employer contact me about a match',
    enables: 'Opens the option for a hiring team to message you about a role you matched.',
    withdrawing: 'Employers can no longer reach out; your applications still update through your tracker.',
  },
  PRODUCT_EMAILS: {
    title: 'Send me product and re-entry programme emails',
    enables: 'Optional email updates. Portal notifications about your own activity are unaffected by this choice.',
    withdrawing: 'Marketing email stops.',
  },
  RESEARCH_CONTRIBUTION: {
    title: 'Include my anonymised data in platform fairness reporting',
    enables:
      'Adds your score and break band to the aggregate distribution administrators monitor for break-based penalty.',
    withdrawing: 'You are excluded from the aggregate figures. It changes nothing about your own scores.',
  },
}

export function ConsentControls({
  rows,
  currentPolicyVersion,
}: {
  rows: ConsentRow[]
  currentPolicyVersion: string
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Consent decisions</CardTitle>
        <CardDescription>
          Each decision is written to an append-only consent record with the policy version in force at the time it was
          taken. The newest decision for this version is the effective one.
          <span className="mt-1 block text-xs">
            Current policy version: <span className="font-medium text-foreground">{currentPolicyVersion}</span>
          </span>
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2.5">
        {rows.map((row) => {
          const copy = CONSENT_COPY[row.type] ?? {
            title: row.type,
            enables: '',
            withdrawing: '',
          }
          return (
            <div key={row.type} className="rounded-xl border border-border/70 bg-card p-3.5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-medium leading-snug">{copy.title}</p>
                  {copy.enables ? (
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      <span className="font-medium text-foreground">What it enables:</span> {copy.enables}
                    </p>
                  ) : null}
                  {copy.withdrawing ? (
                    <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                      <span className="font-medium text-foreground">If withdrawn:</span> {copy.withdrawing}
                    </p>
                  ) : null}
                  <p className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                    <Badge variant="outline" className="text-[10px]">
                      {row.granted === null ? 'No decision recorded' : row.granted ? 'Granted' : 'Withdrawn'}
                    </Badge>
                    <span>Decided {row.decidedAt ? formatDate(row.decidedAt) : '—'}</span>
                    <span aria-hidden>·</span>
                    <span>version {row.policyVersion ?? '—'}</span>
                  </p>
                </div>

                <ActionForm
                  action={setConsentAction}
                  withStatus={false}
                  className="w-full shrink-0 gap-2 sm:w-56"
                >
                  {({ state, pending }) => (
                    <>
                      <HiddenFields fields={{ type: row.type }} />
                      <div className="flex items-center justify-end gap-2.5">
                        <Label htmlFor={`consent-${row.type}`} className="text-[11px] text-muted-foreground">
                          Switch on to grant
                        </Label>
                        <Switch
                          id={`consent-${row.type}`}
                          name="granted"
                          defaultChecked={row.granted === true}
                        />
                      </div>
                      <div className="flex justify-end">
                        <SubmitButton pending={pending} variant="outline" size="xs">
                          Save decision
                        </SubmitButton>
                      </div>
                      <FormStatus state={state} />
                    </>
                  )}
                </ActionForm>
              </div>
            </div>
          )
        })}

        <InfoNote tone="privacy" title="Withdrawals have real, immediate effects">
          Turning off anonymised or identified sharing hides your profile from employers at once. Turning off rule-based
          inference deletes the skill entries the rule created from your wording, because keeping them would present a
          claim you no longer consent to.
        </InfoNote>
      </CardContent>
    </Card>
  )
}
