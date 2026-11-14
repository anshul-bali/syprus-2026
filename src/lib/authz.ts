import { cache } from 'react'
import { redirect } from 'next/navigation'
import type { AccountStatus, OrganizationVerification, UserRole } from '@prisma/client'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { waivedFor } from '@/lib/demo-waiver'
import type { PermissionId, RoleName } from '@/lib/permissions'

export type Principal = {
  userId: string
  email: string
  name: string
  role: UserRole
  status: AccountStatus
  organizationId: string | null
  organizationName: string | null
  organizationVerification: OrganizationVerification | null
  candidateProfileId: string | null
  permissions: PermissionId[]
}

/**
 * Resolves the signed-in principal from PostgreSQL for the current request.
 *
 * The JWT only proves identity; role, account status, organisation membership
 * and permissions are read fresh each time, so a suspension or role change is
 * effective on the next page load. An address that has never been confirmed
 * yields no principal either — a session should be impossible without a redeemed
 * code (see `src/lib/auth.ts`), and this catches an account whose confirmation
 * was withdrawn behind one.
 * Wrapped in `cache` so a render pass performs at most one lookup.
 */
export const getPrincipal = cache(async (): Promise<Principal | null> => {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return null

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      status: true,
      emailVerifiedAt: true,
      candidateProfile: { select: { id: true } },
      ownedOrganization: { select: { id: true, name: true, verificationStatus: true } },
      memberships: { select: { id: true, name: true, verificationStatus: true } },
    },
  })

  if (!user) return null
  if (user.status !== 'ACTIVE') return null
  // An unconfirmed address has no portal. The demonstration waiver is the one
  // case that reaches here without a redemption, and it cannot touch an address
  // that could receive a code.
  if (!user.emailVerifiedAt && !waivedFor(user.email)) return null

  const roleRow = await prisma.roleDefinition.findUnique({
    where: { role: user.role },
    include: { permissions: true },
  })

  if (!roleRow || roleRow.permissions.length === 0) {
    throw new Error(
      `Role catalogue is empty for ${user.role}. Ask an administrator to provision role permissions; do not run the destructive demo seed on a populated database.`,
    )
  }

  const organisation = user.ownedOrganization ?? user.memberships[0] ?? null

  return {
    userId: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    status: user.status,
    organizationId: organisation?.id ?? null,
    organizationName: organisation?.name ?? null,
    organizationVerification: organisation?.verificationStatus ?? null,
    candidateProfileId: user.candidateProfile?.id ?? null,
    permissions: roleRow.permissions.map((permission) => permission.key as PermissionId),
  }
})

/**
 * Lightweight session lookup for marketing pages: identity and role only, with
 * no dependency on the permission catalogue, so the public site still renders
 * before the roles tables have been seeded.
 */
export const getPublicViewer = cache(async (): Promise<{ name: string; role: UserRole } | null> => {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return null
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, role: true, status: true },
  })
  if (!user || user.status !== 'ACTIVE') return null
  return { name: user.name, role: user.role }
})

export function can(principal: Principal | null, permission: PermissionId) {
  return Boolean(principal?.permissions.includes(permission))
}

/** Redirects to the login screen when there is no valid session. */
export async function requirePrincipal(): Promise<Principal> {
  const principal = await getPrincipal()
  if (!principal) redirect('/login')
  return principal
}

/**
 * Redirects a correctly signed-in user who has the wrong role to an
 * explanatory screen rather than silently showing another portal.
 */
export async function requireRole(role: RoleName): Promise<Principal> {
  const principal = await requirePrincipal()
  if (principal.role !== role) {
    redirect(`/no-access?expected=${role}&found=${principal.role}`)
  }
  return principal
}

export async function requirePermission(permission: PermissionId): Promise<Principal> {
  const principal = await requirePrincipal()
  if (!principal.permissions.includes(permission)) {
    redirect(`/no-access?needed=${encodeURIComponent(permission)}`)
  }
  return principal
}

/** Throws unless the principal is the owner of the given candidate profile. */
export async function requireOwnProfile(candidateProfileId: string): Promise<Principal> {
  const principal = await requirePermission('candidate.profile.read')
  if (principal.candidateProfileId !== candidateProfileId) {
    throw new AccessDeniedError('Candidate profiles are only readable by their owner.')
  }
  return principal
}

/** Loads a job and asserts it belongs to the employer's organisation. */
export async function requireOrgJob(jobId: string, permission: PermissionId) {
  const principal = await requirePermission(permission)
  if (!principal.organizationId) {
    throw new AccessDeniedError('No organisation is attached to this account.')
  }
  const job = await prisma.job.findFirst({
    where: { id: jobId, organizationId: principal.organizationId },
  })
  if (!job) throw new AccessDeniedError('This role belongs to another organisation.')
  return { principal, job }
}

/** Loads an application and asserts it belongs to the employer's organisation. */
export async function requireOrgApplication(applicationId: string, permission: PermissionId) {
  const principal = await requirePermission(permission)
  if (!principal.organizationId) {
    throw new AccessDeniedError('No organisation is attached to this account.')
  }
  const application = await prisma.application.findFirst({
    where: { id: applicationId, organizationId: principal.organizationId },
    include: { job: true, candidateProfile: true },
  })
  if (!application) throw new AccessDeniedError('This application belongs to another organisation.')
  return { principal, application }
}

/** Thrown by mutations that fail an ownership or permission test. */
export class AccessDeniedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AccessDeniedError'
  }
}

/**
 * Non-redirecting guard for server functions: throws so the caller can show the
 * reason inline instead of navigating mid-mutation.
 */
export function assertPermission(
  principal: Principal | null,
  permission: PermissionId,
): asserts principal is Principal {
  if (!principal) throw new AccessDeniedError('Your session has ended. Sign in again to continue.')
  if (!principal.permissions.includes(permission)) {
    throw new AccessDeniedError(`This action needs the "${permission}" permission, which your role does not hold.`)
  }
}

export function assertRole(principal: Principal | null, role: RoleName): asserts principal is Principal {
  if (!principal) throw new AccessDeniedError('Your session has ended. Sign in again to continue.')
  if (principal.role !== role) {
    throw new AccessDeniedError(`This action is limited to ${role.toLowerCase()} accounts.`)
  }
}

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string> }

export function fail(error: string, fieldErrors?: Record<string, string>): ActionResult<never> {
  return { ok: false, error, fieldErrors }
}

export function succeed<T>(data: T): ActionResult<T> {
  return { ok: true, data }
}
