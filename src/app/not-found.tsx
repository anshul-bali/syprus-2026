import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { BrandMark } from '@/components/common'

export default function NotFound() {
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-6 px-4 py-16 sm:px-6">
      <BrandMark />
      <div>
        <p className="text-xs font-semibold tracking-[0.16em] text-brand-600 uppercase">404</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">This page does not exist</h1>
        <p className="mt-3 leading-relaxed text-muted-foreground">
          The address may be mistyped, or it may belong to a portal your account is not signed in to.
          Every screen SYPRUS links to is listed in the navigation of the portal it belongs to.
        </p>
      </div>
      <div className="flex flex-wrap gap-3">
        <Button nativeButton={false} render={<Link href="/" />} className="bg-brand-600 hover:bg-brand-700">
          Back to the overview
        </Button>
        <Button nativeButton={false} variant="outline" render={<Link href="/login" />}>
          Sign in
        </Button>
        <Button nativeButton={false} variant="ghost" render={<Link href="/register" />}>
          Create an account
        </Button>
      </div>
    </main>
  )
}
