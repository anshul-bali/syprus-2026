import Image from 'next/image'
import { cn } from '@/lib/utils'
import { imageAsset, type SyprusImageKey } from '@/lib/assets'
import { DemoBadge } from '@/components/common'

/**
 * One figure for one asset: the intrinsic WebP dimensions set the aspect ratio
 * before the file arrives, so nothing below it jumps. Illustrations are
 * contained on the ivory ground because their composition carries the meaning;
 * photographs and shaded scenes are covered, with `focus` keeping faces in frame.
 */
export function SectionImage({
  image,
  sizes,
  caption,
  className,
  frameClassName,
  ratioClassName,
  eager = false,
  decorative = false,
}: {
  image: SyprusImageKey
  sizes: string
  caption?: string
  className?: string
  frameClassName?: string
  /** Override the intrinsic ratio when the layout needs a crop; `focus` then matters. */
  ratioClassName?: string
  eager?: boolean
  /** True only when the neighbouring copy already says everything the image shows. */
  decorative?: boolean
}) {
  const asset = imageAsset(image)
  // A photorealistic render of a person must never read as a customer photo.
  const badge = asset.people
    ? asset.kind === 'rendered-photo'
      ? 'Generated image — not a SYPRUS customer'
      : 'Illustration'
    : null

  return (
    <figure className={cn('flex flex-col gap-2.5', className)}>
      <div
        style={{ aspectRatio: `${asset.width} / ${asset.height}` }}
        className={cn(
          'relative w-full overflow-hidden rounded-xl bg-sand-100 ring-1 ring-border/70',
          ratioClassName,
          frameClassName,
        )}
      >
        <Image
          src={asset.src}
          alt={decorative ? '' : asset.alt}
          fill
          sizes={sizes}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          className={asset.fit === 'cover' ? 'object-cover' : 'object-contain'}
          style={asset.fit === 'cover' && asset.focus ? { objectPosition: asset.focus } : undefined}
        />
      </div>
      {caption || badge ? (
        <figcaption className="flex flex-wrap items-center gap-2 text-xs leading-snug text-muted-foreground">
          {badge ? <DemoBadge text={badge} /> : null}
          {caption ? <span>{caption}</span> : null}
        </figcaption>
      ) : null}
    </figure>
  )
}
