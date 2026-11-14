import Link from 'next/link'
import { BrandMark } from '@/components/common'

const FOOTER_COLUMNS = [
  {
    title: 'Platform',
    links: [
      { href: '/#how-it-works', label: 'How it works' },
      { href: '/#agents', label: 'The four agents' },
      { href: '/#privacy', label: 'Privacy and disclosure' },
      { href: '/#faq', label: 'FAQs' },
    ],
  },
  {
    title: 'Accounts',
    links: [
      { href: '/register?role=candidate', label: 'Candidate sign-up' },
      { href: '/register?role=employer', label: 'Employer sign-up' },
      { href: '/login', label: 'Sign in' },
    ],
  },
  {
    title: 'Portals',
    links: [
      { href: '/candidate', label: 'Candidate portal' },
      { href: '/employer', label: 'Employer portal' },
      { href: '/admin', label: 'Administrator portal' },
    ],
  },
]

export function SiteFooter() {
  return (
    <footer className="border-t border-border bg-brand-950 text-brand-100">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:px-6 lg:grid-cols-[1.4fr_repeat(3,1fr)] lg:px-8">
        <div className="max-w-sm">
          <BrandMark href="/" className="[&_span]:text-brand-50" />
          <p className="mt-4 text-sm leading-relaxed text-brand-200">
            SYPRUS matches returning professionals with employers on demonstrated capability. Skill suggestions come
            from your own words, match scores come from a published weighted rules calculation, and every score is shown
            with the reasoning behind it.
          </p>
        </div>

        {FOOTER_COLUMNS.map((column) => (
          <nav key={column.title} aria-label={column.title}>
            <p className="text-xs font-semibold tracking-[0.14em] text-brand-300 uppercase">{column.title}</p>
            <ul className="mt-4 space-y-2.5">
              {column.links.map((link) => (
                <li key={link.href + link.label}>
                  <Link href={link.href} className="text-sm text-brand-100 transition-colors hover:text-white">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>

      <div className="border-t border-brand-800/60">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-6 text-xs text-brand-300 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <p>
            Demonstration MVP. Match scores are calculated by published rules and skill inference is explainable;
            optional AI agents can propose suggestions with a model when one is enabled, and each proposal says which
            engine produced it. None of it is an AI-verified credential, live labour-market intelligence or a guarantee
            of placement.
          </p>
          <p>Policy version {process.env.POLICY_VERSION ?? '2026-11-01'}</p>
        </div>
      </div>
    </footer>
  )
}
