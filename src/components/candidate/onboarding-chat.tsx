'use client'

import { useEffect, useMemo, useRef, useState, useActionState } from 'react'
import Link from 'next/link'
import { ArrowRight, Check, MessageSquareText, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { InfoNote, StatusBadge } from '@/components/common'
import { IDLE_STATE, type ActionState } from '@/lib/action-state'
import { CAREGIVING_ACTIVITIES } from '@/lib/taxonomy/skills'
import { answerOnboardingStepAction } from '@/server/actions/onboarding'

export type OnboardingMessage = {
  id: string
  role: 'USER' | 'ASSISTANT' | 'SYSTEM'
  content: string
  createdAt: string
}

export type OnboardingFieldData = {
  key: string
  label: string
  input: 'text' | 'textarea' | 'number' | 'select' | 'multiselect' | 'consent' | 'activities'
  options?: { value: string; label: string }[]
  required?: boolean
  help?: string
}

export type OnboardingStepData = {
  key: string
  question: string
  help?: string
  fields: OnboardingFieldData[]
}

type Answers = Record<string, string | number | boolean | string[]>

export function OnboardingChat({
  messages,
  step,
  conversationCompleted,
  progress,
}: {
  messages: OnboardingMessage[]
  step: OnboardingStepData | null
  conversationCompleted: boolean
  progress: { answered: number; total: number }
}) {
  const [state, formAction, pending] = useActionState(answerOnboardingStepAction, IDLE_STATE)
  const [answers, setAnswers] = useState<Answers>({})
  const [answerStep, setAnswerStep] = useState(step?.key)
  const threadEnd = useRef<HTMLDivElement | null>(null)
  if (answerStep !== step?.key) {
    setAnswerStep(step?.key)
    setAnswers({})
  }

  useEffect(() => {
    threadEnd.current?.scrollIntoView({ block: 'nearest' })
  }, [messages.length])

  const payload = useMemo(() => JSON.stringify({ stepKey: step?.key ?? '', answers }), [step?.key, answers])

  const feedback = state.status === 'success' && state.message ? state.message.split('\n') : []
  const canSubmit = !pending && (!step || step.fields.every((field) => !field.required || hasAnswer(field, answers)))

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader className="border-b border-border/70 bg-brand-50/50">
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <MessageSquareText className="size-4.5 text-brand-700" aria-hidden />
                Onboarding conversation
              </CardTitle>
              <CardDescription className="mt-1.5">
                Question {Math.min(progress.answered + 1, progress.total)} of {progress.total}. Nothing is shared with
                an employer from this screen, and you can leave and resume at any point.
              </CardDescription>
            </div>
            <StatusBadge value="RULE_BASED" label="Rule-based reading" />
          </div>
        </CardHeader>

        <CardContent className="pt-5">
          <ol aria-label="Conversation so far" className="flex flex-col gap-3">
            {messages.map((message) => (
              <li key={message.id} className={message.role === 'USER' ? 'flex justify-end' : 'flex justify-start'}>
                <div
                  className={
                    message.role === 'USER'
                      ? 'max-w-[90%] rounded-xl rounded-br-sm bg-brand-600 px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-line text-primary-foreground sm:max-w-[80%]'
                      : 'max-w-[90%] rounded-xl rounded-bl-sm border border-border bg-muted/50 px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-line sm:max-w-[80%]'
                  }
                >
                  <p
                    className={
                      message.role === 'USER'
                        ? 'mb-1 text-[10px] font-medium tracking-wide uppercase opacity-80'
                        : 'mb-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase'
                    }
                  >
                    {message.role === 'USER' ? 'You' : 'SYPRUS'}
                  </p>
                  {message.content}
                </div>
              </li>
            ))}

            {feedback.map((line, index) => (
              <li key={`effect-${index}`} className="flex justify-start">
                <div className="flex max-w-[90%] items-start gap-2 rounded-xl rounded-bl-sm border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-sm leading-relaxed text-emerald-900 sm:max-w-[80%]">
                  <Sparkles className="mt-0.5 size-4 shrink-0" aria-hidden />
                  <span className="whitespace-pre-line">{line}</span>
                </div>
              </li>
            ))}
            <div ref={threadEnd} aria-hidden />
          </ol>
        </CardContent>
      </Card>

      {conversationCompleted || !step ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Check className="size-4.5 text-emerald-600" aria-hidden />
              Onboarding complete
            </CardTitle>
            <CardDescription>
              Your answers became experience entries, skills with evidence, profile fields and recorded consent
              decisions. Correct anything the keyword reading got wrong — every suggestion can be edited or removed.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2.5">
            <Button className="bg-brand-600 hover:bg-brand-700" nativeButton={false} render={<Link href="/candidate/skills" />}>
              Go to your skills
              <ArrowRight className="size-4" aria-hidden />
            </Button>
            <Button variant="outline" nativeButton={false} render={<Link href="/candidate/graph" />}>
              Open capability graph
            </Button>
            <Button variant="outline" nativeButton={false} render={<Link href="/candidate/jobs" />}>
              See recommended roles
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Your answer</CardTitle>
            <CardDescription>
              Fields marked with * are needed to move to the next question. Everything else you can leave blank now and
              fill in later.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form action={formAction} className="flex flex-col gap-4">
              <input type="hidden" name="answers" value={payload} readOnly />
              {state.status === 'error' ? (
                <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3.5 py-2.5 text-sm text-destructive">
                  {state.message}
                </div>
              ) : null}

              {step.fields.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nothing to type for this one — confirm to close the conversation and compute your first matches.
                </p>
              ) : null}

              {step.fields.map((field) => (
                <StepFieldInput
                  key={field.key}
                  field={field}
                  answers={answers}
                  setAnswers={setAnswers}
                  state={state}
                />
              ))}

              <div className="flex flex-wrap items-center gap-3">
                <Button
                  type="submit"
                  className="bg-brand-600 hover:bg-brand-700"
                  disabled={!canSubmit}
                >
                  {pending ? 'Sending…' : step.fields.length === 0 ? 'Finish onboarding' : 'Send answer'}
                </Button>
                <p className="text-xs text-muted-foreground">
                  Each answer writes real rows: experiences, skills with evidence, profile fields or consent records.
                </p>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <InfoNote tone="privacy" title="Why skills are suggested">
        This conversation is a scripted set of predefined questions answered by local rules — no chat model writes the
        questions and nothing you type here is sent to one. Suggestions come from matching your own wording against a
        curated skill taxonomy and its aliases: a keyword rule, not verification. The separate skill-suggestions agent
        can ask a language model the same question, and each of its proposals says which engine produced it.
      </InfoNote>
    </div>
  )
}

function hasAnswer(field: OnboardingFieldData, answers: Answers) {
  const value = answers[field.key]
  if (field.input === 'consent') return typeof value === 'boolean'
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'number') return Number.isFinite(value)
  return typeof value === 'string' && value.trim().length > 0
}

function StepFieldInput({
  field,
  answers,
  setAnswers,
  state,
}: {
  field: OnboardingFieldData
  answers: Answers
  setAnswers: (next: Answers | ((previous: Answers) => Answers)) => void
  state: ActionState
}) {
  const id = `onboarding-${field.key}`
  const errorId = `${id}-error`
  const value = answers[field.key]

  const update = (next: string | number | boolean | string[] | undefined) =>
    setAnswers((previous) => {
      const copy = { ...previous }
      if (next === undefined) delete copy[field.key]
      else copy[field.key] = next
      return copy
    })

  if (field.input === 'consent') {
    return (
      <fieldset className="space-y-2 rounded-lg border border-border/70 bg-muted/30 p-3.5">
        <legend className="text-[13px] font-medium">{field.label}</legend>
        <div className="flex gap-5">
          <label className="flex items-center gap-2 text-sm"><input id={`${id}-yes`} type="radio" name={id} checked={value === true} onChange={() => update(true)} />Allow</label>
          <label className="flex items-center gap-2 text-sm"><input id={`${id}-no`} type="radio" name={id} checked={value === false} onChange={() => update(false)} />Decline</label>
        </div>
        {field.help ? <p className="text-xs leading-relaxed text-muted-foreground">{field.help}</p> : null}
      </fieldset>
    )
  }

  if (field.input === 'activities') {
    const selected = Array.isArray(value) ? value : []
    return (
      <fieldset className="flex flex-col gap-2.5">
        <legend className="text-[13px] font-medium">
          {field.label}
          {field.required ? <span className="ml-1 text-brand-700">*</span> : null}
        </legend>
        {field.help ? <p className="text-xs text-muted-foreground">{field.help}</p> : null}
        <div className="grid gap-2.5 sm:grid-cols-2">
          {CAREGIVING_ACTIVITIES.map((activity) => {
            const activityId = `activity-${activity.key}`
            const isChecked = selected.includes(activity.key)
            return (
              <div
                key={activity.key}
                className={`flex items-start gap-2.5 rounded-lg border p-3 ${
                  isChecked ? 'border-brand-300 bg-brand-50/60' : 'border-border/70 bg-card'
                }`}
              >
                <Checkbox
                  id={activityId}
                  checked={isChecked}
                  onCheckedChange={(next) =>
                    update(
                      next
                        ? [...selected, activity.key]
                        : selected.filter((entry) => entry !== activity.key),
                    )
                  }
                  className="mt-0.5"
                />
                <div className="flex flex-col gap-0.5">
                  <Label htmlFor={activityId} className="text-[13px] font-medium leading-snug">
                    {activity.label}
                  </Label>
                  <p className="text-xs leading-relaxed text-muted-foreground">{activity.prompt}</p>
                </div>
              </div>
            )
          })}
        </div>
      </fieldset>
    )
  }

  if (field.input === 'select') {
    const items = field.options ?? []
    const map: Record<string, string> = Object.fromEntries(items.map((item) => [item.value, item.label]))
    return (
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={id} className="text-[13px] font-medium">
          {field.label}
          {field.required ? <span className="ml-1 text-brand-700">*</span> : null}
        </Label>
        <Select
          name={id}
          items={map}
          required={field.required}
          value={(value as string) ?? null}
          onValueChange={(next) => update(typeof next === 'string' ? next : undefined)}
        >
          <SelectTrigger id={id} className="w-full">
            <SelectValue placeholder="Choose one" />
          </SelectTrigger>
          <SelectContent>
            {items.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {field.help ? <p className="text-xs leading-relaxed text-muted-foreground">{field.help}</p> : null}
      </div>
    )
  }

  if (field.input === 'textarea') {
    return (
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={id} className="text-[13px] font-medium">
          {field.label}
          {field.required ? <span className="ml-1 text-brand-700">*</span> : null}
        </Label>
        <Textarea
          id={id}
          name={id}
          rows={5}
          required={field.required}
          value={(value as string) ?? ''}
          onChange={(event) => update(event.target.value)}
          aria-describedby={state.status === 'error' ? errorId : undefined}
        />
        {field.help ? <p className="text-xs leading-relaxed text-muted-foreground">{field.help}</p> : null}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="text-[13px] font-medium">
        {field.label}
        {field.required ? <span className="ml-1 text-brand-700">*</span> : null}
      </Label>
      <Input
        id={id}
        name={id}
        type={field.input === 'number' ? 'number' : 'text'}
        min={field.input === 'number' ? 0 : undefined}
        required={field.required}
        value={(value as string) ?? (typeof value === 'number' ? String(value) : '')}
        onChange={(event) => {
          const raw = event.target.value
          if (field.input === 'number') update(raw === '' ? undefined : Number(raw))
          else update(raw)
        }}
        aria-describedby={state.status === 'error' ? errorId : undefined}
      />
      {field.help ? <p className="text-xs leading-relaxed text-muted-foreground">{field.help}</p> : null}
    </div>
  )
}
