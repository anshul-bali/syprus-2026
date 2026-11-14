'use client'

import {
  Activity,
  Bell,
  BadgeCheck,
  Briefcase,
  Building2,
  FolderKanban,
  GraduationCap,
  History,
  LayoutDashboard,
  ListChecks,
  MessagesSquare,
  Plus,
  Scale,
  Search,
  ScanLine,
  Share2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  SquareCheckBig,
  Upload,
  Network as NetworkIcon,
  User,
  Users,
  BarChart3,
  type LucideIcon,
} from 'lucide-react'

/**
 * Nav items carry icon names rather than components, so the configuration in
 * `src/lib/nav.ts` stays serialisable across the server/client boundary.
 */
const ICONS: Record<string, LucideIcon> = {
  activity: Activity,
  badge: BadgeCheck,
  bell: Bell,
  briefcase: Briefcase,
  building: Building2,
  chart: BarChart3,
  checks: ListChecks,
  folder: FolderKanban,
  graduation: GraduationCap,
  graph: NetworkIcon,
  history: History,
  layout: LayoutDashboard,
  messages: MessagesSquare,
  plus: Plus,
  scale: Scale,
  scan: ScanLine,
  search: Search,
  share: Share2,
  shield: ShieldCheck,
  sliders: SlidersHorizontal,
  sparkles: Sparkles,
  clipboard: SquareCheckBig,
  upload: Upload,
  user: User,
  users: Users,
}

export function NavIcon({ name, className }: { name: string; className?: string }) {
  const Icon = ICONS[name] ?? LayoutDashboard
  return <Icon className={className} aria-hidden />
}
