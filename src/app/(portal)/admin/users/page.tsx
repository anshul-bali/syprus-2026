import Link from 'next/link'
import { SearchX } from 'lucide-react'
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
import { DemoBadge, EmptyState, InfoNote, PageHeader, StatusBadge } from '@/components/common'
import { FilterResetLink, UrlSearchFilter, UrlSelectFilter } from '@/components/admin/filters'
import { UserStatusForm } from '@/components/admin/user-status-form'
import { can, requirePermission } from '@/lib/authz'
import { listUsers } from '@/server/admin'
import { formatDate, relativeTime } from '@/lib/utils'
import { label as enumLabel } from '@/lib/options'

export const metadata = { title: 'User management' }

const ROLE_OPTIONS = [
  { value: 'ALL', label: 'All roles' },
  { value: 'CANDIDATE', label: 'Candidates' },
  { value: 'EMPLOYER', label: 'Employers' },
  { value: 'ADMIN', label: 'Administrators' },
]

const TAKE_OPTIONS = [
  { value: '25', label: 'Newest 25' },
  { value: '50', label: 'Newest 50' },
  { value: '100', label: 'Newest 100' },
  { value: '200', label: 'Newest 200' },
]

const ROLE_VALUES = ['CANDIDATE', 'EMPLOYER', 'ADMIN'] as const

function parseRole(value: string | undefined) {
  return ROLE_VALUES.find((role) => role === value)
}

function parseTake(value: string | undefined) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 50
  return TAKE_OPTIONS.some((option) => option.value === String(parsed)) ? parsed : 50
}

export default async function AdminUsersPage(props: {
  searchParams: Promise<{ query?: string; role?: string; take?: string }>
}) {
  const principal = await requirePermission('admin.user.read')
  const params = await props.searchParams

  const query = params.query?.trim() ?? ''
  const role = parseRole(params.role)
  const take = parseTake(params.take)
  const canUpdate = can(principal, 'admin.user.update')

  const users = await listUsers(principal, { query: query || undefined, role, take })

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Administrator"
        title="User management"
        description="Every account on the platform, newest first, with the context that matters for its role: profile completion for candidates, organisation and verification for employers."
        actions={<DemoBadge text="Seeded accounts are demonstration data" />}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Find accounts</CardTitle>
          <CardDescription>
            Filters write into the URL, so a filtered view can be bookmarked or reloaded. Suspension takes effect on the
            account&apos;s next page load, because role and status are read from the database every request.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_auto] lg:items-end">
            <UrlSearchFilter param="query" labelText="Name or email" value={query} placeholder="Search by name or email" />
            <UrlSelectFilter param="role" labelText="Role" options={ROLE_OPTIONS} value={role ?? 'ALL'} />
            <UrlSelectFilter param="take" labelText="How many" options={TAKE_OPTIONS} value={String(take)} />
            <FilterResetLink params={['query', 'role', 'take']} href="/admin/users" />
          </div>
        </CardContent>
      </Card>

      {!canUpdate ? (
        <InfoNote tone="warning" title="Read-only access">
          This account can inspect users but does not hold <code className="text-xs">admin.user.update</code>, so status
          controls are not shown.
        </InfoNote>
      ) : (
        <InfoNote tone="info" title="What a status change does">
          Suspending or deactivating an account blocks its next request; a suspended employer&apos;s published roles are
          paused by the same service call, and the account is notified with the reason you enter. Your own account is
          refused — the platform will not let an administrator lock themselves out.
        </InfoNote>
      )}

      <p className="text-sm text-muted-foreground">
        {users.length === 0
          ? 'No accounts match these filters.'
          : `${users.length} account${users.length === 1 ? '' : 's'} shown`}
        {users.length === take ? <span> — this is the current limit, raise “How many” to see more.</span> : null}
      </p>

      {users.length === 0 ? (
        <EmptyState
          title="No matching accounts"
          description={
            query || role
              ? 'Nothing matched that name, email or role. Clear the filters and try a shorter search term.'
              : 'There are no accounts on the platform yet.'
          }
          icon={SearchX}
          action={
            <Button variant="outline" nativeButton={false} render={<Link href="/admin/users" />}>
              Clear filters
            </Button>
          }
        />
      ) : (
        <Card>
          <CardContent className="pt-6">
            <Table>
              <TableCaption>
                Accounts, newest first. {users.length} of {take} requested rows shown.
              </TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Account</TableHead>
                  <TableHead scope="col">Role</TableHead>
                  <TableHead scope="col">Status</TableHead>
                  <TableHead scope="col">Created</TableHead>
                  <TableHead scope="col">Last sign-in</TableHead>
                  <TableHead scope="col">Context</TableHead>
                  {canUpdate ? <TableHead scope="col">Change status</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((user) => {
                  const organisation = user.ownedOrganization ?? user.memberships[0] ?? null
                  const context =
                    user.role === 'CANDIDATE'
                      ? user.candidateProfile
                        ? `${user.candidateProfile.profileCompletion}% profile complete · ${
                            user.candidateProfile.skills.length
                          } skill${user.candidateProfile.skills.length === 1 ? '' : 's'}${
                            user.candidateProfile.visibleToEmployers ? ' · visible to employers' : ' · not visible'
                          }`
                        : 'No candidate profile recorded'
                      : organisation
                        ? `${organisation.name}${
                            'verificationStatus' in organisation && organisation.verificationStatus
                              ? ` · ${String(organisation.verificationStatus).toLowerCase().replace(/_/g, ' ')}`
                              : ''
                          }`
                        : user.role === 'EMPLOYER'
                          ? 'No organisation attached'
                          : 'Platform administrator'

                  return (
                    <TableRow key={user.id}>
                      <TableCell>
                        <span className="block font-medium">{user.name}</span>
                        <span className="block text-xs text-muted-foreground">{user.email}</span>
                      </TableCell>
                      <TableCell>{enumLabel(user.role)}</TableCell>
                      <TableCell>
                        <StatusBadge value={user.status} />
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{formatDate(user.createdAt)}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        {user.lastLoginAt ? relativeTime(user.lastLoginAt) : 'Never'}
                      </TableCell>
                      <TableCell className="max-w-[18rem] whitespace-normal text-xs leading-relaxed text-muted-foreground">
                        {context}
                      </TableCell>
                      {canUpdate ? (
                        <TableCell className="whitespace-normal py-3">
                          <UserStatusForm
                            userId={user.id}
                            currentStatus={user.status}
                            targetName={user.name}
                            isSelf={user.id === principal.userId}
                          />
                        </TableCell>
                      ) : null}
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <p className="text-xs leading-relaxed text-muted-foreground">
        Account names, emails and statuses are visible to administrators only. Candidates are identified to employers
        solely after they apply to a role in that organisation, and until then employers see an anonymised profile.
      </p>
    </div>
  )
}
