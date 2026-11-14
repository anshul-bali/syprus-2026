import type { UserRole } from '@prisma/client'

export type NavItem = {
  href: string
  label: string
  /** Icon name from `src/components/app-shell/icon-map.tsx`. */
  icon: string
  hint?: string
}

/**
 * One place that describes what each role can reach. The portal sidebar renders
 * from this, and each route's own layout still checks permissions in the
 * database — this list is navigation, not a security boundary.
 */
export const PORTAL_NAV: Record<UserRole, NavItem[]> = {
  CANDIDATE: [
    { href: '/candidate', label: 'Dashboard', icon: 'layout' },
    { href: '/candidate/onboarding', label: 'Onboarding chat', icon: 'messages' },
    { href: '/candidate/experiences', label: 'Experience', icon: 'briefcase' },
    { href: '/candidate/skills', label: 'Skills inventory', icon: 'badge' },
    { href: '/candidate/suggestions', label: 'Skill suggestions', icon: 'sparkles' },
    { href: '/candidate/assessments', label: 'Assessments', icon: 'clipboard' },
    { href: '/candidate/evidence', label: 'Documents', icon: 'upload' },
    { href: '/candidate/graph', label: 'Capability graph', icon: 'graph' },
    { href: '/candidate/gap-report', label: 'Skill gaps', icon: 'scan' },
    { href: '/candidate/pathways', label: 'Learning pathways', icon: 'graduation' },
    { href: '/candidate/jobs', label: 'Recommended roles', icon: 'search' },
    { href: '/candidate/applications', label: 'Applications', icon: 'folder' },
    { href: '/candidate/disclosures', label: 'Disclosure requests', icon: 'shield' },
    { href: '/candidate/notifications', label: 'Notifications', icon: 'bell' },
    { href: '/candidate/profile', label: 'Profile and privacy', icon: 'user' },
  ],
  EMPLOYER: [
    { href: '/employer', label: 'Hiring overview', icon: 'layout' },
    { href: '/employer/jobs', label: 'Roles', icon: 'briefcase' },
    { href: '/employer/jobs/new', label: 'Create role', icon: 'plus' },
    { href: '/employer/candidates', label: 'Anonymised candidates', icon: 'users' },
    { href: '/employer/applications', label: 'Applications', icon: 'folder' },
    { href: '/employer/shortlist', label: 'Shortlist', icon: 'badge' },
    { href: '/employer/notifications', label: 'Notifications', icon: 'bell' },
    { href: '/employer/profile', label: 'Organisation', icon: 'building' },
  ],
  ADMIN: [
    { href: '/admin', label: 'Platform overview', icon: 'layout' },
    { href: '/admin/users', label: 'Users', icon: 'users' },
    { href: '/admin/organisations', label: 'Organisations', icon: 'building' },
    { href: '/admin/moderation', label: 'Role moderation', icon: 'scan' },
    { href: '/admin/engines', label: 'Agent health', icon: 'activity' },
    { href: '/admin/review', label: 'Human review queue', icon: 'clipboard' },
    { href: '/admin/weights', label: 'Matching weights', icon: 'sliders' },
    { href: '/admin/fairness', label: 'Fairness monitoring', icon: 'scale' },
    { href: '/admin/reporting', label: 'Reporting', icon: 'chart' },
    { href: '/admin/audit', label: 'Audit history', icon: 'history' },
  ],
}

export const ROLE_LABELS: Record<UserRole, { name: string; home: string }> = {
  CANDIDATE: { name: 'Candidate portal', home: '/candidate' },
  EMPLOYER: { name: 'Employer portal', home: '/employer' },
  ADMIN: { name: 'Administrator portal', home: '/admin' },
}

/** Nav highlighting: exact match, or a match on a deeper path under the item. */
export function isActivePath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`)
}
