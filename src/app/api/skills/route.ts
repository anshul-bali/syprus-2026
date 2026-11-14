import { NextResponse } from 'next/server'
import { getPrincipal } from '@/lib/authz'
import { loadCatalogSkills } from '@/server/skill-catalog'

/**
 * Skill catalogue for the client-side skill pickers. Any signed-in role may
 * read it — it is reference data, not personal data.
 */
export async function GET() {
  const principal = await getPrincipal()
  if (!principal) {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 })
  }

  const skills = await loadCatalogSkills()
  return NextResponse.json({
    count: skills.length,
    skills: skills.map((skill) => ({
      slug: skill.slug,
      name: skill.name,
      category: skill.category,
      transferable: skill.transferable,
    })),
  })
}
