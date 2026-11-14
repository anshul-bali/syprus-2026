import Link from 'next/link'
import { requirePermission } from '@/lib/authz'
import { openReviewTasks, payloadLines, reviewTaskCounts, REVIEW_TASK_KIND_LABELS } from '@/server/review'
import { pendingUploadQueue } from '@/server/ai/uploads'
import { formatDateTime, relativeTime } from '@/lib/utils'
import { ReviewTaskCard, type ReviewTaskData } from '@/components/admin/review-task-card'
import { UploadReviewForm } from '@/components/admin/upload-review-form'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState, InfoNote, PageHeader, StatCard, StatusBadge } from '@/components/common'
import { Badge } from '@/components/ui/badge'

export const metadata = { title: 'Human review queue' }

export default async function AdminReviewPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const principal = await requirePermission('admin.job.moderate')
  const searchParams = await props.searchParams
  const statusParam = typeof searchParams.status === 'string' ? searchParams.status : 'OPEN'
  const kindParam = typeof searchParams.kind === 'string' ? searchParams.kind : undefined
  const showAll = statusParam === 'ALL'

  const [tasks, counts, uploads] = await Promise.all([
    openReviewTasks(principal, { status: showAll ? undefined : 'OPEN', kind: kindParam, take: 80 }),
    reviewTaskCounts(),
    pendingUploadQueue(principal).catch(() => []),
  ])

  const kindTally = tasks.reduce<Record<string, number>>((tally, task) => {
    tally[task.kind] = (tally[task.kind] ?? 0) + 1
    return tally
  }, {})

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Governance"
        title="Human review queue"
        description="Every consequential or uncertain item the platform produced is written here as an open task. A model cannot close its own finding, and a decision is only ever made by the person signed in."
        actions={
          <>
            <Button variant="outline" nativeButton={false} render={<Link href="/admin/engines" />}>
              Agent health
            </Button>
            <Button variant="ghost" nativeButton={false} render={<Link href="/admin/audit" />}>
              Audit history
            </Button>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Open tasks" value={counts.open} hint="waiting on a person" tone={counts.open > 0 ? 'warning' : 'positive'} />
        <StatCard label="Approved" value={counts.approved} hint="decided by staff" tone="positive" />
        <StatCard label="Rejected" value={counts.rejected} hint="with the note kept" tone="neutral" />
        <StatCard label="Evidence documents" value={uploads.length} hint="queued for review" tone={uploads.length > 0 ? 'warning' : 'neutral'} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant={showAll ? 'outline' : 'default'} size="sm" nativeButton={false} render={<Link href="/admin/review" />}>
          Open only
        </Button>
        <Button variant={showAll ? 'default' : 'outline'} size="sm" nativeButton={false} render={<Link href="/admin/review?status=ALL" />}>
          Everything ({counts.total})
        </Button>
        {Object.keys(REVIEW_TASK_KIND_LABELS).map((kind) => (
          <Button
            key={kind}
            variant={kindParam === kind ? 'secondary' : 'ghost'}
            size="sm"
            nativeButton={false}
            render={
              <Link href={`/admin/review?status=${showAll ? 'ALL' : 'OPEN'}&kind=${kind}`} />
            }
          >
            {REVIEW_TASK_KIND_LABELS[kind]}
            {kindTally[kind] ? <span className="ml-1 tabular-nums">({kindTally[kind]})</span> : null}
          </Button>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_24rem] xl:items-start">
        <div className="flex flex-col gap-3">
          {tasks.length === 0 ? (
            <EmptyState
              title={showAll ? 'No review tasks have ever been raised' : 'Nothing is waiting on a person'}
              image="review-queue-clear"
              description={
                showAll
                  ? 'Tasks appear when a language review raises a finding, when a consequential recruitment action is taken, or when a claim needs a human look.'
                  : 'New findings queue themselves. Switch to “Everything” to read decisions already made.'
              }
            />
          ) : (
            tasks.map((task) => (
              <ReviewTaskCard key={task.id} task={task as ReviewTaskData} payloadLines={payloadLines(task.payload)} />
            ))
          )}
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Evidence documents awaiting a reviewer</CardTitle>
            <CardDescription className="text-xs">
              Accepting supports a human-reviewed claim unless an assessment or dispute takes precedence. Rejection
              declines this document without disputing the entire skill.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {uploads.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nothing queued.</p>
            ) : null}
            {uploads.slice(0, 8).map((upload) => (
              <div key={upload.id} className="rounded-lg border border-border/70 bg-muted/20 p-2.5">
                <p className="flex flex-wrap items-center justify-between gap-2 text-xs font-medium">
                  {upload.filename}
                  <StatusBadge value={upload.status} />
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {upload.candidateProfile.anonymousHandle} · {(upload.sizeBytes / 1024).toFixed(0)} KB ·{' '}
                  {relativeTime(upload.createdAt)} · {formatDateTime(upload.createdAt)}
                </p>
                <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                  <Badge variant="outline" className="text-[10px]">
                    {upload.candidateSkillId ? 'attached to a skill' : 'no skill named'}
                  </Badge>
                  <span className="truncate font-mono text-[10px] text-muted-foreground">
                    {upload.sha256.slice(0, 12)}…
                  </span>
                </p>
                <UploadReviewForm uploadId={upload.id} />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <InfoNote tone="privacy" title="What a decision here does not do">
        It does not hire, shortlist, reject or disclose anything. Those actions live on their own screens with their own
        permission checks; a closed task records that a person looked and what they concluded.
      </InfoNote>
    </div>
  )
}
