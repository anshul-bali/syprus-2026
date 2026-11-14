'use client'

import { useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { InfoNote } from '@/components/common'
import { PROFICIENCY_LEVELS, label } from '@/lib/options'

/**
 * One gap row, copied straight out of the stored report: levels are 1–5 scale
 * values, `weight` is the role's own integer 1–5 weight (not a percentage) and
 * `gapPoints` is the distance the gap engine scored. Nothing is re-derived here.
 */
export type GapLevelDatum = {
  /** Gap skill name. */
  name: string
  /** 1–5 from LEVEL_VALUES, 0 when the skill is not on the profile at all. */
  current: number
  /** 1–5 the target demands. */
  target: number
  currentLevel: string | null
  targetLevel: string
  severity: string
  /** Whether the role marked the skill required or preferred — the two are not equally decisive. */
  requirement: 'REQUIRED' | 'PREFERRED'
  /** 1–5, exactly as published on the role. */
  weight: number
  /** Distance the engine scored, in level steps. */
  gapPoints: number
}

const CURRENT_FILL = 'var(--color-brand-300)'
const TARGET_FILL = 'var(--color-brand-500)'

type Filter = 'ALL' | 'REQUIRED' | 'PREFERRED'

/** The wording the employer-side skills editor uses for the same integers. */
function weightWord(value: number) {
  return value <= 2 ? 'low' : value === 3 ? 'medium' : 'high'
}

export function PathwayChart({
  data,
  contextLabel,
  contextKind = 'role',
}: {
  data: GapLevelDatum[]
  contextLabel: string
  /** `union` means the target is several roles collapsed to the highest level demanded. */
  contextKind?: 'role' | 'union'
}) {
  const [filter, setFilter] = useState<Filter>('ALL')
  const counts = {
    ALL: data.length,
    REQUIRED: data.filter((entry) => entry.requirement === 'REQUIRED').length,
    PREFERRED: data.filter((entry) => entry.requirement === 'PREFERRED').length,
  }
  const shown = data.filter((entry) => filter === 'ALL' || entry.requirement === filter)
  const rows = shown.map((entry) => ({
    ...entry,
    shortName: entry.name.length > 22 ? `${entry.name.slice(0, 21)}…` : entry.name,
  }))
  const notRecorded = shown.filter((entry) => entry.currentLevel === null).length

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="text-base">Current level against the level each gap skill needs</CardTitle>
            <CardDescription>
              Levels map to the platform scale: {PROFICIENCY_LEVELS.map((level, index) => `${index + 1} ${label(level)}`).join(' · ')}. Measured
              against{' '}
              {contextKind === 'union'
                ? `${contextLabel} — where several roles name the same skill, the higher level and heavier weight win`
                : contextLabel}
              .
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter gaps by requirement">
            {(['ALL', 'REQUIRED', 'PREFERRED'] as const).map((option) => (
              <Button
                key={option}
                variant={filter === option ? 'default' : 'outline'}
                size="xs"
                aria-pressed={filter === option}
                onClick={() => setFilter(option)}
              >
                {option === 'ALL' ? 'All gaps' : option === 'REQUIRED' ? 'Required' : 'Preferred'}
                <span className="ml-1.5 tabular-nums opacity-80">{counts[option]}</span>
              </Button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {rows.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border bg-muted/30 px-3 py-6 text-center text-sm text-muted-foreground">
            No {filter === 'REQUIRED' ? 'required' : 'preferred'} skill gaps were recorded for this target. That is the
            stored comparison, not a promise about an interview.
          </p>
        ) : (
          <>
            <div className="h-72 w-full" aria-hidden>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" domain={[0, 5]} ticks={[0, 1, 2, 3, 4, 5]} fontSize={11} />
                  <YAxis type="category" dataKey="shortName" width={128} fontSize={11} />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null
                      const row = payload[0].payload as GapLevelDatum
                      return (
                        <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-md">
                          <p className="font-medium">{row.name}</p>
                          <p className="mt-1">
                            Held now: {row.currentLevel ? label(row.currentLevel) : 'nothing recorded'}
                          </p>
                          <p>Needed: {label(row.targetLevel)}</p>
                          <p>
                            {label(row.requirement)} · {label(row.severity)} gap · {row.weight}/5 weight
                          </p>
                          <p>Distance: {row.gapPoints} level steps</p>
                        </div>
                      )
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="current" name="Your level today" fill={CURRENT_FILL} radius={[0, 3, 3, 0]} barSize={10} />
                  <Bar
                    dataKey="target"
                    name={contextKind === 'union' ? 'Highest level demanded' : 'Level the role needs'}
                    fill={TARGET_FILL}
                    radius={[0, 3, 3, 0]}
                    barSize={10}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* The same rows as a table: the chart is aria-hidden, so this is how
                anyone reaches the numbers without a pointer or a tooltip. */}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <caption className="sr-only">
                  Gap skills currently displayed, with the level held, the level required, requirement type, weight and
                  distance.
                </caption>
                <thead className="bg-muted/50 text-[11px] uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-2 py-1.5 font-medium">Skill</th>
                    <th scope="col" className="px-2 py-1.5 font-medium">Needed</th>
                    <th scope="col" className="px-2 py-1.5 font-medium">You hold</th>
                    <th scope="col" className="px-2 py-1.5 font-medium">Requirement</th>
                    <th scope="col" className="px-2 py-1.5 text-right font-medium">Weight /5</th>
                    <th scope="col" className="px-2 py-1.5 text-right font-medium">Gap steps</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={`${row.requirement}-${row.name}`} className="border-t border-border/60 align-top">
                      <th scope="row" className="px-2 py-1.5 font-medium">
                        {row.name}
                        <span className="block text-[11px] font-normal text-muted-foreground">{label(row.severity)} gap</span>
                      </th>
                      <td className="px-2 py-1.5">{label(row.targetLevel)}</td>
                      <td className="px-2 py-1.5">
                        {row.currentLevel ? (
                          label(row.currentLevel)
                        ) : (
                          <span className="text-amber-800">missing — not on your profile</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5">{label(row.requirement)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {row.weight}/5
                        <span className="block text-[11px] text-muted-foreground">{weightWord(row.weight)}</span>
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{row.gapPoints}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="text-[11px] text-muted-foreground">
              {label(filter)} comparison drawn from {rows.length} of {data.length} recorded gap
              {data.length === 1 ? '' : 's'}.
            </p>
          </>
        )}

        {/* Outside the branch so the count is announced whatever the filter does,
            including the case where it leaves nothing on screen. */}
        <p className="text-[11px] text-muted-foreground" role="status" aria-live="polite">
          {rows.length} of {data.length} gap skills shown{filter === 'ALL' ? '' : ` (${label(filter).toLowerCase()} only)`}.
          {rows.length === 0
            ? ' The chart and table above are empty because no gap of that kind was recorded — not because the target is fully covered.'
            : notRecorded > 0
              ? ` ${notRecorded} of ${notRecorded === 1 ? 'them has' : 'them have'} no level recorded on your profile, so their distance starts from zero rather than from a measured skill.`
              : ' Every row compares two recorded levels.'}
        </p>

        <InfoNote tone="info" title="Read this as a distance, not a judgement">
          The bars come from your stored levels and the level labels on the target role’s skills. A bar that starts at
          zero means the skill is not on your inventory yet — not that you lack it. Add or correct the skill and the
          chart changes. Required and preferred skills are separated because a role treats them differently, and the
          weight column is the role’s own published 1–5 weight, not this platform’s opinion of importance.
        </InfoNote>
      </CardContent>
    </Card>
  )
}
