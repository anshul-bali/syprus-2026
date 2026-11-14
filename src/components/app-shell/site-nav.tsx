'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Menu } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { BrandMark } from '@/components/common'
import { ThemeToggle } from '@/components/theme/theme-toggle'
import { cn } from '@/lib/utils'

const NAV_LINKS = [
  { href: '/#problem', label: 'The problem' },
  { href: '/#how-it-works', label: 'How it works' },
  { href: '/#agents', label: 'Four agents' },
  { href: '/#candidates', label: 'For candidates' },
  { href: '/#employers', label: 'For employers' },
  { href: '/#faq', label: 'FAQs' },
]

export function SiteNav({
  portalHref,
  portalLabel,
}: {
  portalHref: string | null
  portalLabel: string | null
}) {
  const [scrolled, setScrolled] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const pathname = usePathname()

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const isActive = (href: string) => href === pathname

  return (
    <header
      className={cn(
        'sticky top-0 z-50 w-full border-b transition-colors',
        scrolled ? 'border-border/70 bg-background/85 backdrop-blur-md' : 'border-transparent bg-transparent',
      )}
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <BrandMark />

        <nav aria-label="Primary" className="hidden items-center gap-1 lg:flex">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                'rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground',
                isActive(link.href) ? 'text-foreground' : 'text-muted-foreground',
              )}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-2 lg:flex">
          <ThemeToggle />
          {portalHref ? (
            <Button className="bg-brand-600 hover:bg-brand-700" nativeButton={false} render={<Link href={portalHref} />}>{portalLabel}</Button>
          ) : (
            <>
              <Button variant="ghost" nativeButton={false} render={<Link href="/login" />}>Sign in</Button>
              <Button className="bg-brand-600 hover:bg-brand-700" nativeButton={false} render={<Link href="/register" />}>Create account</Button>
            </>
          )}
        </div>

        <ThemeToggle className="lg:hidden" />

        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetTrigger
            render={<Button variant="outline" size="icon" className="lg:hidden" aria-label="Open navigation menu" />}
          >
            <Menu className="size-5" />
          </SheetTrigger>
          <SheetContent side="right" className="w-[86vw] max-w-sm flex-col gap-0 p-0">
            <SheetHeader className="border-b border-border px-6 py-4">
              <SheetTitle className="text-left text-base">Navigate SYPRUS</SheetTitle>
            </SheetHeader>
            <div className="flex-1 overflow-y-auto px-3 py-4">
              <nav aria-label="Mobile" className="flex flex-col gap-1">
                {NAV_LINKS.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={() => setSheetOpen(false)}
                    className="rounded-lg px-3 py-2.5 text-sm font-medium text-foreground hover:bg-accent"
                  >
                    {link.label}
                  </Link>
                ))}
              </nav>
            </div>
            <div className="flex flex-col gap-2 border-t border-border px-6 py-4">
              {portalHref ? (
                <Button
                  className="bg-brand-600 hover:bg-brand-700"
                  nativeButton={false}
                  render={<Link href={portalHref} onClick={() => setSheetOpen(false)} />}
                >
                  {portalLabel}
                </Button>
              ) : (
                <>
                  <Button
                    variant="outline"
                    nativeButton={false}
                    render={<Link href="/login" onClick={() => setSheetOpen(false)} />}
                  >
                    Sign in
                  </Button>
                  <Button
                    className="bg-brand-600 hover:bg-brand-700"
                    nativeButton={false}
                    render={<Link href="/register" onClick={() => setSheetOpen(false)} />}
                  >
                    Create account
                  </Button>
                </>
              )}
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  )
}
