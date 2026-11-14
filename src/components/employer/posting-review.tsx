'use client'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { InfoNote, StatusBadge } from '@/components/common'
import { ActionSubmit } from '@/components/candidate/action-submit'
import { runBiasAuditAction, runMarketCheckAction } from '@/server/actions/ai'
import { formatDateTime } from '@/lib/utils'
import { label } from '@/lib/options'
import type { BiasFinding } from '@/lib/ai/schemas'

export type StoredLanguageReview = {
  id: string
  overallRisk: string
  mode: string
  status: string
  findings: BiasFinding[]
  continuityChecks: {
    requirement: string
    isLikelyUnnecessary: boolean
    reason: string
    suggestedRewrite: string | null
  }[]
  positives: string[]
  createdAt: Date
  aiRun: { provider: string; model: string; fallbackReason: string | null } | null
}

export type StoredMarketInsight = {
  id: string
  source: string
  isLive: boolean
  score: number
  dataAsOf: Date
  explanation: string[]
  excludedSignals: string[]
  createdAt: Date
}

const SEVERITY_TONE: Record<string, string> = {
  HIGH: 'border-rose-300 bg-rose-50 text-rose-950',
  MEDIUM: 'border-amber-300 bg-amber-50 text-amber-950',
  LOW: 'border-border bg-muted/40 text-foreground',
}

/**
 * Agent 4 output as the employer sees it: stored findings, the suggested
 * rewrites, and the fact that nothing was changed without a human deciding.
 */
export function PostingReviewPanel({
  jobId,
  reviews,
  insights,
}: {
  jobId: string
  reviews: StoredLanguageReview[]
  insights: StoredMarketInsight[]
}) {
  const latest = reviews[0] ?? null

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">Posting review</CardTitle>
            <CardDescription className="mt-1 text-xs">
              Exclusionary wording and unnecessary continuity requirements, flagged for a human to decide. Nothing here
              edits the role, scores anyone, or claims a posting is bias-free.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <ActionSubmit
              action={runBiasAuditAction}
              fields={{ jobId }}
              label="Check this wording"
              pendingLabel="Reviewing…"
              size="sm"
              showStatus
            />
            <ActionSubmit
              action={runMarketCheckAction}
              fields={{ jobId }}
              label="Compare against stored postings"
              pendingLabel="Comparing…"
              variant="outline"
              size="sm"
              showStatus
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!latest ? (
          <p className="text-sm text-muted-foreground">
            No review has been run on this role yet. The check reads only the text you published and reports what it
            finds, verbatim.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-medium">Overall risk</span>
              <StatusBadge value={latest.overallRisk} />
              <Badge variant="outline">{latest.mode === 'AI' ? 'model pass' : 'rule engine pass'}</Badge>
              <span className="text-muted-foreground">
                {formatDateTime(latest.createdAt)} · {latest.findings.length} finding(s) · status{' '}
                {label(latest.status).toLowerCase()}
              </span>
              {latest.aiRun ? (
                <span className="text-muted-foreground">
                  · answered by {latest.aiRun.provider} ({latest.aiRun.model})
                  {latest.aiRun.fallbackReason ? `, reported ${latest.aiRun.fallbackReason}` : ''}
                </span>
              ) : null}
            </div>

            {latest.findings.length === 0 ? (
              <p className="text-sm">No exclusionary patterns were found in this text. That is not a guarantee of fair
                wording — only that these checks matched nothing.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {latest.findings.map((finding, index) => (
                  <li
                    key={`${finding.category}-${index}`}
                    className={`rounded-xl border p-3 ${SEVERITY_TONE[finding.severity] ?? SEVERITY_TONE.LOW}`}
                  >
                    <p className="flex flex-wrap items-center gap-2 text-xs font-medium uppercase tracking-wide">
                      {label(finding.category)}
                      <Badge variant="outline" className="text-[10px]">
                        {finding.severity.toLowerCase()}
                      </Badge>
                    </p>
                    <p className="mt-1.5 text-sm italic leading-relaxed">“{finding.excerpt}”</p>
                    <p className="mt-1.5 text-xs leading-relaxed">
                      <span className="font-medium">Why it may exclude:</span> {finding.whyItMayExclude}
                    </p>
                    <p className="mt-1 text-xs leading-relaxed">
                      <span className="font-medium">Suggested change:</span> {finding.suggestion}
                    </p>
                    {finding.rewrite ? (
                      <p className="mt-1.5 rounded-lg border border-dashed border-border/70 bg-white/70 px-2.5 py-1.5 text-xs leading-relaxed">
                        <span className="font-medium">Draft replacement:</span> {finding.rewrite}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}

            {latest.continuityChecks.length > 0 ? (
              <div>
                <p className="text-xs font-medium tracking-wide uppercase">Continuity requirements</p>
                <ul className="mt-1.5 flex flex-col gap-1.5">
                  {latest.continuityChecks.map((check) => (
                    <li key={check.requirement} className="rounded-lg border border-border/70 bg-muted/25 px-2.5 py-2 text-xs leading-relaxed">
                      <p className="font-medium">“{check.requirement}”</p>
                      <p className="mt-0.5">
                        {check.isLikelyUnnecessary ? 'Likely unnecessary for the work' : 'Plausibly necessary'} —{' '}
                        {check.reason}
                      </p>
                      {check.suggestedRewrite ? (
                        <p className="mt-1 text-muted-foreground">Rewrite offered: {check.suggestedRewrite}</p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {latest.positives.length > 0 ? (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-emerald-900">
                  Inclusive wording found
                </p>
                <ul className="mt-1.5 list-disc pl-4 text-xs leading-relaxed text-emerald-950">
                  {latest.positives.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <InfoNote tone="warning" title="Human decision required">
              A finding is a suggestion to look, and a rewrite is a draft. Changing the role text stays with you; if a
              reviewer is needed, the finding is already queued for the administrator’s review list.
            </InfoNote>
          </>
        )}

        {insights.length > 0 ? (
          <div>
            <p className="text-xs font-medium tracking-wide uppercase">Stored-posting skill overlap (not market demand)</p>
            <ul className="mt-1.5 flex flex-col gap-1.5">
              {insights.map((insight) => (
                <li key={insight.id} className="rounded-lg border border-border/70 bg-muted/20 px-2.5 py-2 text-xs leading-relaxed">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{Math.round(insight.score * 100)}%</span>
                    <Badge variant="outline">{label(insight.source)}</Badge>
                    <span className="text-muted-foreground">
                      {insight.isLive ? 'live feed' : 'this database only'} · data as of {formatDateTime(insight.dataAsOf)}
                    </span>
                  </p>
                  {insight.explanation.map((line) => (
                    <p key={line} className="mt-1 text-muted-foreground">
                      {line}
                    </p>
                  ))}
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Signals deliberately not used: {insight.excludedSignals.join(', ')}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
