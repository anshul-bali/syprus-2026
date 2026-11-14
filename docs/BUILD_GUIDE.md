# SYPRUS build guide (read before writing any page)

This file is the contract between the foundation layer and every screen. It records the
non-obvious facts about **this** stack, which differs from older Next.js / shadcn defaults.

---

## 1. Stack facts that will bite you

| Fact | Consequence |
| --- | --- |
| Next.js **16.4.5**, App Router, Turbopack, React 19.3 | `middleware.ts` no longer exists — it is `src/proxy.ts` (already written). Do not add middleware. |
| `next.config.ts` sets `cacheComponents: false` | `cookies()`/`auth()` make a route dynamic, as expected. Do not use `"use cache"`, `cacheLife`, `cacheTag` or `partialPrefetching` — they require `cacheComponents: true`. |
| `params` and `searchParams` are **Promises** | `const { jobId } = await props.params` in pages/layouts. |
| Server actions are POSTs to the current route | `revalidatePath('/candidate/skills')` after every mutation. `revalidateTag` needs a second argument in 16 — prefer `revalidatePath`. |
| `useActionState(action, initialState)` where the action is `(prevState, formData) => newState` | Never the old `(formData, prevState)` order. |
| Passing an id to an action: use `.bind` | `<form action={saveSkill.bind(null, skillId)}>` — do not put ids in hidden inputs. |
| A plain `<form action={fn}>` requires `fn` to return `void` | Actions used directly in a form must be `Promise<void>`; only `useActionState` actions may return `ActionState`. See `src/server/actions/notifications.ts`, which has both shapes. |
| `error.tsx` receives `retry` (not `reset`) | Not needed yet; note it if you add one. |
| shadcn style is **`base-nova`** → primitives are `@base-ui/react` v1.9, **not Radix** | See section 3. |
| `cn` comes from the npm package `cn` | `src/lib/utils.ts` re-exports it; `import { cn } from '@/lib/utils'` is correct in app code. |
| ESLint flat config; `next lint` removed | Use `npm run lint`. |

Never import Prisma enum *values* into a Client Component. Use the literal arrays and
`label()` in `src/lib/options.ts`.

---

## 2. Auth, authorisation and data access

- Session: Auth.js v5 credentials + JWT (`src/lib/auth.ts`). The JWT carries **only** the user id.
- `src/lib/authz.ts` is the authority:
  - `getPrincipal()` — DB-accurate principal (role, status, org, candidate profile, permissions). Cached per request.
  - `requirePrincipal()` / `requireRole('EMPLOYER')` / `requirePermission('…')` — **redirecting** guards for pages and layouts.
  - `assertPermission(principal, '…')` / `assertRole` — **throwing** guards for server functions (`AccessDeniedError`).
  - `requireOrgJob(jobId, permission)` / `requireOrgApplication(...)` — ownership-scoped loaders for employer screens.
- Permission keys are defined in `src/lib/permissions.ts` and seeded into the `roles` /
  `role_permissions` tables. **Use a real key for every screen**; list them in the module you write.
- Every query must be scoped. Candidate: `candidateProfileId === principal.candidateProfileId`.
  Employer: `organizationId === principal.organizationId`. Never read another tenant's rows.
- Employer-facing candidate data goes through `src/server/anonymize.ts` only.
- Mutations call `recordAudit({ actor, action, entityType, entityId, metadata })`
  (`src/server/audit.ts`) — this is what populates the real audit log.

Services already exist — **do not duplicate them**. Read their exports before writing a page:

```
src/server/candidate.ts     updateProfile, addExperience, removeExperience, addSkill,
                            removeSkill, addEvidence, removeEvidence, setConsent,
                            consentMap, getCandidateOverview, refreshProfileCompletion,
                            buildChecklist, recomputeYearsOfExperience
src/server/onboarding.ts    ONBOARDING_STEPS, startOrResumeConversation, answerStep,
                            conversationTranscript, stepByKey, nextStepKey
src/server/matching.ts      computeMatchesForProfile, recommendedJobs,
                            matchForCandidateAndJob, candidatesForJob, jobSkillSummary
src/server/gap.ts           generateGapReport, storedGapReports, parseStoredReport
src/server/pathway.ts       generateLearningPlan, setPlanItemStatus, activePlans,
                            catalogueForSlugs
src/server/jobs.ts          createJob, updateJob, setJobLifecycle, listOrgJobs,
                            getJobForEmployer, publishedJobs, requireEmployerOrg
src/server/applications.ts  applyToJob, withdrawApplication, updateApplicationStatus,
                            candidateApplications, organizationApplications,
                            shortlistCandidate, removeShortlistEntry, shortlistForJob,
                            EMPLOYER_TRANSITIONS
src/server/accounts.ts      registerCandidate, registerEmployer, getOrganization,
                            updateOrganization, setOrganizationVerification,
                            listOrganizations, setUserStatus
src/server/admin.ts         listUsers, moderationQueue, moderateJob, reportingDashboard,
                            fairnessReport
src/server/notifications.ts notifyUser, notifyOrganization, listNotifications,
                            unreadNotificationCount, markNotificationRead,
                            markAllNotificationsRead
src/server/engine-log.ts    runEngine, engineHealth, engineLabel
src/server/audit.ts         recordAudit, readAuditLog
src/server/skill-catalog.ts loadCatalogSkills, candidateSkillViews, jobSkillViews,
                            jobSkillViewsForJobIds, hasConsent, effectiveConsents
```

Validation: every form input is parsed with `parseFormData(formData, schema)` or
`parseJsonField(formData, 'payload', schema)` from `src/lib/validation.ts`. Complex repeating
rows (job skill pickers) go through one hidden `payload` JSON field. Both helpers return
`{ ok, data } | { ok: false, error, fieldErrors }` — feed that straight into `errorState`.

---

## 3. UI kit (Base UI) — the five rules

1. **No `asChild`.** Polymorphism is the `render` prop, and components that default to a
   native `<button>` need `nativeButton={false}` when they render a link:
   ```tsx
   <Button nativeButton={false} render={<Link href="/candidate/skills" />}>Skills</Button>
   <SheetTrigger render={<Button variant="outline" size="icon" />}><Menu /></SheetTrigger>
   <DropdownMenuItem render={<Link href="/x" />}>Label</DropdownMenuItem>   // no nativeButton needed
   <Badge render={<Link href="/x" />}>Label</Badge>                          // no nativeButton prop
   ```
2. **`<Progress value={number}>` is required** — there is no `defaultValue`; omitting it throws.
3. **`<TabsTrigger value="…">` and `<TabsContent value="…">` both require `value`.**
   `<Tabs defaultValue="…">`, `onValueChange(value, eventDetails)`.
4. **`<Select>` is the raw Base UI root.** Options are `<SelectItem value="…">` children; put the
   `items` map on the root so the trigger can show labels; `<SelectValue placeholder="…" />` must
   be inside `<SelectTrigger>`; `name`/`required` go on `<Select>` (it renders the hidden input).
   ```tsx
   <Select name="workMode" items={WORK_MODE_ITEMS} required>
     <SelectTrigger className="w-full"><SelectValue placeholder="Choose a work mode" /></SelectTrigger>
     <SelectContent>
       {WORK_MODE_ITEMS.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
     </SelectContent>
   </Select>
   ```
5. **`<Tooltip>` must be wrapped in `<TooltipProvider>`.** `Checkbox` and `Switch` render a real
   hidden `<input>`, so `name` works in FormData; unchecked fields are simply absent, and my Zod
   `booleanField` treats absent as `false` and `'on'` as `true`. `AlertDialogAction` does **not**
   close the dialog — put a server action inside it and let navigation happen, or nest a `Close`.

Available shadcn components: `alert alert-dialog avatar badge button card checkbox dialog
dropdown-menu input label popover progress radio-group scroll-area select separator sheet
skeleton sonner switch table tabs textarea tooltip`. `Dialog/Sheet/AlertDialog` content components
**self-portal** — never wrap them in a `…Portal`.

Shared app components in `src/components/common/index.tsx`: `BrandMark, PageHeader, EmptyState,
ErrorState, StatCard, ScoreBar, StatusBadge, InfoNote, FieldRow, SummaryCard, DemoBadge`.
Form helpers in `src/components/forms/form-parts.tsx`: `FormStatus, FieldError`.
Icons for nav: `src/components/app-shell/icon-map.tsx`.

Brand tokens exist as real utilities: `bg-brand-600`, `text-brand-50`, `border-brand-200`, plus
`bg-teal-600`, `text-plum-500`, `bg-sand-100`. Primary buttons in this app are
`className="bg-brand-600 hover:bg-brand-700"`.

---

## 4. Page pattern to copy

Server component page (`src/app/(portal)/…/page.tsx`):

```tsx
import { requirePermission } from '@/lib/authz'
import { getCandidateOverview } from '@/server/candidate'
import { PageHeader, EmptyState, StatCard } from '@/components/common'

export const metadata = { title: 'Skills inventory' }

export default async function SkillsPage(props: { params: Promise<{ skillId: string }> }) {
  const { skillId } = await props.params          // params/searchParams are Promises
  const principal = await requirePermission('candidate.skills.read')
  const skills = await getCandidateOverview(principal.userId)

  if (!skills || skills.profile.skills.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader title="Skills inventory" description="…" />
        <EmptyState title="No skills yet" description="…" action={<…>} />
      </div>
    )
  }

  return <div className="space-y-6">{/* cards, tables, ScoreBar */}</div>
}
```

Server function file (`src/server/actions/<area>.ts`, first line `'use server'`):

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { getPrincipal, AccessDeniedError } from '@/lib/authz'
import { parseFormData, candidateSkillSchema } from '@/lib/validation'
import { errorState, successState, type ActionState } from '@/lib/action-state'
import { addSkill } from '@/server/candidate'

export async function addSkillAction(prevState: ActionState, formData: FormData): Promise<ActionState> {
  const principal = await getPrincipal()
  if (!principal) return errorState('Your session has ended. Sign in again.')

  const parsed = parseFormData(formData, candidateSkillSchema)
  if (!parsed.ok) return errorState(parsed.error, parsed.fieldErrors)

  try {
    await addSkill(principal, parsed.data)
  } catch (error) {
    return errorState(error instanceof AccessDeniedError ? error.message : 'Could not save that skill.')
  }

  revalidatePath('/candidate/skills')
  return successState('Skill saved to your inventory.')
}
```

Client form: `const [state, formAction, pending] = useActionState(addSkillAction, IDLE_STATE)`,
`<form action={formAction}>`, `<FormStatus state={state} />`, `<FieldError state={state} name="…" />`,
disable the submit while `pending`, and `import { toast } from 'sonner'` for non-form feedback.

---

## 5. States, accessibility, honesty

- Every list/detail screen needs **all three**: populated, empty (`EmptyState`), and a failure path.
  Wrap data-heavy routes in a `loading.tsx` with `Skeleton`s. Route-level `error.tsx` uses `retry`.
- No button may exist that does nothing. No link may point at an unwritten route.
- Every input has a `<Label htmlFor>`; errors get `role="alert"` (use `FieldError`) and
  `aria-describedby`; destructive actions get a confirm (`AlertDialog`) or an explicit note.
- Use `relativeTime`, `formatDate`, `formatMonths`, `label`, `titleCase`, `toPercent` from
  `src/lib/utils.ts` / `src/lib/options.ts` instead of re-implementing formatting.
- **Claims discipline.** The engines are rule based. Never write copy that says skills are
  "AI-verified", that bias is "eliminated", that data is "live job-market intelligence", or that
  the platform places people in jobs. Seeded people, organisations, roles and resources are
  demonstration data — label them with `DemoBadge` or an `InfoNote`.

## 6. Verify before finishing

```bash
npm run typecheck        # must be clean
npm run lint             # must be clean
npm test                 # unit checks, no database
npm run test:integration # service + HTTP checks; uses its own local QA database
npm run test:e2e         # production build, then the Playwright journeys
npm run check:security   # migration state and database privilege surface
```

`npm run db:seed` is **destructive** — it deletes accounts, roles, matches and every
agent row on the database in `.env` and rewrites the demonstration set. Run it only on a
database you own and expect to lose. `npm run qa:seed` does the same thing, but only
against the isolated `syprus_qa` cluster, which is why the QA commands exist.

## 7. Rules this QA pass added

Each of these prevents a bug that survived an earlier round of testing:

1. **`redirect()` goes outside the `try`.** It works by throwing, so a `catch` around it
   swallows the navigation and the user sees nothing happen.
2. **A form field's `name` is what the action reads.** `id` exists for the label and the
   error link. When several forms share one page, keep `id` unique and let `name` stay
   stable: `<TextAreaField id={`note-${task.id}`} name="note" />`.
3. **Percent inputs are converted at the boundary.** The engine stores fractions; the
   editor displays whole percentages. Convert once, in the action.
4. **A server component may not pass a function as a client child.** Extract the form into
   its own client component instead of `ActionForm`'s render prop with server data.
5. **Anything an employer can read about a candidate goes through `toAnonymizedProfile`,**
   and free-text fields are gated on `revealIdentity`, not just the name and email columns.
6. **Identity comes from a consent act,** recorded as `applications.identityConsentAt` or an
   approved, unexpired `identity_disclosure_requests` row. Never from "a row exists".
7. **Provider credentials are bound to one exact HTTPS origin.** Add a provider by adding
   its canonical base URL to `PROVIDER_BASES`; never widen matching to "any allowed host".
8. **`next build` must stay warning-free.** A dynamically composed filesystem path makes
   the bundler trace the whole project; scope it under a literal subfolder.
9. **Tests run against the production server.** Dev-mode hot reload detaches elements and
   has produced failures that were not product bugs.
