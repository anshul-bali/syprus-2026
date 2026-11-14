import { createHash, randomUUID } from 'node:crypto'
import { mkdir, writeFile, readFile, unlink, stat } from 'node:fs/promises'
import path from 'node:path'
import { prisma } from '@/lib/db'
import { AccessDeniedError, assertPermission, type Principal } from '@/lib/authz'
import { recordAudit } from '@/server/audit'
import { notifyUser } from '@/server/notifications'
import { nullableString } from '@/server/fields'
import { refreshEvidenceCount } from '@/server/candidate'
import { computeMatchesForProfile } from '@/server/matching'

/**
 * Evidence uploads supporting a skill claim.
 *
 * Files are stored outside the web root under a generated key; the original
 * filename is kept only as display text and is never used to build a path.
 * Downloads go through this module so ownership and status are checked every
 * time. Accepted evidence still does not make a claim "verified by SYPRUS":
 * it means a reviewer looked at the document the candidate supplied.
 */

/**
 * `UPLOAD_STORAGE_DIR` picks a sub-folder of `storage/`; separators are stripped
 * so the value can never point outside it, and the join stays statically scoped to
 * `storage` for the bundler's filesystem tracing.
 */
const STORAGE_SUBDIR = (process.env.UPLOAD_STORAGE_DIR ?? 'uploads').replace(/[^a-z0-9._-]/gi, '') || 'uploads'
const STORAGE_DIR = path.join(process.cwd(), 'storage', STORAGE_SUBDIR)
const MAX_BYTES = 5 * 1024 * 1024

const ALLOWED: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
}

export type UploadReceipt = {
  id: string
  filename: string
  mimeType: string
  sizeBytes: number
  sha256: string
  status: string
  createdAt: Date
  candidateSkillId: string | null
}

function extensionFor(mimeType: string) {
  return ALLOWED[mimeType.toLowerCase()] ?? null
}

/** Writes the bytes and the metadata row together; a failed write leaves no row. */
export async function saveEvidenceUpload(
  principal: Principal,
  input: {
    candidateSkillId?: string | null
    filename: string
    mimeType: string
    bytes: Uint8Array
  },
): Promise<UploadReceipt> {
  assertPermission(principal, 'candidate.skills.manage')
  const profileId = principal.candidateProfileId
  if (!profileId) throw new AccessDeniedError('No candidate profile attached to this account.')

  const extension = extensionFor(input.mimeType)
  if (!extension) {
    throw new AccessDeniedError('Upload a PDF, PNG, JPEG or WebP file. Other formats are not accepted.')
  }
  if (input.bytes.byteLength === 0) throw new AccessDeniedError('The uploaded file is empty.')
  if (input.bytes.byteLength > MAX_BYTES) {
    throw new AccessDeniedError(`Files must be ${MAX_BYTES / 1024 / 1024} MB or smaller.`)
  }

  const bytes = Buffer.from(input.bytes)
  const matchesType = input.mimeType === 'application/pdf' ? bytes.subarray(0, 5).toString() === '%PDF-'
    : input.mimeType === 'image/png' ? bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a'
    : input.mimeType === 'image/jpeg' ? bytes.subarray(0, 3).toString('hex') === 'ffd8ff'
    : bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP'
  if (!matchesType) throw new AccessDeniedError('File contents do not match the declared PDF or image type.')

  if (input.candidateSkillId) {
    const owned = await prisma.candidateSkill.findFirst({
      where: { id: input.candidateSkillId, candidateProfileId: profileId },
    })
    if (!owned) throw new AccessDeniedError('That skill is not on your profile.')
  }

  const storedKey = `${randomUUID()}.${extension}`
  const sha256 = createHash('sha256').update(input.bytes).digest('hex')

  await mkdir(STORAGE_DIR, { recursive: true })
  await writeFile(path.join(STORAGE_DIR, storedKey), input.bytes, { flag: 'wx' })

  const row = await prisma.evidenceUpload.create({
    data: {
      candidateProfileId: profileId,
      candidateSkillId: input.candidateSkillId ?? null,
      uploadedById: principal.userId,
      // Display text only: strip anything path-shaped.
      filename: input.filename.replace(/[\\/]/g, '_').slice(0, 180),
      storedKey,
      mimeType: input.mimeType.toLowerCase(),
      sizeBytes: input.bytes.byteLength,
      sha256,
      status: 'PENDING',
    },
  })

  await recordAudit({
    actor: principal,
    action: 'ai.evidence.upload',
    entityType: 'evidence_uploads',
    entityId: row.id,
    metadata: { size: row.sizeBytes, sha256: row.sha256.slice(0, 12), skill: input.candidateSkillId ?? null },
  })

  return {
    id: row.id,
    filename: row.filename,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    sha256: row.sha256,
    status: row.status,
    createdAt: row.createdAt,
    candidateSkillId: row.candidateSkillId,
  }
}

export async function listUploads(principal: Principal, profileIdArg?: string) {
  const profileId = profileIdArg ?? principal.candidateProfileId
  if (!profileId) return []
  if (profileId !== principal.candidateProfileId && principal.role !== 'ADMIN') {
    throw new AccessDeniedError('Uploads are only readable by their owner or an administrator.')
  }

  return prisma.evidenceUpload.findMany({
    where: { candidateProfileId: profileId, status: { not: 'REMOVED' } },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      filename: true,
      mimeType: true,
      sizeBytes: true,
      sha256: true,
      status: true,
      reviewNote: true,
      createdAt: true,
      candidateSkillId: true,
    },
  })
}

type LoadedFile = { bytes: Buffer; filename: string; mimeType: string; sha256: string }

/**
 * The only path that reads bytes from disk. Verifies the stored checksum before
 * returning anything, so a corrupted or replaced file is refused.
 */
export async function readUploadForPrincipal(principal: Principal, uploadId: string): Promise<LoadedFile> {
  const row = await prisma.evidenceUpload.findUnique({ where: { id: uploadId } })
  if (!row || row.status === 'REMOVED') throw new AccessDeniedError('That document is not available.')

  const isOwner = row.candidateProfileId === principal.candidateProfileId
  if (!isOwner && !principal.permissions.includes('admin.user.update')) {
    throw new AccessDeniedError('Only the owner or an administrator can open this document.')
  }

  const absolute = path.join(STORAGE_DIR, path.basename(row.storedKey))
  if (!absolute.startsWith(STORAGE_DIR)) throw new AccessDeniedError('Stored file path was rejected.')

  let bytes: Buffer
  try {
    bytes = await readFile(absolute)
  } catch {
    throw new AccessDeniedError('The stored file could not be read. Ask an administrator to check storage.')
  }

  const digest = createHash('sha256').update(bytes).digest('hex')
  if (digest !== row.sha256) throw new AccessDeniedError('Stored file checksum did not match; the file was not served.')

  return { bytes, filename: row.filename, mimeType: row.mimeType, sha256: row.sha256 }
}

/** Reviewer decision on an upload; drives whether it supports a claim. */
export async function decideUpload(
  principal: Principal,
  input: { uploadId: string; decision: 'ACCEPTED' | 'REJECTED'; note: string },
) {
  assertPermission(principal, 'admin.user.update')
  if (!input.note || input.note.trim().length < 5) {
    throw new AccessDeniedError('Record a short reason for the decision.')
  }

  const row = await prisma.evidenceUpload.findUnique({ where: { id: input.uploadId } })
  if (!row || row.status === 'REMOVED') throw new AccessDeniedError('That document is not available.')

  const updated = await prisma.evidenceUpload.update({
    where: { id: row.id },
    data: {
      status: input.decision,
      reviewNote: nullableString(input.note),
      reviewedById: principal.userId,
      reviewedAt: new Date(),
    },
  })

  // A reviewer accepting a document is the only way a claim becomes
  // human-reviewed here; an assessment pass is stronger and is never downgraded.
  if (input.decision === 'ACCEPTED' && row.candidateSkillId) {
    const skill = await prisma.candidateSkill.findUnique({ where: { id: row.candidateSkillId } })
    if (skill) {
      if (skill.validationStatus !== 'ASSESSMENT_VERIFIED' && skill.validationStatus !== 'DISPUTED') {
        await prisma.candidateSkill.update({
          where: { id: skill.id },
          data: {
            validationStatus: 'HR_REVIEWED',
            confidence: Math.min(0.95, skill.confidence + 0.05),
          },
        })
      }
      await refreshEvidenceCount(skill.id)
    }
  }

  if (input.decision === 'REJECTED' && row.candidateSkillId) {
    await refreshEvidenceCount(row.candidateSkillId)
  }
  await computeMatchesForProfile(row.candidateProfileId)

  const owner = await prisma.candidateProfile.findUnique({
    where: { id: row.candidateProfileId },
    select: { userId: true },
  })
  if (owner) {
    await notifyUser(owner.userId, {
      type: 'ADMIN_NOTICE',
      title: input.decision === 'ACCEPTED' ? 'Evidence accepted' : 'Evidence not accepted',
      body: `“${row.filename}”: ${input.note}`,
      link: '/candidate/skills',
    })
  }

  await recordAudit({
    actor: principal,
    action: `ai.evidence.${input.decision.toLowerCase()}`,
    entityType: 'evidence_uploads',
    entityId: updated.id,
    targetUserId: owner?.userId ?? null,
    metadata: { note: input.note },
  })

  return updated
}

/** Owner-initiated removal: marks the row removed and deletes the bytes. */
export async function removeUpload(principal: Principal, uploadId: string) {
  assertPermission(principal, 'candidate.skills.manage')
  const profileId = principal.candidateProfileId
  if (!profileId) throw new AccessDeniedError('No candidate profile attached to this account.')

  const row = await prisma.evidenceUpload.findFirst({
    where: { id: uploadId, candidateProfileId: profileId },
  })
  if (!row) throw new AccessDeniedError('That document is not on your account.')

  try {
    const absolute = path.join(STORAGE_DIR, path.basename(row.storedKey))
    if (await exists(absolute)) await unlink(absolute)
  } catch {
    // A missing file still removes the record; storage state is reported below.
  }

  const updated = await prisma.evidenceUpload.update({ where: { id: row.id }, data: { status: 'REMOVED' } })
  if (row.candidateSkillId) {
    await refreshEvidenceCount(row.candidateSkillId)
    const remaining = await prisma.evidenceUpload.count({ where: { candidateSkillId: row.candidateSkillId, status: 'ACCEPTED' } })
    if (!remaining) await prisma.candidateSkill.updateMany({ where: { id: row.candidateSkillId, validationStatus: 'HR_REVIEWED' }, data: { validationStatus: 'SELF_REPORTED' } })
    await computeMatchesForProfile(profileId)
  }
  await recordAudit({
    actor: principal,
    action: 'ai.evidence.remove',
    entityType: 'evidence_uploads',
    entityId: row.id,
  })
  return updated
}

async function exists(file: string) {
  try {
    await stat(file)
    return true
  } catch {
    return false
  }
}

/** Pending queue for reviewers. */
export async function pendingUploadQueue(principal: Principal) {
  assertPermission(principal, 'admin.user.read')
  return prisma.evidenceUpload.findMany({
    where: { status: 'PENDING' },
    orderBy: { createdAt: 'asc' },
    take: 100,
    include: {
      candidateProfile: { select: { id: true, anonymousHandle: true } },
    },
  })
}
