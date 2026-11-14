import Link from 'next/link'
import { requirePermission } from '@/lib/authz'
import { prisma } from '@/lib/db'
import { listUploads } from '@/server/ai/uploads'
import { ownProfileWhere } from '@/server/candidate'
import { formatDateTime } from '@/lib/utils'
import { label } from '@/lib/options'
import { EvidenceUploadForm } from '@/components/candidate/evidence-upload-form'
import { ActionSubmit } from '@/components/candidate/action-submit'
import { removeUploadAction } from '@/server/actions/ai'
import { EmptyState, InfoNote, PageHeader, StatCard, StatusBadge } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export const metadata = { title: 'Evidence documents' }

export default async function CandidateEvidencePage() {
  const principal = await requirePermission('candidate.skills.read')

  if (!principal.candidateProfileId) {
    return (
      <div className="space-y-6">
        <PageHeader eyebrow="Evidence" title="Documents" description="No candidate profile is attached to this account." />
        <EmptyState
          title="Onboarding comes first"
          description="Documents attach to skills on a candidate profile."
          action={
            <Button className="bg-brand-600 hover:bg-brand-700" nativeButton={false} render={<Link href="/candidate/onboarding" />}>
              Start onboarding
            </Button>
          }
        />
      </div>
    )
  }

  const [uploads, profile] = await Promise.all([
    listUploads(principal),
    prisma.candidateProfile.findFirst({
      where: ownProfileWhere(principal),
      include: { skills: { include: { skill: { select: { name: true, slug: true } } }, orderBy: { confidence: 'desc' } } },
    }),
  ])

  const skillOptions = (profile?.skills ?? []).map((entry) => ({
    value: entry.id,
    label: `${entry.skill.name} — ${label(entry.level).toLowerCase()}`,
  }))

  const pending = uploads.filter((upload) => upload.status === 'PENDING')
  const accepted = uploads.filter((upload) => upload.status === 'ACCEPTED')

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Evidence"
        title="Supporting documents"
        description="Certificates, artefacts or reports you want behind a skill. A reviewer can accept or reject them; uploading one never changes a status by itself."
        actions={
          <>
            <Button variant="outline" nativeButton={false} render={<Link href="/candidate/skills" />}>
              Skills inventory
            </Button>
            <Button variant="ghost" nativeButton={false} render={<Link href="/candidate/graph" />}>
              Capability graph
            </Button>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Documents stored" value={uploads.length} hint="This build keeps them on the server’s disk" tone="neutral" />
        <StatCard label="Waiting for review" value={pending.length} hint={pending.length > 0 ? 'an administrator has to decide' : 'nothing queued'} tone={pending.length > 0 ? 'warning' : 'positive'} />
        <StatCard label="Reviewer accepted" value={accepted.length} hint="These carry the human-reviewed claim" tone="positive" />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Your documents</CardTitle>
            <CardDescription className="text-xs">
              Each row is a stored file with the checksum recorded at upload. Downloading re-verifies that checksum.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {uploads.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing uploaded yet. A skill with a written evidence line works just as well — a document is only
                useful if it is something a reviewer could actually read.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {uploads.map((upload) => (
                  <li key={upload.id} className="rounded-xl border border-border/70 bg-muted/20 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{upload.filename}</p>
                        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                          {upload.mimeType} · {(upload.sizeBytes / 1024).toFixed(0)} KB · {formatDateTime(upload.createdAt)}
                          {upload.candidateSkillId ? ' · attached to a skill' : ' · not yet attached'}
                        </p>
                      </div>
                      <StatusBadge value={upload.status} />
                    </div>
                    {upload.reviewNote ? (
                      <p className="mt-1.5 text-xs leading-relaxed">
                        <span className="font-medium">Reviewer note:</span> {upload.reviewNote}
                      </p>
                    ) : null}
                    <p className="mt-1.5 flex flex-wrap items-center gap-2 text-[10.5px] text-muted-foreground">
                      sha256 <span className="truncate font-mono">{upload.sha256.slice(0, 16)}…</span>
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Button variant="outline" size="xs" nativeButton={false} render={<Link href={`/api/evidence/${upload.id}`} />}>
                        Open
                      </Button>
                      <ActionSubmit
                        action={removeUploadAction}
                        fields={{ uploadId: upload.id }}
                        label="Remove"
                        pendingLabel="Removing…"
                        variant="ghost"
                        size="xs"
                        showStatus={false}
                        formClassName="contents"
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {skillOptions.length === 0 ? (
          <EmptyState
            title="No skill to attach a document to"
            image="evidence-portfolio"
            description="Add a skill first — evidence is only meaningful when it supports a named claim."
            action={
              <Button variant="outline" nativeButton={false} render={<Link href="/candidate/skills" />}>
                Skills inventory
              </Button>
            }
          />
        ) : (
          <EvidenceUploadForm skills={skillOptions} />
        )}
      </div>

      <InfoNote tone="privacy" title="Who can read these">
        Only you and an administrator can open a stored document — the download route checks ownership against the
        profile id on the row, and refuses if the checksum no longer matches. An employer sees that a document exists
        and its review status, never the file itself.
      </InfoNote>
    </div>
  )
}
