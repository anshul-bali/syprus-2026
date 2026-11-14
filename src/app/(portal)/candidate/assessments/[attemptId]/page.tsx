import Link from 'next/link'
import { requirePermission } from '@/lib/authz'
import { openAttempt } from '@/server/ai/assessments'
import { AssessmentQuiz } from '@/components/candidate/assessment-quiz'
import { EmptyState, InfoNote, PageHeader } from '@/components/common'
import { Button } from '@/components/ui/button'

export const metadata = { title: 'Assessment attempt' }

export default async function AssessmentAttemptPage(props: { params: Promise<{ attemptId: string }> }) {
  const { attemptId } = await props.params
  const principal = await requirePermission('candidate.skills.read')

  const attempt = await openAttempt(principal, attemptId).catch(() => null)

  if (!attempt) {
    return (
      <div className="space-y-6">
        <PageHeader eyebrow="Agent 1" title="Assessment attempt" description="This attempt is not on your account." />
        <EmptyState
          title="Nothing to answer here"
          description="An attempt belongs to the candidate who started it. Start a fresh one from the assessments screen."
          action={
            <Button className="bg-brand-600 hover:bg-brand-700" nativeButton={false} render={<Link href="/candidate/assessments" />}>
              Available assessments
            </Button>
          }
        />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Agent 1"
        title={attempt.title}
        description={`One question set for ${attempt.skillSlug}. Answers are scored on the server, and the correct options are never sent to your browser.`}
        actions={
          <>
            <Button variant="outline" nativeButton={false} render={<Link href="/candidate/assessments" />}>
              All assessments
            </Button>
            <Button variant="ghost" nativeButton={false} render={<Link href="/candidate/skills" />}>
              Skills inventory
            </Button>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <AssessmentQuiz
          attemptId={attempt.attemptId}
          title={attempt.title}
          instructions={attempt.instructions}
          skillName={attempt.skillName}
          passMark={attempt.passMark}
          demonstration={attempt.demonstration}
          questions={attempt.questions}
          submitted={attempt.submitted}
          score={attempt.score}
          passed={attempt.passed}
        />

        <div className="flex flex-col gap-4">
          <InfoNote tone="info" title="How the score is used">
            At or above {Math.round(attempt.passMark * 100)}% the skill becomes assessment-verified with confidence set to
            at least your score. Below it, nothing on your inventory changes — an honest fail is not hidden.
          </InfoNote>
          <InfoNote tone="privacy" title="Who can see this">
            An employer sees the validation status and the evidence line describing the pass, but only after they are
            allowed to read your profile — and never this attempt’s answers.
          </InfoNote>
        </div>
      </div>
    </div>
  )
}
