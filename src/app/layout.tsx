import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'
import { Toaster } from '@/components/ui/sonner'
import { ThemeProvider } from '@/components/theme/provider'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
  display: 'swap',
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
  display: 'swap',
})

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'),
  title: {
    default: 'SYPRUS — Skills-first career re-entry',
    template: '%s · SYPRUS',
  },
  description:
    'SYPRUS helps women returning to work after a caregiving or career break surface transferable competencies, identify learning needs and get matched to employers on skills, not on gaps in a timeline.',
  keywords: [
    'career re-entry',
    'return to work',
    'skills-based hiring',
    'returnship',
    'transferable skills',
    'career break',
  ],
  openGraph: {
    title: 'SYPRUS — Skills-first career re-entry',
    description:
      'Discover transferable competencies, close skill gaps and match with employers on skills rather than career-gap screening.',
    type: 'website',
  },
}

/** Browser chrome follows the theme the page is actually drawn in. */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fcfdff' },
    { media: '(prefers-color-scheme: dark)', color: '#0f141d' },
  ],
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      data-scroll-behavior="smooth"
      className={`${geistSans.variable} ${geistMono.variable}`}
      suppressHydrationWarning
    >
      <body className="min-h-dvh bg-background text-foreground antialiased">
        <ThemeProvider>
          {/* Keyboard users can jump straight past navigation. */}
          <a
            href="#main"
            className="sr-only-focusable fixed left-4 top-4 z-100 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground focus:not-sr-only focus:static"
          >
            Skip to main content
          </a>
          {children}
          <Toaster position="top-right" richColors closeButton />
        </ThemeProvider>
      </body>
    </html>
  )
}
