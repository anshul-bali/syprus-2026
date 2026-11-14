/**
 * Provenance bands shared by the graph service and the graph canvas.
 *
 * Seven validation statuses are stored; a reader can reliably distinguish six.
 * This module is the single place that collapses one into the other, so a node
 * colour and a written explanation can never disagree.
 */

export type ProvenanceTier =
  | 'SUGGESTED'
  | 'SELF_REPORTED'
  | 'CONFIRMED'
  | 'ASSESSED'
  | 'VERIFIED'
  | 'DISPUTED'

export const PROVENANCE_TIERS: { key: ProvenanceTier; label: string; blurb: string }[] = [
  {
    key: 'SUGGESTED',
    label: 'Suggested',
    blurb: 'A rule or the model proposed it from your own wording. Not yet a claim you have accepted.',
  },
  {
    key: 'SELF_REPORTED',
    label: 'Self-reported',
    blurb: 'You declared the skill and picked its level. Nothing external supports it.',
  },
  {
    key: 'CONFIRMED',
    label: 'You confirmed',
    blurb: 'Reviewed after a suggestion and accepted or edited by you.',
  },
  {
    key: 'ASSESSED',
    label: 'Assessed',
    blurb: 'A question set on this platform was passed at the recorded score.',
  },
  {
    key: 'VERIFIED',
    label: 'Human reviewed',
    blurb: 'Supporting evidence was checked by a reviewer inside this platform.',
  },
  {
    key: 'DISPUTED',
    label: 'Disputed',
    blurb: 'Flagged as wrong or unsupported. Scored at 15% strength until resolved.',
  },
]

/** Collapses the seven stored statuses into the six bands a reader can see. */
export function provenanceTier(status: string): ProvenanceTier {
  if (status === 'AI_SUGGESTED' || status === 'RULE_INFERRED') return 'SUGGESTED'
  if (status === 'USER_CONFIRMED') return 'CONFIRMED'
  if (status === 'ASSESSMENT_VERIFIED') return 'ASSESSED'
  if (status === 'HR_REVIEWED') return 'VERIFIED'
  if (status === 'DISPUTED') return 'DISPUTED'
  return 'SELF_REPORTED'
}

const NOTE_BY_STATUS: Record<string, string> = {
  SELF_REPORTED: 'You stated this level yourself. Nothing external supports it yet.',
  RULE_INFERRED: 'A keyword rule proposed it from wording you supplied. It stays a suggestion until you confirm it.',
  AI_SUGGESTED: 'The discovery model proposed it from your own sentences, with the phrase it quoted kept as evidence.',
  USER_CONFIRMED: 'You confirmed or edited this after it was suggested.',
  ASSESSMENT_VERIFIED: 'A platform assessment was passed at the recorded score. There is no outside proctor.',
  HR_REVIEWED: 'A person with reviewer access marked the supporting evidence as checked.',
  DISPUTED: 'This claim is disputed, so it contributes almost nothing to a match until resolved.',
}

export function provenanceNote(status: string) {
  return NOTE_BY_STATUS[status] ?? 'Origin not recorded.'
}

export function provenanceBlurb(tier: string) {
  return PROVENANCE_TIERS.find((entry) => entry.key === tier)?.blurb ?? 'Origin not recorded.'
}
