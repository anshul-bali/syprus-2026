import type { UserRole } from '@prisma/client'
import type { DefaultSession } from 'next-auth'

declare module 'next-auth' {
  interface Session {
    user: {
      /** Identity only — always re-validated against PostgreSQL in `authz.ts`. */
      id: string
      role?: UserRole
    } & DefaultSession['user']
  }

  interface User {
    role?: UserRole
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    userId?: string
    role?: UserRole
  }
}
