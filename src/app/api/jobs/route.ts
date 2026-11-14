import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getPrincipal } from '@/lib/authz'
import { publishedJobs } from '@/server/jobs'
import { fieldErrorsFrom } from '@/lib/validation'
import { EMPLOYMENT_TYPES, WORK_MODES } from '@/lib/options'

const searchSchema = z.object({
  search: z.string().trim().max(120).optional(),
  workMode: z.enum(WORK_MODES).optional(),
  employmentType: z.enum(EMPLOYMENT_TYPES).optional(),
  take: z.coerce.number().int().min(1).max(50).default(20),
})

/**
 * Read-only listing API used by the candidate role browser.
 * Requires a signed-in session and returns only published roles from verified
 * organisations, with no applicant or candidate data.
 */
export async function GET(request: Request) {
  const principal = await getPrincipal()
  if (!principal) {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 })
  }

  const params = new URL(request.url).searchParams
  const parsed = searchSchema.safeParse({
    search: params.get('search') ?? undefined,
    workMode: params.get('workMode') ?? undefined,
    employmentType: params.get('employmentType') ?? undefined,
    take: params.get('take') ?? undefined,
  })

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid query.', fieldErrors: fieldErrorsFrom(parsed.error) },
      { status: 400 },
    )
  }

  const jobs = await publishedJobs({
    search: parsed.data.search,
    workMode: parsed.data.workMode,
    employmentType: parsed.data.employmentType,
    take: parsed.data.take,
  })

  return NextResponse.json({
    count: jobs.length,
    jobs: jobs.map((job) => ({
      id: job.id,
      title: job.title,
      organization: job.organization.name,
      locationCity: job.locationCity,
      workMode: job.workMode,
      employmentType: job.employmentType,
      salaryMin: job.salaryMin,
      salaryMax: job.salaryMax,
      currency: job.currency,
      reEntryFriendly: job.reEntryFriendly,
      flexibleHours: job.flexibleHours,
      returnshipProgram: job.returnshipProgram,
      postedAt: job.postedAt,
      skills: job.skills.map((row) => ({
        name: row.skill.name,
        slug: row.skill.slug,
        requirement: row.requirement,
        level: row.level,
      })),
    })),
  })
}
