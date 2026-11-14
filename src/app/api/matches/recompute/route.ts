import { NextResponse } from 'next/server'
import { z } from 'zod'
import { assertPermission, AccessDeniedError, getPrincipal } from '@/lib/authz'
import { computeMatchesForProfile, recomputeAllMatches } from '@/server/matching'
import { recordAudit } from '@/server/audit'
import { fieldErrorsFrom } from '@/lib/validation'

const bodySchema = z.object({
  candidateProfileId: z.string().min(1).optional(),
})

/**
 * Recomputes stored matches with the current rules model. Restricted to the
 * moderation permission, because publishing and unpublishing roles has the same
 * effect on the recommendation set.
 */
export async function POST(request: Request) {
  const principal = await getPrincipal()
  if (!principal) {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 })
  }

  try {
    assertPermission(principal, 'admin.job.moderate')
  } catch (error) {
    const message = error instanceof AccessDeniedError ? error.message : 'Not permitted.'
    return NextResponse.json({ error: message }, { status: 403 })
  }

  if (!request.headers.get('content-type')?.startsWith('application/json')) {
    return NextResponse.json({ error: 'Use application/json.' }, { status: 415 })
  }
  const origin = request.headers.get('origin')
  if (origin && origin !== new URL(request.url).origin) {
    return NextResponse.json({ error: 'Cross-origin mutation refused.' }, { status: 403 })
  }
  let body: unknown = {}
  try {
    const text = await request.text()
    body = text ? JSON.parse(text) : {}
  } catch {
    return NextResponse.json({ error: 'Request body must be JSON.' }, { status: 400 })
  }

  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request body.', fieldErrors: fieldErrorsFrom(parsed.error) },
      { status: 400 },
    )
  }

  const startedAt = Date.now()
  const result = parsed.data.candidateProfileId
    ? { scope: 'single', outcome: await computeMatchesForProfile(parsed.data.candidateProfileId) }
    : { scope: 'all', profilesProcessed: await recomputeAllMatches() }

  await recordAudit({
    actor: principal,
    action: 'admin.matches.recompute',
    entityType: 'matches',
    entityId: parsed.data.candidateProfileId ?? null,
    metadata: { ...result, durationMs: Date.now() - startedAt },
  })

  return NextResponse.json({ ok: true, ...result, durationMs: Date.now() - startedAt })
}
