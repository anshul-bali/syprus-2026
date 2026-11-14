import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { EmptyState, InfoNote, PageHeader, StatusBadge } from '@/components/common'
import { AiHealthSection } from '@/components/admin/ai-health'
import { OrchestrationRunner } from '@/components/admin/orchestration-runner'
import { aiHealth } from '@/server/ai/runs'
import { listOrchestrationRuns } from '@/server/ai/orchestration'
import { prisma } from '@/lib/db'
import { requirePermission } from '@/lib/authz'
import { engineHealth, engineLabel } from '@/server/engine-log'
import { anonymizationActivity } from '@/server/admin-jobs'
import { formatDate, formatDateTime, relativeTime, toPercent } from '@/lib/utils'
import { label as enumLabel } from '@/lib/options'

export const metadata = { title: 'Agent health' }

const WINDOWS = [
  { hours: 24, label: '24 hours' },
  { hours: 168, label: '7 days' },
  { hours: 720, label: '30 days' },
]

const ENGINE_NOTES: Record<string, string> = {
  SKILL_INFERENCE: 'Keyword and pattern rules over the candidate’s own wording, against the curated skill taxonomy.',
  GAP_ANALYSIS: 'Set comparison between a profile’s skills and a role’s required and preferred skills.',
  PATHWAY_PLANNER: 'Orders existing catalogue resources by the gaps it was given. It never invents a resource.',
  MATCHING: 'Weighted coverage model: required 50%, preferred 20%, evidence and assessment strength 20%, candidate preferences and constraints 10%. Configurable prototype assumptions.',
  FAIRNESS_AUDIT: 'Descriptive statistics over stored match scores grouped by career-break band.',
  ANONYMIZATION: 'Deterministic field projection — identity columns are removed before an employer read.',
}

function resolveWindow(value: string | undefined) {
  const parsed = Number(value)
  return WINDOWS.some((entry) => entry.hours === parsed) ? parsed : 168
}

export default async function AdminEnginesPage(props: { searchParams: Promise<{ hours?: string }> }) {
  const principal = await requirePermission('admin.engine.read')
  const params = await props.searchParams
  const hours = resolveWindow(params.hours)

  const [rows, anonymization, aiHealthValue, orchestrationRuns, profiles, jobs] = await Promise.all([
    engineHealth(hours),
    anonymizationActivity(principal, hours),
    aiHealth(hours),
    listOrchestrationRuns(principal, { take: 8 }),
    prisma.candidateProfile.findMany({
      select: { id: true, anonymousHandle: true, targetRole: true },
      orderBy: { createdAt: 'desc' },
      take: 30,
    }),
    prisma.job.findMany({
      where: { status: 'PUBLISHED' },
      select: { id: true, title: true },
      orderBy: { postedAt: 'desc' },
      take: 30,
    }),
  ])

  const runs = rows.reduce((total, row) => total + row.runs, 0)
  const failures = rows.reduce((total, row) => total + row.failures, 0)

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Administrator"
        title="Agent health"
        description="Two kinds of work are measured separately: the deterministic rule engines (engine_runs) and the four AI agents (ai_runs). A run on this page is a stored fact about something that already happened, never a synthetic uptime figure."
        actions={
          <Button variant="outline" nativeButton={false} render={<Link href="/admin/review" />}>
            Human review queue
          </Button>
        }
      />

      <nav aria-label="Time window" className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">Window:</span>
        {WINDOWS.map((entry) => {
          const active = entry.hours === hours
          return (
            <Link
              key={entry.hours}
              href={`/admin/engines?hours=${entry.hours}`}
              aria-current={active ? 'page' : undefined}
              className={
                active
                  ? 'rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-primary-foreground'
                  : 'rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
              }
            >
              Last {entry.label}
            </Link>
          )
        })}
        <span className="text-xs text-muted-foreground">
          {runs} run{runs === 1 ? '' : 's'} recorded, {failures} failed
        </span>
      </nav>

      <div className="space-y-4">
        <h2 className="text-lg font-semibold">AI agents</h2>
        <AiHealthSection health={aiHealthValue} windowHours={hours} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[24rem_minmax(0,1fr)] lg:items-start">
        <OrchestrationRunner
          isAdmin
          profiles={profiles.map((profile) => ({
            value: profile.id,
            label: `${profile.anonymousHandle}${profile.targetRole ? ` → ${profile.targetRole}` : ''}`,
          }))}
          jobs={jobs.map((job) => ({ value: job.id, label: job.title }))}
        />

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Workflow runs</CardTitle>
            <CardDescription className="text-xs">
              Discovery → matching → pathways, with each step’s real status and the mode that produced it.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {orchestrationRuns.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No workflow has been run yet. Running it writes <code className="text-xs">orchestration_runs</code> and{' '}
                <code className="text-xs">orchestration_steps</code> rows you can read here afterwards.
              </p>
            ) : (
              <ul className="flex flex-col gap-3">
                {orchestrationRuns.map((run) => (
                  <li key={run.id} className="rounded-xl border border-border/70 bg-muted/20 p-3">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      {run.candidateProfile.anonymousHandle}
                      <StatusBadge value={run.status} />
                      <StatusBadge value={run.mode} label={run.mode === 'AI' ? 'model' : 'rules'} />
                      <span className="text-xs text-muted-foreground">{formatDateTime(run.startedAt)}</span>
                    </p>
                    <ol className="mt-2 flex flex-col gap-1.5">
                      {run.steps.map((step) => (
                        <li key={step.id} className="flex flex-wrap items-baseline gap-2 text-xs">
                          <span className="tabular-nums text-muted-foreground">{step.position}.</span>
                          <span className="font-medium">{step.agent}</span>
                          <StatusBadge value={step.status} />
                          <span className="text-muted-foreground">
                            {step.producedCount} produced
                            {step.aiRunId ? ' · model run' : ' · rule engine'}
                            {step.fallbackReason ? ` · ${step.fallbackReason}` : ''}
                            {step.durationMs ? ` · ${(step.durationMs / 1000).toFixed(1)}s` : ''}
                          </span>
                        </li>
                      ))}
                    </ol>
                    {run.errorMessage ? (
                      <p className="mt-2 text-[11px] leading-relaxed text-destructive">
                        {run.errorStep}: {run.errorMessage}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Deterministic rule engines</h2>

      <InfoNote tone="info" title="What these agents are, and what they are not">
        <p>
          Each entry below is a rule engine running inside this application: keyword matching, weighted coverage maths,
          set comparison and descriptive statistics. No row in this table performs a model call — the AI agents and
          their provider chain are listed above, from <code className="text-xs">ai_runs</code>. A{' '}
          <strong>Failed</strong> status below is a real exception written by{' '}
          <code className="text-xs">runEngine</code> to <code className="text-xs">engine_runs</code>, with its message,
          not a status this screen invented.
        </p>
      </InfoNote>

      {rows.every((row) => row.runs === 0) ? (
        <EmptyState
          title={`Nothing ran in the last ${hours} hours`}
          description="Agents run when a candidate builds a profile, when a role is published, and when an employer browses candidates. Widen the window above to see earlier activity."
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Agents</CardTitle>
            <CardDescription>Aggregated over the selected window, newest run per agent.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableCaption>
                Engine runs recorded in the last {hours} hours, one row per agent with its real failure data.
              </TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Agent</TableHead>
                  <TableHead scope="col">Last status</TableHead>
                  <TableHead scope="col">Last run</TableHead>
                  <TableHead scope="col">Average duration</TableHead>
                  <TableHead scope="col">Runs / ok / failed</TableHead>
                  <TableHead scope="col">Success rate</TableHead>
                  <TableHead scope="col">Items processed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.engine}>
                    <TableCell>
                      <span className="block font-medium">{engineLabel(row.engine)}</span>
                      <span className="block max-w-[24rem] whitespace-normal text-xs leading-relaxed text-muted-foreground">
                        {ENGINE_NOTES[row.engine] ?? 'Rule-based agent.'}
                      </span>
                    </TableCell>
                    <TableCell>
                      {row.lastStatus ? (
                        <StatusBadge value={row.lastStatus} label={enumLabel(row.lastStatus)} />
                      ) : (
                        <span className="text-xs text-muted-foreground">No run in window</span>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {row.lastRunAt ? (
                        <>
                          <span className="block">{relativeTime(row.lastRunAt)}</span>
                          <span className="block text-[11px] text-muted-foreground">{formatDateTime(row.lastRunAt)}</span>
                        </>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {row.averageDurationMs == null
                        ? '—'
                        : row.averageDurationMs < 1000
                          ? `${row.averageDurationMs} ms`
                          : `${(row.averageDurationMs / 1000).toFixed(2)} s`}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {row.runs} / <span className="text-emerald-700">{row.successes}</span> /{' '}
                      <span className={row.failures > 0 ? 'text-destructive' : 'text-muted-foreground'}>{row.failures}</span>
                    </TableCell>
                    <TableCell className="min-w-[8rem]">
                      {row.successRate == null ? (
                        <span className="text-xs text-muted-foreground">No data</span>
                      ) : (
                        <>
                          <span className="text-xs tabular-nums">{toPercent(row.successRate)}</span>
                          <Progress
                            value={Math.round(row.successRate * 100)}
                            className="mt-1 h-2"
                            aria-label={`${engineLabel(row.engine)} success rate ${Math.round(row.successRate * 100)} percent`}
                          />
                        </>
                      )}
                    </TableCell>
                    <TableCell className="tabular-nums">{row.itemsProcessed}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {rows.some((row) => row.lastError) ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Latest error message per agent</CardTitle>
            <CardDescription>Stored verbatim from the failing run.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {rows
                .filter((row) => row.lastError)
                .map((row) => (
                  <li key={row.engine} className="rounded-lg border border-destructive/30 bg-destructive/5 px-3.5 py-2.5">
                    <p className="text-sm font-medium">{engineLabel(row.engine)}</p>
                    <p className="mt-1 text-xs leading-relaxed break-words text-destructive">{row.lastError}</p>
                    {row.lastRunAt ? (
                      <p className="mt-1 text-[11px] text-muted-foreground">Run started {formatDateTime(row.lastRunAt)}</p>
                    ) : null}
                  </li>
                ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Anonymisation filter in practice</CardTitle>
          <CardDescription>
            Counted from the profile_views table, which records every employer read of a candidate profile.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border border-border/70 px-3.5 py-2.5">
              <dt className="text-xs tracking-wide text-muted-foreground uppercase">Reads in window</dt>
              <dd className="mt-1 text-xl font-semibold tabular-nums">{anonymization.viewsInWindow}</dd>
            </div>
            <div className="rounded-lg border border-border/70 px-3.5 py-2.5">
              <dt className="text-xs tracking-wide text-muted-foreground uppercase">Reads all time</dt>
              <dd className="mt-1 text-xl font-semibold tabular-nums">{anonymization.totalViews}</dd>
            </div>
            <div className="rounded-lg border border-border/70 px-3.5 py-2.5">
              <dt className="text-xs tracking-wide text-muted-foreground uppercase">Profiles / organisations in window</dt>
              <dd className="mt-1 text-xl font-semibold tabular-nums">
                {anonymization.profilesViewedInWindow} / {anonymization.organizationsViewingInWindow}
              </dd>
            </div>
            <div className="rounded-lg border border-border/70 px-3.5 py-2.5">
              <dt className="text-xs tracking-wide text-muted-foreground uppercase">Identity revealed</dt>
              <dd className="mt-1 text-xl font-semibold tabular-nums">
                {anonymization.identityRevealedInWindow}
                <span className="ml-1 text-xs font-normal text-muted-foreground">
                  ({anonymization.identityRevealedTotal} all time)
                </span>
              </dd>
            </div>
          </dl>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {anonymization.lastViewAt
              ? `Most recent employer read ${formatDate(anonymization.lastViewAt)}. `
              : 'No employer has opened a candidate profile on this platform yet. '}
            A revealed identity is only possible after the candidate applies to a role in that organisation, so this
            filter is evidence of what employers could see, not of any outcome.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
