'use client'

import { useEffect, useRef, useState, useActionState, startTransition } from 'react'
import { MessagesSquare, Sparkles, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { askSonaAction, clearSonaAction, type SonaState } from '@/server/actions/assistant'

/**
 * SYPRUS Sona, the in-portal assistant.
 *
 * The panel is deliberately honest about what it is: a launcher, a transcript
 * that belongs to this account, and a per-answer label naming the engine that
 * produced it — a model or the deterministic record reader. Nothing here is a
 * chat window pretending to have opinions.
 */
export function SonaPanel({ initialState }: { initialState: SonaState }) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [state, formAction, pending] = useActionState<SonaState, FormData>(askSonaAction, initialState)
  const [clearState, clearAction] = useActionState<SonaState, FormData>(clearSonaAction, initialState)
  const launcherRef = useRef<HTMLButtonElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Two actions write, one transcript is shown. Whichever returned last owns the
  // list, so no effect has to mirror one state into another.
  const transcript = (state.seq ?? 0) >= (clearState.seq ?? 0) ? (state.transcript ?? []) : (clearState.transcript ?? [])
  const starters = state.starters ?? clearState.starters ?? initialState.starters ?? []

  useEffect(() => {
    if (!open) return
    endRef.current?.scrollIntoView({ block: 'nearest' })
    textareaRef.current?.focus()
  }, [open, transcript.length])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        launcherRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open])

  const ask = (question: string) => {
    setDraft(question)
    startTransition(() => {
      const formData = new FormData()
      formData.set('question', question)
      formAction(formData)
    })
  }

  return (
    <>
      <button
        ref={launcherRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls="syprus-sona-panel"
        className="fixed bottom-4 right-4 z-40 inline-flex items-center gap-2 rounded-full bg-brand-600 px-3.5 py-2.5 text-sm font-medium text-primary-foreground shadow-lg outline-none ring-offset-2 focus-visible:ring-2 focus-visible:ring-ring sm:bottom-6 sm:right-6"
      >
        {open ? <X className="size-4" aria-hidden /> : <MessagesSquare className="size-4" aria-hidden />}
        <span className={open ? 'sr-only' : undefined}>{open ? 'Close Sona' : 'Ask SYPRUS Sona'}</span>
      </button>

      {open ? (
        <div
          id="syprus-sona-panel"
          role="dialog"
          aria-modal="false"
          aria-label="SYPRUS Sona assistant"
          className="fixed bottom-16 right-2 z-40 flex h-[min(78dvh,34rem)] w-[min(calc(100vw-1rem),24rem)] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-xl sm:bottom-20 sm:right-6"
        >
          <div className="flex items-start justify-between gap-3 border-b border-border/70 bg-brand-50/60 px-4 py-3">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-sm font-semibold">
                <Sparkles className="size-4 shrink-0 text-brand-600" aria-hidden />
                SYPRUS Sona
              </p>
              <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
                Answers from the records on this account. Not a person, and not a hiring decision.
              </p>
            </div>
            <Button variant="ghost" size="icon" className="size-8 shrink-0" aria-label="Close Sona" onClick={() => setOpen(false)}>
              <X className="size-4" aria-hidden />
            </Button>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3" aria-live="polite" aria-relevant="additions">
            {transcript.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border bg-muted/30 px-3 py-4">
                <p className="text-sm font-medium">Nothing asked yet</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Sona reads your own stored records — profile completeness, skills, closest roles, applications and
                  consent decisions — and says which engine answered. Pick a question or type your own.
                </p>
              </div>
            ) : null}

            {transcript.map((turn) => (
              <div key={turn.id} className={turn.role === 'USER' ? 'flex justify-end' : 'flex justify-start'}>
                <div
                  className={
                    turn.role === 'USER'
                      ? 'max-w-[88%] rounded-xl rounded-br-sm bg-brand-600 px-3 py-2 text-sm leading-relaxed text-primary-foreground'
                      : 'max-w-[92%] rounded-xl rounded-bl-sm border border-border bg-muted/40 px-3 py-2'
                  }
                >
                  {turn.role === 'ASSISTANT' ? (
                    <p className="mb-1 flex flex-wrap items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                        {turn.mode === 'AI' ? `model · ${turn.provider ?? 'unknown'}` : 'rule engine'}
                      </Badge>
                      {turn.mode === 'AI' && turn.model ? <span className="truncate">{turn.model}</span> : null}
                    </p>
                  ) : null}
                  <p className={turn.role === 'USER' ? '' : 'text-sm leading-relaxed'}>{turn.content}</p>
                  {turn.role === 'ASSISTANT' && turn.citations.length > 0 ? (
                    <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
                      Read from: {turn.citations.join(', ')}
                    </p>
                  ) : null}
                  {turn.role === 'ASSISTANT' && turn.fallbackReason ? (
                    <p className="mt-1.5 text-[11px] leading-snug text-amber-800 dark:text-amber-300">
                      Model path unavailable: {turn.fallbackReason}
                    </p>
                  ) : null}
                </div>
              </div>
            ))}

            {state.status === 'error' ? (
              <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                {state.message}
              </p>
            ) : null}

            {state.reply?.caveats.length ? (
              <ul role="list" className="flex flex-col gap-1 rounded-lg bg-muted/30 px-3 py-2 text-[11px] leading-snug text-muted-foreground">
                {state.reply.caveats.map((caveat) => (
                  <li key={caveat}>{caveat}</li>
                ))}
              </ul>
            ) : null}

            <div ref={endRef} aria-hidden />
          </div>

          {(() => {
            const suggestions: string[] = state.reply?.followUps?.length ? state.reply.followUps : starters
            if (suggestions.length === 0) return null
            return (
              <div className="flex flex-wrap gap-1.5 border-t border-border/70 px-4 py-2.5">
                {suggestions.slice(0, 3).map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => ask(suggestion)}
                    disabled={pending}
                    className="rounded-full border border-border bg-background px-2.5 py-1 text-[11px] leading-snug text-muted-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            )
          })()}

          <form ref={formRef} action={formAction} className="border-t border-border/70 px-4 py-3">
            <label htmlFor="sona-question" className="text-xs font-medium">
              Ask about your records
            </label>
            <Textarea
              id="sona-question"
              name="question"
              ref={textareaRef}
              rows={2}
              maxLength={600}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                  event.preventDefault()
                  formRef.current?.requestSubmit()
                }
              }}
              placeholder="For example: what is still missing before I am ready to apply?"
              className="mt-1.5 resize-none text-sm"
            />
            {state.fieldErrors?.question ? <p className="mt-1 text-xs text-destructive">{state.fieldErrors.question}</p> : null}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button type="submit" size="sm" className="bg-brand-600 hover:bg-brand-700" disabled={pending || draft.trim().length < 3}>
                <Sparkles className="size-4" aria-hidden />
                {pending ? 'Sona is reading…' : 'Ask Sona'}
              </Button>
              {transcript.length > 0 ? (
                <Button type="submit" variant="ghost" size="sm" className="text-xs" disabled={pending} formAction={clearAction}>
                  Clear this conversation
                </Button>
              ) : null}
            </div>
            <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
              {state.status === 'success' && state.message ? state.message : 'Ctrl+Enter sends. Escape closes. Deleting the conversation removes it from your account only.'}
            </p>
          </form>
        </div>
      ) : null}
    </>
  )
}
