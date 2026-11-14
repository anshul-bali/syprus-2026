import Link from 'next/link'
import { ScrollText } from 'lucide-react'
import { Button } from '@/components/ui/button'
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
import { EmptyState, InfoNote, PageHeader } from '@/components/common'
import { FilterResetLink, UrlSearchFilter, UrlSelectFilter } from '@/components/admin/filters'
import { requirePermission } from '@/lib/authz'
import { readAuditLog } from '@/server/audit'
import { auditEntityTypeBreakdown } from '@/server/admin-jobs'
import { formatDateTime, relativeTime } from '@/lib/utils'
import { label as enumLabel } from '@/lib/options'

export const metadata = { title: 'Audit history' }

const TAKE = 50

function truncate(value: string, max: number) {
  return value.length > max ? `${value.slice(0, max)}…` : value
}

function prettyMetadata(metadata: unknown) {
  if (metadata == null) return null
  try {
    return JSON.stringify(metadata, null, 2)
  } catch {
    return String(metadata)
  }
}

export default async function AdminAuditPage(props: {
  searchParams: Promise<{ entity?: string; action?: string; page?: string }>
}) {
  const principal = await requirePermission('admin.audit.read')
  const params = await props.searchParams

  const entity = params.entity?.trim() ?? ''
  const action = params.action?.trim() ?? ''
  const requestedPage = Number(params.page)
  const page = Number.isFinite(requestedPage) && requestedPage > 0 ? Math.floor(requestedPage) : 1
  const skip = (page - 1) * TAKE

  const [log, typeBreakdown] = await Promise.all([
    readAuditLog({ take: TAKE, skip, ...(entity ? { entityType: entity } : {}), ...(action ? { action } : {}) }),
    auditEntityTypeBreakdown(principal),
  ])

  const totalPages = Math.max(1, Math.ceil(log.total / TAKE))
  const options = [
    { value: 'ALL', label: 'Every entity type' },
    ...typeBreakdown.map((row) => ({ value: row.entityType, label: `${enumLabel(row.entityType)} (${row.count})` })),
  ]

  const pageHref = (target: number) => {
    const search = new URLSearchParams()
    if (entity) search.set('entity', entity)
    if (action) search.set('action', action)
    if (target > 1) search.set('page', String(target))
    const query = search.toString()
    return query ? `/admin/audit?${query}` : '/admin/audit'
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Administrator"
        title="Audit history"
        description="Every state change the application recorded: who acted, what entity they touched, and the note or payload they left behind."
      />

      <InfoNote tone="privacy" title="What this log does and does not prove">
        <p>
          Entries are written by the services themselves through <code className="text-xs">recordAudit</code>, so they
          describe actions the platform actually took. Reads of anonymised candidate profiles are recorded separately in
          the profile_views table and shown on the agent health screen. Registration events carry no actor, because no
          administrator was involved.
        </p>
      </InfoNote>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filter the log</CardTitle>
          <CardDescription>
            {log.total} entr{log.total === 1 ? 'y matches' : 'ies match'} the current filters. The action box matches a
            substring of the action key, such as <code className="text-xs">admin.org</code> or{' '}
            <code className="text-xs">application</code>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[2fr_1.4fr_auto] lg:items-end">
            <UrlSearchFilter param="action" labelText="Action contains" value={action} placeholder="e.g. job.publish" />
            <UrlSelectFilter
              param="entity"
              labelText="Entity type"
              options={options}
              value={entity || 'ALL'}
              className="w-full"
            />
            <FilterResetLink params={['action', 'entity', 'page']} href="/admin/audit" />
          </div>
        </CardContent>
      </Card>

      {log.events.length === 0 ? (
        <EmptyState
          title="No audit entries match"
          description={
            log.total === 0
              ? 'Nothing has been recorded with those filters yet. State changes appear here as administrators, employers and candidates act.'
              : 'That page is beyond the last entry. Go back a page or clear the filters.'
          }
          icon={ScrollText}
          action={
            <Button variant="outline" nativeButton={false} render={<Link href="/admin/audit" />}>
              Show the whole log
            </Button>
          }
        />
      ) : (
        <Card>
          <CardContent className="pt-6">
            <Table>
              <TableCaption>
                Page {page} of {totalPages} — entries {skip + 1}–{skip + log.events.length} of {log.total}, newest first.
              </TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">When</TableHead>
                  <TableHead scope="col">Actor</TableHead>
                  <TableHead scope="col">Action</TableHead>
                  <TableHead scope="col">Entity</TableHead>
                  <TableHead scope="col">Organisation</TableHead>
                  <TableHead scope="col">Metadata</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {log.events.map((event) => {
                  const metadata = prettyMetadata(event.metadata)
                  return (
                    <TableRow key={event.id}>
                      <TableCell className="whitespace-nowrap">
                        <span className="block">{formatDateTime(event.createdAt)}</span>
                        <span className="block text-[11px] text-muted-foreground">{relativeTime(event.createdAt)}</span>
                      </TableCell>
                      <TableCell>
                        {event.actor ? (
                          <>
                            <span className="block">{event.actor.name}</span>
                            <span className="block text-[11px] text-muted-foreground">
                              {event.actorRole ? enumLabel(event.actorRole) : 'no role recorded'}
                            </span>
                          </>
                        ) : (
                          <span className="text-[11px] text-muted-foreground">
                            {event.actorRole ? `${enumLabel(event.actorRole)} (account no longer present)` : 'System / self-service'}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="max-w-[14rem] whitespace-normal">
                        <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{event.action}</code>
                      </TableCell>
                      <TableCell>
                        <span className="block">{enumLabel(event.entityType)}</span>
                        {event.entityId ? (
                          <span className="block text-[11px] break-all text-muted-foreground">{event.entityId}</span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-[11px] break-all">
                        {event.organizationId ? (
                          <span className="text-muted-foreground">{event.organizationId}</span>
                        ) : (
                          <span className="text-muted-foreground">Not organisation-scoped</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {metadata ? (
                          <details className="max-w-[20rem]">
                            <summary className="cursor-pointer text-xs font-medium text-brand-600 underline-offset-4 hover:underline">
                              View payload ({metadata.length} characters)
                            </summary>
                            <pre className="mt-2 max-h-60 overflow-auto rounded-lg bg-muted px-3 py-2 text-[11px] leading-relaxed whitespace-pre-wrap break-words">
                              {truncate(metadata, 2000)}
                            </pre>
                          </details>
                        ) : (
                          <span className="text-[11px] text-muted-foreground">No payload recorded</span>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </CardContent>

          <nav aria-label="Audit log pagination" className="flex flex-wrap items-center justify-between gap-3 border-t border-border/70 px-6 py-3.5">
            <p className="text-xs text-muted-foreground">
              Showing {log.events.length} of {log.total} entries · page {page} of {totalPages} · {TAKE} rows per page
            </p>
            <div className="flex gap-2">
              {page > 1 ? (
                <Button
                  variant="outline"
                  size="sm"
                  nativeButton={false}
                  render={<Link href={pageHref(page - 1)} rel="prev" />}
                >
                  Previous page
                </Button>
              ) : (
                <Button variant="outline" size="sm" disabled aria-disabled="true">
                  Previous page
                </Button>
              )}
              {page < totalPages ? (
                <Button
                  variant="outline"
                  size="sm"
                  nativeButton={false}
                  render={<Link href={pageHref(page + 1)} rel="next" />}
                >
                  Next page
                </Button>
              ) : (
                <Button variant="outline" size="sm" disabled aria-disabled="true">
                  Next page
                </Button>
              )}
            </div>
          </nav>
        </Card>
      )}

      <p className="text-xs leading-relaxed text-muted-foreground">
        Organisation and entity identifiers are shown as stored because the audit table keeps no join to the row that was
        changed — that is by design, so an entry survives even after the entity itself is deleted.
      </p>
    </div>
  )
}
