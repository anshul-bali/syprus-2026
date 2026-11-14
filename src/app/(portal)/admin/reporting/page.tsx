import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { DemoBadge, EmptyState, InfoNote, PageHeader, StatCard } from '@/components/common'
import { ApplicationTrendChart, CategoryBarChart, RoleShareChart, SignupTrendChart } from '@/components/admin/charts'
import { requirePermission } from '@/lib/authz'
import { reportingDashboard } from '@/server/admin'
import { label as enumLabel } from '@/lib/options'

export const metadata = { title: 'Reporting' }

export default async function AdminReportingPage() {
  const principal = await requirePermission('admin.reporting.read')
  const report = await reportingDashboard(principal)

  const totals = report.totals
  const signupTotal = report.signupSeries.reduce((sum, row) => sum + row.count, 0)
  const applicationTotal = report.applicationSeries.reduce((sum, row) => sum + row.count, 0)

  const jobStatusData = report.byJobStatus.map((row) => ({ label: enumLabel(row.status), count: row.count }))
  const applicationStatusData = report.byApplicationStatus.map((row) => ({
    label: enumLabel(row.status),
    count: row.count,
  }))
  const roleData = report.byRole.map((row) => ({ label: enumLabel(row.role), count: row.count }))
  const bandData = report.breakBands.map((band) => ({ label: band.label, count: band.count }))

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Administrator"
        title="Reporting dashboard"
        description="Aggregates computed directly from the database: account creation, applications, role statuses, stored matches and career-break distribution."
        actions={<DemoBadge text="Seeded records are demonstration data" />}
      />

      <InfoNote tone="info" title="How these figures are produced">
        <p>
          Each series is a <code className="text-xs">GROUP BY</code> or a daily bucketing of stored timestamps, so the
          numbers describe this database only. There is no external labour-market feed behind them, and no placement
          outcome is implied by a published role or an application: the platform records what happened inside it. A
          large share of these rows were created by the demonstration seed, so read the shapes, not the absolute values.
        </p>
      </InfoNote>

      {totals.candidates + totals.employers + totals.admins + totals.organisations + totals.applications === 0 ? (
        <EmptyState
          title="Nothing to report yet"
          image="reporting-awaiting-data"
          description="Every figure below is a GROUP BY over stored rows. While there are no accounts, organisations, roles or applications, the charts stay empty on purpose — no placeholder numbers are drawn."
          action={
            <Button variant="outline" nativeButton={false} render={<Link href="/admin/users" />}>
              Check the account list
            </Button>
          }
        />
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Accounts" value={totals.candidates + totals.employers + totals.admins} hint={`${totals.candidates} candidates · ${totals.employers} employers · ${totals.admins} admins`} />
        <StatCard label="Organisations" value={totals.organisations} hint={`${totals.verifiedOrganisations} verified`} tone="positive" />
        <StatCard label="Roles" value={totals.publishedJobs} hint={`${totals.pendingModeration} awaiting moderation`} tone="brand" />
        <StatCard label="Applications" value={totals.applications} hint={`${totals.matches} stored match scores`} tone="neutral" />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Signups, last 30 days</CardTitle>
            <CardDescription>
              {signupTotal} account{signupTotal === 1 ? '' : 's'} created in the window, bucketed by creation date.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <SignupTable series={report.signupSeries} />
            <SignupTrendChart data={report.signupSeries} label="Signups per day" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Applications, last 30 days</CardTitle>
            <CardDescription>
              {applicationTotal} application{applicationTotal === 1 ? '' : 's'} submitted in the window.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <SignupTable series={report.applicationSeries} />
            <ApplicationTrendChart data={report.applicationSeries} label="Applications per day" color="var(--color-teal-600)" />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Roles by status</CardTitle>
            <CardDescription>Every role record on the platform, grouped by its lifecycle status.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <MiniTable rows={jobStatusData} caption="Role status" valueCaption="Roles" />
            <CategoryBarChart data={jobStatusData} label="Roles by status" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Applications by status</CardTitle>
            <CardDescription>Pipeline stage as recorded on each application row.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <MiniTable rows={applicationStatusData} caption="Pipeline stage" valueCaption="Applications" />
            <CategoryBarChart data={applicationStatusData} label="Applications by status" color="var(--color-teal-600)" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Accounts by role</CardTitle>
            <CardDescription>Share of the {roleData.reduce((sum, row) => sum + row.count, 0)} registered accounts.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <MiniTable rows={roleData} caption="Role" valueCaption="Accounts" />
            <RoleShareChart data={roleData} label="Accounts by role" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Career-break distribution</CardTitle>
            <CardDescription>
              Self-reported break length on candidate profiles. Profiles without the field are not counted here.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <MiniTable rows={bandData} caption="Break length" valueCaption="Profiles" />
            <CategoryBarChart data={bandData} label="Candidate profiles by career-break length" color="var(--color-plum-500)" />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Totals</CardTitle>
          <CardDescription>The same figures as a plain table, for copying or exporting.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableCaption>Aggregate totals for the whole platform.</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Metric</TableHead>
                <TableHead scope="col">Value</TableHead>
                <TableHead scope="col">What it counts</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TotalRow metric="Candidate accounts" value={totals.candidates} note="Accounts holding the candidate role." />
              <TotalRow metric="Employer accounts" value={totals.employers} note="Accounts holding the employer role." />
              <TotalRow metric="Administrator accounts" value={totals.admins} note="Accounts holding the admin role." />
              <TotalRow metric="Organisations" value={totals.organisations} note="Employer organisations registered." />
              <TotalRow metric="Verified organisations" value={totals.verifiedOrganisations} note="Verification status written by an administrator." />
              <TotalRow
                metric="Organisations pending or rejected"
                value={report.byVerification
                  .filter((row) => row.status !== 'VERIFIED')
                  .reduce((sum, row) => sum + row.count, 0)}
                note="Their published roles are paused by the verification service."
              />
              <TotalRow metric="Published roles" value={totals.publishedJobs} note="Only published roles reach candidates." />
              <TotalRow metric="Roles awaiting moderation" value={totals.pendingModeration} note="Submitted roles not yet decided." />
              <TotalRow metric="Applications" value={totals.applications} note="One row per candidate submission." />
              <TotalRow metric="Stored match scores" value={totals.matches} note="Written by the matching agent." />
              <TotalRow
                metric="Average match score"
                value={totals.matches > 0 ? `${Math.round(totals.averageMatchScore * 100)}%` : '—'}
                note="Mean over every stored score, across all roles and profiles."
              />
              <TotalRow metric="Skills in the catalogue" value={totals.skills} note="Shared taxonomy used by both roles and profiles." />
              <TotalRow metric="Skills with evidence" value={totals.evidencedSkills} note="Candidate skills carrying at least one evidence row." />
              <TotalRow
                metric="Skills suggested by rules"
                value={totals.inferredSkills}
                note="Validation status RULE_INFERRED: derived from the candidate's own wording, not verified."
              />
              <TotalRow
                metric="Profiles visible to employers"
                value={totals.visibleProfiles}
                note="Anonymised views only, and only while the candidate leaves sharing on."
              />
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <p className="text-xs leading-relaxed text-muted-foreground">
        Reporting covers a rolling 30-day window for the two time series; every other figure is a whole-table aggregate
        at the moment the page was loaded.
      </p>
    </div>
  )
}

function TotalRow({ metric, value, note }: { metric: string; value: string | number; note: string }) {
  return (
    <TableRow>
      <TableCell className="font-medium">{metric}</TableCell>
      <TableCell className="tabular-nums">{value}</TableCell>
      <TableCell className="max-w-[26rem] whitespace-normal text-xs leading-relaxed text-muted-foreground">{note}</TableCell>
    </TableRow>
  )
}

function SignupTable({ series }: { series: { day: string; count: number }[] }) {
  const nonZero = series.filter((row) => row.count > 0)

  return (
    <div className="max-h-40 overflow-y-auto rounded-lg border border-border/70">
      <Table>
        <TableCaption className="sr-only">Daily counts underlying the chart</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">Day</TableHead>
            <TableHead scope="col">Count</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {nonZero.length === 0 ? (
            <TableRow>
              <TableCell colSpan={2} className="text-xs text-muted-foreground">
                Nothing recorded in this window.
              </TableCell>
            </TableRow>
          ) : (
            nonZero.map((row) => (
              <TableRow key={row.day}>
                <TableCell className="tabular-nums">{row.day}</TableCell>
                <TableCell className="tabular-nums">{row.count}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )
}

function MiniTable({ rows, caption, valueCaption }: { rows: { label: string; count: number }[]; caption: string; valueCaption: string }) {
  return (
    <div className="max-h-44 overflow-y-auto rounded-lg border border-border/70">
      <Table>
        <TableCaption className="sr-only">{caption} — the values drawn in the chart beside it</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">{caption}</TableHead>
            <TableHead scope="col">{valueCaption}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={2} className="text-xs text-muted-foreground">
                No rows yet.
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row) => (
              <TableRow key={row.label}>
                <TableCell>{row.label}</TableCell>
                <TableCell className="tabular-nums">{row.count}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )
}
