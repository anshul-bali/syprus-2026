import { Building2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { DemoBadge, EmptyState, InfoNote, PageHeader, StatusBadge } from '@/components/common'
import { FilterResetLink, UrlSelectFilter } from '@/components/admin/filters'
import { OrganizationVerificationForm } from '@/components/admin/organization-verification-form'
import { can, requirePermission } from '@/lib/authz'
import { listOrganizations } from '@/server/accounts'
import { formatDate, relativeTime } from '@/lib/utils'
import { label as enumLabel } from '@/lib/options'

export const metadata = { title: 'Organisation management' }

const STATUS_OPTIONS = [
  { value: 'ALL', label: 'All verification states' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'VERIFIED', label: 'Verified' },
  { value: 'REJECTED', label: 'Rejected' },
]

const STATUS_VALUES = ['PENDING', 'VERIFIED', 'REJECTED'] as const

export default async function AdminOrganisationsPage(props: {
  searchParams: Promise<{ status?: string }>
}) {
  const principal = await requirePermission('admin.org.read')
  const params = await props.searchParams

  const statusParam = STATUS_VALUES.find((value) => value === params.status)
  const canVerify = can(principal, 'admin.org.verify')

  const organizations = await listOrganizations(principal, statusParam ? { status: statusParam } : {})

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Administrator"
        title="Organisation management"
        description="Employer accounts and the verification decision that governs whether their roles may reach candidates."
        actions={<DemoBadge text="Seeded organisations are demonstration data" />}
      />

      <InfoNote tone="info" title="What the decision actually does">
        <p>
          The verification service writes the status, the verifying administrator and your note, then notifies the
          organisation. Choosing <strong>Rejected</strong> or returning an organisation to <strong>Pending</strong>{' '}
          immediately moves its published roles to <strong>Paused</strong>, so they stop appearing to candidates and stop
          receiving new applications. Verified organisations can still have individual roles rejected or closed in the
          moderation queue — verifying an employer is not an approval of any specific role.
        </p>
      </InfoNote>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filter organisations</CardTitle>
          <CardDescription>
            Sorted by verification state, then newest first. {organizations.length} organisation
            {organizations.length === 1 ? '' : 's'} in this view.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-3">
            <UrlSelectFilter
              param="status"
              labelText="Verification state"
              options={STATUS_OPTIONS}
              value={statusParam ?? 'ALL'}
              className="w-full sm:w-64"
            />
            <FilterResetLink params={['status']} href="/admin/organisations" />
          </div>
        </CardContent>
      </Card>

      {!canVerify ? (
        <InfoNote tone="warning" title="Read-only access">
          This account holds <code className="text-xs">admin.org.read</code> but not{' '}
          <code className="text-xs">admin.org.verify</code>, so no decision form is shown.
        </InfoNote>
      ) : null}

      {organizations.length === 0 ? (
        <EmptyState
          title={statusParam ? `No ${enumLabel(statusParam).toLowerCase()} organisations` : 'No organisations yet'}
          description={
            statusParam
              ? 'No employer account currently sits in that verification state. Clear the filter to see all organisations.'
              : 'No employer has registered on this platform yet. Registered organisations appear here as pending.'
          }
          icon={Building2}
          action={
            statusParam ? (
              <Button variant="outline" nativeButton={false} render={<a href="/admin/organisations" />}>
                Show all organisations
              </Button>
            ) : null
          }
        />
      ) : (
        <div className="space-y-4">
          {organizations.map((organization) => (
            <Card key={organization.id}>
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <CardTitle className="text-base">{organization.name}</CardTitle>
                    <CardDescription>
                      {[organization.industry, organization.sizeLabel, organization.locationCity, organization.locationCountry]
                        .filter(Boolean)
                        .join(' · ') || 'No sector, size or location recorded'}
                    </CardDescription>
                  </div>
                  <StatusBadge value={organization.verificationStatus} label={enumLabel(organization.verificationStatus)} />
                </div>
              </CardHeader>

              <CardContent className="space-y-4">
                <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <dt className="text-xs tracking-wide text-muted-foreground uppercase">Owner</dt>
                    <dd className="mt-0.5">
                      {organization.owner ? (
                        <>
                          {organization.owner.name}
                          <span className="block text-xs text-muted-foreground">{organization.owner.email}</span>
                        </>
                      ) : (
                        <span className="text-muted-foreground">Unclaimed</span>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs tracking-wide text-muted-foreground uppercase">Activity</dt>
                    <dd className="mt-0.5">
                      {organization._count.jobs} role{organization._count.jobs === 1 ? '' : 's'} ·{' '}
                      {organization._count.applications} application{organization._count.applications === 1 ? '' : 's'}
                      <span className="block text-xs text-muted-foreground">
                        {organization._count.members} team member{organization._count.members === 1 ? '' : 's'}
                      </span>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs tracking-wide text-muted-foreground uppercase">Verified</dt>
                    <dd className="mt-0.5">
                      {organization.verifiedAt ? formatDate(organization.verifiedAt) : 'Not set'}
                      <span className="block text-xs text-muted-foreground">
                        Registered {relativeTime(organization.createdAt)}
                      </span>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs tracking-wide text-muted-foreground uppercase">Website</dt>
                    <dd className="mt-0.5 truncate">
                      {organization.website ? (
                        <a
                          href={organization.website}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="text-brand-600 underline-offset-4 hover:underline"
                        >
                          {organization.website.replace(/^https?:\/\//, '')}
                        </a>
                      ) : (
                        <span className="text-muted-foreground">Not provided</span>
                      )}
                    </dd>
                  </div>
                </dl>

                {organization.verificationNote ? (
                  <div className="rounded-lg border border-border bg-muted/40 px-3.5 py-2.5">
                    <p className="text-xs tracking-wide text-muted-foreground uppercase">Latest note</p>
                    <p className="mt-1 text-sm leading-relaxed">{organization.verificationNote}</p>
                  </div>
                ) : null}

                {organization.description || organization.flexPolicy || organization.returnshipNote ? (
                  <details className="rounded-lg border border-border/70 px-3.5 py-2.5">
                    <summary className="cursor-pointer text-sm font-medium">Employer statements on file</summary>
                    <div className="mt-2 space-y-2 text-sm leading-relaxed text-muted-foreground">
                      {organization.description ? <p>{organization.description}</p> : null}
                      {organization.flexPolicy ? (
                        <p>
                          <span className="font-medium text-foreground">Flexibility:</span> {organization.flexPolicy}
                        </p>
                      ) : null}
                      {organization.returnshipNote ? (
                        <p>
                          <span className="font-medium text-foreground">Return-to-work commitment:</span>{' '}
                          {organization.returnshipNote}
                        </p>
                      ) : null}
                    </div>
                  </details>
                ) : null}

                <Separator />

                {canVerify ? (
                  <div className="grid gap-4 lg:grid-cols-[minmax(0,26rem)_1fr]">
                    <OrganizationVerificationForm
                      organizationId={organization.id}
                      organizationName={organization.name}
                      currentStatus={organization.verificationStatus}
                      roleCount={organization._count.jobs}
                    />
                    <p className="text-xs leading-relaxed text-muted-foreground lg:pt-8">
                      The note is required and is sent to the organisation as the reason for the decision, so an employer
                      knows what to fix. It is also written to the audit history with your name and the time.
                    </p>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
