/**
 * Demonstration-data audit for the Anshika walkthrough.
 *
 *   npx tsx scripts/demo-audit.ts            read-only facts
 *   npx tsx scripts/demo-audit.ts --repair   backfill the two columns this pass
 *                                            introduced, without touching any
 *                                            existing row otherwise
 *
 * Seeded applications predate the explicit identity-consent column, and seeded
 * research consent predates the consent-gated fairness monitor. A demo run on
 * such a database would show "applied" without the identity disclosure the
 * screen claims, so the repair makes the stored facts match the product story.
 * Nothing here deletes a row.
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const repair = process.argv.includes('--repair')

async function main() {
  const anshika = await prisma.candidateProfile.findFirst({
    where: { user: { email: 'anshika@example.com' } },
    include: {
      user: { select: { name: true, email: true } },
      skills: { include: { skill: { select: { name: true, slug: true, category: true } } }, orderBy: { confidence: 'desc' } },
      experiences: true,
    },
  })
  if (!anshika) throw new Error('The demonstration candidate is missing. Load the demonstration seed into this database first.')

  const matches = await prisma.match.findMany({
    where: { candidateProfileId: anshika.id },
    orderBy: { score: 'desc' },
    include: { job: { select: { id: true, title: true, status: true, organization: { select: { name: true, verificationStatus: true } } } } },
  })
  const applications = await prisma.application.findMany({
    where: { candidateProfileId: anshika.id },
    include: { job: { select: { title: true } } },
  })
  const shortlist = await prisma.shortlistEntry.findMany({ where: { candidateProfileId: anshika.id }, include: { job: { select: { title: true } } } })
  const annotations = await prisma.graphAnnotation.count({ where: { candidateProfileId: anshika.id } })
  const proposals = await prisma.aiProposal.count({ where: { candidateProfileId: anshika.id } })
  const assessments = await prisma.assessmentAttempt.count({ where: { candidateProfileId: anshika.id } })
  const researchConsent = await prisma.consentRecord.count({ where: { userId: anshika.userId, type: 'RESEARCH_CONTRIBUTION', decision: 'GRANTED' } })
  const disclosureRequests = await prisma.identityDisclosureRequest.count({ where: { candidateProfileId: anshika.id } })
  const exclusionary = await prisma.job.findFirst({ where: { status: 'PUBLISHED', description: { contains: 'continuous' } }, select: { id: true, title: true } })
  const languageReviews = await prisma.languageReview.count()
  const reviewTasks = await prisma.reviewTask.count({ where: { status: 'OPEN' } })
  const findings = exclusionary
    ? await prisma.languageReview.findFirst({ where: { jobId: exclusionary.id }, orderBy: { createdAt: 'desc' }, select: { overallRisk: true, findings: true, continuityChecks: true, mode: true } })
    : null
  const topMatch = matches[0]
  const topExplanation = topMatch ? await prisma.match.findUnique({ where: { id: topMatch.id }, select: { requiredScore: true, preferredScore: true, evidenceScore: true, preferenceScore: true, weightVersion: true, modelVersion: true } }) : null
  const consentedProfiles = await prisma.consentRecord.count({ where: { type: 'RESEARCH_CONTRIBUTION', decision: 'GRANTED' } })

  console.log('Demonstration candidate:', anshika.user.name, '/', anshika.user.email)
  console.log('  profile:', anshika.yearsOfExperience, 'yrs recorded,', anshika.careerBreakMonths, 'month break (private), sharing', anshika.sharingMode, anshika.visibleToEmployers ? '(visible)' : '(hidden)')
  console.log('  skills:', anshika.skills.length, '| experiences:', anshika.experiences.length, '| proposals:', proposals, '| assessment attempts:', assessments, '| graph edits saved:', annotations)
  console.log('  research consent granted:', researchConsent > 0, '| disclosure requests on file:', disclosureRequests)
  console.log('  stored matches:', matches.length)
  for (const match of matches.slice(0, 6)) {
    console.log(`    ${Math.round(match.score * 100)}%  ${match.job.title} — ${match.job.organization.name} (${match.job.organization.verificationStatus}, ${match.job.status})`)
  }
  console.log('  applications:', applications.map((a) => `${a.job.title} [${a.status}]`).join(', ') || 'none')
  console.log('  shortlisted:', shortlist.map((entry) => entry.job.title).join(', ') || 'none')
  console.log('  platform: language reviews', languageReviews, '| open review tasks', reviewTasks, '| exclusionary demonstration role', exclusionary?.title ?? 'none')
  if (topMatch && topExplanation) {
    console.log('  top match maths:', `${Math.round(topMatch.score * 100)}% =`,
      `required ${topExplanation.requiredScore.toFixed(3)} + preferred ${topExplanation.preferredScore.toFixed(3)}`,
      `+ evidence ${topExplanation.evidenceScore.toFixed(3)} + constraints ${topExplanation.preferenceScore.toFixed(3)}`,
      `(${topExplanation.modelVersion}, weights ${topExplanation.weightVersion})`)
  }
  if (findings) {
    const list = (findings.findings ?? []) as { category: string; severity: string; excerpt: string }[]
    const checks = (findings.continuityChecks ?? []) as { requirement: string; isLikelyUnnecessary: boolean }[]
    console.log('  exclusionary role audit:', findings.mode, '| risk', findings.overallRisk,
      '|', list.length, 'finding(s):', [...new Set(list.map((f) => f.category.toLowerCase()))].join(', '))
    for (const check of checks.filter((c) => c.isLikelyUnnecessary)) console.log('    unnecessary continuity requirement:', check.requirement)
  }
  console.log('  fairness audit can read', consentedProfiles, 'profile(s) that granted research consent')

  if (!repair) {
    console.log('\nRead-only. Pass --repair to backfill identity consent on seeded applications and research consent on the demonstration profiles.')
    return
  }

  const unconsented = await prisma.application.updateMany({
    where: { status: { not: 'WITHDRAWN' }, identityConsentAt: null, candidateProfile: { user: { email: { endsWith: '@example.com' } } } },
    data: { identityConsentAt: new Date() },
  })
  const seededProfiles = await prisma.candidateProfile.findMany({ where: { user: { email: { endsWith: '@example.com' } } }, select: { userId: true } })
  let granted = 0
  for (const profile of seededProfiles) {
    const existing = await prisma.consentRecord.findFirst({ where: { userId: profile.userId, type: 'RESEARCH_CONTRIBUTION' } })
    if (!existing) {
      await prisma.consentRecord.create({ data: { userId: profile.userId, type: 'RESEARCH_CONTRIBUTION', decision: 'GRANTED', policyVersion: process.env.POLICY_VERSION ?? '2026-11-01' } })
      granted += 1
    }
  }
  console.log(`\nRepaired: ${unconsented.count} application(s) given an identity-consent timestamp; ${granted} profile(s) given research consent.`)
}

main()
  .catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
