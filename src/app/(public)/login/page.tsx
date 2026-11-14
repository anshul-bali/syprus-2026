import type { Metadata } from 'next'
import { LoginForm } from '@/components/auth/login-form'
import { DemoWaiverNotice } from '@/components/auth/demo-waiver-notice'
import { waiverEnabled } from '@/lib/demo-waiver'
import { AuthPanel } from '@/components/media/auth-panel'

export const metadata: Metadata = {
  title: 'Sign in',
  description: 'Sign in to the SYPRUS candidate, employer or administrator portal.',
}

export default async function LoginPage(props: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await props.searchParams
  const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : undefined

  return (
    <section className="mx-auto flex max-w-7xl flex-col items-center justify-center gap-8 px-4 py-16 sm:px-6 md:flex-row md:gap-10 lg:py-24">
      <AuthPanel
        image="login-workspace"
        title="One account, one role"
        points={[
          'Candidates, employers and administrators sign in through this same door.',
          'Employers see anonymised profiles until you apply with consent.',
          'Signing out clears the session and records the sign-out in the audit trail.',
        ]}
      />
      <div className="flex w-full max-w-md flex-col items-center gap-3">
        <DemoWaiverNotice />
        <LoginForm next={safeNext} waived={waiverEnabled()} />
      </div>
    </section>
  )
}
