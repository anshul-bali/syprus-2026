'use client'

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

/**
 * Recharts wrappers for the admin screens.
 *
 * Every chart receives plain strings and numbers produced on the server — no
 * Prisma records and no `Date` objects cross this boundary. Each figure carries
 * an accessible label and is always paired with the numbers it draws, so a shape
 * on a screen is never the only way to read a metric.
 */

const BRAND = 'var(--color-brand-600, oklch(0.511 0.217 263))'
const TEAL = 'var(--color-teal-600, oklch(0.6 0.12 195))'
const PLUM = 'var(--color-plum-500, oklch(0.55 0.17 320))'
const AMBER = 'var(--color-amber-500, #f59e0b)'
const AXIS = 'var(--color-muted-foreground, #6b7280)'
const GRID = 'var(--color-border, #e5e7eb)'

const PIE_COLORS = [BRAND, TEAL, PLUM, AMBER]

type TrendPoint = { day: string; count: number }

function Figure({
  label,
  description,
  children,
}: {
  label: string
  description: string
  children: React.ReactNode
}) {
  return (
    <figure role="img" aria-label={label} className="w-full">
      <div className="h-64 w-full" aria-hidden>
        {children}
      </div>
      <figcaption className="mt-2 text-xs leading-relaxed text-muted-foreground">{description}</figcaption>
    </figure>
  )
}

export function SignupTrendChart({ data, label, color = BRAND }: { data: TrendPoint[]; label: string; color?: string }) {
  return (
    <Figure
      label={`${label}: daily counts for the last ${data.length} days`}
      description="Area chart of the daily counts listed in the table beside it."
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
          <XAxis
            dataKey="day"
            tick={{ fontSize: 10, fill: AXIS }}
            interval="preserveStartEnd"
            minTickGap={24}
            tickFormatter={(value: string) => value.slice(5)}
          />
          <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: AXIS }} width={28} />
          <Tooltip
            formatter={(value: unknown) => [Number(value ?? 0), 'Count']}
            labelFormatter={(value: unknown) => `Day ${String(value)}`}
          />
          <Area type="monotone" dataKey="count" stroke={color} fill={color} fillOpacity={0.25} strokeWidth={2} />
        </AreaChart>
      </ResponsiveContainer>
    </Figure>
  )
}

export function ApplicationTrendChart({
  data,
  label,
  color = TEAL,
}: {
  data: TrendPoint[]
  label: string
  color?: string
}) {
  return (
    <Figure
      label={`${label}: daily counts for the last ${data.length} days`}
      description="Line chart of the same daily counts shown in the adjacent table."
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
          <XAxis
            dataKey="day"
            tick={{ fontSize: 10, fill: AXIS }}
            interval="preserveStartEnd"
            minTickGap={24}
            tickFormatter={(value: string) => value.slice(5)}
          />
          <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: AXIS }} width={28} />
          <Tooltip formatter={(value: unknown) => [Number(value ?? 0), 'Applications']} />
          <Line type="monotone" dataKey="count" stroke={color} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
        </LineChart>
      </ResponsiveContainer>
    </Figure>
  )
}

export function CategoryBarChart({
  data,
  label,
  color = BRAND,
  description,
}: {
  data: { label: string; count: number }[]
  label: string
  color?: string
  description?: string
}) {
  return (
    <Figure
      label={`${label}: ${data.map((row) => `${row.label} ${row.count}`).join(', ')}`}
      description={description ?? 'Horizontal counts are listed in the table beside the chart.'}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID} horizontal={false} />
          <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10, fill: AXIS }} />
          <YAxis type="category" dataKey="label" width={110} tick={{ fontSize: 11, fill: AXIS }} />
          <Tooltip formatter={(value: unknown) => [Number(value ?? 0), 'Count']} />
          <Bar dataKey="count" fill={color} radius={[0, 4, 4, 0]} maxBarSize={22} />
        </BarChart>
      </ResponsiveContainer>
    </Figure>
  )
}

export function RoleShareChart({
  data,
  label,
  description,
}: {
  data: { label: string; count: number }[]
  label: string
  description?: string
}) {
  return (
    <Figure
      label={`${label}: ${data.map((row) => `${row.label} ${row.count}`).join(', ')}`}
      description={description ?? 'Accounts by role, with the same figures in the table beside it.'}
    >
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Tooltip formatter={(value: unknown) => [Number(value ?? 0), 'Accounts']} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Pie data={data} dataKey="count" nameKey="label" outerRadius="72%" innerRadius="42%" paddingAngle={2}>
            {data.map((row, index) => (
              <Cell key={row.label} fill={PIE_COLORS[index % PIE_COLORS.length]} stroke="var(--color-background, #fff)" />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
    </Figure>
  )
}

export function FairnessBandChart({
  data,
  label,
  description,
}: {
  data: { band: string; meanScore: number }[]
  label: string
  description?: string
}) {
  return (
    <Figure
      label={`${label}: ${data.map((row) => `${row.band} ${row.meanScore.toFixed(2)}`).join(', ')}`}
      description={
        description ??
        'Mean stored match score per career-break band, on a 0–1 scale. The table beside it carries the sample size, which is what says whether a bar means anything.'
      }
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: -16 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
          <XAxis dataKey="band" tick={{ fontSize: 10, fill: AXIS }} interval={0} />
          <YAxis domain={[0, 1]} tick={{ fontSize: 10, fill: AXIS }} width={32} />
          <Tooltip formatter={(value: unknown) => [Number(value ?? 0).toFixed(3), 'Mean score']} />
          <Bar dataKey="meanScore" fill={PLUM} radius={[4, 4, 0, 0]} maxBarSize={44} />
        </BarChart>
      </ResponsiveContainer>
    </Figure>
  )
}
