'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LogOut, Menu, Search, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import { BrandMark, StatusBadge } from '@/components/common'
import { NavIcon } from '@/components/app-shell/icon-map'
import { ThemeMenuGroup, ThemeToggle } from '@/components/theme/theme-toggle'
import { relativeTime } from '@/lib/utils'
import { label as enumLabel } from '@/lib/options'
import { logoutAction } from '@/server/actions/auth'
import { markAllNotificationsReadAction, markNotificationReadAction } from '@/server/actions/notifications'
import type { NavItem } from '@/lib/nav'

export type NotificationItem = {
  id: string
  title: string
  body: string
  type: string
  link: string | null
  readAt: string | null
  createdAt: string
}

export function PortalShell({
  roleLabel,
  name,
  email,
  organizationName,
  organizationVerification,
  navItems,
  notifications,
  unreadCount,
  notificationsHref,
  assistant,
  children,
}: {
  roleLabel: string
  name: string
  email: string
  organizationName: string | null
  organizationVerification: string | null
  navItems: NavItem[]
  notifications: NotificationItem[]
  unreadCount: number
  notificationsHref: string
  /** The assistant launcher, built by the portal layout so its transcript is server-read. */
  assistant?: React.ReactNode
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [bellOpen, setBellOpen] = useState(false)

  const sidebar = (
    <nav aria-label="Portal" className="flex h-full flex-col gap-1 overflow-y-auto p-3">
      {navItems.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`)
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setMobileOpen(false)}
            aria-current={active ? 'page' : undefined}
            className={
              active
                ? 'flex items-center gap-2.5 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-primary-foreground shadow-sm'
                : 'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
            }
          >
            <NavIcon name={item.icon} className="size-4 shrink-0" />
            <span className="truncate">{item.label}</span>
          </Link>
        )
      })}
    </nav>
  )

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="sticky top-0 z-40 border-b border-border/70 bg-background/90 backdrop-blur">
        <div className="flex h-14 items-center gap-3 px-3 sm:px-4">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger
              render={<Button variant="outline" size="icon" className="lg:hidden" aria-label="Open portal navigation" />}
            >
              <Menu className="size-4.5" />
            </SheetTrigger>
            <SheetContent side="left" className="w-[82vw] max-w-xs gap-0 p-0">
              <SheetHeader className="border-b border-border px-4 py-3">
                <SheetTitle className="text-left text-sm">{roleLabel}</SheetTitle>
              </SheetHeader>
              <div className="h-[calc(100vh-3.75rem)]">{sidebar}</div>
            </SheetContent>
          </Sheet>

          <BrandMark className="shrink-0" />

          <Badge variant="secondary" className="hidden bg-brand-50 text-brand-800 sm:inline-flex">
            {roleLabel}
          </Badge>

          <div className="ml-auto flex items-center gap-1.5">
            {/* Hidden below sm: at 375 px the header row has no spare width, and
                the account menu carries the same control on every screen size. */}
            <ThemeToggle className="hidden sm:inline-flex" />
            <Popover open={bellOpen} onOpenChange={setBellOpen}>
              <PopoverTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon"
                    className="relative"
                    aria-label={`Notifications, ${unreadCount} unread`}
                  />
                }
              >
                  <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={1.8}>
                    <path d="M6 8a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z" />
                    <path d="M10 18a2 2 0 0 0 4 0" strokeLinecap="round" />
                  </svg>
                  {unreadCount > 0 ? (
                    <span className="absolute right-1 top-1 grid min-w-4 place-items-center rounded-full bg-brand-600 px-1 text-[10px] font-semibold leading-4 text-primary-foreground">
                      {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                  ) : null}
              </PopoverTrigger>
              <PopoverContent align="end" className="w-[min(92vw,22rem)] p-0">
                <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
                  <p className="text-sm font-medium">Notifications</p>
                  {unreadCount > 0 ? (
                    <form action={markAllNotificationsReadAction}>
                      <Button type="submit" variant="ghost" size="sm" className="h-7 text-xs">
                        Mark all read
                      </Button>
                    </form>
                  ) : null}
                </div>
                <ScrollArea className="max-h-80">
                  <ul className="divide-y divide-border/70">
                    {notifications.length === 0 ? (
                      <li className="px-4 py-6 text-center text-sm text-muted-foreground">
                        Nothing yet. Updates about your profile, matches and applications appear here.
                      </li>
                    ) : null}
                    {notifications.map((notification) => (
                      <li key={notification.id} className="px-4 py-3">
                        <form
                          action={markNotificationReadAction.bind(null, notification.id)}
                          className="flex flex-col gap-1"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <p className={notification.readAt ? 'text-sm text-muted-foreground' : 'text-sm font-medium'}>
                              {notification.title}
                            </p>
                            <StatusBadge value={notification.type} label={enumLabel(notification.type)} />
                          </div>
                          <p className="text-xs leading-relaxed text-muted-foreground">{notification.body}</p>
                          <div className="mt-1 flex items-center justify-between gap-2">
                            <span className="text-[11px] text-muted-foreground">{relativeTime(notification.createdAt)}</span>
                            <span className="flex items-center gap-1">
                              {!notification.readAt ? (
                                <Button type="submit" variant="ghost" size="sm" className="h-6 px-2 text-[11px]">
                                  Mark read
                                </Button>
                              ) : null}
                              {notification.link ? (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 px-2 text-[11px]"
                                  nativeButton={false}
                                  render={<Link href={notification.link} onClick={() => setBellOpen(false)} />}
                                >
                                  Open
                                </Button>
                              ) : null}
                            </span>
                          </div>
                        </form>
                      </li>
                    ))}
                  </ul>
                </ScrollArea>
                <Separator />
                <div className="px-4 py-2.5">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full justify-start text-xs"
                    nativeButton={false}
                    render={<Link href={notificationsHref} onClick={() => setBellOpen(false)} />}
                  >
                    <Search className="size-3.5" aria-hidden />
                    All notifications
                  </Button>
                </div>
              </PopoverContent>
            </Popover>

            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="ghost" className="h-9 gap-2 px-2" />}>
                  <span className="grid size-7 place-items-center rounded-full bg-brand-100 text-xs font-semibold text-brand-800">
                    {name.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="hidden max-w-[9rem] truncate text-sm font-medium sm:inline">{name}</span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-72">
                <DropdownMenuLabel className="font-normal">
                  <p className="truncate text-sm font-medium">{name}</p>
                  <p className="truncate text-xs text-muted-foreground">{email}</p>
                  {organizationName ? (
                    <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                      {organizationName}
                      {organizationVerification ? (
                        <StatusBadge value={organizationVerification} label={enumLabel(organizationVerification)} />
                      ) : null}
                    </p>
                  ) : null}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem render={<Link href={notificationsHref} />}>Notifications</DropdownMenuItem>
                <DropdownMenuSeparator />
                <ThemeMenuGroup />
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => void logoutAction()}>
                  <LogOut className="size-4" aria-hidden />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      <div className="flex flex-1">
        <aside className="sticky top-14 hidden h-[calc(100dvh-3.5rem)] w-60 shrink-0 border-r border-border/70 bg-muted/25 lg:block">
          {sidebar}
        </aside>

        <main id="main" className="min-w-0 flex-1">
          {organizationVerification && organizationVerification !== 'VERIFIED' ? (
            <div className="border-b border-amber-200 bg-amber-50 px-4 py-2.5 sm:px-6">
              <p className="flex items-center gap-2 text-xs leading-relaxed text-amber-900">
                <TriangleAlert className="size-4 shrink-0" aria-hidden />
                {organizationName} is {organizationVerification.toLowerCase().replace('_', ' ')}. Draft roles can be
                prepared now, but they only reach candidates after an administrator verifies the organisation.
              </p>
            </div>
          ) : null}

          <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</div>
        </main>
      </div>

      {assistant}
    </div>
  )
}
