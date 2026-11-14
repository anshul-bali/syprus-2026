import { getPublicViewer } from '@/lib/authz'
import { SiteNav } from '@/components/app-shell/site-nav'
import { SiteFooter } from '@/components/app-shell/site-footer'

const PORTAL_BY_ROLE = {
  CANDIDATE: { href: '/candidate', label: 'My dashboard' },
  EMPLOYER: { href: '/employer', label: 'Employer portal' },
  ADMIN: { href: '/admin', label: 'Admin portal' },
} as const

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const viewer = await getPublicViewer()
  const portal = viewer ? PORTAL_BY_ROLE[viewer.role] : null

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteNav portalHref={portal?.href ?? null} portalLabel={portal?.label ?? null} />
      <main id="main" className="flex-1">
        {children}
      </main>
      <SiteFooter />
    </div>
  )
}
