/**
 * The SYPRUS image library, supplied as public/images/syprus/*.webp.
 *
 * Dimensions are read from the WebP headers, not guessed: `SectionImage` uses them
 * to reserve the exact aspect ratio, so a figure cannot shift the layout while it
 * loads. `kind` distinguishes flat illustrations (which need their whole
 * composition, so they are contained) from photographs and shaded scenes (which
 * tolerate a cover crop). `focus` is where a crop must not cut — for the two
 * photographs that is the people's faces.
 *
 * Generated people are never presented as real customers: anything that shows a
 * person carries `people: true` so the caller renders the illustrative label.
 */

export type SyprusImageKey =
  | 'hero-possibilities'
  | 'transferable-experience'
  | 'career-pathway'
  | 'candidate-return'
  | 'employer-collaboration'
  | 'privacy-control'
  | 'login-workspace'
  | 'candidate-new-chapter'
  | 'employer-building-team'
  | 'onboarding-conversation'
  | 'skills-growing'
  | 'evidence-portfolio'
  | 'learning-next-step'
  | 'applications-organised'
  | 'employer-role-blueprint'
  | 'candidate-search'
  | 'review-queue-clear'
  | 'reporting-awaiting-data'

export type SyprusImage = {
  src: string
  width: number
  height: number
  alt: string
  fit: 'contain' | 'cover'
  focus?: string
  people: boolean
  /** How the artwork was made, so a photorealistic render is never captioned as a photograph of a customer. */
  kind: 'illustration' | 'rendered-photo'
}

const DIR = '/images/syprus'

function asset(key: SyprusImageKey, width: number, height: number, alt: string, options: Partial<SyprusImage> = {}): SyprusImage {
  return {
    src: `${DIR}/${key}.webp`,
    width,
    height,
    alt,
    fit: 'contain',
    people: false,
    kind: 'illustration',
    ...options,
  }
}

export const SYPRUS_IMAGES = {
  'hero-possibilities': asset(
    'hero-possibilities',
    1448,
    1086,
    'Paper-cut illustration: layered paths of paid work, study, home and creative practice meet in a network of skills that opens onto a lit doorway.',
    { fit: 'cover' },
  ),
  'transferable-experience': asset(
    'transferable-experience',
    1536,
    1024,
    'Illustration of three scenes — household laundry, a community planting day and someone writing beside a laptop — joined by one flowing line.',
    { people: true },
  ),
  'career-pathway': asset(
    'career-pathway',
    1672,
    940,
    'Five milestone icons on a winding route: a conversation, a folder of evidence, a skills network, an open book and an open doorway.',
  ),
  'candidate-return': asset(
    'candidate-return',
    1448,
    1086,
    'A woman at her desk reads back through a notebook beside an open laptop.',
    { fit: 'cover', focus: '50% 22%', people: true, kind: 'rendered-photo' },
  ),
  'employer-collaboration': asset(
    'employer-collaboration',
    1448,
    1086,
    'Three colleagues lean in on one laptop screen during a hiring review.',
    { fit: 'cover', focus: '50% 28%', people: true, kind: 'rendered-photo' },
  ),
  'privacy-control': asset(
    'privacy-control',
    1448,
    1086,
    'Illustration: a person lifts a translucent panel to reveal anonymous profile cards behind it, choosing what is shown.',
    { fit: 'cover', focus: '30% 45%', people: true },
  ),
  'login-workspace': asset(
    'login-workspace',
    1086,
    1448,
    'A quiet desk with a notebook, pen, plant and closed laptop in morning light.',
    { fit: 'cover', kind: 'rendered-photo' },
  ),
  'candidate-new-chapter': asset(
    'candidate-new-chapter',
    1086,
    1448,
    'Illustration: seen from behind, a woman with a shoulder bag walks through arches toward a bright meeting room.',
    { fit: 'cover', people: true },
  ),
  'employer-building-team': asset(
    'employer-building-team',
    1086,
    1448,
    'Illustration: six people assemble large blue and green shapes into one structure together.',
    { fit: 'cover', focus: '50% 45%', people: true },
  ),
  'onboarding-conversation': asset(
    'onboarding-conversation',
    1448,
    1086,
    'Illustration: an open book with a listening bubble and an idea bubble rising from its pages.',
  ),
  'skills-growing': asset(
    'skills-growing',
    1254,
    1254,
    'Illustration: five rounded skill nodes branch upward from the pages of an open book.',
  ),
  'evidence-portfolio': asset(
    'evidence-portfolio',
    1448,
    1086,
    'An open blue folder with one blank page and one picture tucked into its pocket, beside a plant.',
  ),
  'learning-next-step': asset(
    'learning-next-step',
    1448,
    1086,
    'Illustration: stepping stones lead from an open book across a green slope to a lit study alcove.',
  ),
  'applications-organised': asset(
    'applications-organised',
    1254,
    1254,
    'Illustration: three empty tracker cards beside a desk calendar.',
  ),
  'employer-role-blueprint': asset(
    'employer-role-blueprint',
    1448,
    1086,
    'Illustration: a role card blueprint with an anonymous profile shape above six skill tiles — layers, settings, puzzle, overlap, energy and progress.',
  ),
  'candidate-search': asset(
    'candidate-search',
    1254,
    1254,
    'Illustration: a magnifying glass held over a network of six skill nodes, with no identifying details.',
  ),
  'review-queue-clear': asset(
    'review-queue-clear',
    1254,
    1254,
    'An empty blue document tray with nothing left in it.',
  ),
  'reporting-awaiting-data': asset(
    'reporting-awaiting-data',
    1254,
    1254,
    'Illustration: an empty chart frame with its axes drawn, waiting for data, beside four blank tiles.',
  ),
} satisfies Record<SyprusImageKey, SyprusImage>

export function imageAsset(key: SyprusImageKey) {
  return SYPRUS_IMAGES[key]
}
