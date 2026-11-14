'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
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

/**
 * URL-driven filters. State lives in the query string so a filter survives a
 * mutation and a page reload, and every screen below it stays a server component.
 */
function buildHref(basePath: string, params: Record<string, string | undefined>) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value)
  }
  const query = search.toString()
  return query ? `${basePath}?${query}` : basePath
}

export function QueryPicker({
  label,
  param,
  value,
  options,
  basePath,
  otherParams = {},
  placeholder,
  submitLabel = 'Apply',
  helpText,
  id,
}: {
  label: string
  param: string
  value: string | null
  options: { value: string; label: string }[]
  basePath: string
  otherParams?: Record<string, string | undefined>
  placeholder?: string
  submitLabel?: string
  helpText?: string
  id: string
}) {
  const router = useRouter()
  const [selected, setSelected] = useState<string | null>(value)

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        router.push(buildHref(basePath, { ...otherParams, [param]: selected ?? undefined }))
      }}
      className="grid gap-2 rounded-lg border border-border/70 bg-muted/20 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end"
    >
      <div>
        <Label id={`${id}-label`}>{label}</Label>
        <Select
          items={options}
          value={selected}
          onValueChange={(next) => setSelected(next)}
        >
          <SelectTrigger id={id} className="mt-1.5 w-full" aria-labelledby={`${id}-label`} aria-describedby={helpText ? `${id}-help` : undefined}>
            <SelectValue placeholder={placeholder} />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {helpText ? (
          <p id={`${id}-help`} className="mt-1 text-xs text-muted-foreground">
            {helpText}
          </p>
        ) : null}
      </div>
      <Button type="submit" size="sm" variant="outline" disabled={options.length === 0}>
        {submitLabel}
      </Button>
    </form>
  )
}

const PRESETS = [
  { value: '0', label: 'Any score' },
  { value: '50', label: '50% and above' },
  { value: '60', label: '60% and above' },
  { value: '70', label: '70% and above' },
  { value: '80', label: '80% and above' },
]

export function MatchScoreFilter({
  minScore,
  basePath,
  otherParams = {},
}: {
  minScore: number | null
  basePath: string
  otherParams?: Record<string, string | undefined>
}) {
  const router = useRouter()
  const initialPercent = minScore == null ? '0' : String(Math.round(minScore * 100))
  const [percent, setPercent] = useState(initialPercent)

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        const parsed = Number(percent)
        const clamped = Number.isFinite(parsed) ? Math.min(100, Math.max(0, Math.trunc(parsed))) : 0
        router.push(buildHref(basePath, { ...otherParams, minScore: clamped > 0 ? String(clamped) : undefined }))
      }}
      className="grid gap-2 rounded-lg border border-border/70 bg-muted/20 p-3 sm:grid-cols-[9.5rem_minmax(0,1fr)_auto] sm:items-end"
    >
      <div>
        <Label htmlFor="min-score-preset">Score floor</Label>
        <Select
          items={PRESETS}
          value={PRESETS.some((preset) => preset.value === percent) ? percent : '0'}
          onValueChange={(next) => setPercent(next ?? '0')}
        >
          <SelectTrigger id="min-score-preset" className="mt-1.5 w-full" aria-describedby="min-score-help">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PRESETS.map((preset) => (
              <SelectItem key={preset.value} value={preset.value}>
                {preset.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label htmlFor="min-score-custom">Or a custom threshold (%)</Label>
        <Input
          id="min-score-custom"
          type="number"
          min={0}
          max={100}
          step={5}
          inputMode="numeric"
          value={PRESETS.some((preset) => preset.value === percent) ? '' : percent}
          onChange={(event) => setPercent(event.target.value)}
          placeholder="e.g. 65"
          className="mt-1.5"
          aria-describedby="min-score-help"
        />
      </div>
      <Button type="submit" size="sm" variant="outline">
        Filter
      </Button>
      <p id="min-score-help" className="text-xs text-muted-foreground sm:col-span-3">
        The threshold is applied to the weighted rules score. It is a screen you set — the platform does not rank
        candidates for you and does not claim the score predicts performance.
      </p>
    </form>
  )
}
