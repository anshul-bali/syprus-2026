import type { Metadata } from 'next'
import { RegisterShell } from '@/components/auth/register-shell'
import { DemoWaiverNotice } from '@/components/auth/demo-waiver-notice'
import { waiverEnabled } from '@/lib/demo-waiver'

export const metadata: Metadata = {
  title: 'Create an account',
  description: 'Register as a returning professional or as an employer on SYPRUS.',
}

export default async function RegisterPage(props: { searchParams: Promise<{ role?: string }> }) {
  const { role } = await props.searchParams
  const defaultRole = role === 'employer' ? 'employer' : 'candidate'

  return (
    <section className="mx-auto flex max-w-7xl flex-col items-center gap-4 px-4 py-16 sm:px-6 lg:py-24">
      <div className="w-full max-w-2xl">
        <DemoWaiverNotice />
      </div>
      <div className="flex w-full justify-center">
        <RegisterShell defaultRole={defaultRole} waived={waiverEnabled()} />
      </div>
    </section>
  )
}
