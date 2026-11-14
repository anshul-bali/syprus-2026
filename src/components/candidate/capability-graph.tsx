'use client'

import '@xyflow/react/dist/style.css'

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Background,
  Handle,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import { AlertTriangle, Check, Loader2, Maximize2, Minus, Plus, RotateCcw, Search, X } from 'lucide-react'
import { useTheme } from 'next-themes'
import { toast } from 'sonner'
import { useHydrated } from '@/components/theme/theme-toggle'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { InfoNote, StatusBadge } from '@/components/common'
import { label } from '@/lib/options'
import { PROVENANCE_TIERS, provenanceBlurb } from '@/lib/provenance'
import { ActionForm, HiddenFields, SubmitButton } from '@/components/candidate/action-form'
import { TextAreaField, TextField } from '@/components/candidate/field'
import { EvidenceFormDialog } from '@/components/candidate/skills-board'
import {
  editGraphNodeAction,
  hideGraphNodeAction,
  moveGraphNodeAction,
  resetGraphNodeAction,
  resetGraphLayoutAction,
} from '@/server/actions/graph'
import type { GraphModel, GraphNode, GraphNodeKind } from '@/server/graph'

/**
 * The candidate's capability graph, drawn outward from the candidate.
 *
 * Everything here is generated from stored rows at request time; the only thing
 * the canvas writes back is a human edit to the picture — a position, a label, a
 * note, or hiding a node — and each of those is a separate audited row.
 */

type FlowNodeData = Record<string, unknown> & { node: GraphNode; selected: boolean }

const KIND_META: Record<GraphNodeKind, { title: string; hint: string }> = {
  YOU: { title: 'You', hint: 'The profile itself — the centre every other node hangs from.' },
  SKILL: { title: 'Skill', hint: 'A skill on your inventory, coloured by how the claim was earned.' },
  EXPERIENCE: { title: 'Experience', hint: 'A work, caregiving, volunteering or education entry you recorded.' },
  EVIDENCE: { title: 'Evidence', hint: 'Something you attached in support of a skill.' },
  ASSESSMENT: { title: 'Assessment', hint: 'A question set passed on this platform.' },
  OPPORTUNITY: { title: 'Opportunity', hint: 'A published role the matcher currently ranks for you.' },
}

/** Provenance is the colour story: six bands, one ring, one dot. */
const TONE_BY_PROVENANCE: Record<string, string> = {
  SUGGESTED: 'border-amber-400/70 bg-amber-50 text-amber-950',
  SELF_REPORTED: 'border-slate-300 bg-slate-50 text-slate-900',
  CONFIRMED: 'border-brand-400 bg-brand-50 text-brand-800',
  ASSESSED: 'border-violet-400 bg-violet-50 text-violet-950',
  VERIFIED: 'border-emerald-400 bg-emerald-50 text-emerald-950',
  DISPUTED: 'border-rose-400 bg-rose-50 text-rose-950',
}

const DOT_BY_PROVENANCE: Record<string, string> = {
  SUGGESTED: 'bg-amber-500',
  SELF_REPORTED: 'bg-slate-500',
  CONFIRMED: 'bg-brand-600',
  ASSESSED: 'bg-violet-500',
  VERIFIED: 'bg-emerald-600',
  DISPUTED: 'bg-rose-500',
}

const EDGE_STYLE: Record<string, { stroke: string; strokeWidth: number; strokeDasharray?: string }> = {
  HOLD: { stroke: 'oklch(0.511 0.217 263 / 45%)', strokeWidth: 1.6 },
  DERIVED: { stroke: 'oklch(0.66 0.17 70 / 70%)', strokeWidth: 1.5, strokeDasharray: '5 4' },
  SUPPORTED: { stroke: 'oklch(0.62 0.15 155 / 65%)', strokeWidth: 1.3, strokeDasharray: '2 4' },
  ASSESSED: { stroke: 'oklch(0.55 0.2 300 / 65%)', strokeWidth: 1.4, strokeDasharray: '6 3' },
  TARGET: { stroke: 'oklch(0.62 0.16 235 / 60%)', strokeWidth: 1.6 },
  RELATED: { stroke: 'oklch(0.55 0.03 260 / 28%)', strokeWidth: 1.1, strokeDasharray: '1 5' },
}

function CenteredHandles() {
  return (
    <>
      <Handle type="target" position={Position.Left} style={{ left: '50%', top: '50%', opacity: 0 }} />
      <Handle type="source" position={Position.Right} style={{ left: '50%', top: '50%', opacity: 0 }} />
    </>
  )
}

function CardNode({ id, data }: NodeProps) {
  const { node, selected } = data as FlowNodeData
  const width = node.kind === 'YOU' ? 210 : node.kind === 'SKILL' ? 176 + (node.levelValue ?? 1) * 14 : 172
  const tone = node.provenance ? TONE_BY_PROVENANCE[node.provenance] : undefined

  if (node.kind === 'YOU') {
    return (
      <div
        className={`rounded-full border-2 border-brand-600 bg-brand-600 px-5 py-5 text-center text-brand-50 shadow-lg ${
          selected ? 'ring-2 ring-brand-300 ring-offset-2' : ''
        }`}
        style={{ width }}
        aria-label={`Centre node: ${node.label}`}
      >
        <CenteredHandles />
        <p className="text-[13px] font-semibold leading-tight">{node.label}</p>
        <p className="mt-1 text-[10.5px] leading-snug text-brand-100">{node.sublabel}</p>
        <p className="mt-1 text-[9.5px] uppercase tracking-wide text-brand-200">{id === 'you' ? 'the candidate' : id}</p>
      </div>
    )
  }

  const dashed = node.kind === 'EXPERIENCE' || node.provenance === 'SUGGESTED'

  return (
    <div
      className={`rounded-xl border px-2.5 py-2 text-left shadow-sm transition-shadow ${
        tone ?? (node.kind === 'OPPORTUNITY' ? 'border-sky-300 bg-sky-50 text-sky-950' : 'border-border bg-white text-foreground')
      } ${dashed ? 'border-dashed' : ''} ${selected ? 'ring-2 ring-brand-600 ring-offset-2' : ''}`}
      style={{
        width,
        opacity: node.confidence == null ? 1 : 0.76 + node.confidence * 0.24,
      }}
    >
      <CenteredHandles />
      <div className="flex items-start gap-1.5">
        {node.provenance ? (
          <span
            className={`mt-1 size-2 shrink-0 rounded-full ${DOT_BY_PROVENANCE[node.provenance] ?? 'bg-slate-400'}`}
            aria-hidden
          />
        ) : null}
        <div className="min-w-0">
          <p className="truncate text-[12.5px] font-semibold leading-snug">{node.label}</p>
          {node.sublabel ? (
            <p className="mt-0.5 line-clamp-2 text-[10px] leading-snug opacity-85">{node.sublabel}</p>
          ) : null}
        </div>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1 text-[9.5px] uppercase tracking-wide opacity-80">
        <span>{KIND_META[node.kind].title}</span>
        {node.group ? <span className="rounded bg-white/60 px-1">{label(node.group)}</span> : null}
        {node.kind === 'OPPORTUNITY' ? (
          <span className="flex items-center gap-0.5 rounded bg-white/70 px-1 font-semibold">
            <Search className="size-2.5" aria-hidden />
            {String(node.detail.score ?? '')}%
          </span>
        ) : null}
        {node.detail.yourNote ? (
          <span className="flex items-center gap-0.5 rounded bg-white/70 px-1">
            <Check className="size-2.5" aria-hidden />
            note
          </span>
        ) : null}
      </div>
    </div>
  )
}

const nodeTypes = { card: CardNode }

export function CapabilityGraph({ model }: { model: GraphModel }) {
  return (
    <ReactFlowProvider>
      <GraphCanvas model={model} />
    </ReactFlowProvider>
  )
}

const KIND_ORDER: GraphNodeKind[] = ['YOU', 'SKILL', 'EXPERIENCE', 'EVIDENCE', 'ASSESSMENT', 'OPPORTUNITY']

function GraphCanvas({ model }: { model: GraphModel }) {
  const { zoomIn, zoomOut, fitView } = useReactFlow()
  const { resolvedTheme } = useTheme()
  const hydrated = useHydrated()
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [visibleKinds, setVisibleKinds] = useState<GraphNodeKind[]>(KIND_ORDER)
  const [visibleProvenance, setVisibleProvenance] = useState<string[]>(
    model.provenanceTally ? Object.keys(model.provenanceTally) : [],
  )
  const [visibleCategories, setVisibleCategories] = useState<string[]>([])
  const [evidenceOnly, setEvidenceOnly] = useState<'all' | 'with' | 'without'>('all')
  const [query, setQuery] = useState('')
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<string | null>(null)

  const baseNodes = useMemo<Node[]>(
    () =>
      model.nodes.map((node) => ({
        id: node.key,
        type: 'card',
        position: node.position,
        draggable: node.editable,
        data: { node, selected: false },
      })),
    [model.nodes],
  )

  const baseEdges = useMemo<Edge[]>(
    () =>
      model.links.map((link) => ({
        id: link.id,
        source: link.source,
        target: link.target,
        label: link.label,
        labelStyle: { fontSize: 9, fill: 'oklch(0.45 0.05 260)' },
        labelBgStyle: { fill: 'oklch(1 0 0 / 75%)' },
        labelBgPadding: [3, 2] as [number, number],
        labelBgBorderRadius: 3,
        style: EDGE_STYLE[link.kind] ?? EDGE_STYLE.HOLD,
      })),
    [model.links],
  )

  const [nodes, setNodes, onNodesChange] = useNodesState(baseNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(baseEdges)

  useEffect(() => {
    setNodes(baseNodes)
    setEdges(baseEdges)
  }, [baseNodes, baseEdges, setNodes, setEdges])

  // Selection has to live inside node data or the ring never paints.
  useEffect(() => {
    setNodes((current) =>
      current.map((node) => ({ ...node, data: { ...node.data, selected: node.id === selectedKey } })),
    )
  }, [selectedKey, setNodes])

  const provenanceKeys = useMemo(() => Object.keys(model.provenanceTally).sort(), [model.provenanceTally])

  /** Categories are the skill's own taxonomy category, the experience type, or the evidence type. */
  const categories = useMemo(() => {
    const tally = new Map<string, number>()
    for (const node of model.nodes) {
      if (!node.group) continue
      tally.set(node.group, (tally.get(node.group) ?? 0) + 1)
    }
    return [...tally.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  }, [model.nodes])

  const needle = query.trim().toLowerCase()

  const matchesFilters = useCallback(
    (node: GraphNode) => {
      if (!new Set(visibleKinds).has(node.kind)) return false
      // Provenance filtering only constrains the bands that actually exist.
      if (provenanceKeys.length > 0 && node.provenance && !new Set(visibleProvenance).has(node.provenance)) return false
      if (visibleCategories.length > 0 && node.group && !new Set(visibleCategories).has(node.group)) return false
      if (evidenceOnly !== 'all' && node.kind === 'SKILL') {
        const count = Number(node.detail.evidenceCount ?? 0)
        if (evidenceOnly === 'with' && count === 0) return false
        if (evidenceOnly === 'without' && count > 0) return false
      }
      if (needle) {
        const haystack = `${node.label} ${node.sublabel ?? ''} ${node.group ?? ''} ${Object.entries(node.detail)
          .map(([key, value]) => `${key} ${value}`)
          .join(' ')}`.toLowerCase()
        if (!haystack.includes(needle)) return false
      }
      return true
    },
    [visibleKinds, visibleProvenance, visibleCategories, provenanceKeys, evidenceOnly, needle],
  )

  const visibleNodes = useMemo(
    () => nodes.filter((node) => matchesFilters((node.data as FlowNodeData).node)),
    [nodes, matchesFilters],
  )
  const visibleIds = useMemo(() => new Set(visibleNodes.map((node) => node.id)), [visibleNodes])
  const visibleEdges = useMemo(
    () => edges.filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target)),
    [edges, visibleIds],
  )

  const selected = model.nodes.find((node) => node.key === selectedKey) ?? null

  const persistPosition = useCallback(
    (node: Node) => {
      const data = (node.data as FlowNodeData).node
      if (!data.editable) return
      startTransition(async () => {
        const result = await moveGraphNodeAction(data.key, { x: node.position.x, y: node.position.y })
        if (result.ok) {
          setSavedAt(new Date().toLocaleTimeString())
        } else {
          toast.error(result.error ?? 'Could not save that position.')
        }
      })
    },
    [startTransition],
  )

  const hide = (nodeKey: string) => {
    startTransition(async () => {
      const result = await hideGraphNodeAction(nodeKey)
      if (result.ok) {
        setSelectedKey(null)
        toast.success('Node hidden. Restore it from the hidden list.')
        router.refresh()
      } else {
        toast.error(result.error ?? 'Could not hide that node.')
      }
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-4 lg:flex-row">
      <Card className="min-w-0 flex-1 overflow-hidden">
        <CardHeader className="border-b border-border/70 pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">Capability graph</CardTitle>
            <p className="text-xs text-muted-foreground" aria-live="polite">
              {visibleNodes.length}/{model.nodes.length} nodes · {visibleEdges.length}/{model.links.length} links
              {pending ? ' · saving…' : savedAt ? ` · saved ${savedAt}` : ''}
            </p>
          </div>
          <CardDescription>
            You are at the centre. Skills ring outward, each coloured by how the claim was earned; the evidence and
            assessment results that support a skill sit beyond it; experience entries show where a skill was inferred
            from your own wording; and the roles on the right are the ones the matcher currently ranks highest. Drag a
            node and its position is saved. Scroll to zoom, drag the canvas to pan, click a node to inspect it.
          </CardDescription>
          <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
            Where a node sits says nothing about aptitude, seniority or verification. Ring number is the record type
            (skills, then what supports them, then roles), the angle is a layout choice, and only the colour carries
            meaning — it is the stored origin of the claim. The same rows are listed below the canvas as text.
          </p>
        </CardHeader>
        <CardContent className="p-0">
          <div className="h-[640px] w-full">
            <ReactFlow
              nodes={visibleNodes}
              edges={visibleEdges}
              nodeTypes={nodeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onNodeDragStop={(_event, node) => persistPosition(node)}
              onNodeClick={(_event, node) => setSelectedKey(node.id)}
              onPaneClick={() => setSelectedKey(null)}
              fitView
              fitViewOptions={{ padding: 0.18 }}
              minZoom={0.15}
              maxZoom={2}
              colorMode={hydrated && resolvedTheme === 'dark' ? 'dark' : 'light'}
              className="bg-brand-50/30"
            >
              <Background
                gap={26}
                size={1}
                color={hydrated && resolvedTheme === 'dark' ? 'oklch(0.813 0.09 250 / 18%)' : 'oklch(0.511 0.217 263 / 12%)'}
              />
              <MiniMap
                pannable
                zoomable
                className="!h-28 !w-40 rounded-lg border border-border/70 bg-white/80"
                nodeColor={(node) => {
                  const provenance = (node.data as FlowNodeData).node.provenance
                  return provenance === 'ASSESSED' || provenance === 'VERIFIED' ? '#059669' : provenance === 'DISPUTED' ? '#e11d48' : '#2563eb'
                }}
              />
              <Panel position="top-right" className="flex gap-1.5">
                <Button variant="outline" size="icon-sm" onClick={() => void zoomIn()} aria-label="Zoom in">
                  <Plus className="size-4" aria-hidden />
                </Button>
                <Button variant="outline" size="icon-sm" onClick={() => void zoomOut()} aria-label="Zoom out">
                  <Minus className="size-4" aria-hidden />
                </Button>
                <Button
                  variant="outline"
                  size="icon-sm"
                  onClick={() => void fitView({ padding: 0.18 })}
                  aria-label="Fit the graph to the view"
                >
                  <Maximize2 className="size-4" aria-hidden />
                </Button>
              </Panel>
              <Panel position="bottom-left" className="max-w-[min(92%,26rem)] rounded-lg border border-border/70 bg-white/92 px-2.5 py-2 shadow-sm">
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Provenance</p>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                  {PROVENANCE_TIERS.filter((tier) => model.provenanceTally[tier.key]).map((tier) => (
                    <span key={tier.key} className="flex items-center gap-1.5 text-[11px]">
                      <span className={`size-2 rounded-full ${DOT_BY_PROVENANCE[tier.key]}`} aria-hidden />
                      {tier.label}
                      <span className="text-muted-foreground">×{model.provenanceTally[tier.key]}</span>
                    </span>
                  ))}
                  {model.counts.opportunities > 0 ? (
                    <span className="flex items-center gap-1.5 text-[11px]">
                      <span className="size-2 rounded-full bg-sky-500" aria-hidden />
                      Matched role
                    </span>
                  ) : null}
                  <span className="flex items-center gap-1.5 text-[11px]">
                    <span className="h-0 w-4 border-t border-dashed border-amber-500" aria-hidden />
                    Inferred from experience
                  </span>
                </div>
                <p className="mt-1.5 border-t border-border/60 pt-1.5 text-[10px] leading-snug text-muted-foreground">
                  Rings: 1 skills · 2 evidence and assessments · 3 experience and matched roles. Ring and angle are
                  layout only — colour is the stored origin.
                </p>
              </Panel>
            </ReactFlow>
          </div>
        </CardContent>
      </Card>

      <div className="flex w-full shrink-0 flex-col gap-4 lg:w-[22rem]">
        <Card>
          <CardHeader className="pb-2.5">
            <CardTitle className="text-sm">What to show</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2.5">
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {KIND_ORDER.filter((kind) => model.nodes.some((node) => node.kind === kind)).map((kind) => {
                const checked = visibleKinds.includes(kind)
                const count = model.nodes.filter((node) => node.kind === kind).length
                return (
                  <div key={kind} className="flex items-center gap-2">
                    <Checkbox
                      id={`kind-${kind}`}
                      checked={checked}
                      onCheckedChange={(next) =>
                        setVisibleKinds((previous) =>
                          next ? [...previous, kind] : previous.filter((entry) => entry !== kind),
                        )
                      }
                    />
                    <Label htmlFor={`kind-${kind}`} className="flex items-center gap-1.5 text-[12.5px]">
                      {KIND_META[kind].title}
                      <span className="text-xs text-muted-foreground tabular-nums">{count}</span>
                    </Label>
                  </div>
                )
              })}
            </div>

            {provenanceKeys.length > 0 ? (
              <>
                <Separator />
                <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  Skill claims by origin
                </p>
                <div className="flex flex-wrap gap-x-4 gap-y-2">
                  {PROVENANCE_TIERS.filter((tier) => model.provenanceTally[tier.key]).map((tier) => {
                    const checked = visibleProvenance.includes(tier.key)
                    return (
                      <div key={tier.key} className="flex items-center gap-2">
                        <Checkbox
                          id={`prov-${tier.key}`}
                          checked={checked}
                          onCheckedChange={(next) =>
                            setVisibleProvenance((previous) =>
                              next ? [...previous, tier.key] : previous.filter((entry) => entry !== tier.key),
                            )
                          }
                        />
                        <Label htmlFor={`prov-${tier.key}`} className="flex items-center gap-1.5 text-[12.5px]">
                          <span className={`size-2 rounded-full ${DOT_BY_PROVENANCE[tier.key]}`} aria-hidden />
                          {tier.label}
                          <span className="text-xs text-muted-foreground tabular-nums">
                            {model.provenanceTally[tier.key]}
                          </span>
                        </Label>
                      </div>
                    )
                  })}
                </div>
              </>
            ) : null}

            {categories.length > 0 ? (
              <>
                <Separator />
                <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Category</p>
                <div className="flex flex-wrap gap-x-4 gap-y-2">
                  {categories.map(([group, count]) => {
                    const checked = visibleCategories.length === 0 || visibleCategories.includes(group)
                    return (
                      <div key={group} className="flex items-center gap-2">
                        <Checkbox
                          id={`cat-${group}`}
                          checked={checked}
                          onCheckedChange={(next) =>
                            setVisibleCategories((previous) => {
                              const all = previous.length === 0 ? categories.map(([name]) => name) : previous
                              const next_ = next ? [...all, group] : all.filter((entry) => entry !== group)
                              const unique = [...new Set(next_)]
                              // All selected is the same as no filter, which keeps the totals honest.
                              return unique.length === categories.length ? [] : unique
                            })
                          }
                        />
                        <Label htmlFor={`cat-${group}`} className="flex items-center gap-1.5 text-[12.5px]">
                          {label(group)}
                          <span className="text-xs text-muted-foreground tabular-nums">{count}</span>
                        </Label>
                      </div>
                    )
                  })}
                </div>
              </>
            ) : null}

            <Separator />
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Evidence on a skill</p>
            <div className="flex flex-wrap gap-2">
              {([
                ['all', 'Any'],
                ['with', 'With evidence'],
                ['without', 'Without evidence'],
              ] as const).map(([value, text]) => (
                <Button
                  key={value}
                  variant={evidenceOnly === value ? 'default' : 'outline'}
                  size="xs"
                  aria-pressed={evidenceOnly === value}
                  onClick={() => setEvidenceOnly(value)}
                >
                  {text}
                </Button>
              ))}
            </div>

            <div className="mt-1 flex flex-wrap gap-2">
              <Button variant="ghost" size="xs" onClick={() => setVisibleKinds(KIND_ORDER)}>
                Show every kind
              </Button>
              <Button variant="ghost" size="xs" onClick={() => setVisibleProvenance(provenanceKeys)}>
                Show every origin
              </Button>
              <Button variant="ghost" size="xs" onClick={() => setVisibleCategories([])}>
                Show every category
              </Button>
              <Button
                variant="ghost"
                size="xs"
                onClick={() => {
                  setVisibleKinds(KIND_ORDER)
                  setVisibleProvenance(provenanceKeys)
                  setVisibleCategories([])
                  setEvidenceOnly('all')
                  setQuery('')
                }}
              >
                <RotateCcw className="size-3" aria-hidden />
                Reset all filters
              </Button>
            </div>
          </CardContent>
        </Card>

        <NodeInspector
          key={selected?.key ?? 'none'}
          node={selected}
          busy={pending}
          onHide={hide}
          onClose={() => setSelectedKey(null)}
          onSaved={() => {
            setSavedAt(new Date().toLocaleTimeString())
            router.refresh()
          }}
        />

        {model.hidden.length > 0 ? (
          <Card className="border-amber-200 bg-amber-50/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{model.hidden.length} node(s) hidden by you</CardTitle>
              <CardDescription className="text-xs">
                Hiding takes a node off the picture, not off your profile. It still counts in a match.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-1.5">
              {model.hidden.map((entry) => (
                <div key={entry.nodeKey} className="flex items-center justify-between gap-2 text-xs">
                  <span className="min-w-0 truncate">{entry.label}</span>
                  <Button
                    variant="ghost"
                    size="xs"
                    disabled={pending}
                    onClick={() => {
                      const form = new FormData()
                      form.set('nodeKey', entry.nodeKey)
                      startTransition(async () => {
                        const result = await resetGraphNodeAction({ status: 'idle' }, form)
                        if (result.status === 'error') toast.error(result.message)
                        else {
                          toast.success('Back on the graph.')
                          router.refresh()
                        }
                      })
                    }}
                  >
                    <RotateCcw className="size-3" aria-hidden />
                    Restore
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Saved edits on this graph</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2.5 text-xs text-muted-foreground">
            <ul className="flex flex-col gap-1">
              <li>{model.movedCount} node position(s) you moved</li>
              <li>{model.annotatedCount} note or label edit(s) you wrote</li>
              <li>{model.hiddenCount} node(s) hidden</li>
            </ul>
            <ActionForm
              action={resetGraphLayoutAction}
              onSuccess={(message) => {
                toast.success(message ?? 'Layout reset.')
                router.refresh()
              }}
            >
              {({ state, pending: busy }) => (
                <>
                  <SubmitButton pending={busy} variant="outline" size="xs">
                    Reset my layout
                  </SubmitButton>
                  <FormLine state={state} />
                </>
              )}
            </ActionForm>
            <InfoNote tone="info" title="Built from live rows">
              Generated fresh from {model.generatedFrom.join(', ')}. Editing a node here changes the picture; editing a
              skill changes the record — that happens on the skills inventory.
            </InfoNote>
          </CardContent>
        </Card>
      </div>
      </div>

      <GraphList
        nodes={model.nodes.filter(matchesFilters)}
        total={model.nodes.length}
        query={query}
        onQuery={setQuery}
        selectedKey={selectedKey}
        onSelect={setSelectedKey}
      />
    </div>
  )
}

/**
 * The same rows the canvas draws, as a searchable table. It is not a fallback
 * for broken images: it is the accessible reading of the graph, it obeys the
 * filters above it, and selecting a row opens the same inspector.
 */
function GraphList({
  nodes,
  total,
  query,
  onQuery,
  selectedKey,
  onSelect,
}: {
  nodes: GraphNode[]
  total: number
  query: string
  onQuery: (value: string) => void
  selectedKey: string | null
  onSelect: (key: string) => void
}) {
  const ordered = [...nodes].sort((a, b) => a.kind.localeCompare(b.kind) || a.label.localeCompare(b.label))

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="text-base">Graph as a list</CardTitle>
            <CardDescription>
              Every node the canvas is drawing, with the stored values behind it. Filters above apply here too.
            </CardDescription>
          </div>
          <div className="w-full max-w-xs">
            <Label htmlFor="graph-search" className="text-xs">
              Search nodes
            </Label>
            <div className="relative mt-1.5">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                id="graph-search"
                value={query}
                onChange={(event) => onQuery(event.target.value)}
                placeholder="Skill, role, category or evidence type"
                className="pl-8"
              />
            </div>
          </div>
        </div>
        <p className="text-xs text-muted-foreground" role="status" aria-live="polite">
          {ordered.length} of {total} nodes shown
          {query.trim() ? ` for “${query.trim()}”` : ''}
        </p>
      </CardHeader>
      <CardContent className="p-0">
        {ordered.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            No node matches these filters. Clear the search, or use “Reset all filters” above.
          </p>
        ) : (
          <div className="max-h-96 overflow-y-auto">
            <table className="w-full text-left text-xs">
              <caption className="sr-only">
                Nodes currently drawn on the capability graph, with their stored category, origin, level and evidence
                count.
              </caption>
              <thead className="sticky top-0 bg-muted/80 text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-2 font-medium">Node</th>
                  <th scope="col" className="px-2 py-2 font-medium">Type</th>
                  <th scope="col" className="px-2 py-2 font-medium">Category</th>
                  <th scope="col" className="px-2 py-2 font-medium">Origin</th>
                  <th scope="col" className="px-2 py-2 text-right font-medium">Level</th>
                  <th scope="col" className="px-2 py-2 text-right font-medium">Evidence</th>
                  <th scope="col" className="px-4 py-2 text-right font-medium">Open</th>
                </tr>
              </thead>
              <tbody>
                {ordered.map((node) => (
                  <tr key={node.key} className={node.key === selectedKey ? 'bg-brand-50/70' : 'border-t border-border/60'}>
                    <th scope="row" className="max-w-[16rem] px-4 py-2 font-medium">
                      <span className="block truncate">{node.label}</span>
                      {node.sublabel ? <span className="block truncate text-[11px] font-normal text-muted-foreground">{node.sublabel}</span> : null}
                    </th>
                    <td className="px-2 py-2">{KIND_META[node.kind].title}</td>
                    <td className="px-2 py-2">{node.group ? label(node.group) : '—'}</td>
                    <td className="px-2 py-2">
                      {node.provenance ? (
                        <span className="flex items-center gap-1.5">
                          <span className={`size-2 shrink-0 rounded-full ${DOT_BY_PROVENANCE[node.provenance] ?? 'bg-slate-400'}`} aria-hidden />
                          {PROVENANCE_TIERS.find((tier) => tier.key === node.provenance)?.label ?? node.provenance}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {node.kind === 'SKILL' && node.detail.level ? label(String(node.detail.level)) : '—'}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {node.kind === 'SKILL' ? String(node.detail.evidenceCount ?? 0) : '—'}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <Button
                        variant={node.key === selectedKey ? 'secondary' : 'ghost'}
                        size="xs"
                        onClick={() => onSelect(node.key)}
                        aria-pressed={node.key === selectedKey}
                        aria-label={`${node.key === selectedKey ? 'Selected' : 'Inspect'} ${node.label}`}
                      >
                        {node.key === selectedKey ? 'Selected' : 'Inspect'}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function FormLine({ state }: { state: { status: string; message?: string } }) {
  if (state.status === 'idle') return null
  return (
    <p
      className={`text-xs ${state.status === 'error' ? 'text-destructive' : 'text-emerald-800'}`}
      role={state.status === 'error' ? 'alert' : 'status'}
    >
      {state.message}
    </p>
  )
}

function NodeInspector({
  node,
  busy,
  onHide,
  onClose,
  onSaved,
}: {
  node: GraphNode | null
  busy: boolean
  onHide: (nodeKey: string) => void
  onClose: () => void
  onSaved: () => void
}) {
  if (!node) {
    return (
      <Card>
        <CardContent className="pt-5 text-sm text-muted-foreground">
          Click any node to read where it came from, what supports it, and to edit how it sits on the graph.
        </CardContent>
      </Card>
    )
  }

  const detailEntries = Object.entries(node.detail).filter(
    ([, value]) => value !== null && value !== '' && typeof value !== 'object',
  )

  return (
    <Card className="border-brand-200 bg-brand-50/30">
      <CardHeader className="pb-2.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="truncate text-sm">{node.label}</CardTitle>
            <CardDescription className="mt-1 text-xs">{KIND_META[node.kind].hint}</CardDescription>
          </div>
          <Button variant="ghost" size="icon-xs" onClick={onClose} aria-label="Close node details">
            <X className="size-3.5" aria-hidden />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {node.provenance ? (
          <div
            className={`rounded-lg border px-2.5 py-2 text-xs leading-relaxed ${TONE_BY_PROVENANCE[node.provenance] ?? ''}`}
          >
            <p className="flex items-center gap-1.5 font-semibold">
              <span className={`size-2 rounded-full ${DOT_BY_PROVENANCE[node.provenance] ?? ''}`} aria-hidden />
              {PROVENANCE_TIERS.find((tier) => tier.key === node.provenance)?.label ?? node.provenance}
            </p>
            <p className="mt-1">{node.provenanceNote ?? provenanceBlurb(node.provenance)}</p>
          </div>
        ) : node.provenanceNote ? (
          <p className="rounded-lg border border-dashed border-border bg-white/70 px-2.5 py-2 text-xs leading-relaxed">
            {node.provenanceNote}
          </p>
        ) : null}

        {node.confidence != null && node.kind === 'SKILL' ? (
          <div>
            <div className="flex items-baseline justify-between">
              <span className="text-xs text-muted-foreground">Stored confidence</span>
              <span className="text-xs font-semibold tabular-nums">{Math.round(node.confidence * 100)}%</span>
            </div>
            <Progress value={Math.round(node.confidence * 100)} className="mt-1 h-2" aria-label={`${node.label} confidence`} />
          </div>
        ) : null}

        {node.kind === 'OPPORTUNITY' ? (
          <div className="flex flex-wrap gap-1.5 text-[11px]">
            <Badge variant="secondary">match {String(node.detail.score ?? '')}%</Badge>
            <Badge variant="secondary">required {String(node.detail.requiredCoverage ?? '')}%</Badge>
            <Badge variant="secondary">evidence {String(node.detail.evidenceStrength ?? '')}%</Badge>
            <StatusBadge value={String(node.detail.status ?? '')} />
          </div>
        ) : null}

        <dl className="grid grid-cols-2 gap-x-2 gap-y-1.5 text-[11.5px]">
          {detailEntries.map(([key, value]) => (
            <div key={key} className="min-w-0">
              <dt className="truncate text-muted-foreground">{humanise(key)}</dt>
              <dd className="break-words font-medium">
                {typeof value === 'boolean' ? (value ? 'yes' : 'no') : String(value)}
              </dd>
            </div>
          ))}
        </dl>

        <Separator />

        <div className="flex flex-wrap gap-2">
          {node.kind === 'SKILL' && node.recordId ? (
            <EvidenceFormDialog candidateSkillId={node.recordId} skillName={node.label} />
          ) : null}
          {node.kind === 'SKILL' ? (
            <Button variant="outline" size="xs" nativeButton={false} render={<Link href="/candidate/skills" />}>
              Change level or status
            </Button>
          ) : null}
          {node.kind === 'OPPORTUNITY' && node.recordId ? (
            <Button
              variant="outline"
              size="xs"
              nativeButton={false}
              render={<Link href={`/candidate/jobs/${node.recordId as string}`} />}
            >
              Open the role
            </Button>
          ) : null}
          {node.kind === 'ASSESSMENT' ? (
            <Button variant="outline" size="xs" nativeButton={false} render={<Link href="/candidate/assessments" />}>
              Take another assessment
            </Button>
          ) : null}
          {node.kind === 'EXPERIENCE' ? (
            <Button variant="outline" size="xs" nativeButton={false} render={<Link href="/candidate/experiences" />}>
              Edit that entry
            </Button>
          ) : null}
          {node.editable ? (
            <Button variant="ghost" size="xs" disabled={busy} onClick={() => onHide(node.key)}>
              Hide this node
            </Button>
          ) : null}
        </div>

        {node.editable ? (
          <ActionForm
            action={editGraphNodeAction}
            className="gap-3"
            onSuccess={(message) => {
              toast.success(message ?? 'Saved.')
              onSaved()
            }}
          >
            {({ state, pending: busyForm }) => (
              <>
                <HiddenFields fields={{ nodeKey: node.key }} />
                <TextField
                  id="labelOverride"
                  label="Label on the graph"
                  state={state}
                  defaultValue={node.label}
                  placeholder={node.label}
                  help="Only the wording on the picture. The skill name in your inventory is unchanged."
                />
                <TextAreaField
                  id="note"
                  label="Your note about this node"
                  rows={3}
                  state={state}
                  defaultValue={typeof node.detail.yourNote === 'string' ? node.detail.yourNote : ''}
                  placeholder="What this meant in practice, or why you keep it."
                />
                <div className="flex flex-wrap items-center gap-2">
                  <SubmitButton pending={busyForm}>Save node</SubmitButton>
                  <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    {busy ? <Loader2 className="size-3 animate-spin" aria-hidden /> : null}
                    Positions save on their own when you drag.
                  </span>
                </div>
                {state.status === 'error' ? (
                  <p className="text-xs text-destructive" role="alert">
                    {state.message}
                  </p>
                ) : null}
              </>
            )}
          </ActionForm>
        ) : null}

        <p className="text-[11px] text-muted-foreground">
          {node.provenance && node.provenance !== 'VERIFIED' && node.provenance !== 'ASSESSED' ? (
            <span className="flex items-start gap-1.5">
              <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden />
              Nothing here has been independently verified. The graph shows what the platform holds and how it got
              there.
            </span>
          ) : (
            'Supporting detail is stored on the platform; there is no external check behind any of it.'
          )}
        </p>
      </CardContent>
    </Card>
  )
}

function humanise(key: string) {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (character) => character.toUpperCase())
    .trim()
}
