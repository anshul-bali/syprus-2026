import Link from 'next/link'
import { Sparkles } from 'lucide-react'
import { requirePermission } from '@/lib/authz'
import { loadGraphModel } from '@/server/graph'
import { PROVENANCE_TIERS } from '@/lib/provenance'
import { CapabilityGraph } from '@/components/candidate/capability-graph'
import { EmptyState, InfoNote, PageHeader, StatCard } from '@/components/common'
import { Button } from '@/components/ui/button'

export const metadata = { title: 'Capability graph' }

export default async function CandidateGraphPage() {
  const principal = await requirePermission('candidate.graph.read')

  if (!principal.candidateProfileId) {
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow="Visual"
          title="Capability graph"
          description="The graph is drawn from your own profile rows, so it needs a profile to exist first."
        />
        <EmptyState
          title="No candidate profile on this account"
          description="Onboarding creates the profile the graph is built from."
          action={
            <Button className="bg-brand-600 hover:bg-brand-700" nativeButton={false} render={<Link href="/candidate/onboarding" />}>
              Start onboarding
            </Button>
          }
        />
      </div>
    )
  }

  const model = await loadGraphModel(principal)

  if (model.counts.skills === 0 && model.hiddenCount === 0) {
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow="Visual"
          title="Capability graph"
          description="Your skills laid out around you, coloured by how each claim was earned and linked to what supports it."
        />
        <EmptyState
          title="Nothing to place yet"
          description="The graph needs at least one skill on your inventory. Add one yourself, or let the onboarding conversation propose skills from your own wording — every proposal arrives with the sentence that produced it."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button className="bg-brand-600 hover:bg-brand-700" nativeButton={false} render={<Link href="/candidate/skills" />}>
                Open skills inventory
              </Button>
              <Button variant="outline" nativeButton={false} render={<Link href="/candidate/onboarding" />}>
                <Sparkles className="size-4" aria-hidden />
                Get suggestions from my own words
              </Button>
            </div>
          }
        />
      </div>
    )
  }

  const originRows = PROVENANCE_TIERS.filter((tier) => model.provenanceTally[tier.key])

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Visual"
        title="Capability graph"
        description="You sit at the centre. Skills ring outward, evidence and assessment results sit behind them, experience entries show where a skill was inferred from your own wording, and the roles on the right are what the matcher currently ranks highest for you."
        actions={
          <>
            <Button variant="outline" nativeButton={false} render={<Link href="/candidate/skills" />}>
              Skills inventory
            </Button>
            <Button variant="outline" nativeButton={false} render={<Link href="/candidate/gap-report" />}>
              Skill gaps
            </Button>
            <Button variant="ghost" nativeButton={false} render={<Link href="/candidate/jobs" />}>
              Recommended roles
            </Button>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Skills shown"
          value={model.counts.skills}
          hint={`${model.counts.evidence} evidence node(s) · ${model.counts.assessments} assessment result(s)`}
        />
        <StatCard
          label="Experience entries"
          value={model.counts.experiences}
          hint="Care, community and paid work all sit on the graph."
        />
        <StatCard
          label="Matched roles"
          value={model.counts.opportunities}
          hint="Stored match scores, not new claims."
        />
        <StatCard
          label="Saved edits"
          value={`${model.movedCount} moved`}
          hint={`${model.annotatedCount} annotated · ${model.hiddenCount} hidden`}
        />
      </div>

      <CapabilityGraph model={model} />

      {originRows.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {originRows.map((tier) => (
            <div key={tier.key} className="rounded-xl border border-border/70 bg-card p-3">
              <p className="text-sm font-medium">
                {tier.label}
                <span className="ml-1.5 text-xs text-muted-foreground">×{model.provenanceTally[tier.key]}</span>
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{tier.blurb}</p>
            </div>
          ))}
        </div>
      ) : null}

      <InfoNote tone="privacy" title="What the picture does not say">
        Node colour is provenance — where a claim came from — not an aptitude score. Size is the level you stated, and
        opacity is the confidence the platform stores. No node here has been verified by an outside party, and dragging
        or annotating a node changes the drawing, never the underlying record.
      </InfoNote>
    </div>
  )
}
