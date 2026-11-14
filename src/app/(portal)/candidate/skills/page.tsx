import Link from 'next/link'
import { Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState, InfoNote, PageHeader } from '@/components/common'
import { SkillFormDialog, SkillsBoard, type SkillRowData } from '@/components/candidate/skills-board'
import { requirePermission } from '@/lib/authz'
import { prisma } from '@/lib/db'
import { ownProfileWhere } from '@/server/candidate'
import { loadCatalogSkills } from '@/server/skill-catalog'

export const metadata = { title: 'Skills inventory' }

export default async function CandidateSkillsPage() {
  const principal = await requirePermission('candidate.skills.read')

  if (!principal.candidateProfileId) {
    return (
      <div className="space-y-6">
        <PageHeader title="Skills inventory" description="No candidate profile is attached to this account yet." />
        <EmptyState
          title="Build a profile first"
          description="Onboarding creates the profile that skills attach to."
          action={
            <Button className="bg-brand-600 hover:bg-brand-700" nativeButton={false} render={<Link href="/candidate/onboarding" />} />
          }
        />
      </div>
    )
  }

  const [profile, catalog] = await Promise.all([
    prisma.candidateProfile.findFirst({
      where: ownProfileWhere(principal),
      include: {
        skills: {
          include: {
            skill: true,
            evidence: { orderBy: { createdAt: 'desc' } },
          },
          orderBy: [{ confidence: 'desc' }, { evidenceCount: 'desc' }],
        },
      },
    }),
    loadCatalogSkills(),
  ])

  if (!profile) return null

  const rows: SkillRowData[] = profile.skills.map((entry) => ({
    id: entry.id,
    slug: entry.skill.slug,
    name: entry.skill.name,
    category: entry.skill.category,
    transferable: entry.skill.transferable,
    level: entry.level,
    confidence: entry.confidence,
    validationStatus: entry.validationStatus,
    source: entry.source,
    note: entry.note,
    evidence: entry.evidence.map((item) => ({
      id: item.id,
      type: item.type,
      description: item.description,
      url: item.url,
    })),
  }))

  const catalogData = catalog.map((skill) => ({
    slug: skill.slug,
    name: skill.name,
    category: skill.category,
    transferable: skill.transferable,
  }))

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Your capability record"
        title="Skills inventory"
        description="Every skill carries a level, a confidence value, the status it came from and the evidence behind it. Add, correct or remove anything — an inventory you recognise is the one that produces honest matches."
        actions={
          <>
            <Button variant="outline" nativeButton={false} render={<Link href="/candidate/graph" />}>
              Capability graph
            </Button>
            <Button variant="ghost" nativeButton={false} render={<Link href="/candidate/experiences" />}>
              Experience entries
            </Button>
          </>
        }
      />

      {rows.length === 0 ? (
        <div className="space-y-4">
          <EmptyState
            title="No skills on file yet"
            image="skills-growing"
            description="Pick a skill from the catalogue and state the level you would defend in an interview. Or run the onboarding conversation and let the keyword rule propose skills from your own wording — each proposal arrives with the phrase that produced it, and you can remove it."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <SkillFormDialog catalog={catalogData} />
                <Button variant="outline" nativeButton={false} render={<Link href="/candidate/onboarding" />}>
                  <Sparkles className="size-4" aria-hidden />
                  Get suggestions from my own words
                </Button>
              </div>
            }
          />
          <InfoNote tone="info" title="Five skills is the first useful threshold">
            Gap reports and match scores compare your inventory against role skills, so a handful of entries with
            evidence changes what those screens can tell you. Nothing is invented on your behalf.
          </InfoNote>
        </div>
      ) : (
        <>
          <SkillsBoard skills={rows} catalog={catalogData} />
          <InfoNote tone="privacy" title="Evidence raises confidence, it does not verify you">
            The confidence figure on each card is the platform’s own stored value: 0.6 for a skill you declared, up to
            0.95 as evidence accumulates. There is no external check behind it and no claim of one.
          </InfoNote>
        </>
      )}
    </div>
  )
}
