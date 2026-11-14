import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { CategoryBarChart } from '@/components/admin/charts'
import { InfoNote, StatCard, StatusBadge } from '@/components/common'
import { formatDateTime, relativeTime } from '@/lib/utils'
import { label } from '@/lib/options'
import type { AiHealth } from '@/server/ai/runs'

const AGENT_LABELS: Record<string, string> = {
  SKILLS_DISCOVERY: 'Agent 1 · Skills Discovery',
  MARKET_INTELLIGENCE: 'Agent 2 · Market Intelligence',
  LEARNING_PATHWAYS: 'Agent 3 · Learning Pathways',
  BIAS_AUDIT: 'Agent 4 · Bias Audit',
  ASSISTANT_CHAT: 'SYPRUS Sona · assistant',
}

const MODE_NOTES: Record<string, string> = {
  AI: 'a configured endpoint answered',
  DETERMINISTIC: 'the rule engines answered, with no model call',
}

/**
 * The model side of agent health. Everything here is read back from stored
 * `ai_runs` rows, including which endpoint actually answered, so a failover is
 * visible instead of being reported as Groq.
 */
export function AiHealthSection({ health, windowHours }: { health: AiHealth; windowHours: number }) {
  const { config, totals } = health
  const fallbackRate = totals.runs > 0 ? totals.fallback / totals.runs : null
  // The page is a read of stored rows; saying when it was read keeps that honest.
  const readAt = new Date()

  const blocks = [
    {
      key: 'mode',
      title: 'What produced the answer',
      caption: 'Model calls against deterministic runs, counted over the whole window.',
      rows: health.byMode.map((row) => ({ label: label(row.mode), count: row.runs })),
      note: (row: { label: string; count: number }) => MODE_NOTES[row.label.toUpperCase()] ?? '',
      empty: 'No agent has run in this window, so there is nothing to split.',
    },
    {
      key: 'status',
      title: 'How each run ended',
      caption: 'The stored status of every run: success, fallback to the rule engines, or failure.',
      rows: health.byStatus.map((row) => ({ label: label(row.status), count: row.runs })),
      note: () => '',
      empty: 'No run has been recorded in this window.',
    },
    {
      key: 'provider',
      title: 'Which endpoint answered',
      caption: 'Recorded on the run itself, so a failover shows up as the endpoint that actually replied.',
      rows: health.byProvider.map((row) => ({ label: row.provider ?? 'unrecorded', count: row.runs })),
      note: () => '',
      empty: 'No model call has completed in this window, so no endpoint is credited with one.',
    },
    {
      key: 'reason',
      title: 'Why a run fell back',
      caption: 'The reason string the chain stored: rate limit, timeout, unreachable host, or output its contract rejected.',
      rows: health.byFallbackReason.map((row) => ({ label: label(row.reason), count: row.runs })),
      note: () => '',
      empty: 'Nothing fell back in this window. That is a record of the past, not a promise about the next call.',
    },
  ]

  return (
    <div className="space-y-4">
      <p className="text-[11px] leading-relaxed text-muted-foreground tabular-nums">
        Window: last {windowHours} hours · this screen was read at {formatDateTime(readAt)} · newest stored run{' '}
        {totals.newestRunAt ? `${formatDateTime(totals.newestRunAt)} (${relativeTime(totals.newestRunAt)})` : 'none in this window'}
        . Every figure below is a count of rows in <code className="text-xs">ai_runs</code>; nothing here probes a
        provider, so “answered” always means “answered in the past”, never “answers now”.
      </p>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Live model calls"
          value={totals.ai}
          hint={`of ${totals.runs} run(s) in ${windowHours}h`}
          tone={totals.ai > 0 ? 'positive' : 'neutral'}
        />
        <StatCard
          label="Deterministic fallbacks"
          value={totals.fallback}
          hint={fallbackRate == null ? 'no runs to judge' : `${Math.round(fallbackRate * 100)}% of runs fell back`}
          tone={fallbackRate != null && fallbackRate > 0.25 ? 'warning' : 'neutral'}
        />
        <StatCard label="Guardrail blocks" value={totals.blockedItems} hint="items refused before they were stored" tone={totals.blockedItems > 0 ? 'warning' : 'positive'} />
        <StatCard
          label="Tokens spent"
          value={totals.tokens.toLocaleString('en-IN')}
          hint={
            totals.averageLatencyMs == null
              ? 'no latency recorded'
              : `average ${(totals.averageLatencyMs / 1000).toFixed(1)}s per run`
          }
          tone="neutral"
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {blocks.map((block) => {
          const sum = block.rows.reduce((total, row) => total + row.count, 0)
          return (
            <Card key={block.key}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">{block.title}</CardTitle>
                <CardDescription className="text-xs">{block.caption}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {block.rows.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-border bg-muted/30 px-3 py-4 text-center text-xs text-muted-foreground">
                    {block.empty}
                  </p>
                ) : (
                  <>
                    <CategoryBarChart data={block.rows} label={block.title} description="The same counts are listed beside the bars." />
                    <ul className="divide-y divide-border/60 text-xs">
                      {block.rows.map((row) => (
                        <li key={row.label} className="flex flex-wrap items-baseline justify-between gap-2 py-1.5">
                          <span className="min-w-0 leading-snug">
                            {row.label}
                            {block.note(row) ? <span className="block text-[11px] text-muted-foreground">{block.note(row)}</span> : null}
                          </span>
                          <span className="shrink-0 font-medium tabular-nums">{` ${row.count}`}</span>
                        </li>
                      ))}
                    </ul>
                    <p className="text-[11px] leading-relaxed text-muted-foreground tabular-nums">
                      {sum === totals.runs
                        ? `Adds to ${sum} — the same ${totals.runs} runs the totals above count.`
                        : `Adds to ${sum} of the ${totals.runs} runs in the window; the difference is rows with no value in this grouping.`}
                    </p>
                  </>
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Provider chain</CardTitle>
          <CardDescription className="text-xs">
            The first endpoint is the primary. The others are only tried when the earlier endpoint is rate-limited,
            unreachable or returns output its own contract rejects — and the endpoint that answered is the one recorded
            on the run.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <StatusBadge value={config.enabled ? 'ACTIVE' : 'PAUSED'} label={config.enabled ? 'AI enabled' : 'AI disabled'} />
            <span className="text-muted-foreground">
              {config.liveAvailable ? 'a credential is configured' : 'no usable credential — every answer comes from the rule engines'}
            </span>
            <span className="text-muted-foreground">
              · {config.rateLimitPerMinute} req/min · {config.tokensPerMinute.toLocaleString('en-IN')} tokens/min on the
              primary · {config.dailyTokenBudget.toLocaleString('en-IN')} tokens/day · {config.timeoutMs}ms timeout ·{' '}
              {config.maxRetries} transport retries
            </span>
          </div>

          <ol className="flex flex-col gap-2">
            {config.chain.length === 0 ? (
              <li className="rounded-lg border border-dashed border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                No allow-listed endpoint holds a credential. Agents fall back to the deterministic engines.
              </li>
            ) : null}
            {config.chain.map((endpoint, index) => (
              <li key={endpoint.name} className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2">
                <p className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-xs text-muted-foreground tabular-nums">{index + 1}.</span>
                  <span className="font-medium">{endpoint.name}</span>
                  <span className="text-xs text-muted-foreground">{endpoint.host}</span>
                  <span className="text-xs">{endpoint.model}</span>
                  <span className="text-[11px] text-muted-foreground">
                    {endpoint.tokensPerMinute.toLocaleString('en-IN')} tokens/min ·{' '}
                    {endpoint.jsonMode ? 'JSON mode' : 'prompt-only JSON'}
                  </span>
                  {index === 0 ? <span className="text-[11px] text-brand-700">primary</span> : <span className="text-[11px] text-muted-foreground">failover</span>}
                </p>
              </li>
            ))}
          </ol>

          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Credentials are read from the server environment and never rendered here — presence is shown as a boolean,
            and the host allow list in <code className="text-xs">src/lib/ai/config.ts</code> is what stops a key being
            sent somewhere it was not configured for.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">The four agents</CardTitle>
          <CardDescription className="text-xs">
            Aggregated from stored runs. A fallback is a real event with a stored reason, not a display state. Past runs
            prove those calls happened — they are not evidence a provider answers the next one; the chain above is what
            this process will attempt now.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {health.byAgent.every((agent) => agent.runs === 0) ? (
            <p className="text-sm text-muted-foreground">
              No agent has run in this window. Trigger one from a candidate account, or use{' '}
              <Link href="/admin/review" className="underline underline-offset-2">
                the review queue
              </Link>{' '}
              to see what they raised.
            </p>
          ) : (
            <>
              <CategoryBarChart
                data={health.byAgent
                  .filter((agent) => agent.runs > 0)
                  .map((agent) => ({ label: AGENT_LABELS[agent.agent] ?? label(agent.agent), count: agent.runs }))}
                label="Runs per agent"
                description="Runs counted per agent over the window; the table below carries the same rows with their token and latency figures."
              />
                <Table>
                <TableCaption>Agent runs recorded in the last {windowHours} hours.</TableCaption>
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">Agent</TableHead>
                    <TableHead scope="col">Runs</TableHead>
                    <TableHead scope="col">Model / fallback</TableHead>
                    <TableHead scope="col">Fallback rate</TableHead>
                    <TableHead scope="col">Blocked items</TableHead>
                    <TableHead scope="col">Tokens</TableHead>
                    <TableHead scope="col">Average duration</TableHead>
                    <TableHead scope="col">Last run</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {health.byAgent.map((agent) => (
                    <TableRow key={agent.agent}>
                      <TableCell>
                        <span className="block font-medium">{AGENT_LABELS[agent.agent] ?? label(agent.agent)}</span>
                      </TableCell>
                      <TableCell className="tabular-nums">{agent.runs}</TableCell>
                      <TableCell className="tabular-nums text-xs">
                        <span className="text-emerald-700">{agent.ai}</span> /{' '}
                        <span className={agent.fallback > 0 ? 'text-amber-700' : 'text-muted-foreground'}>
                          {agent.fallback}
                        </span>
                        {agent.failed > 0 ? <span className="text-destructive"> · {agent.failed} failed</span> : null}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {agent.fallbackRate == null ? '—' : `${Math.round(agent.fallbackRate * 100)}%`}
                      </TableCell>
                      <TableCell className="tabular-nums">{agent.blockedItems}</TableCell>
                      <TableCell className="tabular-nums text-xs">{agent.tokens.toLocaleString('en-IN')}</TableCell>
                      <TableCell className="tabular-nums text-xs">
                        {agent.averageLatencyMs == null
                          ? '—'
                          : agent.averageLatencyMs < 1000
                            ? `${agent.averageLatencyMs} ms`
                            : `${(agent.averageLatencyMs / 1000).toFixed(2)} s`}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs">
                        {agent.lastRunAt ? (
                          <>
                            <span className="block">{relativeTime(agent.lastRunAt)}</span>
                            <span className="block text-[11px] text-muted-foreground">{formatDateTime(agent.lastRunAt)}</span>
                          </>
                        ) : (
                          '—'
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                </Table>
            </>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Recent fallbacks</CardTitle>
            <CardDescription className="text-xs">
              The eight most recent fallbacks in the window — the counts above are the whole window. Each of these
              answers was produced by the deterministic engines, and the stored reason is shown verbatim.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {health.recentFallbacks.length === 0 ? (
              <p className="text-xs text-muted-foreground">None in this window.</p>
            ) : null}
            {health.recentFallbacks.map((run) => (
              <div key={run.id} className="rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-xs">
                <p className="flex flex-wrap items-center gap-2 font-medium">
                  {AGENT_LABELS[run.agent] ?? run.agent}
                  <StatusBadge value={run.fallbackReason ?? 'FALLBACK'} />
                  <span className="text-muted-foreground">{formatDateTime(run.startedAt)}</span>
                </p>
                <p className="mt-1 leading-relaxed text-amber-950">{run.fallbackNote}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Guardrail blocks in this window</CardTitle>
            <CardDescription className="text-xs">
              The eight most recent runs that had something blocked; the count above totals every run in the window.
              Output the platform refused to store: unknown skill slugs, evidence with no verbatim quote, invented
              catalogue links, or any inference of a protected characteristic.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {health.recentBlocks.length === 0 ? (
              <p className="text-xs text-muted-foreground">No run in this window had an item blocked.</p>
            ) : null}
            {health.recentBlocks.map((run) => (
              <div key={run.id} className="rounded-lg border border-border/70 bg-muted/25 px-3 py-2 text-xs">
                <p className="flex flex-wrap items-center gap-2 font-medium">
                  {AGENT_LABELS[run.agent] ?? run.agent}
                  <span className="text-muted-foreground">{formatDateTime(run.startedAt)}</span>
                </p>
                <ul className="mt-1 flex flex-col gap-1">
                  {(Array.isArray(run.blocked) ? run.blocked : []).slice(0, 4).map((item, index) => {
                    const entry = item as { rule?: string; detail?: string }
                    return (
                      <li key={`${run.id}-${index}`} className="leading-relaxed text-muted-foreground">
                        <span className="font-medium text-foreground">{entry.rule ?? 'block'}</span> — {entry.detail ?? ''}
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <InfoNote tone="warning" title="A fallback is a working system, not a broken one">
        When no endpoint can answer, the rule engines produce the same structured output with{' '}
        <code className="text-xs">mode = DETERMINISTIC</code> recorded, and every screen that shows the result says which
        path produced it. Nothing on this page claims a live labour-market feed, external verification of a skill, or a
        bias-free outcome.
      </InfoNote>
    </div>
  )
}
