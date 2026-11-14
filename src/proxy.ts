import { NextResponse, type NextRequest } from 'next/server'
import { getToken } from '@auth/core/jwt'

// Next 16 replaced `middleware.ts` with `proxy.ts`. Proxy already runs on the
// Node.js runtime, so no `runtime` export is allowed here (setting it throws).

const SESSION_COOKIES = ['__Secure-authjs.session-token', 'authjs.session-token'] as const

const PROTECTED_PREFIXES = [
  { prefix: '/candidate', role: 'CANDIDATE' },
  { prefix: '/employer', role: 'EMPLOYER' },
  { prefix: '/admin', role: 'ADMIN' },
] as const

async function readToken(request: NextRequest) {
  const secret = process.env.AUTH_SECRET
  if (!secret) return null

  for (const name of SESSION_COOKIES) {
    const payload = await getToken({ req: request, secret, cookieName: name, salt: name })
    if (payload) return payload
  }
  return null
}

/**
 * Fast-path redirect only. Every portal layout and server function re-checks the
 * session against PostgreSQL, so this layer can never widen access — Proxy also
 * sees POSTs to page routes, which is where server functions are sent.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const rule = PROTECTED_PREFIXES.find((entry) => pathname.startsWith(entry.prefix))
  if (!rule) return NextResponse.next()

  const token = await readToken(request)

  if (!token?.userId) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('next', pathname)
    return NextResponse.redirect(loginUrl)
  }

  if (token.role && token.role !== rule.role) {
    const deniedUrl = new URL('/no-access', request.url)
    deniedUrl.searchParams.set('expected', rule.role)
    deniedUrl.searchParams.set('found', String(token.role))
    return NextResponse.redirect(deniedUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/candidate/:path*', '/employer/:path*', '/admin/:path*'],
}
