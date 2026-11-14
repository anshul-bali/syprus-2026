import Link from 'next/link'
import {
  Activity,
  ArrowRight,
  BadgeCheck,
  Briefcase,
  Building2,
  Gauge,
  Scale,
  ScrollText,
  ShieldAlert,
  Users,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { can, requirePermission } from '@/lib/authz'
import { engineHealth, engineLabel } from '@/server/engine-log'
import { listUsers, moderationQueue, reportingDashboard } from '@/server/admin'
import { reviewTaskCounts } from '@/server/review'
import { DemoBadge, EmptyState, ErrorState, InfoNote, PageHeader, StatCard, StatusBadge } from '@/components/common'
import { ApplicationTrendChart, CategoryBarChart, SignupTrendChart } from '@/components/admin/charts'
import { relativeTime } from '@/lib/utils'
import { APPLICATION_STATUSES, JOB_STATUSES, label as enumLabel } from '@/lib/options'

export const metadata = { title: 'Platform overview' }

const SCREENS = [
  {
    href: '/admin/users',
    title: 'Users',
    text: 'Search accounts, see profile or organisation context, change an account status.',
    icon: Users,
    permission: 'admin.user.read',
  },
  {
    href: '/admin/organisations',
    title: 'Organisations',
    text: 'Verify or reject employer accounts and see what each decision does to their roles.',
    icon: Building2,
    permission: 'admin.org.read',
  },
  {
    href: '/admin/moderation',
    title: 'Role moderation',
    text: 'The queue of roles awaiting a decision, plus every role on the platform by status.',
    icon: ShieldAlert,
    permission: 'admin.job.read',
  },
  {
    href: '/admin/engines',
    title: 'Agent health',
    text: 'Run history of the rule-based agents from engine_runs, including real failures.',
    icon: Activity,
    permission: 'admin.engine.read',
  },
  {
    href: '/admin/fairness',
    title: 'Fairness monitoring',
    text: 'Stored match scores measured against career-break bands and caregiving history.',
    icon: Scale,
    permission: 'admin.fairness.read',
  },
  {
    href: '/admin/reporting',
    title: 'Reporting',
    text: 'Signup, application, role and match series with the totals behind them.',
    icon: Gauge,
    permission: 'admin.reporting.read',
  },
  {
    href: '/admin/audit',
    title: 'Audit history',
    text: 'Every recorded state change: who acted, on what, and the note they left.',
    icon: ScrollText,
    permission: 'admin.audit.read',
  },
]

export default async function AdminOverviewPage() {
  const principal = await requirePermission('admin.dashboard.read')

  const hasReporting = can(principal, 'admin.reporting.read')
  const hasJobs = can(principal, 'admin.job.read')
  const hasEngines = can(principal, 'admin.engine.read')

  if (!hasReporting) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Platform overview"
          description="Aggregate activity across the platform. This screen needs the reporting read permission as well as the dashboard one."
        />
        <ErrorState
          title="Reporting is not readable by this account"
          description="The overview figures come from the reporting service, which requires admin.reporting.read. Your role holds admin.dashboard.read only."
        />
      </div>
    )
  }

  const [report, queue, engines, newAccounts, reviewTasks] = await Promise.all([
    reportingDashboard(principal),
    hasJobs ? moderationQueue(principal, 'PENDING_MODERATION') : Promise.resolve([]),
    hasEngines ? engineHealth(168) : Promise.resolve([]),
    can(principal, 'admin.user.read') ? listUsers(principal, { take: 5 }) : Promise.resolve([]),
    reviewTaskCounts(),
  ])

  const totals = report.totals
  const pendingOrgs = report.byVerification.find((row) => row.status === 'PENDING')?.count ?? 0
  const rejectedOrgs = report.byVerification.find((row) => row.status === 'REJECTED')?.count ?? 0
  const failedRuns = engines.reduce((total, row) => total + row.failures, 0)
  const totalRuns = engines.reduce((total, row) => total + row.runs, 0)
  const signupTotal = report.signupSeries.reduce((sum, row) => sum + row.count, 0)
  const applicationTotal = report.applicationSeries.reduce((sum, row) => sum + row.count, 0)

  /**
   * A composition block that always shows the same numbers twice: once as bars
   * and once as a table, with the sum stated so a reader can check the chart
   * against the count it came from.
   */
  const compositions = [
    {
      key: 'roles',
      title: 'Roles by moderation status',
      caption: 'Every role on the platform, grouped by the status an administrator or employer last set.',
      rows: JOB_STATUSES.map((status) => ({
        label: enumLabel(status),
        count: report.byJobStatus.find((row) => row.status === status)?.count ?? 0,
      })).filter((row) => row.count > 0),
      total: report.byJobStatus.reduce((sum, row) => sum + row.count, 0),
      totalLabel: 'roles on the platform',
      href: '/admin/moderation',
      linkLabel: 'Open role moderation',
    },
    {
      key: 'applications',
      title: 'Applications by pipeline stage',
      caption: 'The stage an application holds now. One application is counted once, in one stage.',
      rows: APPLICATION_STATUSES.map((status) => ({
        label: enumLabel(status),
        count: report.byApplicationStatus.find((row) => row.status === status)?.count ?? 0,
      })).filter((row) => row.count > 0),
      total: report.byApplicationStatus.reduce((sum, row) => sum + row.count, 0),
      totalLabel: 'applications recorded',
      href: '/admin/reporting',
      linkLabel: 'Full reporting series',
    },
    {
      key: 'accounts',
      title: 'Accounts by role',
      caption: 'Login accounts by the role that decides what the account can read.',
      rows: report.byRole.map((row) => ({ label: enumLabel(row.role), count: row.count })),
      total: report.byRole.reduce((sum, row) => sum + row.count, 0),
      totalLabel: 'accounts in total',
      href: '/admin/users',
      linkLabel: 'Manage accounts',
    },
  ]

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Administrator"
        title="Platform overview"
        description="Counts read live from the database: accounts, organisations, roles, applications and the matches the scoring model wrote."
        actions={<DemoBadge text="Seeded accounts are demonstration data" />}
      />

      {queue.length > 0 ? (
        <InfoNote tone="warning" title={`${queue.length} role${queue.length === 1 ? '' : 's'} awaiting a moderation decision`}>
          Nothing reaches candidates from this queue until an administrator publishes it, and only for a verified
          organisation.{' '}
          {hasJobs ? (
            <Button
              variant="link"
              size="sm"
              className="h-auto px-0 font-medium underline-offset-4"
              nativeButton={false}
              render={<Link href="/admin/moderation" />}
            >
              Open the moderation queue
            </Button>
          ) : null}
        </InfoNote>
      ) : null}

      <section aria-labelledby="stats-heading" className="space-y-3">
        <h2 id="stats-heading" className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Platform totals
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Candidates" value={totals.candidates} hint="Accounts with the candidate role" icon={Users} />
          <StatCard label="Employers" value={totals.employers} hint={`${totals.admins} administrator account${totals.admins === 1 ? '' : 's'}`} icon={Briefcase} tone="neutral" />
          <StatCard
            label="Organisations verified"
            value={totals.verifiedOrganisations}
            hint={`${pendingOrgs} pending, ${rejectedOrgs} rejected of ${totals.organisations}`}
            icon={Building2}
            tone="positive"
          />
          <StatCard
            label="Published roles"
            value={totals.publishedJobs}
            hint={`${totals.pendingModeration} awaiting moderation`}
            icon={ShieldAlert}
            tone={totals.pendingModeration > 0 ? 'warning' : 'brand'}
          />
          <StatCard label="Applications" value={totals.applications} hint="All pipeline stages, all organisations" icon={ScrollText} tone="neutral" />
          <StatCard
            label="Matches stored"
            value={totals.matches}
            hint={`Average score ${totals.matches > 0 ? `${Math.round(totals.averageMatchScore * 100)}%` : 'no matches yet'}`}
            icon={Gauge}
          />
          <StatCard label="Skills in catalogue" value={totals.skills} hint="Shared skill taxonomy for roles and profiles" icon={BadgeCheck} tone="neutral" />
          <StatCard
            label="Evidenced / inferred skills"
            value={`${totals.evidencedSkills} / ${totals.inferredSkills}`}
            hint={`${totals.visibleProfiles} candidate profiles visible to employers`}
            icon={Users}
            tone="brand"
          />
        </div>
      </section>

      <section aria-labelledby="queues-heading" className="space-y-3">
        <h2 id="queues-heading" className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Queues waiting on a person
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Roles awaiting moderation"
            value={totals.pendingModeration}
            hint={hasJobs ? `${queue.length} listed for you now` : 'Queue listing needs the role-moderation permission'}
            icon={ShieldAlert}
            tone={totals.pendingModeration > 0 ? 'warning' : 'neutral'}
          />
          <StatCard label="Review tasks open" value={reviewTasks.open} hint={`${reviewTasks.total} task${reviewTasks.total === 1 ? '' : 's'} ever recorded`} icon={ScrollText} tone={reviewTasks.open > 0 ? 'warning' : 'neutral'} />
          <StatCard
            label="Review tasks decided"
            value={reviewTasks.approved + reviewTasks.rejected}
            hint={`${reviewTasks.approved} approved, ${reviewTasks.rejected} rejected, ${reviewTasks.deferred} deferred`}
            icon={BadgeCheck}
            tone="neutral"
          />
          <StatCard
            label="Agent runs, last 7 days"
            value={totalRuns}
            hint={failedRuns > 0 ? `${failedRuns} failed run${failedRuns === 1 ? '' : 's'} recorded` : 'no failures recorded'}
            icon={Activity}
            tone={failedRuns > 0 ? 'warning' : 'brand'}
          />
        </div>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          These are counts of stored rows. A queue is never drawn as empty because nothing was scheduled — if the table
          has no rows, the card says so.
        </p>
      </section>

      <section aria-labelledby="composition-heading" className="space-y-3">
        <h2 id="composition-heading" className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Composition, charted and tabulated
        </h2>
        <div className="grid gap-4 lg:grid-cols-3">
          {compositions.map((block) => {
            const sum = block.rows.reduce((total, row) => total + row.count, 0)
            return (
              <Card key={block.key} className="h-full">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">{block.title}</CardTitle>
                  <CardDescription className="text-xs">{block.caption}</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-2">
                  {block.rows.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-border bg-muted/30 px-3 py-4 text-center text-xs text-muted-foreground">
                      No rows carry this grouping yet, so there is nothing to draw.
                    </p>
                  ) : (
                    <>
                      <CategoryBarChart data={block.rows} label={block.title} description="The same figures are listed below the bars." />
                      <ul className="divide-y divide-border/60 text-xs">
                        {block.rows.map((row) => (
                          <li key={row.label} className="flex items-baseline justify-between gap-2 py-1.5">
                            <span className="min-w-0 leading-snug">{row.label}</span>
                            <span className="shrink-0 font-medium tabular-nums">{row.count}</span>
                          </li>
                        ))}
                        <li className="flex items-baseline justify-between gap-2 border-t-2 border-border py-1.5 font-medium">
                          <span>Total</span>
                          <span className="tabular-nums">{sum}</span>
                        </li>
                      </ul>
                      <p className="text-[11px] leading-relaxed text-muted-foreground">
                        {sum === block.total
                          ? `The bars and the list both add to ${block.total} ${block.totalLabel} — the same rows the totals block above counts.`
                          : `The list adds to ${sum} but the grouping reports ${block.total} ${block.totalLabel}. The difference is shown rather than smoothed.`}
                      </p>
                      <Button variant="outline" size="xs" nativeButton={false} render={<Link href={block.href} />}>
                        {block.linkLabel}
                      </Button>
                    </>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">New accounts, last 30 days</CardTitle>
            <CardDescription>
              Daily signups bucketed from the account creation timestamps. {signupTotal} in the window.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {signupTotal === 0 ? (
              <p className="rounded-lg border border-dashed border-border bg-muted/30 px-3 py-5 text-sm text-muted-foreground">
                No account was created in the last 30 days, so no trend is drawn. A flat line would look like a
                measurement of activity that did not happen.
              </p>
            ) : (
              <SignupTrendChart data={report.signupSeries} label="Signups per day over the last 30 days" />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Applications started, last 30 days</CardTitle>
            <CardDescription>
              Daily application rows. {applicationTotal} in the window — the same rows the stage counts above include.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {applicationTotal === 0 ? (
              <p className="rounded-lg border border-dashed border-border bg-muted/30 px-3 py-5 text-sm text-muted-foreground">
                No application was recorded in the last 30 days. The stage counts above still describe the applications
                that exist, but there is no recent series to draw.
              </p>
            ) : (
              <ApplicationTrendChart data={report.applicationSeries} label="Applications per day over the last 30 days" />
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Agent activity, last 7 days</CardTitle>
            <CardDescription>
              {hasEngines
                ? `${totalRuns} recorded run${totalRuns === 1 ? '' : 's'} across ${engines.length} rule-based agents; ${failedRuns} failed.`
                : 'This account cannot read engine health.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {failedRuns > 0 ? (
              <p className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-900">
                {failedRuns} failed run{failedRuns === 1 ? '' : 's'} in the window. Each one is a real error written to
                engine_runs, not a synthetic status.
              </p>
            ) : null}
            <ul className="divide-y divide-border/70">
              {engines.map((engine) => (
                <li key={engine.engine} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{engineLabel(engine.engine)}</p>
                    <p className="text-xs text-muted-foreground">
                      {engine.runs === 0
                        ? 'No runs in this window'
                        : `${engine.runs} run${engine.runs === 1 ? '' : 's'} · ${engine.itemsProcessed} item${
                            engine.itemsProcessed === 1 ? '' : 's'
                          } · ${relativeTime(engine.lastRunAt)}`}
                    </p>
                  </div>
                  <StatusBadge value={engine.lastStatus ?? 'IDLE'} label={engine.lastStatus ? enumLabel(engine.lastStatus) : 'Idle'} />
                </li>
              ))}
              {engines.length === 0 ? <li className="py-3 text-sm text-muted-foreground">No engine data available.</li> : null}
            </ul>
            {hasEngines ? (
              <Button variant="outline" size="sm" className="mt-3 w-full" nativeButton={false} render={<Link href="/admin/engines" />}>
                Full agent health
                <ArrowRight className="size-3.5" aria-hidden />
              </Button>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <section aria-labelledby="screens-heading">
        <h2 id="screens-heading" className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Administration screens
        </h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {SCREENS.filter((screen) => can(principal, screen.permission as Parameters<typeof can>[1])).map((screen) => (
            <Card key={screen.href} className="h-full">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <screen.icon className="size-4 text-brand-600" aria-hidden />
                  {screen.title}
                </CardTitle>
                <CardDescription>{screen.text}</CardDescription>
              </CardHeader>
              <CardContent>
                <Button variant="outline" size="sm" nativeButton={false} render={<Link href={screen.href} />}>
                  Open
                  <ArrowRight className="size-3.5" aria-hidden />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
        {SCREENS.every((screen) => !can(principal, screen.permission as Parameters<typeof can>[1])) ? (
          <EmptyState
            title="No administration screens to open"
            description="This account can read the overview, but holds none of the detailed admin permissions. Ask a platform owner to grant them."
          />
        ) : null}
      </section>

      <Separator />

      <section aria-labelledby="recent-accounts" className="space-y-3">
        <h2 id="recent-accounts" className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Newest accounts
        </h2>
        <ul className="divide-y divide-border/70 rounded-xl border border-border bg-card">
          {newAccounts.map((user) => (
            <li key={user.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
              <span className="min-w-0">
                <span className="text-sm font-medium">{user.name}</span>
                <span className="ml-2 text-xs text-muted-foreground">{enumLabel(user.role)}</span>
              </span>
              <span className="flex items-center gap-2">
                <StatusBadge value={user.status} label={enumLabel(user.status)} />
                <span className="text-xs text-muted-foreground">{relativeTime(user.createdAt)}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
