import Link from 'next/link'
import { requirePermission } from '@/lib/authz'
import { prisma } from '@/lib/db'
import { consentMap, ownProfileWhere } from '@/server/candidate'
import { policyVersion } from '@/lib/env'
import { label } from '@/lib/options'
import { formatDate } from '@/lib/utils'
import { ConsentControls, type ConsentRow } from '@/components/candidate/consent-controls'
import { ProfileForm } from '@/components/candidate/profile-form'
import { EmptyState, FieldRow, InfoNote, PageHeader, StatCard } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { StatusBadge } from '@/components/common'

export const metadata = { title: 'Profile and privacy' }

const CONSENT_TYPES = [
  'DATA_PROCESSING',
  'SENSITIVE_DATA',
  'ANONYMIZED_PROFILE_SHARING',
  'IDENTIFIED_PROFILE_SHARING',
  'RULE_BASED_INFERENCE',
  'EMPLOYER_CONTACT',
  'PRODUCT_EMAILS',
  'RESEARCH_CONTRIBUTION',
] as const

export default async function CandidateProfilePage() {
  const principal = await requirePermission('candidate.profile.read')

  if (!principal.candidateProfileId) {
    return (
      <div className="space-y-6">
        <PageHeader eyebrow="You" title="Profile and privacy" description="This account has no candidate profile attached yet." />
        <EmptyState
          title="Create the profile first"
          description="Onboarding builds the profile that skills, matches, applications and consents attach to."
          action={
            <Button className="bg-brand-600 hover:bg-brand-700" nativeButton={false} render={<Link href="/candidate/onboarding" />}>
              Start onboarding
            </Button>
          }
        />
      </div>
    )
  }

  const [profile, consents, views, disclosureRows] = await Promise.all([
    prisma.candidateProfile.findFirst({ where: ownProfileWhere(principal) }),
    consentMap(principal.userId),
    prisma.profileView.count({ where: { candidateProfileId: principal.candidateProfileId } }),
    prisma.identityDisclosureRequest.groupBy({
      by: ['status'],
      where: { candidateProfileId: principal.candidateProfileId },
      _count: { _all: true },
    }),
  ])

  if (!profile) return null

  const rows: ConsentRow[] = CONSENT_TYPES.map((type) => {
    const entry = consents.get(type)
    return {
      type,
      granted: entry ? entry.granted : null,
      decidedAt: entry ? formatDate(entry.decidedAt) : null,
      policyVersion: entry?.policyVersion ?? null,
    }
  })

  const pending = disclosureRows.find((entry) => entry.status === 'PENDING')?._count._all ?? 0
  const approved = disclosureRows.find((entry) => entry.status === 'APPROVED')?._count._all ?? 0

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="You"
        title="Profile and privacy"
        description="What an employer can read, what the rule engine may infer, and which fields exist but are never used to score you. Every switch below writes an append-only consent record."
        actions={
          <>
            <Button variant="outline" nativeButton={false} render={<Link href="/candidate/disclosures" />}>
              Disclosure requests
            </Button>
            <Button variant="ghost" nativeButton={false} render={<Link href="/candidate/skills" />}>
              Skills inventory
            </Button>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Sharing mode" value={label(profile.sharingMode)} hint={`visible to employers: ${profile.visibleToEmployers ? 'yes' : 'no'}`} />
        <StatCard label="Profile reads logged" value={views} hint="Every employer view of your anonymous profile" tone="neutral" />
        <StatCard
          label="Disclosure requests"
          value={pending}
          hint={pending > 0 ? 'waiting on your decision' : approved > 0 ? `${approved} approved so far` : 'none outstanding'}
          tone={pending > 0 ? 'warning' : 'neutral'}
        />
        <StatCard label="Profile completion" value={`${profile.profileCompletion}%`} hint="Recorded by the platform’s own checklist" tone="positive" />
      </div>

      {pending > 0 ? (
        <InfoNote tone="warning" title="An employer is asking to know who you are">
          Nothing has been revealed yet. Decide on the{' '}
          <Link href="/candidate/disclosures" className="underline underline-offset-2">
            disclosure screen
          </Link>
          , where you can read their reason and approve or decline it.
        </InfoNote>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start">
        <ProfileForm
          values={{
            headline: profile.headline ?? '',
            summary: profile.summary ?? '',
            locationCity: profile.locationCity ?? '',
            locationCountry: profile.locationCountry ?? '',
            workPreference: profile.workPreference,
            availabilityHours: profile.availabilityHours == null ? '' : String(profile.availabilityHours),
            targetRole: profile.targetRole ?? '',
            targetIndustry: profile.targetIndustry ?? '',
            careerBreakMonths: profile.careerBreakMonths == null ? '' : String(profile.careerBreakMonths),
            breakReason: profile.breakReason ?? '',
            returnTimeline: profile.returnTimeline ?? '',
            yearsOfExperience: String(profile.yearsOfExperience),
            educationSummary: profile.educationSummary ?? '',
            sharingMode: profile.sharingMode,
            visibleToEmployers: profile.visibleToEmployers,
            anonymousSharingGranted: consents.get('ANONYMIZED_PROFILE_SHARING')?.granted === true,
          }}
        />

        <ConsentControls rows={rows} currentPolicyVersion={policyVersion()} />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Fields stored but never read by the matcher</CardTitle>
          <CardDescription className="text-xs">
            They are here because you told the platform, and because you may want them on a CV. None of them is a
            parameter of the scoring function.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl>
            <FieldRow label="Career break length">
              {profile.careerBreakMonths == null ? 'Not recorded' : `${profile.careerBreakMonths} months`}
            </FieldRow>
            <FieldRow label="Break reason">{profile.breakReason ?? 'Not recorded'}</FieldRow>
            <FieldRow label="Return timeline">{profile.returnTimeline ?? 'Not recorded'}</FieldRow>
            <FieldRow label="Anonymous handle">{profile.anonymousHandle}</FieldRow>
            <FieldRow label="Account">{principal.email}</FieldRow>
            <FieldRow label="Role">
              <StatusBadge value={principal.role} />
            </FieldRow>
            <FieldRow label="Member since">{formatDate(profile.createdAt)}</FieldRow>
          </dl>
        </CardContent>
      </Card>

      <InfoNote tone="privacy" title="What anonymity actually hides here">
        While a profile is anonymous, an employer sees your handle, skills, stored levels, confidence, validation status
        and durations of responsibility. Employer names become neutral labels, calendar dates become durations, and your
        name, email and experience descriptions stay hidden until you apply or approve a disclosure request.
      </InfoNote>
    </div>
  )
}
