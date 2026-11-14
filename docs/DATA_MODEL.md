# SYPRUS data model

PostgreSQL, migrated with Prisma (`prisma/migrations/`). Table names are snake_case; the Prisma
models are camelCase in `prisma/schema.prisma`. The migrated database holds **48 public tables**
(reported by `npm run check:security`), across six migrations:

```
20261104122039_init                     core platform
20261104144821_ai_layer                 agents, assessments, uploads, review queue
20261104153000_explainable_weights      component scores, weight profiles
20261105090000_disclosure_and_graph     identity disclosure, graph annotations
20261105120000_qa_consent               append-only consent history, explicit apply consent
20261105130000_data_api_isolation       revokes Data API privileges where those roles exist
```

## Tables

| Table | Purpose | Notable columns / behaviour |
| --- | --- | --- |
| `users` | One account per person, any role | `role` (CANDIDATE/EMPLOYER/ADMIN), `status`, `passwordHash` (bcrypt cost 12, never selected into a page), `failedLoginCount` + `lockedUntil` for the 5-strikes 15-minute lockout, `emailVerifiedAt` (null means no portal, unless this server waived codes for a reserved demonstration domain), `lastLoginAt` |
| `email_verifications` | One emailed code and link per signup or sign-in | `codeHash` (HMAC-SHA256 of the user id and the six digits), `linkTokenHash` (HMAC of the 288-bit link token, unique — the row has to be found from the token alone), `purpose` SIGNUP/LOGIN, `transport` SUPABASE/PREVIEW (which is how the entry screen decides that a code may never be shown on screen — anything but PREVIEW left the server in a real mail), `previewCode`/`previewToken` only for an undeliverable demonstration address, `expiresAt` (10 min), `attempts` (5 burn a code), `consumedAt` (retired for any reason), `verifiedAt` (stamped only by a successful redemption, then cleared by the session that spends it). The code and the link spend the same row, so neither can be used twice. Indexed on `userId, createdAt` and `userId, purpose, expiresAt` |
| `roles` | One row per role with a label and description | parent of `role_permissions` |
| `role_permissions` | The permission catalogue the app reads at request time | `role` + `key` unique; `getPrincipal()` builds its permission list from here, so an unseeded catalogue fails loudly rather than granting nothing silently |
| `candidate_profiles` | The candidate's professional identity | `anonymousHandle` (shown to employers), `careerBreakMonths`, `breakReason` (never exposed to employers), `sharingMode`, `visibleToEmployers`, `yearsOfExperience` (recomputed from dated experiences), `profileCompletion`, `onboardingComplete` |
| `experiences` | Work, caregiving, volunteering, freelance, study | `type`, `isCaregiving`, `hoursPerWeek`, `startDate`/`endDate`/`ongoing`; part-time roles contribute pro-rated years |
| `skills` | Curated taxonomy (seeded from `src/lib/taxonomy/skills.ts`) | `category`, `transferable`, `aliases[]` (the only signal inference reads), `relatedSlugs[]` (drives the capability graph edges) |
| `candidate_skills` | A claimed skill with a level and a provenance | unique per profile+skill; `validationStatus` SELF_REPORTED / RULE_INFERRED / AI_SUGGESTED / USER_CONFIRMED / ASSESSMENT_VERIFIED / HR_REVIEWED / DISPUTED; `source` records who created it; a profile owner may only set SELF_REPORTED, RULE_INFERRED or DISPUTED |
| `skill_evidence` | The reason a claim exists | `type`, `description`, optional `url`, `reviewedById` for human review; `evidenceCount` on the parent is recomputed on every change |
| `organizations` | Employer tenant | `slug` unique, `verificationStatus` PENDING/VERIFIED/REJECTED, `verifiedAt`/`verifiedById`/`verificationNote`, `ownerUserId` unique, many-to-many `members` |
| `jobs` | A role posting | state machine DRAFT → PENDING_MODERATION → PUBLISHED → PAUSED/CLOSED, plus REJECTED; `moderatedById`/`moderationNote`; re-entry flags (`reEntryFriendly`, `flexibleHours`, `returnshipProgram`); editing a published role returns it to moderation |
| `job_skills` | What the role needs | `requirement` REQUIRED/PREFERRED, required `level`, `weight` 1–5 — these weights drive the score |
| `matches` | One scored candidate/role pair | unique per pair; stores `score` plus the four component scores and the full `explanation` JSON (per-skill contribution, gaps, strengths, `inputsUsed`, `inputsExcluded`, `modelVersion`) |
| `applications` | A submitted application | unique per pair; `matchScoreSnapshot`, `status`, `interviewScheduledAt`, and **`identityConsentAt`** — the timestamp of the candidate's explicit tick at apply time. Identity disclosure to that organisation is keyed on this column, not on the row existing, so withdrawing the application removes the grant |
| `application_status_events` | Immutable pipeline history | `fromStatus`/`toStatus`/`note`/`actorUserId`, rendered as the candidate's timeline |
| `shortlists`, `shortlist_entries` | Per-organisation shortlist | entry unique per job+candidate, so the same person cannot be shortlisted twice for one role |
| `profile_views` | Which organisation saw which anonymised profile, at which score | `revealedIdentity` records whether identity was available at view time — the fairness screen reports on this |
| `learning_resources` | Catalogue of study options | `type`, `format`, `targetLevel`, `durationHours`, `isFree`, `demonstration` flag; plans can only reference rows that exist here |
| `learning_plans` | A generated pathway | `generatedBy` records the engine, `targetJobId` the goal, `status` ACTIVE/ABANDONED so regenerating retires the old plan |
| `learning_plan_items` | Ordered steps | unique `position` per plan, `gapSkillSlug` ties a step to the gap it closes, `status` drives progress |
| `skill_gap_reports` | Stored gap analysis | `readiness` band + `readinessScore`, `strengths`/`gaps`/`transferables`/`scores` JSON |
| `conversations` | Onboarding thread | `channel`, `status`, `stepKey` (server-side position — answers for the wrong step are rejected), accumulated `answers` JSON |
| `messages` | Transcript | `role` USER/ASSISTANT/SYSTEM with `stepKey`, so the chat re-renders exactly as it happened |
| `consent_records` | Append-only consent history | indexed by user+type+policy version+time, **not unique**: granting, withdrawing and granting again each leave their own row, and the effective decision is the newest one. Rows written by a disclosure grant carry a `scope` naming the request and organisation, so a scoped grant never overwrites the general privacy-screen decision |
| `audit_events` | Who did what | `actorRole`, `action`, `entityType`/`entityId`, `targetUserId`, `organizationId`, `metadata` JSON; indexed by entity and time |
| `notifications` | In-app notification | `type`, `link`, `readAt` |
| `engine_runs` | Real telemetry per engine invocation | `engine`, `status` RUNNING/SUCCESS/FAILED, `mode` RULE_BASED, `itemsProcessed`, `itemsAffected`, `durationMs`, `errorMessage` — this is the source for the agent-health screen |

## Tables the agent layer added

| Table | Purpose | Notable columns / behaviour |
| --- | --- | --- |
| `ai_runs` | One row per agent invocation, whichever path answered | `agent`, `mode` AI/DETERMINISTIC, `provider`/`model` written **from the result** so a failover is attributed to the endpoint that answered, `promptVersion`, `schemaVersion`, token counts, `attempts`, `durationMs`, `blocked`/`warnings` JSON, `fallbackReason`, `status` RUNNING→SUCCESS/FALLBACK/FAILED (a thrown execution now lands on FAILED rather than sticking at RUNNING) |
| `ai_proposals` | Skills the discovery agent suggested | `status` PROPOSED/CONFIRMED/EDITED/REJECTED with `decisionNote`; the verbatim quote that produced it is stored; nothing reaches `candidate_skills` until the candidate acts |
| `assessments`, `assessment_questions` | Authored question sets | `passMark`, `demonstration` flag; `correctIndex` and `explanation` are never sent to the browser before submission |
| `assessment_attempts`, `assessment_responses` | One try and its answers | ownership checked in the query; the update is a guarded `updateMany` so a second submit of the same attempt cannot be scored twice |
| `evidence_uploads` | Candidate documents awaiting review | randomised `storedKey`, declared and magic-byte-checked `mimeType`, `sha256` re-verified on every read, `status` PENDING/ACCEPTED/REJECTED/REMOVED with reviewer note |
| `market_insights` | Agent 2 output | `source` + `isLive` (false for every row this build can write), `components`, `matched`, `gaps`, `excludedSignals`; either candidate-scoped or role-scoped, never shown to an employer when it names a candidate |
| `job_source_connectors` | Registry for a future live feed | `enabled`/`credentialConfigured` false by default; an uncredentialled connector throws rather than inventing postings |
| `language_reviews` | Agent 4 findings on a posting | `overallRisk`, `findings[]`, `continuityChecks[]` with `suggestedRewrite`, `status` — a suggested rewrite is stored for a human, never applied |
| `review_tasks` | The human queue | `kind`, `status` OPEN/APPROVED/REJECTED/DEFERRED, mandatory note, `createdBy`/`decidedBy`; stores subject ids without relations so a task outlives the row it described |
| `weight_profiles` | Configurable matching weights | unique `version`, four fractions summing to 1.00, required floor 0.30, one active row; versions are **immutable** — saving over an existing tag is refused so stored scores stay traceable |
| `orchestration_runs`, `orchestration_steps` | The discovery → market → pathway workflow | per-step `status` SUCCESS/FALLBACK/SKIPPED, `aiRunId`, `durationMs`; a deliberate skip is recorded as `SKIPPED`, not as a degraded fallback |
| `identity_disclosure_requests` | An employer's ask, the candidate's answer | `status` PENDING/APPROVED/DECLINED/WITHDRAWN/EXPIRED with `expiresAt` (30 days), enforced at decision time; approval appends a scoped consent row and can be revoked |
| `graph_annotations` | The candidate's own edits to their graph | unique per profile+`nodeKey`; position, `labelOverride`, `note`, `hidden` — the graph itself is regenerated from live records every load, so only human edits are stored |

## Relationship shape

`users 1—1 candidate_profiles 1—{ experiences, candidate_skills, matches, applications,
learning_plans, skill_gap_reports }`; `users 1—1 organizations (owner)` with `users *—* organizations
(members)`; `organizations 1—{ jobs 1—{ job_skills, matches, applications, shortlist_entries } }`;
`skills 1—{ candidate_skills, job_skills, learning_resources }`; `learning_resources 1—{
learning_plan_items }`. Deleting a user cascades to their profile, skills, plans, applications and
consents; deleting an organisation cascades to its jobs and matches. Audit and engine-run rows are
retained with `SetNull` references so history survives account removal.

## Enums worth reading

`SkillValidationStatus` deliberately has **no** `VERIFIED_BY_AI` state — the strongest status an
automated pass can reach is `RULE_INFERRED` or `AI_SUGGESTED`, a candidate confirming a claim sets
`USER_CONFIRMED`, passing a question set sets `ASSESSMENT_VERIFIED`, and only a human reviewer sets
`HR_REVIEWED`. `ApplicationStatus`, `JobStatus`, `OrganizationVerification`, `MatchStatus` and
`DisclosureRequestStatus` are the state machines the services enforce (`EMPLOYER_TRANSITIONS` in
`src/server/applications.ts`, `LIFECYCLE_RULES` in `src/server/jobs.ts`, the expiry and revocation
rules in `src/server/disclosure.ts`).

## Enumerating against the specification

The requested entities — users, roles, candidate_profiles, organizations, experiences, skills,
candidate_skills, skill_evidence, jobs, job_skills, matches, applications, learning_resources,
learning_plans, conversations, consent_records, audit_events, notifications — all exist. The rest
of the 48 tables were added because a feature needed somewhere to put real data and nothing was
faked instead: `role_permissions` (real permission checks), `application_status_events`
(auditable pipeline history), `shortlists`/`shortlist_entries`, `profile_views` (privacy
monitoring), `learning_plan_items`, `skill_gap_reports`, `messages` (resumable transcript),
`engine_runs` (agent health from real runs), and the agent-layer tables listed above.
