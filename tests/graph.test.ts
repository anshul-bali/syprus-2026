import { describe, it, expect } from './harness'
import { PROVENANCE_TIERS, provenanceBlurb, provenanceNote, provenanceTier } from '../src/lib/provenance'
import { EVIDENCE_WEIGHT_BY_STATUS, evidenceStrength } from '../src/lib/engines/matching'

/**
 * The graph colours nodes by provenance band, so the collapse from seven stored
 * statuses to six bands is the one place a claim could be shown stronger than it
 * is. These are the checks that keep it honest.
 */

const ALL_STATUSES = Object.keys(EVIDENCE_WEIGHT_BY_STATUS)

describe('provenance bands', () => {
  it('maps every stored status to a band the canvas can draw', () => {
    const known = new Set(PROVENANCE_TIERS.map((tier) => tier.key))
    for (const status of ALL_STATUSES) {
      const tier = provenanceTier(status)
      expect.true(known.has(tier), `${status} resolves to a declared band`)
      expect.true(provenanceBlurb(tier).length > 20, `${tier} explains itself`)
    }
  })

  it('keeps a suggestion out of the confirmed band', () => {
    expect.equal(provenanceTier('AI_SUGGESTED'), 'SUGGESTED')
    expect.equal(provenanceTier('RULE_INFERRED'), 'SUGGESTED')
    expect.equal(provenanceTier('USER_CONFIRMED'), 'CONFIRMED')
    expect.equal(provenanceTier('SELF_REPORTED'), 'SELF_REPORTED')
    expect.equal(provenanceTier('DISPUTED'), 'DISPUTED')
  })

  it('never calls an assessment a human verification', () => {
    expect.equal(provenanceTier('ASSESSMENT_VERIFIED'), 'ASSESSED')
    expect.equal(provenanceTier('HR_REVIEWED'), 'VERIFIED')
    expect.true(provenanceNote('ASSESSMENT_VERIFIED').includes('proctor'), 'the limits of a pass are stated')
  })

  it('explains an unknown status without inventing an origin', () => {
    expect.equal(provenanceNote('NOT_A_STATUS'), 'Origin not recorded.')
    expect.equal(provenanceTier('NOT_A_STATUS'), 'SELF_REPORTED', 'the weakest honest default')
  })

  it('orders claim strength by how the claim was earned', () => {
    const assessed = EVIDENCE_WEIGHT_BY_STATUS.ASSESSMENT_VERIFIED
    const reviewed = EVIDENCE_WEIGHT_BY_STATUS.HR_REVIEWED
    const confirmed = EVIDENCE_WEIGHT_BY_STATUS.USER_CONFIRMED
    const reported = EVIDENCE_WEIGHT_BY_STATUS.SELF_REPORTED
    const suggested = EVIDENCE_WEIGHT_BY_STATUS.AI_SUGGESTED
    const disputed = EVIDENCE_WEIGHT_BY_STATUS.DISPUTED

    expect.true(assessed > reviewed && reviewed > confirmed, 'verified beats reviewed beats confirmed')
    expect.true(confirmed > reported && reported > suggested, 'a claim you own beats one you declared')
    expect.true(suggested > disputed, 'a disputed claim contributes the least')
  })

  it('scores an absent skill at zero rather than guessing', () => {
    expect.equal(evidenceStrength(undefined), 0)

    const skill = {
      slug: 'excel',
      name: 'Excel',
      category: 'TECHNICAL' as const,
      level: 'PROFICIENT' as const,
      confidence: 0.6,
      validationStatus: 'SELF_REPORTED' as const,
      evidenceCount: 0,
      transferable: false,
    }
    const base = evidenceStrength(skill)
    expect.true(base > 0 && base <= 1, 'a self-reported skill still counts something')

    // Evidence and verification raise the figure; nothing else does.
    expect.true(evidenceStrength({ ...skill, evidenceCount: 9 }) > base, 'evidence raises it')
    expect.true(evidenceStrength({ ...skill, validationStatus: 'ASSESSMENT_VERIFIED' as const }) > base)
    expect.true(evidenceStrength({ ...skill, validationStatus: 'DISPUTED' as const }) < base)

    // The bonus is capped, so spamming five rows cannot outrank a pass.
    expect.equal(
      evidenceStrength({ ...skill, evidenceCount: 3 }),
      evidenceStrength({ ...skill, evidenceCount: 300 }),
      'evidence bonus is capped',
    )
  })
})
