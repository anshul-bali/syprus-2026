import { cn } from '@/lib/utils'

/**
 * One figure, two readings: a stacked bar of what each component *contributed*
 * to the total, and the table of the component values and weights that produced
 * it. The distinction matters and is stated on screen — a component can score
 * 100% and still add only 18 points, because that is what its weight allows.
 *
 * Numbers arrive from the server already computed by the same engine that
 * produced the score; this component only adds, never re-derives.
 */
export type ContributionRow = {
  key: string
  label: string
  /** The component's own 0–1 value. */
  value: number
  /** Normalised weight actually applied, 0–1. */
  weight: number
  /** value × weight, in the same units as `total`. */
  contribution: number
  note?: string
  /** True when the engine had no data for this component. */
  missing?: boolean
}

const FILL = ['bg-brand-500', 'bg-teal-600', 'bg-plum-500', 'bg-amber-500', 'bg-sky-600']

export function ContributionBreakdown({
  title,
  rows,
  total,
  totalLabel = 'Score',
  unit = 'points',
  className,
}: {
  title: string
  rows: ContributionRow[]
  total: number
  totalLabel?: string
  /** `points` is a 0–100 figure, `fraction` the engine's own 0–1 arithmetic. */
  unit?: 'points' | 'fraction'
  className?: string
}) {
  const sum = rows.reduce((accumulator, row) => accumulator + row.contribution, 0)
  // Reconciliation is a property of the data, not a nicety: if the parts do not
  // add up to the whole, say so instead of drawing a bar that implies they do.
  // The tolerance only covers the rounding the engines themselves apply.
  const tolerance = unit === 'points' ? 0.05 : 0.0005
  const reconciles = Math.abs(sum - total) < tolerance
  const dp = unit === 'points' ? 1 : 3
  const num = (value: number) => value.toFixed(dp)
  const suffix = unit === 'points' ? 'points' : ''
  const scale = (value: number) => (total > 0 ? Math.max(0, Math.min(100, (value / total) * 100)) : 0)

  return (
    <div className={cn('flex flex-col gap-2.5', className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</p>
        <p className="text-xs text-muted-foreground">
          {unit === 'points' ? 'components are shown on a 0–100 scale' : 'components are shown as 0–1 fractions'}
        </p>
      </div>

      <div
        role="img"
        aria-label={`${title}: ${rows.map((row) => `${row.label} ${num(row.contribution)} ${suffix}`).join(', ')}. Total ${num(total)} ${suffix}.`}
        className="flex h-3.5 w-full overflow-hidden rounded-full bg-muted ring-1 ring-border/70"
      >
        {rows.map((row, index) => (
          <div
            key={row.key}
            className={cn(row.missing ? 'bg-muted-foreground/25' : FILL[index % FILL.length], 'h-full')}
            style={{ width: `${scale(row.contribution)}%` }}
            title={`${row.label}: ${num(row.contribution)} ${suffix}`}
          />
        ))}
      </div>

      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {rows.map((row, index) => (
          <span key={row.key} className="flex items-center gap-1.5 text-[11px]">
            <span className={cn('size-2 rounded-full', row.missing ? 'bg-muted-foreground/40' : FILL[index % FILL.length])} aria-hidden />
            {row.label}
            <span className="text-muted-foreground tabular-nums">{num(row.contribution)}</span>
          </span>
        ))}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <caption className="sr-only">
            {title}: each component value, the weight applied to it, and the points it added to the total.
          </caption>
          <thead className="bg-muted/50 text-[11px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th scope="col" className="px-2 py-1.5 font-medium">Component</th>
              <th scope="col" className="px-2 py-1.5 text-right font-medium">Value</th>
              <th scope="col" className="px-2 py-1.5 text-right font-medium">Weight</th>
              <th scope="col" className="px-2 py-1.5 text-right font-medium">Added</th>
              <th scope="col" className="px-2 py-1.5 text-right font-medium">Share of total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-t border-border/60 align-top">
                <th scope="row" className="px-2 py-1.5 font-normal">
                  <span className="block font-medium">{row.label}</span>
                  {row.note ? <span className="block text-[11px] leading-snug text-muted-foreground">{row.note}</span> : null}
                </th>
                <td className="px-2 py-1.5 text-right tabular-nums">
                  {row.missing ? <span className="text-muted-foreground">no data</span> : `${Math.round(row.value * 100)}%`}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums">{Math.round(row.weight * 100)}%</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{num(row.contribution)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">
                  {total > 0 ? `${Math.round((row.contribution / total) * 100)}%` : '—'}
                </td>
              </tr>
            ))}
            <tr className="border-t-2 border-border font-medium">
              <th scope="row" className="px-2 py-1.5">{totalLabel}</th>
              <td className="px-2 py-1.5" />
              <td className="px-2 py-1.5 text-right tabular-nums">{Math.round(rows.reduce((t, r) => t + r.weight, 0) * 100)}%</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{num(total)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">100%</td>
            </tr>
          </tbody>
        </table>
      </div>

      <p className={cn('text-[11px] leading-relaxed', reconciles ? 'text-muted-foreground' : 'text-amber-800')} role={reconciles ? undefined : 'status'}>
        {reconciles
          ? `The “Added” column sums to the ${num(total)} ${suffix} shown as the total. A high Value is not the same as a large Added figure — weight decides that.`
          : `Components add to ${num(sum)} of the ${num(total)} ${totalLabel.toLowerCase()} displayed. The difference is stated rather than smoothed over — check the engine output.`}
      </p>
    </div>
  )
}
