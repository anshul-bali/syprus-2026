import { SectionImage } from '@/components/media/section-image'
import type { SyprusImageKey } from '@/lib/assets'

/**
 * The decorative side panel for the authentication screens. It is hidden below
 * `lg` so the form stays primary on phones and in narrow split views, and it is
 * marked as an aside so it never competes with the form for a reader's order.
 */
/**
 * The decorative side panel for the authentication screens. It appears from the
 * tablet width up, where there is room beside the form, and disappears below
 * that so the form stays primary on phones.
 */
export function AuthPanel({
  image,
  title,
  points,
  sizes = '(max-width: 767px) 0px, (max-width: 1023px) 240px, (max-width: 1279px) 320px, 352px',
}: {
  image: SyprusImageKey
  title: string
  points: string[]
  sizes?: string
}) {
  return (
    <aside
      className="hidden w-full shrink-0 self-center md:block md:max-w-[15rem] lg:max-w-[20rem] xl:max-w-[22rem]"
      aria-label={title}
    >
      <SectionImage image={image} sizes={sizes} eager />
      <p className="mt-4 text-sm font-medium">{title}</p>
      <ul role="list" className="mt-2 flex flex-col gap-1.5 text-xs leading-relaxed text-muted-foreground">
        {points.map((point) => (
          <li key={point} role="listitem" className="flex gap-2">
            <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brand-400" />
            <span>{point}</span>
          </li>
        ))}
      </ul>
    </aside>
  )
}
