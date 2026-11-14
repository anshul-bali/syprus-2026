'use client'

import { useMemo, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  PROFICIENCY_LEVELS,
  REQUIREMENT_LEVELS,
  label as enumLabel,
  optionsFor,
  type ProficiencyLevel,
  type RequirementLevel,
} from '@/lib/options'
import type { CatalogSkill } from '@/lib/engines/types'

/**
 * Repeating skill rows for a role. The rows are held in client state and
 * serialised into one hidden `skills` field, which `jobSchema` parses and
 * validates again on the server (`src/server/actions/employer.ts`).
 */

export type JobSkillDraft = {
  skillSlug: string
  skillName: string
  level: ProficiencyLevel
  weight: number
  requirement: RequirementLevel
}

const LEVEL_ITEMS = optionsFor(PROFICIENCY_LEVELS)
const REQUIREMENT_ITEMS = optionsFor(REQUIREMENT_LEVELS)
const WEIGHT_ITEMS = [1, 2, 3, 4, 5].map((value) => ({
  value: String(value),
  label: `${value} · ${value <= 2 ? 'low' : value === 3 ? 'medium' : 'high'} weight`,
}))

export function JobSkillsEditor({
  catalog,
  initial = [],
  name = 'skills',
  idPrefix = 'job-skill',
}: {
  catalog: CatalogSkill[]
  initial?: JobSkillDraft[]
  name?: string
  idPrefix?: string
}) {
  const [rows, setRows] = useState<JobSkillDraft[]>(initial)
  const [query, setQuery] = useState('')

  const chosen = useMemo(() => new Set(rows.map((row) => row.skillSlug)), [rows])
  const term = query.trim().toLowerCase()

  const matches = useMemo(() => {
    if (!term) return []
    return catalog
      .filter(
        (skill) =>
          !chosen.has(skill.slug) &&
          (skill.name.toLowerCase().includes(term) ||
            skill.slug.includes(term) ||
            skill.aliases.some((alias) => alias.toLowerCase().includes(term))),
      )
      .slice(0, 8)
  }, [catalog, chosen, term])

  const requiredCount = rows.filter((row) => row.requirement === 'REQUIRED').length
  const preferredCount = rows.length - requiredCount

  const payload = JSON.stringify(
    rows.map((row) => ({
      skillSlug: row.skillSlug,
      level: row.level,
      weight: row.weight,
      requirement: row.requirement,
    })),
  )

  function add(skill: CatalogSkill) {
    setRows((current) => [
      ...current,
      { skillSlug: skill.slug, skillName: skill.name, level: 'PROFICIENT', weight: 3, requirement: 'REQUIRED' },
    ])
    setQuery('')
  }

  function patch(slug: string, changes: Partial<JobSkillDraft>) {
    setRows((current) => current.map((row) => (row.skillSlug === slug ? { ...row, ...changes } : row)))
  }

  function remove(slug: string) {
    setRows((current) => current.filter((row) => row.skillSlug !== slug))
  }

  return (
    <div className="space-y-3 rounded-lg border border-border/70 bg-muted/20 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-sm font-medium">Required and preferred skills</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Each row becomes one weighted input for the matching model. Skills must exist in the SYPRUS catalogue.
          </p>
        </div>
        <p aria-live="polite" className="text-xs font-medium text-muted-foreground">
          {rows.length} skill{rows.length === 1 ? '' : 's'} · {requiredCount} required · {preferredCount} preferred
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
        <div>
          <Label htmlFor={`${idPrefix}-search`}>Search the skill catalogue</Label>
          <Input
            id={`${idPrefix}-search`}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Start typing, e.g. excel, stakeholder, scheduling"
            autoComplete="off"
            className="mt-1.5"
          />
        </div>
        <p className="text-xs text-muted-foreground sm:pb-2">Pick one or more skills below.</p>
      </div>

      {term ? (
        matches.length === 0 ? (
          <p role="status" className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
            No catalogue skill matches “{query}”. Ask an administrator to add it, or search by another word.
          </p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {matches.map((skill) => (
              <li key={skill.slug}>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => add(skill)}
                  aria-label={`Add ${skill.name} to the role`}
                >
                  <Plus className="size-3.5" aria-hidden />
                  {skill.name}
                  <span className="text-muted-foreground">· {enumLabel(skill.category)}</span>
                </Button>
              </li>
            ))}
          </ul>
        )
      ) : null}

      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
          No skills added yet. A role needs at least one skill before it can be matched to a candidate.
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <li
              key={row.skillSlug}
              className="grid gap-2 rounded-lg border border-border/70 bg-background p-2.5 sm:grid-cols-[minmax(0,1fr)_7.5rem_8.5rem_8.5rem_auto] sm:items-center"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{row.skillName}</p>
                <p className="truncate text-[11px] text-muted-foreground">{row.skillSlug}</p>
              </div>

              <Select
                aria-label={`Requirement for ${row.skillName}`}
                items={REQUIREMENT_ITEMS}
                value={row.requirement}
                onValueChange={(value) => patch(row.skillSlug, { requirement: (value ?? 'REQUIRED') as RequirementLevel })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REQUIREMENT_ITEMS.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                aria-label={`Level needed in ${row.skillName}`}
                items={LEVEL_ITEMS}
                value={row.level}
                onValueChange={(value) => patch(row.skillSlug, { level: (value ?? 'PROFICIENT') as ProficiencyLevel })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LEVEL_ITEMS.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                aria-label={`Weight for ${row.skillName}`}
                items={WEIGHT_ITEMS}
                value={String(row.weight)}
                onValueChange={(value) =>
                  patch(row.skillSlug, { weight: Math.min(5, Math.max(1, Number(value) || 1)) })
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WEIGHT_ITEMS.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => remove(row.skillSlug)}
                aria-label={`Remove ${row.skillName} from the role`}
              >
                <X className="size-4" aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <input type="hidden" name={name} value={payload} readOnly />
    </div>
  )
}
