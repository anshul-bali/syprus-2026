import Link from 'next/link'
import { requirePermission } from '@/lib/authz'
import { listProposals } from '@/server/ai/proposals'
import { aiConfigSummary } from '@/lib/ai/config'
import { ownProfileWhere } from '@/server/candidate'
import { prisma } from '@/lib/db'
import { ProposalCard, ProvenanceExplanation } from '@/components/candidate/proposal-card'
import { ActionSubmit } from '@/components/candidate/action-submit'
import { runDiscoveryAction } from '@/server/actions/ai'
import { EmptyState, InfoNote, PageHeader, StatCard } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export const metadata = { title: 'Skill suggestions' }

export default async function CandidateSuggestionsPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const principal = await requirePermission('candidate.skills.read')
  const searchParams = await props.searchParams
  const showDecided = searchParams.view === 'decided'

  if (!principal.candidateProfileId) {
    return (
      <div className="space-y-6">
        <PageHeader eyebrow="Agent 1" title="Skill suggestions" description="No candidate profile is attached to this account." />
        <EmptyState
          title="Onboarding creates the suggestions"
          description="The discovery agent reads the wording you supply during onboarding and experience entry."
          action={
            <Button className="bg-brand-600 hover:bg-brand-700" nativeButton={false} render={<Link href="/candidate/onboarding" />}>
              Start onboarding
            </Button>
          }
        />
      </div>
    )
  }

  const [proposals, profile, skillCount] = await Promise.all([
    listProposals(principal),
    prisma.candidateProfile.findFirst({
      where: ownProfileWhere(principal),
      select: { onboardingComplete: true, profileCompletion: true },
    }),
    prisma.candidateSkill.count({ where: { candidateProfileId: principal.candidateProfileId } }),
  ])

  const open = proposals.filter((proposal) => proposal.status === 'PROPOSED')
  const decided = proposals.filter((proposal) => proposal.status !== 'PROPOSED')
  const flagged = open.filter((proposal) => proposal.requiresHumanReview)
  const config = aiConfigSummary()
  const modelBacked = proposals.filter((proposal) => proposal.origin.mode === 'AI').length
  const ruleBacked = proposals.length - modelBacked

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Agent 1 · Skills Discovery"
        title="Skill suggestions"
        description="Every suggestion here was produced from your own wording. Nothing becomes a skill on your inventory until you say so, and confirming it marks it as you-confirmed — never as verified by anyone."
        actions={
          <>
            <Button variant="outline" nativeButton={false} render={<Link href="/candidate/onboarding" />}>
              Onboarding conversation
            </Button>
            <Button variant="ghost" nativeButton={false} render={<Link href="/candidate/skills" />}>
              Skills inventory
            </Button>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Waiting on you"
          value={open.length}
          hint={flagged.length > 0 ? `${flagged.length} flagged for care-origin review` : 'none flagged'}
          tone={open.length > 0 ? 'warning' : 'positive'}
        />
        <StatCard label="You have answered" value={decided.length} hint={`${decided.filter((entry) => entry.status === 'CONFIRMED').length} confirmed · ${decided.filter((entry) => entry.status === 'REJECTED').length} rejected`} tone="neutral" />
        <StatCard label="Skills on your inventory" value={skillCount} hint="Only what you accepted or added" />
        <StatCard
          label="Produced by"
          value={proposals.length === 0 ? 'Nothing yet' : modelBacked === 0 ? 'Rule engine' : ruleBacked === 0 ? 'A model' : 'Rules + model'}
          hint={
            proposals.length === 0
              ? config.liveAvailable
                ? 'A model is configured for this deployment, and nothing has been proposed yet'
                : 'AI is switched off here, so the keyword rule engine answers'
              : `${modelBacked} of ${proposals.length} came from a model, ${ruleBacked} from the rule engine — each card names its own`
          }
          tone="neutral"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant={showDecided ? 'outline' : 'default'} size="sm" nativeButton={false} render={<Link href="/candidate/suggestions" />}>
          Waiting on me ({open.length})
        </Button>
        <Button variant={showDecided ? 'default' : 'outline'} size="sm" nativeButton={false} render={<Link href="/candidate/suggestions?view=decided" />}>
          My decisions ({decided.length})
        </Button>
        <ActionSubmit
          action={runDiscoveryAction}
          label="Ask for suggestions from my wording"
          pendingLabel="Reading your entries…"
          variant="secondary"
          size="sm"
        />
      </div>

      <ProvenanceExplanation />

      {proposals.length === 0 ? (
        <EmptyState
          title="Nothing has been proposed yet"
          description="Run the onboarding conversation, or add experience entries with real detail. The agent only reads what you wrote — with no wording to quote, it invents nothing."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button className="bg-brand-600 hover:bg-brand-700" nativeButton={false} render={<Link href="/candidate/onboarding" />}>
                Continue onboarding
              </Button>
              <Button variant="outline" nativeButton={false} render={<Link href="/candidate/experiences" />}>
                Add an experience entry
              </Button>
            </div>
          }
        />
      ) : !showDecided && open.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Every suggestion has an answer</CardTitle>
            <CardDescription>
              {decided.length} decided so far. Switch to “My decisions” to see what you accepted, edited or rejected, and
              who proposed each one.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-2">
        {(showDecided ? decided : open).map((proposal) => (
          <ProposalCard key={proposal.id} proposal={proposal} />
        ))}
      </div>

      {profile && !profile.onboardingComplete ? (
        <InfoNote tone="info" title="Onboarding is still open">
          The conversation is only part way through (profile {profile.profileCompletion}% complete). More of your own
          wording usually means more suggestions worth deciding on — and better evidence quotes attached to them.
        </InfoNote>
      ) : null}

      <InfoNote tone="privacy" title="What this screen cannot do">
        It cannot verify you. A suggestion is a pattern match or a model reading of your sentence; confirming it records
        your agreement, an evidence row quoting your words, and a recomputed match score. Independent verification would
        need an assessment, a reviewer or a certificate — none of which happened by clicking here. A model that answered
        an earlier run is also not proof a provider answers the next one: when the call is disabled, rate-limited or
        unreachable, the same agent falls back to the keyword rules and the card says which engine produced it.
      </InfoNote>
    </div>
  )
}
