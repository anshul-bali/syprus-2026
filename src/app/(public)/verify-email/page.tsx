import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { VerifyEmailForm } from '@/components/auth/verify-email-form'
import { VerifyLinkCard } from '@/components/auth/verify-link-card'
import { AuthPanel } from '@/components/media/auth-panel'
import { prisma } from '@/lib/db'
import { currentVerificationTicket, verificationSummaryFor } from '@/server/verification'
import { formatClock } from '@/lib/utils'

export const metadata: Metadata = {
  title: 'Confirm your email',
  description:
    'Enter the six-digit code, or open the link, that SYPRUS sent to your email address to open your account.',
}

/** `a••••@domain` — enough to recognise the address, not enough to read it out. */
function maskEmail(email: string) {
  const [local = '', domain = ''] = email.split('@')
  const visible = local.slice(0, 1)
  const hidden = Math.max(0, Math.min(local.length - 1, 12))
  return `${visible}${'•'.repeat(hidden)}@${domain}`
}

export default async function VerifyEmailPage(props: {
  searchParams: Promise<{ next?: string; token?: string }>
}) {
  const { next, token } = await props.searchParams
  const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : null

  // Arrived by link. Nothing is spent by this GET — the card posts the token to
  // an action, which is where it is redeemed and the session is opened.
  if (token) {
    return (
      <section className="mx-auto flex max-w-7xl flex-col items-center justify-center gap-8 px-4 py-16 sm:px-6 md:flex-row md:gap-10 lg:py-24">
        <AuthPanel
          image="login-workspace"
          title="One link, one session"
          points={[
            'The link in the mail and the six-digit code are two ways of passing the same check.',
            'Either one works once, expires in ten minutes, and opens exactly one session.',
            'Nothing in the portal is reachable until this step is finished.',
          ]}
        />
        <VerifyLinkCard token={token} next={safeNext} />
      </section>
    )
  }

  const ticket = await currentVerificationTicket()
  if (!ticket) redirect('/login')

  const [account, code] = await Promise.all([
    prisma.user.findUnique({
      where: { id: ticket.userId },
      select: { id: true, email: true, status: true },
    }),
    verificationSummaryFor(ticket.verificationId),
  ])

  if (!account || account.status !== 'ACTIVE' || !code) redirect('/login')

  return (
    <section className="mx-auto flex max-w-7xl flex-col items-center justify-center gap-8 px-4 py-16 sm:px-6 md:flex-row md:gap-10 lg:py-24">
      <AuthPanel
        image="login-workspace"
        title="Two things, not one"
        points={[
          'The password proves you know something; the code or link proves you can read the mailbox on the account.',
          'A code or link opens exactly one session and then stops working, so a screenshot is not a key.',
          'Nothing in the portal is reachable until this step is finished.',
        ]}
      />
      <VerifyEmailForm
        purpose={ticket.purpose}
        maskedEmail={maskEmail(account.email)}
        next={safeNext}
        previewCode={code.emailed ? null : code.previewCode}
        previewLink={code.previewLink}
        expiresAtLabel={formatClock(code.expiresAt)}
        resendFromLabel={formatClock(code.resendFrom)}
        expired={code.expired}
      />
    </section>
  )
}
