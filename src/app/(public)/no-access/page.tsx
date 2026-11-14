import type { Metadata } from 'next'
import Link from 'next/link'
import { ShieldX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getPublicViewer } from '@/lib/authz'
import { permissionLabel } from '@/lib/permissions'

export const metadata: Metadata = {
  title: 'Not available for your account',
  description: 'This area of SYPRUS belongs to a different role.',
}

const HOME_BY_ROLE = { CANDIDATE: '/candidate', EMPLOYER: '/employer', ADMIN: '/admin' } as const

export default async function NoAccessPage(props: {
  searchParams: Promise<{ expected?: string; found?: string; needed?: string }>
}) {
  const { expected, found, needed } = await props.searchParams
  const viewer = await getPublicViewer()

  const home = viewer ? HOME_BY_ROLE[viewer.role] : '/login'

  return (
    <section className="mx-auto flex max-w-3xl justify-center px-4 py-16 sm:px-6 lg:py-24">
      <Card className="w-full">
        <CardHeader>
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-amber-50 text-amber-700">
              <ShieldX className="size-5" aria-hidden />
            </span>
            <div>
              <CardTitle>Not available for your account</CardTitle>
              <CardDescription className="mt-1.5 leading-relaxed">
                {needed
                  ? `This action requires the “${permissionLabel(needed)}” permission, which your role does not hold.`
                  : expected
                    ? `This area belongs to ${expected.toLowerCase()} accounts. Your account is signed in${found ? ` as ${found.toLowerCase()}` : ''}.`
                    : 'Your account does not have access to the area you requested.'}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <p className="text-sm leading-relaxed text-muted-foreground">
            Access is checked against the role and permission records in the database on every request, so switching
            accounts is the only way in — and an administrator must grant it.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button className="bg-brand-600 hover:bg-brand-700" nativeButton={false} render={<Link href={viewer ? home : '/login'} />}>{viewer ? 'Back to my portal' : 'Sign in with another account'}</Button>
            {viewer ? (
              <Button variant="outline" nativeButton={false} render={<Link href="/login?switch=1" />}>Switch account</Button>
            ) : null}
            <Button variant="ghost" nativeButton={false} render={<Link href="/" />}>Return to the overview</Button>
          </div>
        </CardContent>
      </Card>
    </section>
  )
}
