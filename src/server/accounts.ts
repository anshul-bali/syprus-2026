import type { OrganizationVerification, Prisma } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/db'
import { AccessDeniedError, assertPermission, type Principal } from '@/lib/authz'
import { nullableString } from '@/server/fields'
import { recordAudit } from '@/server/audit'
import { notifyOrganization, notifyUser } from '@/server/notifications'
import { policyVersion } from '@/lib/env'
import { anonymousHandle, slugify } from '@/lib/utils'
import type { z } from 'zod'
import type {
  candidateSignupSchema,
  employerSignupSchema,
  organizationSchema,
  orgVerificationSchema,
  userStatusSchema,
} from '@/lib/validation'

type EmployerSignup = z.infer<typeof employerSignupSchema>
type CandidateSignup = z.infer<typeof candidateSignupSchema>
type OrgDto = z.infer<typeof organizationSchema>
type VerificationDto = z.infer<typeof orgVerificationSchema>
type UserStatusDto = z.infer<typeof userStatusSchema>

const BCRYPT_ROUNDS = 12

/**
 * Account creation. Passwords are hashed here and never stored or returned in
 * plaintext. Each registration writes the mandatory data-processing consent in
 * the same transaction as the account, so no record exists without a basis for
 * processing it.
 */
export async function registerCandidate(input: CandidateSignup) {
  const email = input.email.toLowerCase()
  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } })
  if (existing) {
    throw new AccessDeniedError('An account already exists for this email address.')
  }

  const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS)

  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: { email, name: input.name.trim(), role: 'CANDIDATE', passwordHash, status: 'ACTIVE' },
    })

    await tx.candidateProfile.create({
      data: {
        userId: created.id,
        anonymousHandle: anonymousHandle(created.id),
        sharingMode: 'NOT_VISIBLE',
        visibleToEmployers: false,
      },
    })

    await tx.consentRecord.create({
      data: {
        userId: created.id,
        type: 'DATA_PROCESSING',
        decision: 'GRANTED',
        policyVersion: policyVersion(),
      },
    })

    return created
  })

  await notifyUser(user.id, {
    type: 'ADMIN_NOTICE',
    title: 'Welcome to SYPRUS',
    body: 'Start the conversational onboarding to build your skills inventory. Nothing reaches an employer until you choose to share it.',
    link: '/candidate/onboarding',
  })

  await recordAudit({
    actor: null,
    action: 'auth.register.candidate',
    entityType: 'users',
    entityId: user.id,
    targetUserId: user.id,
    metadata: { email },
  })

  return user
}

export async function registerEmployer(input: EmployerSignup) {
  const email = input.email.toLowerCase()
  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } })
  if (existing) {
    throw new AccessDeniedError('An account already exists for this email address.')
  }

  const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS)

  const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const user = await tx.user.create({
      data: { email, name: input.name.trim(), role: 'EMPLOYER', passwordHash, status: 'ACTIVE' },
    })

    const organization = await tx.organization.create({
      data: {
        name: input.organizationName.trim(),
        slug: await uniqueOrgSlug(tx, slugify(input.organizationName)),
        website: nullableString(input.website),
        industry: nullableString(input.industry),
        sizeLabel: nullableString(input.sizeLabel),
        locationCity: nullableString(input.locationCity),
        locationCountry: nullableString(input.locationCountry),
        ownerUserId: user.id,
        verificationStatus: 'PENDING',
      },
    })

    return { user, organization }
  })

  await notifyOrganization(result.organization.id, {
    type: 'VERIFICATION_UPDATE',
    title: 'Organisation created, verification pending',
    body: `${result.organization.name} can draft roles now. Roles reach candidates only after an administrator verifies the organisation.`,
    link: '/employer/profile',
  })

  await recordAudit({
    actor: null,
    action: 'auth.register.employer',
    entityType: 'organizations',
    entityId: result.organization.id,
    targetUserId: result.user.id,
    organizationId: result.organization.id,
    metadata: { name: result.organization.name, verification: 'PENDING' },
  })

  return result
}

/** Finds an unused URL slug without exposing organisation names to guesswork. */
async function uniqueOrgSlug(tx: Prisma.TransactionClient, base: string) {
  const cleaned = base || 'organisation'
  let candidate = cleaned
  let suffix = 2
  // Slug is unique in the database, so the collision loop terminates quickly.
  while (await tx.organization.findUnique({ where: { slug: candidate }, select: { id: true } })) {
    candidate = `${cleaned}-${suffix}`
    suffix += 1
    if (suffix > 50) throw new AccessDeniedError('Could not derive a unique organisation slug. Rename and retry.')
  }
  return candidate
}

export async function getOrganization(principal: Principal) {
  assertPermission(principal, 'employer.org.read')
  if (!principal.organizationId) throw new AccessDeniedError('No organisation attached to this account.')

  return prisma.organization.findUniqueOrThrow({
    where: { id: principal.organizationId },
    include: {
      owner: { select: { name: true, email: true } },
      members: { select: { id: true, name: true, email: true, lastLoginAt: true } },
      _count: { select: { jobs: true, applications: true } },
    },
  })
}

export async function updateOrganization(principal: Principal, dto: OrgDto) {
  assertPermission(principal, 'employer.org.update')
  if (!principal.organizationId) throw new AccessDeniedError('No organisation attached to this account.')

  const organization = await prisma.organization.update({
    where: { id: principal.organizationId },
    data: {
      name: dto.name.trim(),
      website: nullableString(dto.website),
      industry: nullableString(dto.industry),
      sizeLabel: nullableString(dto.sizeLabel),
      locationCity: nullableString(dto.locationCity),
      locationCountry: nullableString(dto.locationCountry),
      description: nullableString(dto.description),
      flexPolicy: nullableString(dto.flexPolicy),
      returnshipNote: nullableString(dto.returnshipNote),
    },
  })

  await recordAudit({
    actor: principal,
    action: 'employer.org.update',
    entityType: 'organizations',
    entityId: organization.id,
    organizationId: organization.id,
  })

  return organization
}

/** Administrator decision on employer verification. */
export async function setOrganizationVerification(principal: Principal, dto: VerificationDto) {
  assertPermission(principal, 'admin.org.verify')

  const organization = await prisma.organization.findUnique({
    where: { id: dto.organizationId },
    include: { jobs: { select: { id: true, status: true } } },
  })
  if (!organization) throw new AccessDeniedError('Organisation not found.')

  const decision = dto.decision

  await prisma.organization.update({
    where: { id: organization.id },
    data: {
      verificationStatus: decision,
      verifiedAt: decision === 'VERIFIED' ? new Date() : null,
      verifiedById: principal.userId,
      verificationNote: dto.note.trim(),
    },
  })

  // Rejection or a return to pending unpublishes the organisation's live roles.
  if (decision !== 'VERIFIED') {
    await prisma.job.updateMany({
      where: { organizationId: organization.id, status: 'PUBLISHED' },
      data: { status: 'PAUSED' },
    })
  }

  await notifyOrganization(organization.id, {
    type: 'VERIFICATION_UPDATE',
    title: `Verification ${decision.toLowerCase()}`,
    body: `${organization.name}: ${dto.note}`,
    link: '/employer/profile',
  })

  await recordAudit({
    actor: principal,
    action: `admin.org.${decision.toLowerCase()}`,
    entityType: 'organizations',
    entityId: organization.id,
    organizationId: organization.id,
    metadata: { note: dto.note, jobsAffected: organization.jobs.length },
  })

  return organization
}

export async function listOrganizations(principal: Principal, filter: { status?: OrganizationVerification } = {}) {
  assertPermission(principal, 'admin.org.read')
  return prisma.organization.findMany({
    where: filter.status ? { verificationStatus: filter.status } : {},
    orderBy: [{ verificationStatus: 'asc' }, { createdAt: 'desc' }],
    include: {
      owner: { select: { id: true, name: true, email: true, status: true } },
      _count: { select: { jobs: true, applications: true, members: true } },
    },
  })
}

export async function setUserStatus(principal: Principal, dto: UserStatusDto) {
  assertPermission(principal, 'admin.user.update')
  if (dto.userId === principal.userId) {
    throw new AccessDeniedError('You cannot change the status of your own account.')
  }

  const target = await prisma.user.findUnique({
    where: { id: dto.userId },
    select: {
      id: true,
      name: true,
      role: true,
      status: true,
      ownedOrganization: { select: { id: true } },
    },
  })
  if (!target) throw new AccessDeniedError('User not found.')

  const updated = await prisma.user.update({
    where: { id: dto.userId },
    data: { status: dto.status },
  })

  if (target.ownedOrganization && dto.status === 'SUSPENDED') {
    await prisma.job.updateMany({
      where: { organizationId: target.ownedOrganization.id, status: 'PUBLISHED' },
      data: { status: 'PAUSED' },
    })
  }

  await notifyUser(dto.userId, {
    type: 'ADMIN_NOTICE',
    title: `Account status: ${dto.status.toLowerCase().replace('_', ' ')}`,
    body: dto.reason ?? 'An administrator updated your account status.',
    link: '/',
  })

  await recordAudit({
    actor: principal,
    action: 'admin.user.status',
    entityType: 'users',
    entityId: dto.userId,
    targetUserId: dto.userId,
    metadata: { from: target.status, to: dto.status, reason: dto.reason },
  })

  return updated
}
