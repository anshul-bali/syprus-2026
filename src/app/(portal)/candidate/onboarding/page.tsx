import { requirePermission } from '@/lib/authz'
import { startOrResumeConversation, ONBOARDING_STEPS } from '@/server/onboarding'
import { PageHeader, InfoNote } from '@/components/common'
import { OnboardingChat, type OnboardingMessage } from '@/components/candidate/onboarding-chat'
import { SectionImage } from '@/components/media/section-image'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export const metadata = { title: 'Onboarding conversation' }

export default async function CandidateOnboardingPage() {
  const principal = await requirePermission('candidate.conversation.manage')
  const { conversation, step } = await startOrResumeConversation(principal)

  const messages: OnboardingMessage[] = conversation.messages.map((message) => ({
    id: message.id,
    role: message.role === 'USER' ? 'USER' : 'ASSISTANT',
    content: message.content,
    createdAt: message.createdAt.toISOString(),
  }))

  const currentIndex = ONBOARDING_STEPS.findIndex((entry) => entry.key === conversation.stepKey)
  const answered = conversation.status === 'COMPLETED' ? ONBOARDING_STEPS.length : Math.max(0, currentIndex)

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Step by step"
        title="Onboarding conversation"
        description="Eight questions, in your own words. Each answer writes real records on your profile, and nothing leaves this account unless you switch sharing on."
      />

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <OnboardingChat
          messages={messages}
          step={step}
          conversationCompleted={conversation.status === 'COMPLETED'}
          progress={{ answered, total: ONBOARDING_STEPS.length }}
        />

        <div className="flex flex-col gap-4">
          <SectionImage
            image="onboarding-conversation"
            sizes="(max-width: 1023px) 92vw, 320px"
            className="mx-auto w-full max-w-[16rem] sm:mx-0 sm:max-w-none"
            frameClassName="ring-border/60"
          />
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">What your answers become</CardTitle>
              <CardDescription>No summaries are stored as free text only — each step creates rows you can edit later.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2.5 text-sm leading-relaxed">
              <StepNote title="Inference consent" text="One decision, recorded with the policy version. It gates every skill suggestion and can be withdrawn later." />
              <StepNote title="Break period" text="Months and timeline, stored privately. Marked as not an input to matching or ranking." />
              <StepNote title="Last paid role" text="An experience entry with start and end dates, plus any skills the keyword rule proposes." />
              <StepNote title="Caregiving responsibilities" text="Each activity you pick becomes an experience plus skill entries carrying that activity’s evidence sentence." />
              <StepNote title="Goals and sharing" text="Target role, sector, work style, hours, city — and who may see the result." />
            </CardContent>
          </Card>

          <InfoNote tone="info" title="You can leave and come back">
            The conversation, its answers and each step’s position are persisted. Closing the tab does not lose your
            progress, and a completed conversation can be reviewed but not restarted from this screen.
          </InfoNote>
        </div>
      </div>
    </div>
  )
}

function StepNote({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-lg border border-border/70 bg-muted/25 px-3 py-2.5">
      <p className="text-[13px] font-medium">{title}</p>
      <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{text}</p>
    </div>
  )
}
