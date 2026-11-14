'use client'

import { useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

/**
 * A public, self-contained toy of step 2. Everything below is invented for the
 * explanation: the skills, the roles and the weights are illustrative, nothing
 * is stored, nothing is sent anywhere, and no call is made to a model or to the
 * real scoring engine. The arithmetic is the same *shape* the platform uses —
 * weighted coverage of what a role asks for — so the number behaves the way a
 * real one does, without pretending to describe anybody.
 */
const SKILLS = [
  { slug: 'scheduling', name: 'Scheduling and coordination', why: 'keeping several moving parts in date order' },
  { slug: 'spreadsheets', name: 'Spreadsheets', why: 'rows, formulas, and checking a total adds up' },
  { slug: 'stakeholders', name: 'Stakeholder management', why: 'agreeing a date with people who do not report to you' },
  { slug: 'reporting', name: 'Writing a report', why: 'turning numbers into a page someone can act on' },
  { slug: 'records', name: 'Records management', why: 'a filing scheme someone else can follow' },
  { slug: 'crm', name: 'CRM software', why: 'cases, queues and notes in a shared system' },
  { slug: 'data-privacy', name: 'Data privacy', why: 'knowing what may be stored, and for how long' },
  { slug: 'budgets', name: 'Budget tracking', why: 'spend against an agreed line' },
] as const

const ROLES = [
  {
    id: 'coordinator',
    name: 'Operations coordinator',
    note: 'Illustrative role, invented for this demo.',
    asks: [
      { slug: 'scheduling', weight: 5, level: 'the level a role would need' },
      { slug: 'spreadsheets', weight: 4 },
      { slug: 'stakeholders', weight: 3 },
      { slug: 'reporting', weight: 2 },
    ],
  },
  {
    id: 'records',
    name: 'Records and data assistant',
    note: 'Illustrative role, invented for this demo.',
    asks: [
      { slug: 'records', weight: 5 },
      { slug: 'data-privacy', weight: 4 },
      { slug: 'spreadsheets', weight: 3 },
      { slug: 'crm', weight: 2 },
    ],
  },
  {
    id: 'campaign',
    name: 'Campaign reporting helper',
    note: 'Illustrative role, invented for this demo.',
    asks: [
      { slug: 'reporting', weight: 5 },
      { slug: 'spreadsheets', weight: 4 },
      { slug: 'crm', weight: 3 },
      { slug: 'budgets', weight: 2 },
    ],
  },
] as const

const ALL_SKILLS = new Map(SKILLS.map((skill) => [skill.slug, skill]))

export function SkillsDemo() {
  const [picked, setPicked] = useState<string[]>(['scheduling', 'spreadsheets'])
  const [roleId, setRoleId] = useState<string>(ROLES[0].id)

  const role = ROLES.find((entry) => entry.id === roleId) ?? ROLES[0]
  const covered = useMemo(
    () => role.asks.filter((ask) => picked.includes(ask.slug)),
    [picked, role],
  )
  const missing = useMemo(
    () => role.asks.filter((ask) => !picked.includes(ask.slug)),
    [picked, role],
  )
  const weightTotal = role.asks.reduce((total, ask) => total + ask.weight, 0)
  const weightCovered = covered.reduce((total, ask) => total + ask.weight, 0)
  const percent = weightTotal > 0 ? Math.round((weightCovered / weightTotal) * 100) : 0
  const unused = SKILLS.filter((skill) => !role.asks.some((ask) => ask.slug === skill.slug) && picked.includes(skill.slug))

  function toggle(slug: string) {
    setPicked((current) => (current.includes(slug) ? current.filter((entry) => entry !== slug) : [...current, slug]))
  }

  return (
    <Card className="border-brand-200 bg-card">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="text-base">Try the arithmetic yourself — on made-up data</CardTitle>
            <CardDescription className="mt-1 text-xs">
              Tick skills, pick an illustrative role, and watch weighted coverage move. These skills, roles and weights
              are invented for this demo. Nothing you choose here is stored, sent to a model, or used to score you
              anywhere on this site.
            </CardDescription>
          </div>
          <Badge variant="outline" className="border-dashed border-amber-400 bg-amber-50 text-[10px] text-amber-900">
            Illustrative data · not a match score
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div>
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Skills to try</p>
          <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Illustrative skills">
            {SKILLS.map((skill) => {
              const on = picked.includes(skill.slug)
              return (
                <Button
                  key={skill.slug}
                  type="button"
                  variant={on ? 'default' : 'outline'}
                  size="xs"
                  aria-pressed={on}
                  onClick={() => toggle(skill.slug)}
                  title={skill.why}
                >
                  {skill.name}
                </Button>
              )
            })}
          </div>
        </div>

        <div>
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Illustrative role</p>
          <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Illustrative roles">
            {ROLES.map((entry) => (
              <Button
                key={entry.id}
                type="button"
                variant={entry.id === role.id ? 'default' : 'outline'}
                size="xs"
                aria-pressed={entry.id === role.id}
                onClick={() => setRoleId(entry.id)}
              >
                {entry.name}
              </Button>
            ))}
          </div>
          <p className="mt-1.5 text-[11px] text-muted-foreground">{role.note}</p>
        </div>

        <div className="rounded-xl border border-border/70 bg-muted/25 p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm font-medium">Illustrative coverage of {role.name}</p>
            <p className="text-lg font-semibold tabular-nums">{percent}%</p>
          </div>
          <div
            role="img"
            aria-label={`Illustrative coverage of ${role.name}: ${percent} percent — ${weightCovered} of ${weightTotal} weight points, from ${covered.length} of ${role.asks.length} skills this demo role asks for.`}
            className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-background ring-1 ring-border/70"
          >
            <div className="h-full bg-brand-500" style={{ width: `${percent}%` }} />
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground" role="status">
            {weightCovered} of {weightTotal} weight points for {role.name}, from {covered.length} of{' '}
            {role.asks.length} skills it asks for. Each skill earns exactly the weight this invented role gives it —
            nothing else is counted.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3">
            <p className="text-xs font-medium tracking-wide text-emerald-900 uppercase">Counted</p>
            {covered.length === 0 ? (
              <p className="mt-1.5 text-xs text-muted-foreground">Nothing this role asks for is ticked yet.</p>
            ) : (
              <ul className="mt-1.5 flex flex-col gap-1 text-xs">
                {covered.map((ask) => (
                  <li key={ask.slug} className="flex items-baseline justify-between gap-2">
                    <span>{ALL_SKILLS.get(ask.slug)?.name ?? ask.slug}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">{` weight ${ask.weight}`}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="rounded-xl border border-rose-200 bg-rose-50/50 p-3">
            <p className="text-xs font-medium tracking-wide text-rose-950 uppercase">Not counted</p>
            {missing.length === 0 ? (
              <p className="mt-1.5 text-xs text-muted-foreground">Every skill this demo role asks for is ticked.</p>
            ) : (
              <ul className="mt-1.5 flex flex-col gap-1 text-xs">
                {missing.map((ask) => (
                  <li key={ask.slug} className="flex items-baseline justify-between gap-2">
                    <span>{ALL_SKILLS.get(ask.slug)?.name ?? ask.slug}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">{` weight ${ask.weight}`}</span>
                  </li>
                ))}
              </ul>
            )}
            {unused.length > 0 ? (
              <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                Ticked but not asked for here: {unused.map((skill) => skill.name).join(', ')}. A real report would not
                discard them — transferable skills are listed separately, because a different role may ask for them.
              </p>
            ) : null}
          </div>
        </div>

        <p className="text-[11px] leading-relaxed text-muted-foreground">
          What this toy leaves out is the part that matters: a real comparison uses the <em>level</em> you hold against
          the level a published role asks for, the weight that role itself set, and how well each claim is evidenced. It
          is computed from your stored profile by the deterministic scoring engine, and it is a description of distance,
          not a prediction that you will be shortlisted, invited or hired. This widget predicts nothing about you.
        </p>
      </CardContent>
    </Card>
  )
}
