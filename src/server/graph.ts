import type { ProficiencyLevel, SkillValidationStatus } from '@prisma/client'
import { AccessDeniedError, assertPermission, type Principal } from '@/lib/authz'
import { prisma } from '@/lib/db'
import { LEVEL_VALUES } from '@/lib/engines/types'
import { provenanceNote, provenanceTier } from '@/lib/provenance'
import { SKILL_TAXONOMY } from '@/lib/taxonomy/skills'
import { recordAudit } from '@/server/audit'
import { notifyUser } from '@/server/notifications'

/**
 * Capability graph (Prompt 3).
 *
 * The picture is generated from live rows every time it opens — skills, their
 * evidence, assessment results, experience entries and the roles the platform
 * currently matches best. The only thing stored is what the human changed:
 * node position, an override label, a note, and whether a node is hidden. That
 * way a rearranged graph cannot quietly become a different set of facts.
 */

export type GraphNodeKind = 'YOU' | 'SKILL' | 'EXPERIENCE' | 'EVIDENCE' | 'ASSESSMENT' | 'OPPORTUNITY'

export type GraphLinkKind = 'HOLD' | 'DERIVED' | 'SUPPORTED' | 'ASSESSED' | 'TARGET' | 'RELATED'

export type GraphNode = {
  key: string
  kind: GraphNodeKind
  label: string
  sublabel: string | null
  /** Skill category, experience type, evidence type or job work mode. */
  group: string | null
  /** How the claim was earned — the provenance the prompt asks to make visible. */
  provenance: string | null
  provenanceNote: string | null
  /** 1–4: how far out from the candidate the node sits, for the legend and filters. */
  ring: number
  confidence: number | null
  levelValue: number | null
  recordId: string | null
  detail: Record<string, string | number | boolean | null>
  position: { x: number; y: number }
  editable: boolean
}

export type GraphLink = {
  id: string
  source: string
  target: string
  kind: GraphLinkKind
  label: string
}

export type GraphModel = {
  nodes: GraphNode[]
  links: GraphLink[]
  hiddenCount: number
  movedCount: number
  annotatedCount: number
  /** Nodes the candidate hid, so the screen can offer to put them back. */
  hidden: { nodeKey: string; label: string; kind: GraphNodeKind }[]
  counts: {
    skills: number
    experiences: number
    evidence: number
    assessments: number
    opportunities: number
  }
  provenanceTally: Record<string, number>
  generatedFrom: string[]
}

const RELATED_BY_SLUG = new Map(SKILL_TAXONOMY.map((entry) => [entry.slug, entry.relatedSlugs]))

/** Ring radii in flow coordinates. Nodes are ~180px wide, so gaps stay readable. */
const R_CORE = 0
const R_SKILL = 300
const R_SKILL_OUTER = 430
const R_SATELLITE = 560
const R_RING_THREE = 760

function polar(radius: number, degrees: number) {
  const radians = (degrees * Math.PI) / 180
  return { x: Math.round(radius * Math.cos(radians)), y: Math.round(radius * Math.sin(radians)) }
}

type ProfileGraphSource = {
  id: string
  userId: string
  anonymousHandle: string
  headline: string | null
  targetRole: string | null
  targetIndustry: string | null
  yearsOfExperience: number
  skills: {
    id: string
    level: ProficiencyLevel
    confidence: number
    validationStatus: SkillValidationStatus
    source: string
    note: string | null
    evidenceCount: number
    skill: { slug: string; name: string; category: string; transferable: boolean }
    evidence: {
      id: string
      type: string
      description: string
      url: string | null
      experienceId: string | null
      reviewedAt: Date | null
      createdAt: Date
    }[]
  }[]
  experiences: {
    id: string
    type: string
    title: string
    description: string
    isCaregiving: boolean
    ongoing: boolean
    hoursPerWeek: number | null
    _count?: { evidence: number }
  }[]
  assessmentAttempts: {
    id: string
    score: number
    passed: boolean
    completedAt: Date | null
    assessment: { id: string; title: string; skill: { slug: string; name: string } }
  }[]
}

const GRAPH_INCLUDE = {
  skills: {
    include: {
      skill: { select: { slug: true, name: true, category: true, transferable: true } },
      evidence: {
        select: {
          id: true,
          type: true,
          description: true,
          url: true,
          experienceId: true,
          reviewedAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' as const },
      },
    },
    orderBy: { confidence: 'desc' as const },
  },
  experiences: {
    select: {
      id: true,
      type: true,
      title: true,
      description: true,
      isCaregiving: true,
      ongoing: true,
      hoursPerWeek: true,
      _count: { select: { evidence: true } },
    },
    orderBy: { createdAt: 'asc' as const },
  },
  assessmentAttempts: {
    where: { passed: true },
    include: { assessment: { select: { id: true, title: true, skill: { select: { slug: true, name: true } } } } },
    orderBy: { completedAt: 'desc' as const },
    take: 12,
  },
}

/**
 * Loads the graph for the signed-in candidate. Employer and admin principals get
 * nothing: this view is a self-description, not a review screen.
 */
export async function loadGraphModel(principal: Principal) {
  assertPermission(principal, 'candidate.graph.read')
  if (!principal.candidateProfileId) throw new AccessDeniedError('No candidate profile is attached to this account.')

  const profile = (await prisma.candidateProfile.findUnique({
    where: { id: principal.candidateProfileId },
    select: {
      id: true,
      userId: true,
      anonymousHandle: true,
      headline: true,
      targetRole: true,
      targetIndustry: true,
      yearsOfExperience: true,
      ...GRAPH_INCLUDE,
    },
  })) as ProfileGraphSource | null

  if (!profile) throw new AccessDeniedError('Candidate profile not found.')

  // The roles the matching engine currently ranks highest for this profile.
  const matches = await prisma.match.findMany({
    where: { candidateProfileId: profile.id },
    orderBy: { score: 'desc' },
    take: 6,
    include: {
      job: {
        select: {
          id: true,
          title: true,
          status: true,
          workMode: true,
          employmentType: true,
          locationCity: true,
          organization: { select: { name: true, verificationStatus: true } },
        },
      },
    },
  })

  const annotations = await prisma.graphAnnotation.findMany({
    where: { candidateProfileId: profile.id },
  })
  const annotationByKey = new Map(annotations.map((entry) => [entry.nodeKey, entry]))

  const nodes: GraphNode[] = []
  const links: GraphLink[] = []

  const skillSlugs = new Set(profile.skills.map((entry) => entry.skill.slug))
  const transferableSkills = profile.skills.filter((entry) => entry.skill.transferable)
  const technicalSkills = profile.skills.filter((entry) => !entry.skill.transferable)

  // --- centre -------------------------------------------------------------
  nodes.push({
    key: 'you',
    kind: 'YOU',
    label: profile.headline?.trim() || 'You',
    sublabel: `${profile.anonymousHandle} · ${profile.yearsOfExperience.toFixed(1)} recorded years`,
    group: null,
    provenance: null,
    provenanceNote: 'The centre of the graph is the profile itself. Everything else hangs off it by origin.',
    ring: 0,
    confidence: null,
    levelValue: null,
    recordId: profile.id,
    detail: {
      anonymousHandle: profile.anonymousHandle,
      targetRole: profile.targetRole ?? 'No target role set',
      skills: profile.skills.length,
      evidence: profile.skills.reduce((total, entry) => total + entry.evidence.length, 0),
    },
    position: polar(R_CORE, 0),
    editable: false,
  })

  // --- skills: transferable on the left half, technical on the right ------
  const placeArc = (
    list: ProfileGraphSource['skills'],
    fromDegrees: number,
    toDegrees: number,
    startRing: 1,
  ) => {
    list.forEach((entry, index) => {
      const share = list.length === 1 ? 0.5 : index / (list.length - 1)
      const degrees = fromDegrees + (toDegrees - fromDegrees) * share
      const radius = index % 2 === 0 ? R_SKILL : R_SKILL_OUTER
      const tier = provenanceTier(entry.validationStatus)
      const key = `skill:${entry.id}`
      nodes.push({
        key,
        kind: 'SKILL',
        label: entry.skill.name,
        sublabel: `${entry.level.toLowerCase()} · ${Math.round(entry.confidence * 100)}% confidence`,
        group: entry.skill.category,
        provenance: tier,
        provenanceNote: provenanceNote(entry.validationStatus),
        ring: startRing,
        confidence: entry.confidence,
        levelValue: LEVEL_VALUES[entry.level],
        recordId: entry.id,
        detail: {
          slug: entry.skill.slug,
          level: entry.level,
          status: entry.validationStatus,
          storedSource: entry.source,
          transferable: entry.skill.transferable,
          evidenceCount: entry.evidence.length,
          note: entry.note ?? null,
        },
        position: polar(radius, degrees),
        editable: true,
      })
      links.push({
        id: `hold:${entry.id}`,
        source: 'you',
        target: key,
        kind: 'HOLD',
        label: entry.skill.transferable ? 'transferable skill' : 'skill',
      })

      // satellites: evidence and assessment, fanned just outside the skill
      const satellites: GraphNode[] = []
      entry.evidence.forEach((item) => {
        satellites.push({
          key: `evidence:${item.id}`,
          kind: 'EVIDENCE',
          label: evidenceLabel(item.type, item.description),
          sublabel: item.description,
          group: item.type,
          provenance: item.reviewedAt ? 'VERIFIED' : 'SELF_REPORTED',
          provenanceNote: item.reviewedAt
            ? 'A reviewer checked this evidence on the platform.'
            : 'You attached this evidence. Nothing has verified it.',
          ring: 2,
          confidence: null,
          levelValue: null,
          recordId: item.id,
          detail: {
            type: item.type,
            url: item.url ?? null,
            fromExperience: item.experienceId ?? null,
            attached: item.createdAt.toISOString().slice(0, 10),
          },
          position: polar(R_SATELLITE, degrees),
          editable: true,
        })
        links.push({
          id: `support:${item.id}`,
          source: key,
          target: `evidence:${item.id}`,
          kind: 'SUPPORTED',
          label: item.type.toLowerCase().replace(/_/g, ' '),
        })
        if (item.experienceId) {
          links.push({
            id: `derived:${item.id}`,
            source: `experience:${item.experienceId}`,
            target: key,
            kind: 'DERIVED',
            label: 'inferred from this experience',
          })
        }
      })

      const graded = profile.assessmentAttempts.filter((attempt) => attempt.assessment.skill.slug === entry.skill.slug)
      for (const attempt of graded.slice(0, 1)) {
        satellites.push({
          key: `assessment:${attempt.id}`,
          kind: 'ASSESSMENT',
          label: attempt.assessment.title,
          sublabel: `passed with ${Math.round(attempt.score * 100)}%`,
          group: 'ASSESSMENT',
          provenance: 'ASSESSED',
          provenanceNote: 'Scored by this platform’s own question set. Not externally proctored.',
          ring: 2,
          confidence: attempt.score,
          levelValue: null,
          recordId: attempt.id,
          detail: {
            skill: attempt.assessment.skill.name,
            score: Math.round(attempt.score * 100),
            completed: attempt.completedAt ? attempt.completedAt.toISOString().slice(0, 10) : 'not finished',
          },
          position: polar(R_SATELLITE, degrees),
          editable: true,
        })
        links.push({
          id: `assessed:${attempt.id}`,
          source: key,
          target: `assessment:${attempt.id}`,
          kind: 'ASSESSED',
          label: 'assessment result',
        })
      }

      // Satellites alternate radius by their parent's slot, so two neighbouring
      // skills' evidence never stacks on the same arc.
      satellites.forEach((satellite, satelliteIndex) => {
        const offset = (satelliteIndex - (satellites.length - 1) / 2) * 7
        const radius = R_SATELLITE + (index % 2) * 110 + satelliteIndex * 78
        satellite.position = polar(radius, degrees + offset)
        nodes.push(satellite)
      })
    })
  }

  placeArc(technicalSkills, -78, 78, 1)
  placeArc(transferableSkills, 102, 258, 1)

  // --- experience ring ----------------------------------------------------
  const caregiving = profile.experiences.filter((entry) => entry.isCaregiving || entry.type === 'CAREGIVING')
  const paid = profile.experiences.filter((entry) => !entry.isCaregiving && entry.type !== 'CAREGIVING')

  const placeExperience = (entry: ProfileGraphSource['experiences'][number], degrees: number, radius: number) => {
    const inferredFromHere = profile.skills.some((skill) =>
      skill.evidence.some((item) => item.experienceId === entry.id),
    )
    nodes.push({
      key: `experience:${entry.id}`,
      kind: 'EXPERIENCE',
      label: entry.title,
      sublabel: entry.isCaregiving
        ? `${entry.type.toLowerCase().replace(/_/g, ' ')} · unpaid care work`
        : entry.type.toLowerCase().replace(/_/g, ' '),
      group: entry.type,
      provenance: inferredFromHere ? 'SUGGESTED' : null,
      provenanceNote: inferredFromHere
        ? 'Skills were proposed from the wording of this entry. Each one still needs your confirmation.'
        : 'Recorded experience. No skill was inferred from its wording.',
      ring: 3,
      confidence: null,
      levelValue: null,
      recordId: entry.id,
      detail: {
        type: entry.type,
        isCaregiving: entry.isCaregiving,
        hoursPerWeek: entry.hoursPerWeek ?? null,
        ongoing: entry.ongoing,
        evidenceAttached: entry._count?.evidence ?? 0,
        description: entry.description.slice(0, 240),
      },
      position: polar(radius, degrees),
      editable: true,
    })
    links.push({
      id: `exp:${entry.id}`,
      source: 'you',
      target: `experience:${entry.id}`,
      kind: 'HOLD',
      label: entry.isCaregiving ? 'care experience' : 'experience',
    })
  }

  // Experiences sit below the centre so the upper half stays skills-first.
  const experienceDegrees = (index: number, total: number) => {
    const spread = total === 1 ? 0 : (index / (total - 1)) * 2 - 1
    return 180 + spread * 22 + (index % 2 === 0 ? 40 : -40)
  }
  const allExperiences = [...paid, ...caregiving]
  allExperiences.forEach((entry, index) => {
    const radius = index % 2 === 0 ? R_RING_THREE : R_RING_THREE + 150
    placeExperience(entry, experienceDegrees(index, allExperiences.length), radius)
  })

  // --- target opportunities ----------------------------------------------
  const opportunityDegrees = (index: number, total: number) => {
    const spread = total === 1 ? 0 : index / (total - 1)
    return -34 + spread * 68
  }
  matches.forEach((match, index) => {
    const key = `job:${match.jobId}`
    nodes.push({
      key,
      kind: 'OPPORTUNITY',
      label: match.job.title,
      sublabel: `${Math.round(match.score * 100)}% match · ${match.job.organization.name}`,
      group: match.job.workMode,
      provenance: null,
      provenanceNote:
        'The score is the weighted rule model’s output, not a promise of an interview. Employer verification status is shown as recorded.',
      ring: 4,
      confidence: match.score,
      levelValue: null,
      recordId: match.jobId,
      detail: {
        score: Math.round(match.score * 100),
        requiredCoverage: Math.round(match.requiredScore * 100),
        evidenceStrength: Math.round(match.evidenceScore * 100),
        status: match.job.status,
        workMode: match.job.workMode,
        employerVerification: match.job.organization.verificationStatus,
        weightsVersion: match.weightVersion,
      },
      position: polar(R_RING_THREE + (index % 2 === 0 ? 0 : 150), opportunityDegrees(index, matches.length)),
      editable: true,
    })
    links.push({
      id: `target:${match.jobId}`,
      source: 'you',
      target: key,
      kind: 'TARGET',
      label: 'matched opportunity',
    })
  })

  // --- taxonomy relations between the skills the candidate actually holds --
  for (const entry of profile.skills) {
    for (const related of RELATED_BY_SLUG.get(entry.skill.slug) ?? []) {
      if (!skillSlugs.has(related) || related <= entry.skill.slug) continue
      const other = profile.skills.find((candidate) => candidate.skill.slug === related)
      if (!other) continue
      links.push({
        id: `related:${entry.id}:${other.id}`,
        source: `skill:${entry.id}`,
        target: `skill:${other.id}`,
        kind: 'RELATED',
        label: 'related in the taxonomy',
      })
    }
  }

  // --- apply stored human edits ------------------------------------------
  let hiddenCount = 0
  let movedCount = 0
  const hidden: { nodeKey: string; label: string; kind: GraphNodeKind }[] = []
  const kept: GraphNode[] = []
  for (const node of nodes) {
    const annotation = annotationByKey.get(node.key)
    if (!annotation) {
      kept.push(node)
      continue
    }
    if (annotation.hidden) {
      hiddenCount += 1
      hidden.push({ nodeKey: node.key, label: node.label, kind: node.kind })
      continue
    }
    if (annotation.positionX != null && annotation.positionY != null) {
      node.position = { x: annotation.positionX, y: annotation.positionY }
      movedCount += 1
    }
    if (annotation.labelOverride?.trim()) node.label = annotation.labelOverride.trim()
    if (annotation.note?.trim()) node.detail = { ...node.detail, yourNote: annotation.note.trim() }
    kept.push(node)
  }

  const keptKeys = new Set(kept.map((node) => node.key))
  const provenanceTally: Record<string, number> = {}
  for (const node of kept) {
    if (!node.provenance) continue
    provenanceTally[node.provenance] = (provenanceTally[node.provenance] ?? 0) + 1
  }

  return {
    nodes: kept,
    links: links.filter((link) => keptKeys.has(link.source) && keptKeys.has(link.target)),
    hiddenCount,
    movedCount,
    hidden,
    annotatedCount: annotations.filter((entry) => entry.note?.trim() || entry.labelOverride?.trim()).length,
    counts: {
      skills: kept.filter((node) => node.kind === 'SKILL').length,
      experiences: kept.filter((node) => node.kind === 'EXPERIENCE').length,
      evidence: kept.filter((node) => node.kind === 'EVIDENCE').length,
      assessments: kept.filter((node) => node.kind === 'ASSESSMENT').length,
      opportunities: kept.filter((node) => node.kind === 'OPPORTUNITY').length,
    },
    provenanceTally,
    generatedFrom: [
      'candidate_skills',
      'skill_evidence',
      'experiences',
      'assessment_attempts',
      'matches',
      'graph_annotations (your edits only)',
    ],
  } satisfies GraphModel
}

/**
 * Evidence rows are written by the engines with a fixed preamble, so the useful
 * part is the quoted phrase inside them. Without one, fall back to the first
 * sentence rather than showing the same boilerplate on twelve nodes.
 */
function evidenceLabel(type: string, description: string) {
  const quoted = /[“"]([^”"]{8,120})[”"]/.exec(description)
  if (quoted) return quoted[1].trim()
  // The engines write “Suggested from the wording in the candidate’s X
  // description.” — the useful part is X, so show that rather than the frame.
  const named = /candidate[’']s\s+(.+?)\s+description/i.exec(description)
  if (named) return `${named[1]} wording`
  const stripped = description
    .replace(/^suggested from the wording (in|of)[^:]*:\s*/i, '')
    .replace(/^evidence (from|of)[^:]*:\s*/i, '')
    .trim()
  const first = (stripped || description).split(/[.;]\s/)[0] ?? description
  const readable = first || type.replace(/_/g, ' ')
  return readable.length > 40 ? `${readable.slice(0, 40)}…` : readable
}

// ---------------------------------------------------------------------------
// Persisted edits
// ---------------------------------------------------------------------------

export type GraphNodeEdit = {
  nodeKey: string
  position?: { x: number; y: number } | null
  labelOverride?: string | null
  note?: string | null
  hidden?: boolean | null
}

const EDITABLE_PREFIXES = ['skill:', 'experience:', 'evidence:', 'assessment:', 'job:']

/**
 * Writes one human edit. The node key must exist in the freshly generated model,
 * which stops an edit from naming a record the candidate cannot see.
 */
export async function saveGraphNodeEdit(principal: Principal, edit: GraphNodeEdit) {
  assertPermission(principal, 'candidate.skills.manage')
  if (!principal.candidateProfileId) throw new AccessDeniedError('No candidate profile is attached to this account.')
  if (!EDITABLE_PREFIXES.some((prefix) => edit.nodeKey.startsWith(prefix))) {
    throw new AccessDeniedError('That node cannot be edited.')
  }

  if (edit.position && [edit.position.x, edit.position.y].some((value) => !Number.isFinite(value) || Math.abs(value) > 6000)) {
    throw new AccessDeniedError('Graph position is outside the supported canvas.')
  }
  const model = await loadGraphModel(principal)
  if (!model.nodes.some((node) => node.key === edit.nodeKey) && !model.hidden.some((node) => node.nodeKey === edit.nodeKey)) {
    throw new AccessDeniedError('That node is no longer on your graph.')
  }

  const data = {
    positionX: edit.position ? edit.position.x : null,
    positionY: edit.position ? edit.position.y : null,
    labelOverride: edit.labelOverride?.trim() ? edit.labelOverride.trim().slice(0, 60) : null,
    note: edit.note?.trim() ? edit.note.trim().slice(0, 400) : null,
    hidden: edit.hidden ?? false,
  }

  // An edit that only carries a position must not erase an existing note, and a
  // note-only edit must not snap the node back to the generated layout.
  const existing = await prisma.graphAnnotation.findUnique({
    where: {
      candidateProfileId_nodeKey: {
        candidateProfileId: principal.candidateProfileId,
        nodeKey: edit.nodeKey,
      },
    },
  })
  const merged = existing
    ? {
        positionX: edit.position ? data.positionX : existing.positionX,
        positionY: edit.position ? data.positionY : existing.positionY,
        labelOverride: edit.labelOverride === undefined ? existing.labelOverride : data.labelOverride,
        note: edit.note === undefined ? existing.note : data.note,
        hidden: edit.hidden === undefined ? existing.hidden : data.hidden,
      }
    : data

  const row = await prisma.graphAnnotation.upsert({
    where: {
      candidateProfileId_nodeKey: {
        candidateProfileId: principal.candidateProfileId,
        nodeKey: edit.nodeKey,
      },
    },
    create: { candidateProfileId: principal.candidateProfileId, nodeKey: edit.nodeKey, ...merged },
    update: merged,
  })

  await recordAudit({
    actor: principal,
    action: existing ? 'graph.node.updated' : 'graph.node.created',
    entityType: 'GraphAnnotation',
    entityId: row.id,
    metadata: { nodeKey: edit.nodeKey, moved: Boolean(edit.position), annotated: Boolean(merged.note) },
  })

  return row
}

/** Clears the stored layout for one node, returning it to the generated position. */
export async function resetGraphNode(principal: Principal, nodeKey: string) {
  assertPermission(principal, 'candidate.skills.manage')
  if (!principal.candidateProfileId) throw new AccessDeniedError('No candidate profile is attached to this account.')
  const row = await prisma.graphAnnotation.deleteMany({
    where: { candidateProfileId: principal.candidateProfileId, nodeKey },
  })
  await recordAudit({
    actor: principal,
    action: 'graph.node.reset',
    entityType: 'GraphAnnotation',
    entityId: nodeKey,
    metadata: { removed: row.count },
  })
  return row.count
}

/** Clears every stored edit on this profile's graph. */
export async function resetGraphLayout(principal: Principal) {
  assertPermission(principal, 'candidate.skills.manage')
  if (!principal.candidateProfileId) throw new AccessDeniedError('No candidate profile is attached to this account.')
  const removed = await prisma.graphAnnotation.deleteMany({
    where: { candidateProfileId: principal.candidateProfileId },
  })
  await recordAudit({
    actor: principal,
    action: 'graph.layout.reset',
    entityType: 'CandidateProfile',
    entityId: principal.candidateProfileId,
    metadata: { annotationsRemoved: removed.count },
  })
  await notifyUser(principal.userId, {
    type: 'ADMIN_NOTICE',
    title: 'Capability graph layout reset',
    body: 'Every saved position, note and hidden flag on your graph was cleared. The generated layout is back.',
    link: '/candidate/graph',
  })
  return removed.count
}

export async function graphEditCount(candidateProfileId: string) {
  return prisma.graphAnnotation.count({ where: { candidateProfileId } })
}
