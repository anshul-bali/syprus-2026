import Link from 'next/link'
import { requirePermission } from '@/lib/authz'
import { prisma } from '@/lib/db'
import { activeWeights, listWeightProfiles } from '@/server/weights'
import { DEFAULT_WEIGHTS, WEIGHTS_VERSION, EVIDENCE_WEIGHT_BY_STATUS } from '@/lib/engines/matching'
import { formatDateTime } from '@/lib/utils'
import { label } from '@/lib/options'
import { ActiveWeightReadout, WeightEditor } from '@/components/admin/weights-editor'
import { InfoNote, PageHeader } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

export const metadata = { title: 'Matching weights' }

export default async function AdminWeightsPage() {
  const principal = await requirePermission('admin.reporting.read')

  const [active, profiles, scoreVersions] = await Promise.all([
    activeWeights(),
    listWeightProfiles(principal),
    prisma.match.groupBy({ by: ['weightVersion'], _count: { _all: true }, orderBy: { _count: { weightVersion: 'desc' } } }),
  ])

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Governance"
        title="Matching weights"
        description="The four buckets a match score is built from, how much each counts, and which stored scores were produced by which assumption. Prompt 3 asks for these to be configurable prototype values, so they are stored, versioned and editable rather than baked into code."
        actions={
          <>
            <Button variant="outline" nativeButton={false} render={<Link href="/admin/fairness" />}>
              Fairness monitoring
            </Button>
            <Button variant="ghost" nativeButton={false} render={<Link href="/admin/engines" />}>
              Agent health
            </Button>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[24rem_minmax(0,1fr)] lg:items-start">
        <div className="flex flex-col gap-4">
          <ActiveWeightReadout
            values={{
              version: active.version,
              label: 'active',
              ...active.weights,
            }}
            version={active.version}
            source={active.source === 'database' ? 'the weight_profiles table' : `built-in defaults (${WEIGHTS_VERSION})`}
          />

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Evidence strength by validation status</CardTitle>
              <CardDescription className="text-xs">
                How much a claim counts inside the evidence bucket, ordered by how the status was earned.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-1.5">
              {Object.entries(EVIDENCE_WEIGHT_BY_STATUS).map(([status, value]) => (
                <div key={status} className="flex items-center justify-between gap-2 text-xs">
                  <span>{label(status)}</span>
                  <span className="tabular-nums">{value.toFixed(2)}</span>
                </div>
              ))}
              <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                Combined as 0.55 × status weight + 0.35 × stored confidence + 0.05 per evidence row (max 3), then
                clamped to 0–1.
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <WeightEditor
            activeVersion={active.version}
            defaults={{
              version: active.version,
              label: 'Prototype weights — skills-first',
              required: DEFAULT_WEIGHTS.required,
              preferred: DEFAULT_WEIGHTS.preferred,
              evidence: DEFAULT_WEIGHTS.evidence,
              preferences: DEFAULT_WEIGHTS.preferences,
            }}
          />

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Stored weight profiles ({profiles.length})</CardTitle>
              <CardDescription className="text-xs">
                Every set ever saved, including inactive ones, so a historical score can be traced to its assumption.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {profiles.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nothing saved yet — the engine is using its built-in defaults ({WEIGHTS_VERSION}).
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Version</TableHead>
                      <TableHead>Label</TableHead>
                      <TableHead>R / P / E / C</TableHead>
                      <TableHead>Active</TableHead>
                      <TableHead>Updated</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {profiles.map((profile) => (
                      <TableRow key={profile.id}>
                        <TableCell className="font-mono text-xs">{profile.version}</TableCell>
                        <TableCell className="text-xs">{profile.label}</TableCell>
                        <TableCell className="text-xs tabular-nums">
                          {Math.round(profile.required * 100)} / {Math.round(profile.preferred * 100)} /{' '}
                          {Math.round(profile.evidence * 100)} / {Math.round(profile.preferences * 100)}
                        </TableCell>
                        <TableCell>{profile.active ? 'yes' : 'no'}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{formatDateTime(profile.updatedAt)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Scores grouped by the weights that produced them</CardTitle>
              <CardDescription className="text-xs">
                {scoreVersions.reduce((total, row) => total + row._count._all, 0)} match rows in total.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {scoreVersions.map((row) => (
                <div key={row.weightVersion} className="flex items-center justify-between gap-2 text-xs">
                  <span className="font-mono">{row.weightVersion}</span>
                  <span className="tabular-nums">{row._count._all} score(s)</span>
                </div>
              ))}
              {scoreVersions.length === 0 ? <p className="text-xs text-muted-foreground">No scores stored yet.</p> : null}
            </CardContent>
          </Card>
        </div>
      </div>

      <InfoNote tone="warning" title="Recomputing rewrites the ranking, not the facts">
        A new weight set changes the order of stored scores but nothing about a candidate’s skills, evidence or break.
        Roles with no preferred skills hand that bucket’s weight to the categories that have data, so an empty category
        cannot silently inflate a match.
      </InfoNote>
    </div>
  )
}
