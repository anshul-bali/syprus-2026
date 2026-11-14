'use client'

import { ThemeProvider as NextThemesProvider } from 'next-themes'

/**
 * One provider for the whole app: the public site and all three portals share a
 * theme, stored in `localStorage` under one key and defaulting to the operating
 * system. `class` is what the stylesheet reads, so nothing else has to know
 * that next-themes is behind it.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      {children}
    </NextThemesProvider>
  )
}
