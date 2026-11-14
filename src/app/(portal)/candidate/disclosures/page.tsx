import Link from 'next/link'
import { requirePermission } from '@/lib/authz'
import { prisma } from '@/lib/db'
import { disclosureRequestsForCandidate } from '@/server/disclosure'
import { ownProfileWhere } from '@/server/candidate'
import { label } from '@/lib/options'
import { DisclosureDecisionCard } from '@/components/candidate/disclosure-decision'
import { EmptyState, InfoNote, PageHeader, StatCard } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export const metadata = { title: 'Identity disclosures' }

export default async function CandidateDisclosuresPage() {
  const principal = await requirePermission('candidate.consent.manage')

  if (!principal.candidateProfileId) {
    return (
      <div className="space-y-6">
        <PageHeader eyebrow="Privacy" title="Disclosure requests" description="No candidate profile is attached to this account." />
        <EmptyState
          title="Nothing to disclose yet"
          description="Requests only exist once a profile is shared with employers."
          action={
            <Button className="bg-brand-600 hover:bg-brand-700" nativeButton={false} render={<Link href="/candidate/onboarding" />}>
              Start onboarding
            </Button>
          }
        />
      </div>
    )
  }

  const [requests, profile, applications, views] = await Promise.all([
    disclosureRequestsForCandidate(principal),
    prisma.candidateProfile.findFirst({
      where: ownProfileWhere(principal),
      select: { sharingMode: true, visibleToEmployers: true, anonymousHandle: true },
    }),
    prisma.application.findMany({
      where: { candidateProfileId: principal.candidateProfileId },
      select: { id: true, organizationId: true, status: true, organization: { select: { name: true } } },
    }),
    prisma.profileView.groupBy({
      by: ['organizationId'],
      where: { candidateProfileId: principal.candidateProfileId },
      _count: { _all: true },
      orderBy: { _count: { organizationId: 'desc' } },
    }),
  ])

  const pending = requests.filter((request) => request.status === 'PENDING')
  const revealedByConsent = requests.filter((request) => request.status === 'APPROVED')
  const revealedByApplication = applications.filter((application) => application.status !== 'WITHDRAWN')

  const viewOrgNames = views.length
    ? await prisma.organization.findMany({
        where: { id: { in: views.map((entry) => entry.organizationId) } },
        select: { id: true, name: true },
      })
    : []
  const nameById = new Map(viewOrgNames.map((organization) => [organization.id, organization.name]))

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Privacy"
        title="Disclosure requests"
        description="Anonymity is the default. You lift it in one of exactly two ways: by applying to a role, or by approving a request here. Nothing an employer writes can do it for you."
        actions={
          <>
            <Button variant="outline" nativeButton={false} render={<Link href="/candidate/profile" />}>
              Privacy settings
            </Button>
            <Button variant="ghost" nativeButton={false} render={<Link href="/candidate/applications" />}>
              Applications
            </Button>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Waiting on you"
          value={pending.length}
          hint={pending.length > 0 ? 'Read the reason before deciding' : 'Nothing outstanding'}
          tone={pending.length > 0 ? 'warning' : 'positive'}
        />
        <StatCard label="Shared by consent" value={revealedByConsent.length} hint="Requests you approved" />
        <StatCard
          label="Disclosed by applying"
          value={revealedByApplication.length}
          hint="Each application reveals your identity to that one organisation"
          tone="neutral"
        />
        <StatCard label="Current sharing mode" value={label(profile?.sharingMode ?? 'NOT_VISIBLE')} hint={profile?.visibleToEmployers ? 'employers can browse anonymously' : 'hidden from browsing'} />
      </div>

      {pending.length === 0 ? (
        <EmptyState
          title="No request is waiting for a decision"
          description="When an organisation wants to know who is behind your handle, they have to ask and you have to answer. Their access to your skills never depends on that."
        />
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <div className="flex flex-col gap-3">
          {requests.length === 0 ? (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">No history yet</CardTitle>
                <CardDescription className="text-xs">
                  Every request, answer and expiry is kept here so the record of who knew what stays readable.
                </CardDescription>
              </CardHeader>
            </Card>
          ) : null}
          {requests.map((request) => (
            <DisclosureDecisionCard key={request.id} request={request} />
          ))}
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Who has opened your profile</CardTitle>
            <CardDescription className="text-xs">
              Counts of stored view events. A view of an anonymous profile is not a disclosure of identity.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            {views.length === 0 ? (
              <p className="text-xs text-muted-foreground">No employer has opened your profile yet.</p>
            ) : null}
            {views.slice(0, 8).map((entry) => (
              <div key={entry.organizationId} className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-xs">
                  {nameById.get(entry.organizationId) ?? 'Organisation no longer on the platform'}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{entry._count._all} view(s)</span>
              </div>
            ))}
            <p className="pt-1 text-[11px] leading-relaxed text-muted-foreground">
              Your handle as employers see it: <span className="font-medium text-foreground">{profile?.anonymousHandle}</span>
            </p>
          </CardContent>
        </Card>
      </div>

      <InfoNote tone="privacy" title="A decline is a complete answer">
        Declining leaves your skills, levels, evidence counts and durations visible while your profile is shared
        anonymously — that is the whole point of skills-first review. Declined and expired requests stay listed here so
        the record does not silently disappear.
      </InfoNote>
    </div>
  )
}
