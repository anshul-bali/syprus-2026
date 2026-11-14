# Feature completion report

Status of every feature the three product prompts asked for, with what was
actually verified and what is not claimed. Written against the build as it runs
today: Next.js 16.4.5, PostgreSQL on Supabase (`xadmldzlpchjjsxwppaz`), Groq as
the primary AI provider with OpenRouter and Gemini as failovers.

Legend — **Done**: implemented, persisted, reachable in the UI, and covered by a
check. **Partial**: works, with a named limit. **Not built**: absent by design or
deferred; nothing pretends it exists.

---

## Verification runs

Results are copied from the commands actually executed on 2026-11-05. The QA pass,
including what was **not** verified, is [QA_REPORT.md](QA_REPORT.md).

| Command | Result |
| --- | --- |
| `npm run build` | compiles, type-checks, **47 routes**, no warnings |
| `npm run typecheck` | clean |
| `npm run lint` | clean (0 errors, 0 warnings) |
| `npm test` | **73 passed, 0 failed** (extraction, guardrails, authorization, matching maths and its arithmetic, fairness, provenance bands, provider chain, credential↔endpoint binding, consent semantics) |
| `npm run check:engines` | **25 passed** rule-engine invariants, no database |
| `npm run test:integration` | **22 passed, 0 failed** — real services + real HTTP APIs against a dedicated local PostgreSQL; refuses to run on a remote database |
| `npm run test:e2e` | **4 Playwright journeys passed (44.0 s)** against the production build: candidate, employer, assessment/admin/accessibility, and a crawl of every internal link in all three portals |
| `npm run check:security` | 48 public tables, RLS enabled on all 48, `anon`/`authenticated` hold 0 table privileges, 10 migrations applied, explicit application-consent column present |
| `npm run check:fallback` | OpenRouter and Gemini both accept the keys and answer in JSON mode |
| `npx tsx scripts/check-failover.ts` | Groq 1181 ms / 421 tokens, OpenRouter 1025 ms / 152, Gemini 6475 ms / 207; with the primary pointed at a nonexistent model the chain answered from `openrouter` after 2 attempts |
| `npm run qa:ai-demo` | agents 1, 2 and 4 ran live (`mode=AI`, Groq); agent 3 correctly reported no gaps for the demonstration candidate; the exclusionary role produced 9 findings, risk **high**, and queued a review task |
| `npm run qa:demo` | prints the facts `DEMO_SCRIPT.md` quotes: 13 skills, 12 stored matches, top match 83% (required 0.859 / preferred 0.881 / evidence 0.662 / constraints 0.912) |
| HTTP + browser checks | the portal screens are covered by the Playwright journeys rather than a manual walk |

---

## Prompt 1 — platform foundation

| Requested feature | Status | Where / evidence |
| --- | --- | --- |
| Next.js App Router + TypeScript + Tailwind + shadcn/ui + Prisma + PostgreSQL + Auth.js + React Flow + Recharts | **Done** | `package.json`; graph on `@xyflow/react`, charts on `recharts` |
| Three roles: candidate, employer, administrator | **Done** | `role_definitions` + `role_permissions` (42 permissions), `requirePermission` on every screen and server function |
| Public landing page: hero, problem, how-it-works, four agents, candidate and employer benefits, illustrative testimonials, FAQs, registration CTAs, premium blue/white, responsive | **Done** | `src/app/(public)/page.tsx`; mobile sheet navigation; every claim labelled |
| Candidate signup and login by email | **Done** | `/register`, `/login`; bcrypt cost 12, lockout after 5 failures, identical unknown-email and wrong-password responses, and a six-digit emailed code required before either opens a session |
| Email verification at account creation and every sign-in | **Done** | `src/server/verification.ts` (digest-only storage, 10-minute expiry, 5 attempts, 30-second gap, hourly ceiling), `src/lib/mail/supabase.ts` + `supabase/functions/send-email` (the letter is posted to a function in the operator's own Supabase project, so no mail provider key exists in this app; host allow-list, no redirects, no key/code/address in any error, and the caller cannot choose the sender), `/verify-email` screen, `email-code` provider in `src/lib/auth.ts` as the only way to a session. Measured by 26 unit checks, 11 integration checks and the browser suite's code-screen test — see QA report §9 and §10. Not measured: one live delivery, which needs the function deployed and a provider secret set in the project |
| Demonstration waiver for the seeded accounts | **Done, explicitly opt-in and environment-gated** | `SYPRUS_DEMO_ENV=true` plus `DEMO_SKIP_EMAIL_CODE=true` in `.env`; `src/lib/demo-mode.ts` is the single gate and returns false whenever `VERCEL_ENV=production`, `src/lib/demo-waiver.ts` refuses to waive anything on a deliverable address or off a declared demonstration environment, `src/components/auth/demo-waiver-notice.tsx` announces the waiver on `/login` and `/register` without naming an environment setting, and `scripts/qa.ts` pins the waiver to `false` so the suites measure the gated path |
| On-screen verification codes confined to a disposable environment | **Done** | `src/lib/mail/config.ts` forces `MAIL_MODE=supabase` unless `src/lib/demo-mode.ts` says the environment is disposable, and reports a refused mode rather than silently ignoring it; `src/server/verification.ts` re-checks the gate where the transport is chosen, so a reserved-domain account — the seeded administrator included — is emailed a code on any public deployment instead of shown one |
| Seed target safeguards | **Done** | `src/lib/db/seed-guard.ts` refuses before `prisma/seed.ts` opens a client: production, an undeclared environment, an unrequested wipe, a non-PostgreSQL or unparseable URL, a non-loopback host, a tenanted `user.project` username, an unnamed or `postgres` database, and a `SEED_DEMO_PASSWORD` shorter than twelve characters. The published fallback password is gone |
| Consent and privacy controls | **Done** | `/candidate/profile` → 8 consent types; every decision appends a versioned row in `consent_records` (never overwrites), withdrawing inference consent deletes inferred skills, and withdrawing sharing also revokes pending/approved disclosure grants |
| Conversational onboarding | **Done** | `/candidate/onboarding`, 8 steps, writes experiences/skills/consents/messages; E2E asserts 15 transcript messages and 3 experience rows |
| Work **and** caregiving experience entry | **Done** | `/candidate/experiences`, `Experience.type` incl. `CAREGIVING`, `VOLUNTEERING`, `COMMUNITY_LEADERSHIP`, `EDUCATION` |
| Dashboard | **Done** | `/candidate` with completion checklist, matches, notifications |
| Skills inventory with evidence and validation status | **Done** | `/candidate/skills`; per-skill level, confidence, status, source, evidence rows, add/remove |
| Interactive capability graph | **Done** | `/candidate/graph` — see Prompt 3 |
| Skill gap report | **Done** | `/candidate/gap-report`; stored `skill_gap_reports`, history table, current-vs-target chart |
| Personalised learning pathways | **Done** | `/candidate/pathways`; catalogue-only steps, per-step reason, progress states, honest "uncovered gaps" |
| Recommended jobs | **Done** | `/candidate/jobs` + `/candidate/jobs/[jobId]` |
| Applications tracker | **Done** | `/candidate/applications` with `application_status_events` timeline and withdraw |
| Profile editing | **Done** | `/candidate/profile` |
| Notifications | **Done** | `/candidate/notifications`, in-portal bell, 11 notification types |
| Employer: org signup + verification status | **Done** | `/register?role=employer`; `verificationStatus` gates publishing (Lumen Analytics demonstrates the gate) |
| Employer: org profile, job create/edit/close | **Done** | `/employer/profile`, `/employer/jobs`, `/employer/jobs/new`, lifecycle submit/pause/resume/close/delete |
| Required + preferred skills with levels and weights | **Done** | `job_skills` (78 rows seeded), editor on the job form |
| Anonymised candidate review | **Done** | `/employer/candidates` through `src/server/anonymize.ts`; E2E asserts no name, no email, withheld descriptions, neutral employer labels, durations not dates |
| Explainable match scores | **Done** | "Why this score" dialog: four buckets, raw × weight × contribution, per-skill credit rows, constraint checks, inputs used vs never read |
| Shortlist, interview invitations, application tracking | **Done** | `/employer/shortlist`, status machine on `/employer/applications` |
| Admin: user/org management, job moderation | **Done** | `/admin/users`, `/admin/organisations`, `/admin/moderation` |
| Admin: AI service health | **Done** | `/admin/engines` — provider chain, per-agent AI vs fallback counts, fallback rate, guardrail blocks, tokens, latency, recent fallbacks and blocked items |
| Admin: matching + fairness monitoring | **Done** | `/admin/fairness` (distribution by break band, correlation, verdict), `/admin/weights` |
| Admin: audit history | **Done** | `/admin/audit` over `audit_events` (144 rows after the demo pass) |
| Admin: reporting dashboard | **Done** | `/admin/reporting` |
| Data model: users, roles, candidate_profiles, organizations, experiences, skills, candidate_skills, skill_evidence, jobs, job_skills, matches, applications, learning_resources, learning_plans, conversations, consent_records, audit_events, notifications | **Done** | all present in `prisma/schema.prisma`; `npm run check:security` reports **48** tables in the public schema of the migrated database |
| Real PostgreSQL persistence, migrations, seed | **Done** | 6 migrations applied to Supabase and to the isolated QA database; seed writes 73 skills, 42 permissions, 28 resources, 4 orgs, 12 jobs, 6 candidates, 2 assessment sets |
| Server-side validation and access control | **Done** | shared Zod schemas back the profile, experience, skill, consent, application, job, shortlist, search and API inputs; the remaining server functions normalise their fields and re-check ownership and permission inside the service, which is what the cross-account tests assert |
| No fake buttons or non-functional navigation | **Done** | every internal link in all three portals is crawled by the browser suite and returns no 4xx/5xx; the employer "compare stored postings" control was broken and now calls its own service |
| No secrets exposed to browsers | **Done** | the only `NEXT_PUBLIC_*` variable is the site URL; AI keys are server-only and reported as presence booleans; `/api/evidence/{id}` re-checks ownership + sha256 |
| Loading, empty and error states | **Partial** | empty states and the error boundary are reached by the journeys (admin screens assert no error boundary, unknown routes render "This page does not exist"); per-route `loading.tsx` skeletons exist but their appearance was not individually screenshotted |
| Candidate restricted to own records; employer to authorised recruitment records; admin by permission | **Done** | cross-account refusals are asserted in `tests/integration.ts` (skill, upload, attempt, proposal, graph node, job, application, disclosure) and in the Playwright journeys |
| Accessible and mobile responsive | **Done** | axe reports no violations at 390 px and 1440 px on the public screens **and** on the signed-in candidate dashboard, recommended roles and privacy screens; no page overflows horizontally, including the graph canvas on a phone. The longer admin queues were checked structurally in the browser rather than audited |
| Structured documentation + env example | **Done** | `README.md`, `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`, `docs/BUILD_GUIDE.md`, `docs/AI_INTEGRATION.md`, `docs/DEMO_SCRIPT.md`, `docs/QA_REPORT.md`, this report, `.env.example` |
| Seeded demo profiles and jobs explicitly labelled demonstration data | **Done** | `demonstration` flags on resources/orgs/assessments, `DemoBadge` in the UI, "Illustrative" on testimonials |
| Feature completion report | **Done** | this file |
| Honesty constraint: no claim of AI verification, live market intelligence, bias elimination or placement | **Done** | stated on the landing page, in every agent screen, in the explanation dialogs, and in §9 of `docs/AI_INTEGRATION.md` |

## Prompt 2 — the four AI agents

| Requested | Status | Evidence |
| --- | --- | --- |
| Agent 1 Skills Discovery: conversational coverage of prior roles, projects, caregiving, volunteering, education, achievements | **Done** | `buildDiscoveryInput` assembles blocks per context; onboarding steps cover all six areas |
| Structured JSON with standardised names, categories, evidence, confidence, provenance | **Done** | `discoveryOutputSchema`; slugs constrained to the taxonomy; verbatim quotes kept as evidence |
| "Do not automatically equate caregiving with professionally verified competence" | **Done** | `professionallyVerified: literal(false)`; care/volunteer evidence caps at `PROFICIENT` and sets `requiresHumanReview`; E2E asserts no care-derived skill carries a reviewer status |
| Candidate confirms, edits, rejects, adds | **Done** | `/candidate/suggestions` + `decideProposal`/`addOwnSkill`; E2E proves confirm and reject paths |
| Optional short assessments and evidence uploads | **Done** | `/candidate/assessments` (2 seeded sets, server-side scoring, answers never sent to the client) and `/candidate/evidence` (5 MB cap, MIME allowlist, randomised keys, sha256 re-check on download) |
| Agent 2 Market Intelligence: compare skills to requirements, DB postings as MVP source, provider interface for future live feeds | **Done** | `runMarketIntelligence` + `JobRequirementSource` with `createDatabaseRequirementSource` / `createHttpRequirementSource` |
| "Never fabricate real-time jobs or market demand" | **Done** | the HTTP source **throws** when uncredentialled or on feed error; guardrail forces `isLiveDemandSignal=false` unless the source really is live; screen text says "this database only" |
| Clear match breakdowns | **Done** | four-bucket calculation stored per match and rendered in full |
| Exclude career-gap length, caregiving status, protected characteristics from ranking | **Done** | they are not parameters of `scoreMatch`; `inputsUsed`/`inputsExcluded` stored per score; `auditFairness` measures stored scores and a deliberately biased set is caught as `REVIEW` |
| Agent 3 Learning Pathways: missing required skills, resources, micro-certifications, projects | **Done** | `buildLearningPlan` ranks catalogue rows by severity, ≤2 per gap, ≤8 steps |
| Why each item was recommended + effort where supported + relevant gaps | **Done** | `note` per item ("Why this step"), `durationHours` where the catalogue holds one, `uncoveredGaps` named |
| Curated catalogue with working links; external course APIs only with valid access | **Done** | 28 seeded resources with real homepage URLs and `demonstration: true`; invented `catalogueId` is dropped by the guardrail and the run falls back |
| Track progress and allow reassessment | **Done** | `PlanItemStatus` (not started / in progress / completed / skipped) and the assessments screen |
| Agent 4 Bias Audit: exclusionary language + unnecessary continuity requirements | **Done** | 10 documented regex patterns; live run flagged the demonstration role with 9 findings and 3 continuity checks |
| Store explanations and suggested improvements for human review | **Done** | `language_reviews` + `review_tasks` (`BIAS_FINDING`), rendered on `/employer/jobs/[id]` and `/admin/review` |
| Monitor ranking distributions with governed data | **Done** | `/admin/fairness`; only profiles that granted `RESEARCH_CONTRIBUTION` are counted in the aggregate |
| "Do not claim guaranteed bias-free outcomes or infer sensitive characteristics" | **Done** | schema caps `protectedCharacteristicsInferred` to zero items and the guardrail discards the whole reply if it is non-empty; disclaimer text is fixed |
| Typed Zod I/O schemas | **Done** | `src/lib/ai/schemas.ts`, versioned per agent |
| Server-side configurable LLM provider | **Done** | `AI_PROVIDER`/`AI_BASE_URL`/`AI_MODEL` + failover endpoints, host-allow-listed |
| Structured JSON output, error handling, retries, rate limits | **Done** | JSON mode, classified `ProviderError` categories, retry with jitter and `Retry-After`, per-minute token window + daily budget |
| Conversation and result persistence, audit trails, model/version tracking | **Done** | `ai_runs` records provider, model, prompt version, schema version, tokens, duration, attempts, blocked/warning counts and the verbatim provider error |
| Meaningful deterministic fallback when AI is unavailable | **Done** | every agent has a rule engine; `mode` and `fallbackReason` are stored and shown to users |
| Clear separation of AI-inferred / user-confirmed / independently-verified | **Done** | seven-value `SkillValidationStatus` collapsed into six visible bands; provenance is a colour on the graph and a status on every card |
| Human review for consequential recruitment decisions | **Done** | review queue with mandatory notes; no AI path can close its own task |
| Orchestration: discovery → graph → matching → learning recommendations | **Done** | `runOrchestration` (3 persisted steps; the graph reads live rows so needs no step). Candidate-triggered run: all three `SUCCESS`, mode `AI` |
| Tests for structured extraction, authorization, matching calculations, hallucination handling, unsafe outputs | **Done** | `tests/ai.test.ts` (5 suites) + `tests/providers.test.ts` + `tests/graph.test.ts` |
| Complete integration summary | **Done** | `docs/AI_INTEGRATION.md` |

## Prompt 3 — capability graph and explainable matching

| Requested | Status | Evidence |
| --- | --- | --- |
| React Flow graph with the **candidate at the centre** | **Done** | `loadGraphModel` builds a radial model; `you` is node 0 and every other node hangs off it |
| Technical skills, transferable skills, prior professional experience, skills inferred from caregiving/community, supporting evidence and assessments, target career opportunities | **Done** | six node kinds (`YOU`, `SKILL`, `EXPERIENCE`, `EVIDENCE`, `ASSESSMENT`, `OPPORTUNITY`); Anshika's graph renders 35 nodes / 43 links |
| Zoom, pan, inspect | **Done** | zoom buttons, fit-to-view, minimap, wheel zoom, drag-pan, click-to-inspect — verified in Chromium by `npm run test:e2e`, which clicks a skill node and reads its inspector |
| Add evidence from the graph | **Done** | the skill inspector embeds the evidence dialog |
| Edit nodes | **Done** | label override, note, hide, per-node reset, full layout reset |
| Understand where each skill originated | **Done** | provenance band + explanation on every node, plus the stored source (`MANUAL`, `INFERENCE`, `AI_PROPOSAL_CONFIRMED`, `ASSESSMENT`, `REVIEWER`) |
| Visually distinct suggested / self-reported / assessed / verified | **Done** | one colour and one dot per band, defined once in `src/lib/provenance.ts` so the canvas and the text cannot disagree |
| Persist edits to the database | **Done** | `graph_annotations` (unique per profile + node key), audited; the Chromium journey drags a node, reloads and reads the position and note back from the database |
| Deterministic explainable weighted scoring, MVP weights 50 / 20 / 20 / 10 | **Done** | `DEFAULT_WEIGHTS`, `WEIGHTS_VERSION`, stored per match; E2E asserts the sum is 1.00, required = 0.50 and contributions add up to the stored score |
| Normalise each category and show the full calculation | **Done** | each bucket normalised to 0–1; empty categories hand their weight to those with data; the dialog shows raw, nominal weight, effective weight and points |
| Weights are configurable prototype assumptions, not validated criteria | **Done** | `/admin/weights` (versioned profiles, sum-to-1 enforcement, ≥30% required-coverage floor, recompute), and `assumptionNote` on every explanation |
| Do not use break duration, parental status, name or protected characteristics to lower scores | **Done** | not parameters of the function; `fairness.ts` measures stored scores and reports `REVIEW` on a synthetic penalising set |
| Display: overall score, matched required, missing required, matched preferred, evidence strength, next learning actions, ranking explanation, eligibility and consent | **Done** | `/candidate/jobs` cards and `/candidate/jobs/[jobId]`; learning actions link to `/candidate/pathways` |
| Employer blind review with random identifiers | **Done** | `anonymousHandle` per profile; identity fields never leave `anonymize.ts` |
| No name, photograph, DOB, contact details or exact timelines in first-stage review | **Done** | no photo/DOB fields exist in the employer projection; dates → durations; E2E asserts each |
| Explicit candidate consent before identity disclosure | **Done** | `identity_disclosure_requests` + `/candidate/disclosures`; a request alone changes nothing (E2E-proved), approve/decline both recorded, decline keeps anonymity |
| Log access and disclosure events | **Done** | `profile_views` records each employer read with a `revealedIdentity` flag, and `audit_events` holds `disclosure.requested/approved/declined/withdrawn/revoked`; the browser journey asserts the rows appear as the UI acts |
| Seeded illustrative candidate **Anshika**, ex-Marketing Analyst, three-year caregiving break | **Done** | `anshika@example.com`: 4 years at Bluewave Retail, `breakMonths: 36`, 13 skills mixing professional and care-derived, target Marketing Operations Coordinator |
| Suitable fictional marketing, operations and coordination roles | **Done** | Meridian Media (verified) publishes Marketing Operations Coordinator, Digital Marketing Executive, Campaign Performance Analyst and an exclusionary-wording demonstration role; Northwind and Ashford add operations, coordination, healthcare and finance roles |
| Demonstrate discovery, review and matching | **Done** | her profile has proposals, evidence, a graph, 6 stored matches, a gap report and an application + shortlist at Meridian |
| Clearly labelled simulated scores and fictional vacancies | **Done** | `DemoBadge` on roles/resources/assessments; explanations state the model version and the prototype-weights caveat |
| Entire sequence works: onboarding → saved graph → matching → employer shortlist | **Done** | `npm run test:e2e` walks exactly that path (plus disclosure and application) against the real database |
| End-to-end tests | **Done** | `npm run test:e2e` (4 Playwright journeys on the production build) and `npm run test:integration` (21 service/API checks). `scripts/e2e.ts` remains as the earlier service-level walk, superseded by those two suites for claims made here |

---

## Bugs this pass found and fixed

These were live defects, not polish — each is now covered by a check.

1. **Sign-in was broken.** `src/proxy.ts` decoded the session JWE with the wrong
   salt (`__Host-`/empty). `@auth/core` uses the **cookie name** as the salt, so
   every portal request redirected to `/login`. Fixed in `src/proxy.ts`.
2. **Employers could not create a role.** `resolveSkillIds` returned a map keyed
   by skill **id** while the caller looked skills up by **slug**, so
   `createJob`/`updateJob` always answered "These skills are not in the
   catalogue". Found by the E2E, fixed in `src/server/jobs.ts`.
3. **A second decision on the same consent type crashed.** `decideDisclosure`
   inserted a new `consent_records` row, colliding with the unique
   `(userId, type, policyVersion)`. Now upserted, matching the rule the privacy
   screen already applies.
4. **Reviewer decisions did not change the claim.** Accepting an evidence
   document raised confidence but left the status, while the screen said the
   claim was human-reviewed. `decideUpload` now sets `HR_REVIEWED` (or
   `DISPUTED` on rejection), and never downgrades an assessment pass.
5. **An administrator could not read workflow history.** `listOrchestrationRuns`
   demanded a candidate permission for an admin with no profile of their own.
6. **Agent 2 and 3 refused an administrator trigger.** Permission branches keyed
   on the wrong comparison; the market step now accepts an admin, and the
   pathway step reports an honest `SKIPPED` when the candidate must run it
   themselves.
7. **A deliberate skip was recorded as a fallback**, which made the workflow look
   degraded when it was working correctly.
8. **Stale copy:** the admin engines page still described the 50/15/20/15 weights
   and claimed "none of these agents calls an external model".

## Known limits, stated plainly

* **Failover is per process.** The token window and daily budget are in-memory, so
  each server instance keeps its own allowance. No Redis.
* **Evidence files live on the server's disk** (`storage/uploads`), not object
  storage. Adequate for the MVP; a real deployment should move them to S3 or
  Supabase Storage.
* **No email delivery.** Notifications are in-portal only.
* **Fairness monitoring is descriptive.** On the current demonstration data the
  verdict is `WATCH` (it read `REVIEW` before the last pass added more profiles —
  the figure moves with the sample, which is the point of measuring it rather
  than asserting a conclusion). The seeded candidates differ in skills, so score
  varies across break bands; the monitor reports that instead of explaining it
  away. It cannot prove fairness — it measures one correlation over stored scores.
* **Assessment content is authored, not validated.** Two demonstration sets exist;
  a pass means "this platform's questions", nothing more.
* **Agent 4 finds patterns, not intent.** On the inclusive seeded roles it reports
  zero findings and low risk; on the deliberately exclusionary role it reports 9
  findings and queues a human review task. Both outcomes are stored verbatim.
* **Browser verification depth.** Four Playwright journeys run against the
  production build and drive the real controls: registration, all eight onboarding
  steps, proposal editing, graph annotation and dragging with a reload, pathway
  building, applying with and without identity consent, shortlisting, disclosure
  approval and revocation, interview invitation, assessment completion, the admin
  screens, the weight percentages, axe at two widths, and a crawl of every internal
  link in the public site and all three portals. Not clicked: the employer
  multi-user invitation screens, the research-catalogue admin editor, and the
  profile-completion checklist interactions.
* **Secrets.** The Groq, OpenRouter, Gemini and Supabase credentials were pasted
  into this conversation, and earlier command lines in this project did embed a
  fallback key and print a session cookie. They now live only in the git-ignored
  `.env` / `.env.supabase`; this pass avoided echoing any of them. **Treat them as
  compromised and rotate them before any real use** — see QA_REPORT §5.

---

## Prompt 4 — QA, security and deployment pass

The full evidence is [QA_REPORT.md](QA_REPORT.md); this is the status line for each
thing that prompt asked for. No functional feature was replaced with a static mock to
make a check pass — where a control could not be made to work honestly (the employer
market comparison), it was re-pointed at a real service rather than faked.

| Requested | Status | Evidence |
| --- | --- | --- |
| Test every user flow end to end | **Done** | 4 Chromium journeys on the production build (`npm run test:e2e`, 4 passed) |
| Verify routes, persistence, RBAC, cross-account isolation, validation, broken links | **Done** | integration suite (22 passed) + journey 4 link crawl across all three portals |
| Mobile/desktop layout, loading/empty/error states | **Partial** | axe clean at 390/1440 px on public screens, no horizontal overflow, error boundary and not-found verified; per-route skeletons exist but were not individually captured |
| AI schema validation, fallback, matching formula correctness | **Done** | unit suites (73 passed) incl. exact 50/20/20/10 arithmetic, empty-bucket redistribution, failover attribution; live chain and forced failover executed |
| Privacy, consent, identity protection, API key handling, audit generation | **Done** | free-text anonymity, explicit apply consent, expiring and revocable disclosure grants, append-only consent history, credential↔endpoint binding, audit rows asserted |
| Unit tests for extraction mapping and formulas | **Done** | `tests/ai.test.ts`, `tests/security.test.ts` |
| Integration tests for APIs and DB workflows | **Done** | `tests/integration.ts` against an isolated local database |
| Playwright for major candidate and employer journeys | **Done** | `tests/browser.spec.ts` |
| Demo accounts and Anshika walkthrough | **Done** | `docs/DEMO_SCRIPT.md` + `npm run qa:demo` prints the figures it quotes |
| Env config, migration commands, setup README, Vercel + PostgreSQL guidance | **Done** | README "Deployment" and `.env.example` |
| Deployment itself | **Not done** | nothing was pushed to any host, and two blockers are documented first (disk uploads, per-process budgets) |

---

## Prompt 5 — imagery, the assistant and a stability re-check (2026-11-06)

| Requested | Status | Evidence |
| --- | --- | --- |
| Use the supplied 18-image library, no regeneration, no duplicates | **Done** | extracted to `public/images/syprus/`, formats and dimensions verified from WebP headers, manifest in `src/lib/assets.ts` |
| Homepage, auth and portal placements | **Done** | 6 homepage, 3 auth, 9 portal empty states; each asset referenced exactly once (audit by `grep` over `src`) |
| Reusable components, correct `next/image` usage | **Done** | `SectionImage`, `AuthPanel`, `EmptyState image` prop; intrinsic aspect ratios reserved, `sizes` per placement, lazy below the fold, nothing preloaded |
| No generated person presented as a customer | **Done** | `kind: 'rendered-photo'` renders the badge "Generated image — not a SYPRUS customer"; no image sits in the testimonials section |
| Assistant "SYPRUS Sona" with OpenRouter primary and Groq + Gemini as fallback | **Done** | `AI_BASE_URL` points at OpenRouter, the other two keep their own keys; `providerNameForBaseUrl` recognises the primary by its canonical origin, so promoting a provider is configuration, not code |
| Sona grounded, consent-aware, labelled, persisted | **Done** | facts are read server-side per role; name, email and credentials never enter the payload; each turn stores the mode and endpoint; `assistant_sessions`/`assistant_messages` + `ASSISTANT_CHAT` in `AiAgentName` |
| Sona still answers when no model is reachable | **Done** | `deterministicAssistant` reads the same facts back and says the model path was unavailable — asserted by unit, integration and the browser suite (which runs with AI off) |
| Re-check that earlier fixes survived | **Done** | account menu 12/12 on the live build, dashboard completion wording and clipping clean at 375/768/1024/1440, sweep of 109 pages with 0 real findings |

## Prompt 6 — dynamic visualisations on real data (2026-11-06)

Nine screens, in the requested order. Every figure is read from stored rows; a
chart that has no data says so instead of drawing a shape.

| Requested | Status | Evidence |
| --- | --- | --- |
| 1 · Capability graph: labels, legend, filters, node detail, zoom/reset, searchable list | **Done** | `capability-graph.tsx`: category + evidence + search filters, ring/legend copy, `GraphList` table alternative with `aria-pressed` rows; verified 35 nodes listed, search narrowing to 2, canvas narrowing with them, 0 px overflow at 375 px |
| 2 · Gap and match explanations: current vs required, required/preferred split, missing data, weights vs contributions | **Done** | `pathway-chart.tsx` (filter chips, weight /5, whole level steps, missing markers), `contribution-breakdown.tsx` (Value / Weight / Added / Share + reconciliation sentence), wired into `gap-report/page.tsx` and the job explanation dialog; `scripts/check-gap-viz.ts` reconciles every column against the total |
| 3 · Learning pathway: order, recorded status, duration, links, next action | **Done** | `pathway-timeline.tsx`: progress rail, hours behind you vs catalogued, “Next action” naming the first open step, per-step status with the recorded timestamp; `scripts/check-pathway-viz.ts` completes and reverts a step and re-checks the counts |
| 4 · Application tracker: real stages and history | **Done** | `application-timeline.tsx`: stage rail drawn only from recorded events, “ever reached vs now” separated from missing stages, interview date only when an employer stored one, attribution of each event; `scripts/check-applications-viz.ts` + `scripts/check-interview-date.ts` (employer records the invitation, candidate screen shows it) |
| 5 · Employer dashboard: role status, stage counts, role filter, shortlist coverage | **Done** | `employer/page.tsx`: `?job=` filter (server-scoped), paired chart+list for roles and stages with a self-reconciliation line, new “Stage history against current stage” table, shortlist coverage gated on `employer.shortlist.manage`; `scripts/check-employer-dash.ts` proves per-role totals add to the all-roles total |
| 6 · Admin dashboard: accounts, moderation, stages, review queues | **Done** | `admin/page.tsx`: three composition cards (chart + list + total + reconciliation sentence), queue cards from stored rows, trends guarded by the window count; `scripts/check-admin-dash.ts` checks bars, list, sentence and header stats all agree |
| 7 · AI health: mode split, per agent/provider, tokens, latency, fallback reasons, blocks, window and read time | **Done** | `ai/runs.ts` now aggregates the whole window (`byMode`, `byStatus`, `byProvider`, `byFallbackReason`, per-agent tokens/latency, newest run) instead of summing a 500-row sample; `ai-health.tsx` charts each with its own reconciliation and states “answered in the past, never answers now”; `scripts/check-ai-health-viz.ts` |
| 8 · Fairness: sample counts, missing data, limitations, access boundary | **Done** | `admin/fairness/page.tsx`: matches-per-band chart, consent-coverage bar, explicit “no matches in this band” rows, aggregates-only statement; `scripts/check-fairness-viz.ts` also proves a candidate cannot read the screen and that no email or handle is rendered |
| 9 · Public interactive explanation | **Done** | `components/public/skills-demo.tsx` in “How it works”: invented skills/roles/weights, labelled “Illustrative data · not a match score”, no request of any kind, no prediction wording; `scripts/check-public-demo.ts` recomputes the arithmetic from the DOM and fails if any network call happens |
| Common: loading/empty/error/stale states, text alternatives, keyboard, mobile, reduced motion | **Done** | every chart is `aria-hidden` with a table or list beside it; live regions announce filter changes; the global `prefers-reduced-motion` rule already disables transitions, and nothing added polls or animates on its own |
| Validation | **Done** | typecheck + lint clean, `npm test` 89, `check:engines` pass, integration 24, `test:e2e` **11 passed** (two new visualisation regressions), sweeps and per-screen checks above |

## Prompt 7 — hero pairing and a dark theme everywhere (2026-11-06)

| Requested | Status | Evidence |
| --- | --- | --- |
| Keep the capability snapshot exactly as it reads | **Done** | same handle, badge, 78% match, four component figures, three skills with their provenance, and the flagged Excel gap — the content was moved, not rewritten |
| Put it beside the image that was underneath it | **Done** | the hero is now headline → points → a two-column row of artwork and snapshot (`lg:grid-cols-[1.05fr_0.95fr]`), with `sizes` recalculated for the narrower column and a clean stack at 375/768 |
| Dark mode across the whole web | **Done** | `next-themes` provider on the root layout, header control plus an Appearance radio group in the account menu, palette remapped in `globals.css` for every tint/border/status shade, React Flow `colorMode`, chart fills on theme variables, `theme-color` derived from the actual background tokens |
| Nothing else may break | **Done** | typecheck + lint clean, unit 89, integration 24, `test:e2e` 11 (including the three account-menu regressions, now with the appearance group inside the menu), sweep 112 pages 0 findings, contrast ≥ 3.6:1 on fifteen screens in dark |

Decisions worth stating: the pastel *tints, borders and status text* are remapped by
variable, while the 500–600 *fills* keep their saturation in both themes — a primary
button and a provenance dot must not wash out. The generated imagery is left untouched:
recolouring the client's artwork would be a different claim than the one the page makes.
