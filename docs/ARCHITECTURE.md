# SYPRUS architecture

## Layers

```
Browser
  └─ Client components (forms, graph, charts)        src/components/**
       │  server functions (POST to the current route, .bind for ids)
       ▼
Route layer                                          src/app/**
  ├─ (public)   landing, login, register, no-access
  ├─ (portal)   candidate / employer / admin, per-role layouts
  ├─ api/       health, jobs, skills, matches/recompute, auth/[...nextauth]
  └─ proxy.ts   Next 16 redirect-only guard (was middleware)
       │  requirePermission / requireRole (redirecting)
       ▼
Authorisation                                        src/lib/authz.ts, src/lib/auth.ts
  └─ getPrincipal(): DB-accurate role, status, org, permissions per request
       │  typed DTOs validated by Zod
       ▼
Services                                             src/server/**
  ├─ accounts, candidate, onboarding, jobs, applications,
  │  matching, gap, pathway, admin, anonymize, notifications, audit, engine-log
  └─ own every mutation: permission assert → write → audit → notify
       │  pure inputs / pure outputs
       ▼
Rule engines (no I/O, unit-testable)                 src/lib/engines/**
  ├─ inference.ts   keyword → skill suggestions + phrases
  ├─ matching.ts    weighted coverage → score + full explanation
  ├─ gap.ts         target skill set → readiness, strengths, prioritised gaps
  ├─ pathway.ts     gaps + catalogue → ordered learning plan
  └─ fairness.ts    stored scores → band stats, correlation, verdict
       │
       ▼
PostgreSQL via Prisma                                prisma/schema.prisma
```

The split that matters: **engines are pure** (they take plain arrays and return plain objects, so
the same code runs in the seed script, a page render, or a unit test), **services own side effects**
(authorisation, persistence, audit, notifications), and **route components own presentation only**.

## The four agents and where they live

| Product name | Engine | Persists to | Mode |
| --- | --- | --- | --- |
| Skills Discovery Agent | `inference.ts` | `candidate_skills`, `skill_evidence` | rule-based keyword match against `skills.aliases` |
| Capability Graph Agent | `taxonomy/skills.ts` `relatedSlugs` + `candidate_skills` | reads only | taxonomy relationships, rendered with `@xyflow/react` |
| Gap & Pathway Agent | `gap.ts`, `pathway.ts` | `skill_gap_reports`, `learning_plans`, `learning_plan_items` | severity ranking + catalogue lookup |
| Matching & Fairness Agent | `matching.ts`, `fairness.ts` | `matches`, `engine_runs` | weighted coverage model + descriptive statistics |

Every run is recorded in `engine_runs` by `runEngine()` (status, duration, items processed, error),
which is what the administrator health screen reports.

## Skills-first, and how it is enforced rather than asserted

`src/lib/engines/types.ts` declares `MATCH_INPUT_FIELDS` and `MATCH_EXCLUDED_FIELDS`. The scorer
only receives candidate skill levels/confidence/evidence counts, job skill requirements/weights,
stated years of experience and the role's published experience range. Career-break length, break
reason, age, marital status, gender and employer names never enter the function — they are not even
parameters.

Two consequences are checkable in the running app:

1. Each `Match.explanation` stores `inputsUsed` / `inputsExcluded` plus the per-skill contribution,
   so any score shown to an employer can be opened and audited.
2. `fairness.ts` measures the *stored* scores: mean score per break-length band, the Pearson
   correlation between break months and score, and the caregiving-experience delta. If the model
   started depending on the gap, the correlation and band spread would move, and the admin screen
   verdict changes from PASS to WATCH or REVIEW.

This is monitoring, not proof. The UI says so.

## Matching formula

```
score = (wRequired·requiredCoverage + wPreferred·preferredCoverage
       + wExperience·experienceFit + wTransferable·transferableStrength) / Σw
weights: 0.50 / 0.15 / 0.20 / 0.15   (renormalised if a role defines no required or no preferred skills)

credit per skill  = min(1, candidateLevel/requiredLevel) × (0.55 + 0.30·confidence + 0.05·min(evidence,2))
experienceFit     = 1 inside the published range, partial below it, 0.9 far above it, 0.7 when unpublished
transferable      = share of covered required weight that comes from portable (non tool-specific) skills
```

## Authorisation

- `roles` and `role_permissions` tables hold the catalogue defined in `src/lib/permissions.ts`
  (18 candidate + 13 employer + 11 admin keys). The seed writes it; `getPrincipal()` reads it.
- If the catalogue is missing, `getPrincipal()` throws a message telling you to run `npm run db:seed`
  rather than silently granting nothing and confusing the operator.
- Redirecting guards (`requirePrincipal`, `requireRole`, `requirePermission`) are for pages.
  Throwing guards (`assertPermission`, `assertRole`, `requireOrgJob`, `requireOrgApplication`) are for
  server functions, which report the reason inline instead of navigating.
- Employer→candidate reads are funnelled through `anonymize.ts`; there is no path from an employer
  screen to `candidateProfile.user` that bypasses it.

## Data flow for the two flagship journeys

**Candidate onboarding.** `startOrResumeConversation` creates a `conversations` row plus the first
assistant `messages` row. Each answer validates the required fields, writes a user message, applies
one documented effect (consent row, `experiences` row, inference pass writing `candidate_skills` +
`skill_evidence`, profile fields, or sharing consents), advances `stepKey`, and writes the next
assistant message. On the final step it marks onboarding complete and runs the matching engine, so
recommendations exist the moment the candidate lands on the dashboard.

**Employer hiring.** Create role (draft) → sync `job_skills` → submit for moderation (blocked while
the organisation is unverified) → administrator publishes, which recomputes matches for every
profile with skills → employer opens the role and reads anonymised candidates ranked by weighted
coverage with the explanation → shortlist → invite to interview (requires a scheduled time, writes
an `application_status_events` row and an `INTERVIEW_INVITATION` notification) → advance or reject.
Editing a published role sends it back to moderation automatically.

## Frontend conventions

`src/app/globals.css` registers a `brand` colour scale as Tailwind v4 theme tokens, plus shadcn
semantic variables (oklch, light and dark). `src/lib/nav.ts` is the single description of what each
role can reach; the portal shell renders it and each route still checks the database.
`docs/BUILD_GUIDE.md` records the Next 16 and Base UI specifics that differ from older shadcn
guides (`render` instead of `asChild`, Promise `params`, `useActionState` argument order,
void-returning actions for plain forms).

## Known limits of this build

- Rule-based inference cannot judge skill depth beyond keyword presence and stated duration; it is
  capped below the level that would imply expert performance.
- The learning catalogue is a fixed, seeded set of demonstration entries; gaps with no catalogue
  entry are reported as uncovered instead of being filled with invented courses.
- Anonymisation of *structured* fields is complete; free-text that a candidate wrote can still name
  an employer, which is why experience descriptions stay hidden until the candidate applies.
- Fairness monitoring needs volume. With the seeded sample it reports small-sample caveats and an
  indicative verdict only.
- No email/SMS delivery, no file upload, no third-party AI provider, no background job runner:
  notifications are in-app rows, and long recomputes run inline in the request.
