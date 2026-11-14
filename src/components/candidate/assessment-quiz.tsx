'use client'

import Link from 'next/link'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { InfoNote, StatusBadge } from '@/components/common'
import { ActionForm, HiddenFields, SubmitButton } from '@/components/candidate/action-form'
import { DemoBadge } from '@/components/common'
import { submitAssessmentAction } from '@/server/actions/ai'

export type QuizQuestion = { id: string; position: number; prompt: string; options: string[] }

/**
 * One question set, answered server-side. Nothing about which option is correct
 * is present in this markup, because the answers are never sent to the browser.
 */
export function AssessmentQuiz({
  attemptId,
  title,
  instructions,
  skillName,
  passMark,
  questions,
  demonstration,
  submitted,
  score,
  passed,
}: {
  attemptId: string
  title: string
  instructions: string
  skillName: string
  passMark: number
  questions: QuizQuestion[]
  demonstration: boolean
  submitted: boolean
  score: number
  passed: boolean
}) {
  if (submitted) {
    return (
      <Card className={passed ? 'border-emerald-200 bg-emerald-50/50' : 'border-amber-200 bg-amber-50/50'}>
        <CardHeader>
          <CardTitle className="text-base">{title} — already answered</CardTitle>
          <CardDescription className="text-xs">{skillName}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm">
            Stored result: <span className="font-semibold tabular-nums">{Math.round(score * 100)}%</span>{' '}
            <StatusBadge value={passed ? 'PASS' : 'WATCH'} label={passed ? 'passed' : 'below the pass mark'} />
          </p>
          <InfoNote tone="info" title="Start a fresh attempt for another go">
            Each attempt is a new row with its own score, so a retake cannot overwrite the history an assessor would
            read. Passing sets the skill to assessment-verified on this platform only.
          </InfoNote>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/candidate/assessments" />}>
              Other assessments
            </Button>
            <Button variant="ghost" size="sm" className="text-xs" nativeButton={false} render={<Link href="/candidate/skills" />}>
              See the effect on my inventory
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">{title}</CardTitle>
            <CardDescription className="mt-1 text-xs">
              {skillName} · pass mark {Math.round(passMark * 100)}% · {questions.length} question(s)
            </CardDescription>
          </div>
          {demonstration ? <DemoBadge text="Illustrative question set" /> : null}
        </div>
        <p className="pt-1 text-sm leading-relaxed">{instructions}</p>
      </CardHeader>
      <CardContent>
        <ActionForm
          action={submitAssessmentAction}
          className="gap-5"
          onSuccess={(message) => {
            toast.success(message ?? 'Attempt scored.')
          }}
        >
          {({ state, pending }) => (
            <>
              <HiddenFields fields={{ attemptId }} />

              <ol className="flex flex-col gap-5">
                {questions.map((question, questionIndex) => (
                  <li key={question.id} className="flex flex-col gap-2">
                    <p className="text-sm font-medium">
                      <span className="mr-1.5 text-xs text-muted-foreground tabular-nums">{questionIndex + 1}.</span>
                      {question.prompt}
                    </p>
                    <div className="flex flex-col gap-1.5">
                      {question.options.map((option, optionIndex) => (
                        <Label
                          key={`${question.id}-${optionIndex}`}
                          htmlFor={`answer-${question.id}-${optionIndex}`}
                          className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border/70 bg-muted/20 px-3 py-2 text-sm font-normal leading-snug hover:bg-muted/40"
                        >
                          <input
                            id={`answer-${question.id}-${optionIndex}`}
                            type="radio"
                            name={`answer:${question.id}`}
                            value={optionIndex}
                            className="mt-0.5 size-4 accent-[oklch(0.511_0.217_263)]"
                          />
                          <span>{option}</span>
                        </Label>
                      ))}
                    </div>
                  </li>
                ))}
              </ol>

              <div className="mt-5 flex flex-wrap items-center gap-3">
                <SubmitButton pending={pending}>Submit my answers</SubmitButton>
                <span className="text-xs text-muted-foreground">
                  Scored on the server. Nothing here is shared with an employer unless you apply or approve a
                  disclosure.
                </span>
              </div>

              {state.status === 'success' ? (
                <InfoNote tone="success" title="Recorded">
                  {state.message}
                </InfoNote>
              ) : null}
              {state.status === 'error' ? (
                <p className="text-sm text-destructive" role="alert">
                  {state.message}
                </p>
              ) : null}
            </>
          )}
        </ActionForm>
      </CardContent>
    </Card>
  )
}
