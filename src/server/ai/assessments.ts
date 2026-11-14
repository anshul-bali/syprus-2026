import { prisma } from '@/lib/db'
import { AccessDeniedError, assertPermission, type Principal } from '@/lib/authz'
import { recordAudit } from '@/server/audit'
import { notifyUser } from '@/server/notifications'
import { refreshEvidenceCount, refreshProfileCompletion } from '@/server/candidate'

/**
 * Optional short assessments that support skill validation.
 *
 * Correct answers never leave the server: a published attempt carries prompts
 * and options only. Passing sets the skill to ASSESSMENT_VERIFIED, which is a
 * platform-administered result — it is still not an employer reference, and the
 * wording on screen says so.
 */

export type PublishedQuestion = { id: string; position: number; prompt: string; options: string[] }

export async function listAvailableAssessments(principal: Principal) {
  assertPermission(principal, 'candidate.skills.read')
  const profileId = principal.candidateProfileId
  if (!profileId) throw new AccessDeniedError('No candidate profile attached to this account.')

  const [assessments, attempts, held] = await Promise.all([
    prisma.assessment.findMany({
      where: { isActive: true },
      include: { skill: { select: { slug: true, name: true, category: true } }, _count: { select: { questions: true } } },
      orderBy: { title: 'asc' },
    }),
    prisma.assessmentAttempt.findMany({
      where: { candidateProfileId: profileId },
      select: { assessmentId: true, score: true, passed: true, completedAt: true, startedAt: true },
      orderBy: { startedAt: 'desc' },
    }),
    prisma.candidateSkill.findMany({
      where: { candidateProfileId: profileId },
      select: { skillId: true, validationStatus: true },
    }),
  ])

  const bestByAssessment = new Map<string, { score: number; passed: boolean; attempts: number }>()
  for (const attempt of attempts) {
    const current = bestByAssessment.get(attempt.assessmentId) ?? { score: 0, passed: false, attempts: 0 }
    bestByAssessment.set(attempt.assessmentId, {
      score: Math.max(current.score, attempt.score),
      passed: current.passed || attempt.passed,
      attempts: current.attempts + 1,
    })
  }

  const heldSkillIds = new Set(held.map((entry) => entry.skillId))

  return assessments.map((assessment) => {
    const record = bestByAssessment.get(assessment.id)
    return {
      id: assessment.id,
      title: assessment.title,
      skillName: assessment.skill.name,
      skillSlug: assessment.skill.slug,
      category: assessment.skill.category,
      questionCount: assessment._count.questions,
      passMark: assessment.passMark,
      instructions: assessment.instructions,
      demonstration: assessment.demonstration,
      skillOnProfile: heldSkillIds.has(assessment.skillId),
      attempts: record?.attempts ?? 0,
      bestScore: record?.score ?? null,
      passed: record?.passed ?? false,
    }
  })
}

export async function startAttempt(principal: Principal, assessmentId: string) {
  assertPermission(principal, 'candidate.skills.manage')
  const profileId = principal.candidateProfileId
  if (!profileId) throw new AccessDeniedError('No candidate profile attached to this account.')

  const assessment = await prisma.assessment.findFirst({
    where: { id: assessmentId, isActive: true },
    include: {
      skill: { select: { name: true, slug: true } },
      questions: { orderBy: { position: 'asc' } },
    },
  })
  if (!assessment) throw new AccessDeniedError('This assessment is not available.')
  if (assessment.questions.length === 0) throw new AccessDeniedError('This assessment has no questions yet.')

  const attempt = await prisma.assessmentAttempt.create({
    data: { assessmentId: assessment.id, candidateProfileId: profileId, score: 0, passed: false },
  })

  // correctIndex and explanation are deliberately not returned.
  const questions: PublishedQuestion[] = assessment.questions.map((question) => ({
    id: question.id,
    position: question.position,
    prompt: question.prompt,
    options: question.options,
  }))

  await recordAudit({
    actor: principal,
    action: 'ai.assessment.start',
    entityType: 'assessment_attempts',
    entityId: attempt.id,
    metadata: { assessmentId: assessment.id, skill: assessment.skill.slug },
  })

  return {
    attemptId: attempt.id,
    title: assessment.title,
    instructions: assessment.instructions,
    skillName: assessment.skill.name,
    passMark: assessment.passMark,
    questions,
  }
}

/**
 * Reads an attempt the candidate is working through. Answers are never sent to
 * the browser before submission, so a right answer cannot be read out of HTML.
 */
export async function openAttempt(principal: Principal, attemptId: string) {
  assertPermission(principal, 'candidate.skills.read')
  const profileId = principal.candidateProfileId
  if (!profileId) throw new AccessDeniedError('No candidate profile attached to this account.')

  const attempt = await prisma.assessmentAttempt.findFirst({
    where: { id: attemptId, candidateProfileId: profileId },
    include: {
      assessment: {
        include: { skill: { select: { name: true, slug: true } }, questions: { orderBy: { position: 'asc' } } },
      },
    },
  })
  if (!attempt) throw new AccessDeniedError('That attempt is not on your account.')

  return {
    attemptId: attempt.id,
    title: attempt.assessment.title,
    instructions: attempt.assessment.instructions,
    skillName: attempt.assessment.skill.name,
    skillSlug: attempt.assessment.skill.slug,
    passMark: attempt.assessment.passMark,
    demonstration: attempt.assessment.demonstration,
    submitted: attempt.completedAt != null,
    score: attempt.score,
    passed: attempt.passed,
    startedAt: attempt.startedAt,
    questions: attempt.assessment.questions.map((question) => ({
      id: question.id,
      position: question.position,
      prompt: question.prompt,
      options: question.options,
    })) satisfies PublishedQuestion[],
  }
}

export async function submitAttempt(
  principal: Principal,
  input: { attemptId: string; responses: { questionId: string; selectedIndex: number }[] },
) {
  assertPermission(principal, 'candidate.skills.manage')
  const profileId = principal.candidateProfileId
  if (!profileId) throw new AccessDeniedError('No candidate profile attached to this account.')

  const attempt = await prisma.assessmentAttempt.findFirst({
    where: { id: input.attemptId, candidateProfileId: profileId, completedAt: null },
    include: { assessment: { include: { questions: true, skill: true } } },
  })
  if (!attempt) throw new AccessDeniedError('That attempt is not open on your account.')

  const questions = attempt.assessment.questions
  const submitted = new Map<number, number>()
  for (const response of input.responses) {
    const question = questions.find((entry) => entry.id === response.questionId)
    if (!question) throw new AccessDeniedError('A question reference was not part of this assessment.')
    if (submitted.has(question.position)) throw new AccessDeniedError('One answer per question is required.')
    if (
      !Number.isInteger(response.selectedIndex) ||
      response.selectedIndex < 0 ||
      response.selectedIndex >= question.options.length
    ) {
      throw new AccessDeniedError('An option index was outside the allowed range.')
    }
    submitted.set(question.position, response.selectedIndex)
  }
  if (submitted.size !== questions.length) {
    throw new AccessDeniedError(`Answer all ${questions.length} question(s) before submitting.`)
  }

  let correct = 0
  const responses = questions.map((question) => {
    const selectedIndex = submitted.get(question.position) as number
    const isCorrect = selectedIndex === question.correctIndex
    if (isCorrect) correct += 1
    return { questionId: question.id, selectedIndex, correct: isCorrect }
  })

  const score = Number((correct / questions.length).toFixed(4))
  const passed = score >= attempt.assessment.passMark

  await prisma.$transaction(async (tx) => {
    const changed = await tx.assessmentAttempt.updateMany({ where: { id: attempt.id, completedAt: null }, data: { score, passed, completedAt: new Date() } })
    if (changed.count !== 1) throw new AccessDeniedError('That attempt has already been submitted.')
    await tx.assessmentResponse.createMany({ data: responses.map((response) => ({ ...response, attemptId: attempt.id })) })
  })

  // A pass upgrades validation status, and adds evidence of the assessment.
  if (passed) {
    const candidateSkill = await prisma.candidateSkill.upsert({
      where: {
        candidateProfileId_skillId: { candidateProfileId: profileId, skillId: attempt.assessment.skillId },
      },
      create: {
        candidateProfileId: profileId,
        skillId: attempt.assessment.skillId,
        level: 'PROFICIENT',
        confidence: Math.min(0.9, score),
        validationStatus: 'ASSESSMENT_VERIFIED',
        source: 'ASSESSMENT',
        note: `Passed “${attempt.assessment.title}” at ${(score * 100).toFixed(0)}%.`,
      },
      update: {
        validationStatus: 'ASSESSMENT_VERIFIED',
        confidence: Math.max(0.75, score),
        source: 'ASSESSMENT',
      },
    })

    await prisma.skillEvidence.create({
      data: {
        candidateSkillId: candidateSkill.id,
        type: 'ASSESSMENT',
        description: `Passed the platform assessment “${attempt.assessment.title}” with ${correct}/${questions.length} correct on ${new Date().toLocaleDateString('en-IN')}.`,
      },
    })
    await refreshEvidenceCount(candidateSkill.id)
    await refreshProfileCompletion(profileId)
    const { computeMatchesForProfile } = await import('@/server/matching')
    await computeMatchesForProfile(profileId)
  }

  await notifyUser(principal.userId, {
    type: 'PLAN_REMINDER',
    title: passed ? 'Assessment passed' : 'Assessment completed',
    body: passed
      ? `${attempt.assessment.title}: ${(score * 100).toFixed(0)}%. ${attempt.assessment.skill.name} is now marked assessment-verified.`
      : `${attempt.assessment.title}: ${(score * 100).toFixed(0)}%, below the ${(attempt.assessment.passMark * 100).toFixed(0)}% pass mark. You can retake it after reviewing the gaps.`,
    link: '/candidate/assessments',
  })

  await recordAudit({
    actor: principal,
    action: 'ai.assessment.submit',
    entityType: 'assessment_attempts',
    entityId: attempt.id,
    metadata: { skill: attempt.assessment.skill.slug, score, passed },
  })

  return {
    score,
    passed,
    correct,
    total: questions.length,
    passMark: attempt.assessment.passMark,
    // Explanations are revealed only after submission.
    review: questions.map((question) => ({
      prompt: question.prompt,
      selectedIndex: submitted.get(question.position) as number,
      correctIndex: question.correctIndex,
      correct: (submitted.get(question.position) as number) === question.correctIndex,
      explanation: question.explanation,
    })),
  }
}

/** Attempts a reviewer can inspect for one skill claim. */
export async function attemptsForProfile(principal: Principal, profileId: string) {
  assertPermission(principal, 'candidate.gap.read')
  if (profileId !== principal.candidateProfileId && principal.role !== 'ADMIN') {
    throw new AccessDeniedError('Assessment history is only readable by its owner or an administrator.')
  }
  return prisma.assessmentAttempt.findMany({
    where: { candidateProfileId: profileId },
    include: { assessment: { include: { skill: { select: { name: true, slug: true } } } } },
    orderBy: { startedAt: 'desc' },
  })
}
