import Link from 'next/link'
import { requirePermission } from '@/lib/authz'
import { loadCatalogSkills } from '@/server/skill-catalog'
import { InfoNote, PageHeader } from '@/components/common'
import { Button } from '@/components/ui/button'
import { JobForm } from '@/components/employer/job-form'

export const metadata = { title: 'Draft a role' }

export default async function NewJobPage() {
  const principal = await requirePermission('employer.job.create')
  const catalog = await loadCatalogSkills()

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={principal.organizationName ?? 'Employer portal'}
        title="Draft a role"
        description="Describe the work and declare the skills that matter, at the level you need them. The rules model scores candidates against exactly these rows."
        actions={
          <Button variant="outline" nativeButton={false} render={<Link href="/employer/jobs" />}>
            Back to roles
          </Button>
        }
      />

      <InfoNote tone="info" title="A new role is always a draft">
        Saving creates a draft that only your organisation can see. Once it is saved you land on the role page, where{' '}
        <strong>Submit for moderation</strong> puts it in the administrator queue. Drafts are allowed before your
        organisation is verified; publishing is not. Skill rows are validated against the SYPRUS skill catalogue on the
        server, and the score is a weighted rules result — the platform does not verify skills for you and makes no
        placement guarantee.
      </InfoNote>

      <JobForm
        mode="create"
        catalog={catalog}
        verificationStatus={principal.organizationVerification ?? 'PENDING'}
      />
    </div>
  )
}
