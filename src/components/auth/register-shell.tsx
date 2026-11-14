'use client'

import { useState } from 'react'
import { RegisterForm } from '@/components/auth/register-form'
import { AuthPanel } from '@/components/media/auth-panel'

const PANELS = {
  candidate: {
    image: 'candidate-new-chapter' as const,
    title: 'Start from what you actually did',
    points: [
      'Eight predefined questions, answered in your own words — no résumé required.',
      'Skill suggestions quote your wording back to you, and you accept or remove each one.',
      'Break length and reason are stored for your records and are never inputs to matching.',
    ],
  },
  employer: {
    image: 'employer-building-team' as const,
    title: 'Define the skill before you write the advert',
    points: [
      'Required and preferred skills carry levels and weights; those weights are what scoring uses.',
      'A new organisation stays pending until an administrator verifies it.',
      'First-stage review shows handles, skills and durations — not names.',
    ],
  },
}

/**
 * The register screen keeps the form primary; the side panel follows whichever
 * role tab is selected, and disappears entirely below `lg`.
 */
export function RegisterShell({
  defaultRole,
  waived = false,
}: {
  defaultRole: 'candidate' | 'employer'
  waived?: boolean
}) {
  const [role, setRole] = useState<'candidate' | 'employer'>(defaultRole)
  const panel = PANELS[role]

  return (
    <div className="flex w-full flex-col items-center justify-center gap-8 md:flex-row md:gap-10">
      <AuthPanel image={panel.image} title={panel.title} points={panel.points} />
      <RegisterForm defaultRole={defaultRole} onRoleChange={setRole} waived={waived} />
    </div>
  )
}
