import Link from 'next/link'
import { requirePermission } from '@/lib/authz'
import { getOrganization } from '@/server/accounts'
import { isDemonstrationName, organizationVerifier } from '../_data/queries'
import { DemoBadge, FieldRow, InfoNote, PageHeader, StatusBadge } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { OrganizationProfileForm } from '@/components/employer/org-profile-form'
import { formatDate, relativeTime } from '@/lib/utils'

export const metadata = { title: 'Organisation profile' }

export default async function EmployerProfilePage() {
  const principal = await requirePermission('employer.org.read')
  const organization = await getOrganization(principal)
  const verifier = await organizationVerifier(organization.id)

  const values = {
    name: organization.name,
    website: organization.website ?? '',
    industry: organization.industry ?? '',
    sizeLabel: organization.sizeLabel ?? '',
    locationCity: organization.locationCity ?? '',
    locationCountry: organization.locationCountry ?? '',
    description: organization.description ?? '',
    flexPolicy: organization.flexPolicy ?? '',
    returnshipNote: organization.returnshipNote ?? '',
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Organisation"
        title={organization.name}
        description="What candidates read beside your roles, plus the verification record an administrator keeps."
        actions={
          <Button variant="outline" nativeButton={false} render={<Link href="/employer" />}>
            Hiring overview
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <OrganizationProfileForm values={values} />

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                Verification
                <StatusBadge value={organization.verificationStatus} />
                {isDemonstrationName(organization.name) ? <DemoBadge /> : null}
              </CardTitle>
              <CardDescription>
                {organization.verificationStatus === 'VERIFIED'
                  ? 'Verified organisations can publish roles that reach candidates.'
                  : 'Until an administrator verifies this organisation, roles stay drafts inside your organisation and cannot be submitted for moderation.'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="divide-y divide-border/60">
                <FieldRow label="Status">{organization.verificationStatus}</FieldRow>
                <FieldRow label="Verified on">{formatDate(organization.verifiedAt, 'Not verified yet')}</FieldRow>
                <FieldRow label="Decided by">{verifier ? verifier.name : 'No decision recorded'}</FieldRow>
                <FieldRow label="Decision note">
                  {organization.verificationNote ?? 'No note recorded by the administrator.'}
                </FieldRow>
                <FieldRow label="Owner">{organization.owner ? organization.owner.name : 'Unassigned'}</FieldRow>
                <FieldRow label="Team accounts">{organization.members.length}</FieldRow>
                <FieldRow label="Roles">
                  <Link href="/employer/jobs" className="hover:underline">
                    {organization._count.jobs}
                  </Link>
                </FieldRow>
                <FieldRow label="Applications">{organization._count.applications}</FieldRow>
                <FieldRow label="Profile created">
                  {formatDate(organization.createdAt)} · updated {relativeTime(organization.updatedAt)}
                </FieldRow>
              </dl>
            </CardContent>
          </Card>

          <InfoNote tone="warning" title="Read only">
            Only an administrator can change the verification status, its date or its note — there is deliberately no
            control for it on this screen, and saving the profile never alters it. Ask through your administrator contact.
          </InfoNote>

          <InfoNote tone="privacy" title="What candidates see">
            Candidates see the fields above once a role of yours is published. Your organisation name is shown to a
            candidate only after they open a role; while they browse anonymised profiles, the filter hides which
            organisation looked at them.
          </InfoNote>
        </div>
      </div>
    </div>
  )
}
