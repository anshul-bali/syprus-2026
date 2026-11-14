import Link from 'next/link'
import Image from 'next/image'
import { AlertTriangle, CheckCircle2, Inbox, Info, ShieldCheck, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { imageAsset, type SyprusImageKey } from '@/lib/assets'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'

/** Wordmark used across the marketing site and all three portals. */
export function BrandMark({ className, href = '/' }: { className?: string; href?: string }) {
  return (
    <Link href={href} className={cn('flex items-center gap-2.5', className)} aria-label="SYPRUS home">
      <span
        aria-hidden
        className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-600 text-primary-foreground shadow-sm"
      >
        <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2.1}>
          <path d="M7 7h7a3 3 0 0 1 0 6H7" strokeLinecap="round" />
          <path d="M12 13h3a3 3 0 0 1 0 6H7" strokeLinecap="round" />
        </svg>
      </span>
      <span className="flex flex-col leading-none">
        <span className="text-[17px] font-semibold tracking-tight text-foreground">SYPRUS</span>
        <span className="mt-0.5 text-[10.5px] font-medium tracking-[0.14em] text-brand-600 uppercase">
          Skills-first re-entry
        </span>
      </span>
    </Link>
  )
}

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: string
  description?: string
  actions?: React.ReactNode
  eyebrow?: string
}) {
  return (
    <header className="flex flex-col gap-3 border-b border-border/70 pb-5 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-3xl">
        {eyebrow ? <p className="text-xs font-medium tracking-wide text-brand-600 uppercase">{eyebrow}</p> : null}
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-balance sm:text-[28px]">{title}</h1>
        {description ? <p className="mt-1.5 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
    </header>
  )
}

export function EmptyState({
  title,
  description,
  action,
  icon: Icon = Inbox,
  image,
  imageWidth = '16rem',
}: {
  title: string
  description: string
  action?: React.ReactNode
  icon?: LucideIcon
  /** Library key for the illustration shown in place of the plain icon. */
  image?: SyprusImageKey
  imageWidth?: string
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-muted/40 px-6 py-12 text-center">
      {image ? (
        <EmptyStateImage image={image} imageWidth={imageWidth} />
      ) : (
        <span className="grid size-11 place-items-center rounded-full bg-brand-50 text-brand-600">
          <Icon className="size-5" aria-hidden />
        </span>
      )}
      <div>
        <p className="font-medium">{title}</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  )
}

/**
 * Empty states are the one place an illustration earns its bytes: it explains
 * the screen while there is no data to explain. It is contained, fixed to the
 * asset's own ratio, and lazy — a populated table never pays for it.
 */
function EmptyStateImage({ image, imageWidth }: { image: SyprusImageKey; imageWidth: string }) {
  const asset = imageAsset(image)
  return (
    <div
      style={{ aspectRatio: `${asset.width} / ${asset.height}`, width: imageWidth }}
      className="relative max-w-full overflow-hidden rounded-lg bg-sand-100 ring-1 ring-border/60"
    >
      <Image
        src={asset.src}
        alt={asset.alt}
        fill
        sizes={`(max-width: 639px) 90vw, ${imageWidth}`}
        loading="lazy"
        decoding="async"
        className={asset.fit === 'cover' ? 'object-cover' : 'object-contain'}
        style={asset.fit === 'cover' && asset.focus ? { objectPosition: asset.focus } : undefined}
      />
    </div>
  )
}

export function ErrorState({
  title = 'This section could not load',
  description,
  action,
}: {
  title?: string
  description: string
  action?: React.ReactNode
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex gap-3">
        <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden />
        <div>
          <p className="font-medium text-destructive">{title}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      {action}
    </div>
  )
}

export function StatCard({
  label,
  value,
  hint,
  tone = 'brand',
  icon: Icon,
}: {
  label: string
  value: string | number
  hint?: string
  tone?: 'brand' | 'positive' | 'warning' | 'neutral'
  icon?: LucideIcon
}) {
  const tones: Record<string, string> = {
    brand: 'bg-brand-50 text-brand-700',
    positive: 'bg-emerald-50 text-emerald-700',
    warning: 'bg-amber-50 text-amber-700',
    neutral: 'bg-muted text-muted-foreground',
  }
  // Values are not always numbers: an engine name or a ratio string has to stay
  // readable inside a narrow card, so it wraps at a size that fits the box
  // instead of being clipped.
  const longValue = typeof value === 'string' && value.length > 12
  return (
    <Card className="h-full">
      <CardContent className="flex items-start gap-3 pt-5">
        {Icon ? (
          <span className={cn('grid size-9 shrink-0 place-items-center rounded-lg', tones[tone])}>
            <Icon className="size-4.5" aria-hidden />
          </span>
        ) : null}
        <div className="min-w-0 flex-1">
          <p className="text-xs leading-snug font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
          <p
            className={cn(
              'mt-1 font-semibold tabular-nums [overflow-wrap:anywhere]',
              longValue ? 'text-base leading-snug' : 'text-2xl',
            )}
          >
            {value}
          </p>
          {hint ? <p className="mt-1 text-xs leading-snug text-muted-foreground">{hint}</p> : null}
        </div>
      </CardContent>
    </Card>
  )
}

/**
 * Renders a 0–1 engine score with the breakdown the matching model produced, so
 * a percentage is never presented without the reason behind it.
 */
export function ScoreBar({
  score,
  label = 'Match',
  breakdown,
}: {
  score: number
  label?: string
  breakdown?: { label: string; value: number }[]
}) {
  const percent = Math.round(score * 100)
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
        <span className="min-w-0 text-xs leading-snug font-medium text-muted-foreground">{label}</span>
        <span className="shrink-0 text-sm font-semibold tabular-nums">{percent}%</span>
      </div>
      <Progress value={percent} className="mt-1.5 h-2" aria-label={`${label} ${percent} percent`} />
      {breakdown?.length ? (
        // Two columns at every width: a four-across grid inside a narrow card
        // cuts the component names off, and the breakdown is the point.
        <ul role="list" className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {breakdown.map((entry) => (
            <li key={entry.label} role="listitem" className="flex min-w-0 items-baseline justify-between gap-2">
              <span className="min-w-0 leading-snug">{entry.label}</span>
              <span className="shrink-0 tabular-nums">{Math.round(entry.value * 100)}%</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

const TONE_BY_STATUS: Record<string, string> = {
  DRAFT: 'bg-muted text-muted-foreground',
  PENDING_MODERATION: 'bg-amber-100 text-amber-800',
  PENDING: 'bg-amber-100 text-amber-800',
  PUBLISHED: 'bg-emerald-100 text-emerald-800',
  VERIFIED: 'bg-emerald-100 text-emerald-800',
  ACTIVE: 'bg-emerald-100 text-emerald-800',
  PAUSED: 'bg-slate-100 text-slate-700',
  CLOSED: 'bg-slate-100 text-slate-700',
  REJECTED: 'bg-rose-100 text-rose-800',
  SUSPENDED: 'bg-rose-100 text-rose-800',
  DEACTIVATED: 'bg-slate-200 text-slate-700',
  SELF_REPORTED: 'bg-brand-50 text-brand-700',
  RULE_INFERRED: 'bg-violet-100 text-violet-800',
  HR_REVIEWED: 'bg-emerald-100 text-emerald-800',
  DISPUTED: 'bg-rose-100 text-rose-800',
  SHORTLISTED: 'bg-brand-100 text-brand-800',
  INTERVIEW_INVITED: 'bg-violet-100 text-violet-800',
  OFFER_EXTENDED: 'bg-emerald-100 text-emerald-800',
  HIRED: 'bg-emerald-200 text-emerald-900',
  WITHDRAWN: 'bg-slate-100 text-slate-600',
  EMERGING: 'bg-slate-100 text-slate-700',
  DEVELOPING: 'bg-amber-100 text-amber-800',
  JOB_READY: 'bg-brand-100 text-brand-800',
  STRONG_MATCH: 'bg-emerald-100 text-emerald-800',
  PASS: 'bg-emerald-100 text-emerald-800',
  WATCH: 'bg-amber-100 text-amber-800',
  REVIEW: 'bg-rose-100 text-rose-800',
  INSUFFICIENT_DATA: 'bg-slate-100 text-slate-600',
  SUCCESS: 'bg-emerald-100 text-emerald-800',
  FAILED: 'bg-rose-100 text-rose-800',
  RUNNING: 'bg-amber-100 text-amber-800',
}

export function StatusBadge({ value, label }: { value: string; label?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium tracking-wide whitespace-nowrap',
        TONE_BY_STATUS[value] ?? 'bg-muted text-muted-foreground',
      )}
    >
      {label ?? value.replace(/_/g, ' ').toLowerCase()}
    </span>
  )
}

export function InfoNote({
  children,
  tone = 'info',
  title,
}: {
  children: React.ReactNode
  tone?: 'info' | 'success' | 'warning' | 'privacy'
  title?: string
}) {
  const config = {
    info: { Icon: Info, className: 'bg-brand-50/70 text-brand-900 border-brand-200' },
    success: { Icon: CheckCircle2, className: 'bg-emerald-50 text-emerald-900 border-emerald-200' },
    warning: { Icon: AlertTriangle, className: 'bg-amber-50 text-amber-900 border-amber-200' },
    privacy: { Icon: ShieldCheck, className: 'bg-violet-50 text-violet-900 border-violet-200' },
  }[tone]
  const Icon = config.Icon

  return (
    <div className={cn('flex gap-2.5 rounded-lg border px-3.5 py-3 text-sm', config.className)}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0">
        {title ? <p className="font-medium">{title}</p> : null}
        <div className={cn(title && 'mt-0.5')}>{children}</div>
      </div>
    </div>
  )
}

/** Small labelled figure used inside detail cards. */
export function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-border/60 py-2.5 last:border-0 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
      <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</dt>
      <dd className="text-sm text-foreground sm:text-right">{children}</dd>
    </div>
  )
}

export function SummaryCard({
  title,
  description,
  children,
  footer,
  className,
}: {
  title: string
  description?: string
  children?: React.ReactNode
  footer?: React.ReactNode
  className?: string
}) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      {children ? <CardContent>{children}</CardContent> : null}
      {footer ? <div className="border-t border-border/70 px-6 py-3.5">{footer}</div> : null}
    </Card>
  )
}

export function DemoBadge({ text = 'Demonstration data' }: { text?: string }) {
  return (
    <Badge variant="outline" className="border-dashed border-amber-400 bg-amber-50 text-[10px] text-amber-900">
      {text}
    </Badge>
  )
}
