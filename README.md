# SYPRUS — Skills-First Career Re-entry Platform

**Helping women translate experience into skills, learning plans, and career opportunities.**

[Website](https://syprus-2026.vercel.app) · [Setup](#setup) · [Architecture](docs/ARCHITECTURE.md) · [Feature status](docs/FEATURE_COMPLETION.md) · [Demo walkthrough](docs/DEMO_SCRIPT.md)

## Project overview

SYPRUS is a full-stack, AI-assisted career re-entry platform for women returning to work after caregiving or another career break. It brings skills discovery, gap analysis, personalised learning, explainable job matching, and employer recruitment workflows into one application.

This repository is the **main home of the SYPRUS project**: its application source, database migrations, AI integrations, tests, and technical documentation. It can be understood and run independently.

The central idea is simple: a career break does not describe everything a person can do. SYPRUS helps candidates document capabilities from professional and other relevant experiences, review suggested skills, and compare their profile with the requirements of a target role. Employers can review skills and match explanations before requesting access to a candidate's identity.

**Project status:** functional full-stack MVP. The repository includes persistent candidate, employer, and administrator workflows, configurable AI providers, and deterministic fallbacks. Production deployment prerequisites and current limitations are documented below; demonstration records are fictional.

## The problem

Returning professionals may struggle to express transferable experience, identify which skills need refreshing, and navigate recruitment processes that emphasise uninterrupted employment. Employers also need a structured way to assess role-relevant capabilities and understand why a candidate appears suitable.

SYPRUS addresses these needs by organising experience around skills, showing the reasoning behind role matches, and giving candidates control over identity disclosure. It supports informed decisions by candidates and recruiters; it does not make hiring decisions for them.

## How SYPRUS works

1. **Describe experience.** A candidate registers, completes verification, and records professional experience, caregiving experience, goals, and consent preferences.
2. **Review suggested skills.** Skills discovery proposes capabilities grounded in the candidate's wording. The candidate can confirm, edit, or reject each suggestion.
3. **Explore capabilities.** A skills inventory, evidence records, practice assessments, and an interactive capability graph help organise the profile.
4. **Understand role readiness.** The platform compares skills with stored job requirements, explains weighted match scores, and identifies required and preferred gaps.
5. **Build a learning plan.** Personalised pathways use the available resource catalogue, with ordered steps and progress tracking.
6. **Connect with employers.** Candidates explore roles and track applications. Employers review anonymised profiles, shortlist candidates, request identity disclosure, and manage interview invitations.
7. **Stay in control.** Candidates manage sharing and disclosure decisions; administrators oversee moderation, operational health, and audit records.

## Three connected portals

| Portal | Main capabilities |
| --- | --- |
| **Candidate** | Conversational onboarding, skills suggestions, evidence uploads, practice assessments, interactive capability graph, skill-gap reports, learning pathways, recommended roles, applications, notifications, and privacy controls. |
| **Employer** | Organisation profile, role publishing and management, required/preferred skill definitions, anonymised candidate review, explainable matching, shortlisting, disclosure requests, application pipeline, interview invitations, and posting-language review. |
| **Administrator** | User and organisation management, role moderation, human review queues, matching-weight configuration, AI and rule-engine monitoring, fairness reporting, and audit history. |

## Five AI-assisted components

| Component | Purpose | Boundaries |
| --- | --- | --- |
| **Skills Discovery** | Proposes transferable skills from candidate-provided experience, with supporting quotes. | Suggestions require candidate review; they are not independently verified credentials. |
| **Market Intelligence** | Explains alignment and gaps against requirements in stored job postings. | Uses the platform's database, not a live labour-market feed. |
| **Learning Pathways** | Organises learning steps around identified gaps and available resources. | Uses the resource catalogue and identifies gaps it cannot cover. |
| **Bias Audit** | Flags potentially exclusionary posting language and suggests changes for review. | Supports human review; it does not certify that recruitment is bias-free. |
| **SYPRUS Sona** | Answers questions inside the signed-in portals using facts available to the current account. | Access is scoped to the user's role and authorised data. |

The AI layer supports **OpenRouter, Groq, and Google Gemini** through a configurable provider chain. Structured outputs are validated, runs record which provider or fallback produced the result, and deterministic rule engines provide a fallback path. See [AI integration](docs/AI_INTEGRATION.md) for the contracts, guardrails, and failure behaviour.

## Architecture at a glance

| Layer | Responsibility |
| --- | --- |
| **Next.js + React interface** | Public website and role-specific portals, responsive layouts, light/dark themes, forms, graphs, and reporting. |
| **Server actions and API routes** | Authentication checks, permissions, validation, candidate ownership, organisation scoping, and workflow mutations. |
| **Domain and AI services** | Skills discovery, weighted matching, learning plans, posting review, assistant responses, and run attribution. |
| **Prisma + PostgreSQL** | Persistent profiles, skills, roles, applications, consent history, learning progress, and audit records. |
| **External integrations** | Configured AI providers and verification-email delivery. Credentials remain server-side. |

The application uses TypeScript across both interface and server code. React components render the page structure, Tailwind CSS and shared styles control presentation, and PostgreSQL stores application data.

## Privacy and explainability

- **Skills-based review:** career-break length and reason are excluded from employer views and match scoring.
- **Visible match reasoning:** candidates and employers can inspect the weighted components behind recommendations.
- **Candidate-controlled identity sharing:** employer access depends on explicit application consent or an approved disclosure request.
- **Revocable disclosure:** candidates can withdraw sharing; consent decisions are recorded as history.
- **Server-enforced access:** permissions, record ownership, and organisation boundaries are checked on the server.
- **Traceable AI:** stored runs distinguish provider-generated answers from deterministic results.

These are implemented design features, not a claim of independent security certification or guaranteed hiring fairness. The detailed security model and deployment limitations appear below.

## Explore the repository

| Location | Contents |
| --- | --- |
| [`src/`](src/) | Application interface, shared components, server logic, and AI integration. |
| [`prisma/`](prisma/) | Database schema, migrations, and demonstration seed. |
| [`public/`](public/) | Static assets and project imagery. |
| [`tests/`](tests/) | Unit, integration, and browser test suites. |
| [`scripts/`](scripts/) | Local database tooling, QA runners, and operational checks. |
| [`docs/`](docs/) | Architecture, feature status, data model, AI contracts, and demonstration guide. |

For a guided product walkthrough, start with [the demo script](docs/DEMO_SCRIPT.md). For implementation details, read [architecture](docs/ARCHITECTURE.md), [the data model](docs/DATA_MODEL.md), and [the QA report](docs/QA_REPORT.md).

---

## Stack

| Layer | Choice |
| --- | --- |
| Framework | Next.js 16.4.5 (App Router, Turbopack), React 19.3 |
| Language | TypeScript (strict) |
| Styling | Tailwind CSS v4 + shadcn/ui (`base-nova` style on `@base-ui/react`), light and dark themes via `next-themes` |
| Data | Prisma 6.19 + PostgreSQL (real persistence, migrations, seed) |
| Auth | Auth.js v5 (`next-auth@5.0.0-beta.32`), credentials provider, JWT sessions, plus a six-digit emailed code at registration and at **every** sign-in (verification delivery through the configured mail function; see Email verification) |
| Visualisation | `@xyflow/react` (capability graph), `recharts` (reporting, fairness, health). Every chart is `aria-hidden` and sits beside the same numbers as a table or list; filters announce their effect through a live region; a chart with no stored rows says so instead of drawing a shape. |
| Validation | Zod v4, shared between client forms and server functions |

## Prerequisites

- Node.js 20.19+ (developed on Node 24)
- PostgreSQL 14+. If you do not have one, the repo can run a real local cluster for you — see step 2.

## Setup

```bash
# 1. Install dependencies.
#    This project's package manager blocks install scripts by default; approve
#    prisma, @prisma/client, @prisma/engines, esbuild and
#    # @embedded-postgres/windows-x64 with `npm install-scripts approve <pkg>`
#    if your environment does the same, then rebuild.
npm install

# 2a. Either start the bundled local PostgreSQL (no Docker needed):
npm run db:pg
#     … and keep this terminal open while you work.

# 2b. … or point DATABASE_URL in .env at any PostgreSQL instance you own.

# 3. Create the environment file and set AUTH_SECRET.
cp .env.example .env
npx auth secret          # prints a value for AUTH_SECRET

# 4. Create the schema and generate the client.
npm run db:migrate       # prisma migrate dev

# 5. Load the demonstration data (needs SYPRUS_DEMO_ENV=true, SEED_ALLOW_RESET=true
#    and a SEED_DEMO_PASSWORD of at least twelve characters — see Seeding safeguards).
npm run db:seed

# 6. Run it.
npm run dev              # http://localhost:3000
```

`.env.example` documents every variable. The local cluster from step 2a listens on port **55432**
and stores its data in `.postgres/data` (git-ignored, removed when you delete the folder).

## Demonstration accounts

Every seeded account uses the password in `SEED_DEMO_PASSWORD` (`.env`). There is no fallback:
`prisma/seed.ts` refuses to run without a value of at least twelve characters, so no demonstration
password is published in this repository. Seeding is also gated on the target being a disposable
loopback database — see [Seeding safeguards](#seeding-safeguards).

| Role | Email | Notes |
| --- | --- | --- |
| Administrator | `admin@syprus.example.com` | Sees moderation, engines, fairness, audit, reporting. |
| Employer (verified) | `talent@northwind.example.com` | Northwind Logistics — published roles. |
| Employer (verified) | `recruitment@ashford.example.com` | Ashford Health Partners — published roles. |
| Employer (verified) | `people@meridian.example.com` | Meridian Media — publishes the marketing and coordination roles the Anshika demo matches. |
| Employer (pending) | `people@lumen.example.com` | Lumen Analytics — demonstrates the verification gate: its role stays unpublished. |
| Candidate | `anshika@example.com` | **Featured demonstration candidate.** Marketing Analyst, 36-month caregiving break, 13 skills mixing professional and care-derived claims, targeting Marketing Operations Coordinator; shortlisted at Meridian and applied at Northwind. |
| Candidate | `priya.n@example.com` | Operations background, 38-month break, strong match set. |
| Candidate | `sana.q@example.com` | Finance/bookkeeping, 52-month break. |
| Candidate | `maria.d@example.com` | Customer experience, returnship target. |
| Candidate | `farah.k@example.com` | Data analysis, gaps plus an active learning plan. |
| Candidate | `ananya.s@example.com` | HR, sharing switched off — demonstrates a hidden profile. |

Sign-in lives at `/login`; registration at `/register` (candidate or employer). Every address
above is on `example.com` or `syprus.example.com`, which no mail service delivers to. On a server
that declares itself a disposable demonstration environment (`SYPRUS_DEMO_ENV=true`), a code for
them is shown on the entry screen rather than emailed — or skipped altogether when
`DEMO_SKIP_EMAIL_CODE=true` as well, which is how this checkout is configured. Both cases are
announced on the sign-in screen.

Anywhere else, including every Vercel production deployment, both shortcuts are refused and every
address is sent a real code. Being undeliverable is not a permission: the seeded administrator is a
reserved-domain account too, and an on-screen code beside a shared password would hand it over.
`npx tsx scripts/check-demo-login.ts` walks all five roles through whatever this server requires.

## Seeding safeguards

`prisma/seed.ts` deletes transactional tables before it writes, so it decides whether it is allowed
to run *before* it constructs a client. All of the following must hold, and the first failure exits
with nothing written:

| Check | Refuses |
| --- | --- |
| `VERCEL_ENV` is not `production` | Any Vercel production build, whatever else is set. |
| `SYPRUS_DEMO_ENV=true` | A server that has not declared itself disposable. |
| `SEED_ALLOW_RESET=true` | A run where deleting every table was not explicitly intended. |
| `DATABASE_URL` parses as `postgres://` or `postgresql://` | Anything else, including an empty or malformed value. |
| Host is `localhost`, `127.0.0.1` or `::1` | Every remote host, Supabase included. |
| Username has no `.` | The tenanted `postgres.<ref>` form, which is how a tunnel to a hosted database looks. |
| Database is named, and not `postgres` | The default maintenance database. |
| `SEED_DEMO_PASSWORD` is at least twelve characters | Seeding accounts with a password published in this repository. |

`npm run qa:seed` sets the two declarations for the isolated QA cluster. Pointing `DATABASE_URL` at
a hosted database is not enough to seed it: the loopback and username rules refuse it first.

## Scripts

| Command | Does |
| --- | --- |
| `npm run dev` / `build` / `start` | Development, production build (runs `prisma generate` first), production server. |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm lint` (`npm run lint`) | ESLint flat config. |
| `npm run db:pg` | Initialise and run the bundled PostgreSQL cluster. |
| `npm run db:migrate` / `db:deploy` | Create/apply migrations. |
| `npm run db:seed` | Rewrite demonstration data (destructive on transactional tables; skills, roles and permissions are upserted). |
| `npm run db:generate` / `db:push` / `db:studio` / `db:reset` | Client generation, schema sync, data browser, full reset. |
| `npm test` | 158 unit checks: structured extraction mapping, guardrails, authorization, matching maths and its exact arithmetic, fairness audit, provenance bands, provider chain, credential↔endpoint binding, consent semantics, the verification ticket, transport decision, Supabase mail-function boundary and demonstration waiver, and the security boundaries — credential-free probe URLs, output redaction, TLS rejection of a self-signed and a wrong-hostname peer, demonstration shortcuts failing closed off-demo, and the seed guard refusing before it writes. |
| `npm run test:e2e` | **Production build + 14 Playwright tests** (Chromium). Four journeys: candidate register → code → onboarding → proposal edit → graph drag/annotate persisted → pathway → apply (with and without identity consent); employer register → code → draft → moderation → blind review → shortlist → disclosure request → approve → **revoke** → application → interview invitation; assessment redirect, admin screens, weight percentages, axe accessibility at 390 px and 1440 px; and a crawl of every internal link in all three portals. Three are the account-menu regression: pointer open, keyboard open/arrows/Escape, axe on the open menu and sign-out, once per portal. Two are the Sona panel. Two are the visualisation reconciliations. One is the code screen: it must say the code was not emailed, refuse a wrong one with its attempts left, start over cleanly, and take the right code from the keyboard alone. Two are input retention: a rejected registration keeps the name, address and consent tick (and never the password), and a rejected sign-in keeps the address while the code field stays empty. |
| `npm run test:integration` | 34 checks against a **dedicated local PostgreSQL** and the real HTTP APIs: cross-account isolation, anonymous projection contents, consent revealed-when-granted and withheld-when-revoked in both directions, append-only consent history, disclosure expiry/revocation, upload magic-byte and ownership rules, API 401/400/403/404 responses and download headers, and the verification rules — registration leaves the account unverified, digest-only storage with no code or address in the audit row, cooldown, five-attempt ceiling, a spent code not blocking the next sign-in, the hourly ceiling with its real clearing time and its own default, single use, cross-account rejection, the grant spent by the session that came from it, a password-only browser reaching no portal page/no API/no data, and a locked account not unlocked by the right password. It refuses to run against a remote database. |
| `npm run qa:migrate` / `qa:seed` / `qa:demo` | Migrate, seed and then read back the demonstration facts quoted in the demo script. |
| `npm run qa:ai-demo` | Live pass of all four agents against the QA database, storing genuine provider output. |
| `npm run qa:build` / `qa:start` | Production build and server for the QA environment (own `distDir`, deterministic AI). |
| `npm run check:security` | Migration state, RLS coverage and whether the anonymous/authenticated database roles hold table privileges. |
| `npm run check:engines` | Rule-engine invariants (25 assertions) without a database. |
| `npm run check:ai` | Live agent probe: `--model=<id>` to test a model, `--bias` for agent 4, `--persist` to write through the product path. |
| `npm run check:fallback` | Which failover endpoints the keys can actually serve (prints no secrets). |
| `npx tsx scripts/check-failover.ts` | Proves failover: calls each endpoint, then breaks the primary and shows which endpoint answered. |
| `npx tsx scripts/sweep-site.ts <base>` | Crawls every page of all three portals and the public site, reporting error boundaries, console errors and failed subresources (RSC prefetch aborts are excluded as framework noise). |
| `npx tsx scripts/check-sona.ts <base>` | Live assistant check: asks Sona two grounded questions, reports which engine answered each, verifies the transcript persisted, and measures the auth panels at 820/900/1024. |
| `npx tsx scripts/check-gap-viz.ts <base>` | Gap report and match explanation: components must add to the readiness figure, weights must total 100%, required + preferred must equal every gap, filter announcements must match the rows on screen, and nothing may clip at 375/768/1024. |
| `npx tsx scripts/check-pathway-viz.ts <base>` | Learning pathway: step order, next action, hours arithmetic, real resource links, and a step completed then reverted through the normal action, with the counts checked at each stage. |
| `npx tsx scripts/check-applications-viz.ts <base>` | Application tracker: every stage drawn must be backed by a recorded event, a stage named as missing must never appear as reached, and interview dates must come from stored values only. |
| `npx tsx scripts/check-interview-date.ts` | Records an interview invitation as the employer, then reads it back on the candidate screen with its attribution — run against the QA cluster only. |
| `npx tsx scripts/check-employer-dash.ts <base>` | Employer overview: per-role totals must add to the all-roles total, chart, list, sentence and header stat must agree, and no candidate name or email may appear. |
| `npx tsx scripts/check-admin-dash.ts <base>` | Administrator overview: composition bars, lists and totals reconcile, and a trend may only be drawn when its window contains rows. |
| `npx tsx scripts/check-ai-health-viz.ts <base>` | AI health: mode, status, provider, fallback-reason and per-agent token figures all reconcile against the window aggregates, and the page must not present stored runs as current connectivity. |
| `npx tsx scripts/check-fairness-viz.ts <base>` | Fairness: band counts reconcile with the audit total, missing data is named rather than zeroed, no individual attribute is rendered, and a candidate is refused the screen. |
| `npx tsx scripts/check-public-demo.ts <base>` | The public skills demo: recomputes its arithmetic from the DOM, checks pointer and keyboard operation, and fails if interacting with it makes any request. |
| `npx tsx scripts/check-dark-mode.ts <base>` | Forces the dark theme, reads the computed surfaces, measures text contrast on fifteen screens across all three portals, and captures the dark screenshots. |
| `npx tsx scripts/check-theme-menu.ts <base>` | Appearance control: device-following default, Light/Dark overrides, the header toggle agreeing with the account menu, axe on the menu, and keyboard selection. |
| `npx tsx scripts/check-verification.ts <base>` | Which door this server uses: reads the waiver notice off the sign-in screen, signs a demonstration account in through the code step or the waiver, proves the session works on the API and that a fresh browser gets nothing, and with `--signup` registers an address no waiver can cover to show it is still stopped. Prints no secret. |
| `npx tsx scripts/seed-ai-demo.ts` | Runs the four batch agents live against the database in `.env`. `--candidate <email>` and `--as-candidate` change who triggers it. |
| `npm run check:supabase` | Database reachability for the configured host, with the failure cause classified. |

## What is implemented

**Public site** — responsive navigation with a mobile sheet, hero, problem statement, five-step
how-it-works, the four agents with explicit limits, candidate and employer benefits, testimonials
marked as illustrative, FAQs, an honest "what this build does not claim" panel, and registration CTAs.

**Candidate portal** — email signup/login, consent and privacy controls, conversational onboarding
that writes real experiences/skills/consent rows, dashboard, skills inventory with evidence and
validation status, **skill suggestion inbox** (confirm / edit the level / reject, each with the
sentence it came from), **practice assessments** scored server-side, **evidence document uploads**
with checksum-verified downloads, centre-out **interactive capability graph** (zoom, pan, inspect,
drag and annotate with edits persisted per node), skill gap report, personalised learning pathways
with progress tracking, recommended roles with the full weighted calculation behind each score,
applications tracker, **disclosure request decisions**, notifications, profile and privacy editing.

**Employer portal** — organisation signup with verification status, organisation profile, create /
edit / pause / resume / close / delete roles, required and preferred skills with levels and weights,
anonymised candidate review, explainable match scores, shortlist, interview invitations, application
pipeline with a state machine, **identity-disclosure requests** (a question, not a key), and a
**posting review panel** showing stored language findings, continuity checks and suggested rewrites.

**Administrator portal** — user and organisation management, role moderation, **agent health**
(provider chain, per-agent fallback rate, guardrail blocks, token spend, workflow runs), rule-engine
health from real `engine_runs` data, **human review queue** including the evidence-document queue,
**matching weight editor** with versioned profiles and recomputation, fairness monitoring, audit
history, reporting dashboard.

**AI layer** — five agents with Zod contracts (four batch agents plus Sona), a provider chain whose
primary is chosen by configuration and whose per-endpoint token windows, retries, repair-retry and
guardrails enforce provenance and refuse invented skills, links or figures, `ai_runs` audit rows
naming the endpoint that answered, and a deterministic fallback for every agent. See
[docs/AI_INTEGRATION.md](docs/AI_INTEGRATION.md).

**Platform** — 48 persisted tables (verified by `npm run check:security`), server-side
validation on every mutation, an emailed six-digit code required at registration and at every
sign-in (see **Email verification**), role-based access with a database-backed permission
catalogue, tenant scoping, anonymisation filter, audit trail, notifications, JSON APIs
(`/api/health`, `/api/jobs`, `/api/skills`, `/api/matches/recompute`,
`/api/evidence/{id}`).

See [docs/FEATURE_COMPLETION.md](docs/FEATURE_COMPLETION.md) for the honest per-feature status,
[docs/AI_INTEGRATION.md](docs/AI_INTEGRATION.md) for the agent contracts, provider chain, guardrails
and failure semantics, [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the pieces fit, and
[docs/DATA_MODEL.md](docs/DATA_MODEL.md) for the schema. [docs/BUILD_GUIDE.md](docs/BUILD_GUIDE.md)
records the stack-specific rules for adding screens.

## Images and media

`public/images/syprus/` holds the 18-file WebP library; `src/lib/assets.ts` is the single
manifest of path, intrinsic width/height, alt text, fit (`contain` for illustrations that
need their whole composition, `cover` for photographs and shaded scenes) and, for the
cover cases, the crop focus that keeps faces in frame.

Three surfaces render it, so no page hand-rolls an `<img>`:

- `SectionImage` (`src/components/media/section-image.tsx`) — reserves the asset's own
  aspect ratio before the bytes arrive, so nothing shifts, and badges any artwork that
  shows a person as generated rather than a customer.
- `AuthPanel` (`src/components/media/auth-panel.tsx`) — the login and registration side
  panel. Hidden below `lg`, so the form stays primary on narrow screens; on registration it
  follows the role tab.
- `EmptyState`'s optional `image` prop — the nine portal empty states.

Everything is lazy by default (nothing preloads), `sizes` is set per placement, and live
data stays live: charts, the capability graph, match scores and pipelines are computed
components, never pictures.

## Theme

Light and dark, on every screen — public site and all three portals.

- `next-themes` provides the class on `<html>`; the first visit follows the operating
  system, and an explicit choice is stored under one `localStorage` key.
- The header carries a one-click control (sun/moon, named by `aria-label`); the account
  menu carries the full set — device setting, light, dark — as radio items, so
  "follow my device" stays reachable.
- Dark is not a filter over the light palette. `globals.css` remaps the tint, border and
  status-text shades of each scale inside `.dark`, while the 500–600 fills — primary
  buttons, progress rails, provenance dots — stay saturated in both. That is why the
  change lands across two hundred class lists without editing two hundred class lists.
- Charts read the same variables (`var(--color-brand-500)`), so a bar changes with the
  theme; the capability graph passes `colorMode` to React Flow so its canvas, minimap and
  attribution follow too.
- Generated artwork keeps its original colours in both themes — the images are the
  client's library, not something to recolour — and `theme-color` for browser chrome is
  derived from the two background tokens rather than guessed.
- Contrast is measured, not assumed: `scripts/check-dark-mode.ts` walks the rendered text
  of fifteen screens and fails below 3.6:1.

## Email verification

An account cannot be opened, and a session cannot be created, until a six-digit code that was
sent to its own address is entered. This runs at registration **and at every sign-in**.

- **Password first, then code.** `loginAction` checks the password through
  `verifyCredentials` (`src/server/credentials.ts`) — bcrypt, the five-attempt/15-minute lockout,
  the status check — and creates **no session**. It issues a code, writes a short-lived signed
  ticket cookie, and sends the browser to `/verify-email`.
- **The code is the only door.** There is no password-only provider in `src/lib/auth.ts` apart
  from the opt-in demonstration waiver below, so there is nothing that turns a password into a
  session cookie. The session provider takes the ticket, requires the code row it names to carry
  `verifiedAt` (stamped only by a correct entry, and only within the last five minutes), and
  clears that stamp as an atomic write — so a grant buys exactly one session, and two racing
  requests for the same grant cannot both collect one. What is measured: a browser that has only
  passed the password reaches no portal page, no API and no data, and the redeemed row's stamp is
  gone once the session exists.
- **Two ways to pass one check.** Every verification carries a six-digit code *and* a single-use
  link (`/verify-email?token=…`). The link screen posts the token to an action, so opening a GET
  never spends anything, and either path stamps the same row — the door into a session is
  identical whichever the recipient uses. A link that was already clicked says so and offers a new
  one rather than quietly minting a second session.
- **What is stored.** A 6-digit code from the CSPRNG plus a 288-bit link token, kept as HMAC-SHA256
  digests (the code bound to the user id, the link to the secret alone, because the row has to be
  found from the token); 10-minute expiry; 5 wrong entries burn a code; a 30-second gap and 6 sends
  per hour per account (`VERIFICATION_MAX_SENDS_PER_HOUR`, raised only on the QA cluster so a suite
  of sign-ins cannot exhaust it); issuing a new verification retires the previous one. The plaintext
  code and token are never written for a mailed delivery — and never logged, including in the audit
  rows, which carry only the row id, purpose, transport, method and outcome.
- **Transport.** The letter is posted to an Edge Function **inside your own Supabase project**
  (`supabase/functions/send-email`, called from `src/lib/mail/supabase.ts`), so the application
  holds no mail credential at all: the provider secret lives in Supabase's secret store, and this
  repository never sees it. The call carries `SUPABASE_URL` plus the project's service-role key as
  a bearer token, which the function checks in constant time — a user's own access token is refused
  even though the platform would accept it. The endpoint is built only from hosts ending in
  `supabase.co`/`supabase.in` (or http on localhost for the CLI's local project), so a mis-set
  `SUPABASE_URL` cannot carry the key to a stranger's host; `redirect: 'error'` and an abort timeout
  apply, and error messages classify the failure (`rejected-credential`, `unverified-sender`,
  `rate-limited`, `timeout`, …) without repeating the key, the address or the code — the function
  itself answers in machine codes, never in provider prose, for the same reason. The caller cannot
  choose the sender: `from` is read only from the function's own secrets, and a `from` field in the
  request is ignored without saying so. Requires `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`;
  with either missing — or with the function deployed but mail-less, which answers
  `mail-not-configured` — a real address is told that this server cannot send mail and **no session
  is created**. It fails closed.
- **Why not Supabase's own mailer.** Supabase has no general email API: its built-in SMTP is
  documented at two messages an hour, delivers only to addresses on the project's own team, and is
  "not meant for production use", while a candidate's code must reach a stranger's mailbox on the
  first try. So Supabase is the place the credential and the sender live, and the provider in front
  of it is your choice — `RESEND_API_KEY` for an HTTPS-only path, or `SMTP_HOST`/`SMTP_PORT`/
  `SMTP_USER`/`SMTP_PASS` for a mailbox you already run (Google Workspace, Zoho, Hostinger, your own
  server). The SMTP branch has not been proven from a deployed function in this environment; the
  Resend branch is what Supabase's own documentation example uses. Deploy with:
  ```bash
  npx supabase link --project-ref <project-ref>
  npx supabase secrets set MAIL_FROM_ADDRESS="SYPRUS <no-reply@yourdomain>" RESEND_API_KEY=...
  npx supabase functions deploy send-email
  ```
- **Demonstration addresses.** `example.com`, `example.org`, `example.net`, `syprus.test`,
  `localhost` and their subdomains cannot receive mail, so on a server that declares
  `SYPRUS_DEMO_ENV=true` their code **and** their link are shown on the entry screen under a panel
  that reads "Demonstration delivery — this code was not emailed". That is the only case where a
  credential appears on screen, and it is why `npm run demo:login` and the browser suite can drive
  the whole flow. Without that declaration the reserved domains are treated like any other address
  and handed to the mail function, because undeliverable is not the same as authorised.
- **Waived for the demo, loudly.** `DEMO_SKIP_EMAIL_CODE=true` skips the code for those same
  reserved addresses only, through a separate provider that re-checks the password and the
  domain itself; a real address can never be signed in that way, and `/login` and `/register`
  print the waiver notice whenever it is active. The flag does nothing without
  `SYPRUS_DEMO_ENV=true`, and `VERCEL_ENV=production` overrides both. The QA cluster pins the flag
  to `false`, so every browser and integration result below is measured with codes required. It is
  `false` by default.
- **Belt and braces.** `getPrincipal` returns no principal for an account whose address was never
  confirmed, so a session left over from before a confirmation was withdrawn reaches no data, and
  every API route goes through it.

Run `npx tsx scripts/check-verification.ts http://localhost:3000` to check the running server.
`GET /api/health` reports mail configuration as `function-configured`, `screen-only` (explicit
preview mode), or `not-configured`. Configuration alone does **not** prove that the function is
deployed, its provider is configured, or an email reached an inbox. The Supabase key must be in
`.env` or the server environment; Next.js does not automatically load `.env.supabase`.
Use `QA_BASE_URL=http://localhost:3100 npx tsx scripts/check-verification.ts --signup` only against
the isolated QA cluster, where codes appear on screen. `npm run test:integration` asserts digest
storage, delivery failure cleanup and reasons, cooldowns, attempt/send ceilings, single use,
cross-account rejection, and that a password-only browser reaches no protected page or data.

## Security model in one paragraph

Passwords are bcrypt-hashed (cost 12, with a 72-byte UTF-8 guard so bcrypt's truncation
cannot silently shorten them) and never leave the server; the rule is at least 8 characters
with a letter and a number, and every password field has a reveal button so a mistyped
character is visible instead of costing a rejected submit; five failed sign-ins lock an
account for 15 minutes; unknown-email and wrong-password responses are identical. A correct
password opens nothing by itself — see **Email verification** above, because the only session
provider accepts a code or link that was actually passed. Sessions
are JWTs that carry **only** the user id — role, account status, organisation membership and
permissions are re-read from PostgreSQL on every request, so suspending an account or
changing a role takes effect immediately; the residual risk is that a stolen cookie stays
valid for `session.maxAge` (12 hours) because there is no server-side revocation list. Pages
guard with `requirePermission`, and every server function re-resolves the principal and
asserts the same permission, because a server function can be POSTed to directly. Candidate
mutations are keyed to `candidateProfileId` ownership and employer mutations to
`organizationId`, enforced inside the query, not in the UI; the browser and integration suites
assert those refusals across accounts rather than trusting them. The Next.js proxy only
redirects — it is never the authorising layer. Client components cannot reach Prisma at all.
No secret is exposed to the browser: the only `NEXT_PUBLIC_*` variable is the site URL. On the
database side, `npm run check:security` confirms that RLS is enabled on all 45 public tables
and that the `anon` and `authenticated` roles hold **no** table privileges, because the
application connects as its own owner role and exposes nothing through the Data API.

## Privacy behaviour worth knowing

Employer-facing candidate views are produced by a single anonymisation filter
(`src/server/anonymize.ts`). It removes names and contact details, replaces employer names
with neutral labels, converts calendar dates into durations so a service gap is not visible,
and withholds **free text as well** — headline, summary, education text, target role and
industry, location and experience descriptions stay empty until a live consent exists,
because those fields are where a name hides. Career-break length and reason are never part of
an employer view or a score.

Identity becomes available only through the candidate's own act, and there are exactly two
routes: **applying to a role**, which now requires ticking an explicit identity-consent
control that is stored as `identityConsentAt` on that application; and **approving that
organisation's disclosure request** on `/candidate/disclosures`, which grants access for 30
days, is recorded as its own append-only consent row, and can be **withdrawn** from the same
screen — the next employer load is anonymous again. A request on its own reveals nothing, and
a decline is a recorded answer. Withdraw sharing entirely and the profile disappears, pending
and approved disclosure grants are revoked, and application consents are cleared. Every
identified view is written to `profile_views` and `audit_events`; the application payload the
employer list reads no longer carries a candidate headline.

Consent is versioned and append-only: each decision is a new row in `consent_records`, so the
history shows a decision being made, changed and withdrawn rather than overwritten. Withdrawing
inference consent deletes the skills inference or the model had created and rejects the
suggestions still waiting.

AI credentials are server-only (`AI_API_KEY`, `OPENROUTER_API_KEY`, `GEMINI_API_KEY`) and are
never rendered, logged or returned by any screen — health reports presence as a boolean. Each
credential is bound to the exact endpoint that issued it (`endpointIsAllowed` in
`src/lib/ai/config.ts`): an HTTP scheme, a non-standard port, embedded credentials, a query
string or a look-alike hostname is refused, the adapter re-checks the binding before it sends
anything, redirects are disabled, and a provider's own error body is never stored because it
can echo a key. Uploaded evidence is stored under a randomised key outside the web root, size-
gated, magic-byte checked against its declared type, and served only to its owner or an
administrator after a sha256 re-check, with `nosniff`, a sandboxed CSP and `private, no-store`.

## Demonstration

Run it for a demo with the database and credentials in `.env`:

```bash
npm run build && npm start     # http://localhost:3000
npm run demo:smoke             # signs in as the candidate and two employers, checks disclosure rules
REPRO_BASE=http://localhost:3000 npx tsx scripts/repro-account-menu.ts   # account menu: open, keyboard, sign-out per portal
npx tsx scripts/check-dashboard-layout.ts http://localhost:3000 final    # completion wording + clipping at 375/768/1024/1440
```

`demo:smoke` is a post-start check, not a test suite: it signs in as Anshika, counts the
graph nodes, then signs in as **two employers with different entitlements** and asserts
that the one holding her consented application can read her contact details while the
other cannot — per card, because that is where a leak would actually hide.

`repro-account-menu.ts` is the harness that reproduced the Base UI group-context crash; it
runs against the dev server (`npx tsx scripts/qa.ts dev`) when you want an unminified stack.
`check-dashboard-layout.ts` measures `scrollWidth` against `clientWidth` per element, so a
"truncated label" claim is a number, not an opinion.

[docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md) is a twelve-minute, five-scene walkthrough built
around the fictional candidate **Anshika** — a marketing analyst with a 36-month caregiving
break — and it contrasts timeline-first screening with skills-first recognition using the
demonstration posting whose exclusionary wording the bias agent actually flags. Every figure
it quotes is printed by `npm run qa:demo`, so the script cannot drift from the database.

## Testing

Three layers, all executed and all reproducible:

```bash
npm test                    # 158 unit checks, no database
npm run test:integration    # 37 service + HTTP API checks against a dedicated local database
npm run test:e2e            # production build, then 17 Playwright tests (Chromium)
```

The QA suites deliberately run against their **own** local PostgreSQL (`syprus_qa` on port
55433) with `AI_ENABLED=false`, `DEMO_SKIP_EMAIL_CODE=false`, `MAIL_MODE=preview` and
`SYPRUS_DEMO_ENV=true` plus `SEED_ALLOW_RESET=true` — the last two are what let the seeder touch
that disposable cluster at all. A test run can therefore never erase a demo database, never spend
provider credits, **never post a letter to the mail function**, and never measure a sign-in whose
second factor was switched off. Both
`tests/integration.ts` and `tests/browser.spec.ts` refuse to
start if `DATABASE_URL` points anywhere else. Live provider behaviour is verified separately
and deliberately: `npm run check:fallback`, `npx tsx scripts/check-failover.ts` and
`npm run qa:ai-demo`.

What the tests do **not** cover is stated in [docs/QA_REPORT.md](docs/QA_REPORT.md) — notably
Firefox/WebKit, load testing and penetration testing.

**Secret scanning.** [.github/workflows/secret-scan.yml](.github/workflows/secret-scan.yml) runs
gitleaks over every commit reachable from any branch or tag on each push, pull request and weekly
schedule. The action and the scanner are both pinned — checkout by commit SHA, gitleaks by version
plus a SHA-256 check against the published checksums — and the scan runs with `--redact`, so a
failing job names the file, commit and rule without printing the value. No report is uploaded as an
artifact, for the same reason. [.gitleaks.toml](.gitleaks.toml) extends the default ruleset with two
rules the default lacks (a Postgres URL carrying a password, and a Supabase secret key or personal
access token) and carries one exception: the two loopback-only cluster passwords published in
`.env.example`, matched by whole value. Publishable and anon keys, the pinned public Supabase root
certificate and the inert fixture strings in `tests/` are not secrets and are not excluded.

## Deployment

Set the environment first (`AUTH_SECRET`, `DATABASE_URL`, then the AI
keys you actually want live, then `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` — without those
two, sign-in cannot issue a code and nobody with a real address can get in; the mail function also
has to be deployed, or it answers `mail-not-configured` and the same door stays shut).
`SEED_DEMO_PASSWORD`, `SYPRUS_DEMO_ENV` and `SEED_ALLOW_RESET` are seeding-time only and have no
place in a deployment's environment. Then:

```bash
npm ci
npx prisma generate
npx prisma migrate deploy      # applies all eleven migrations
npm run build                  # prisma generate && next build
npm start                      # serves on PORT (default 3000)
```

**Managed PostgreSQL (Supabase).** Use the *direct* connection string on port 5432 with
`sslmode=require`, not the pooled transaction endpoint on 6543 — `prisma migrate deploy`
cannot run through transaction pooling. Keep SSL on. The application needs no Data API
access: leave `anon` and `authenticated` without table privileges (the
`20261105130000_data_api_isolation` migration does exactly that, and is a no-op on plain
PostgreSQL where those roles do not exist). If you later expose tables through the Data API
or add Supabase Auth, Row Level Security **policies** become mandatory — enabling RLS alone
denies everything rather than protecting anything.

**Vercel.** Add `DATABASE_URL`, `AUTH_SECRET`, `AUTH_URL` (your deployment URL),
`AUTH_TRUST_HOST=true`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and the AI keys as encrypted
environment variables; never prefix a secret with `NEXT_PUBLIC_`. Keep the mail provider key in
Supabase function secrets. The app's service-role key remains highly privileged: leaking it can
allow database access and mail-function calls, so it must also be protected and rotated if exposed.
Leave `SYPRUS_DEMO_ENV` unset or `false`, and `DEMO_SKIP_EMAIL_CODE` and `MAIL_MODE` with it: the
first is the gate the other two sit behind, so on a deployment none of them can put a verification
code on screen. `VERCEL_ENV=production` is a second lock that cannot be switched off by a variable
you control. Set the build command to `npm run build` and
run `npx prisma migrate deploy` as a build/release step rather than inside a request. Three
things must be solved before a real production deployment, the first two described in
[docs/QA_REPORT.md](docs/QA_REPORT.md) §6: evidence uploads currently write to the server's own
disk (read-only outside `/tmp` on Vercel, so they need object storage), provider token
budgets live in one process's memory, so with N instances you get N budgets, and verification
mail needs a sender the Supabase mail function can use — with no function configured the app
refuses to sign anyone in at a real address rather than showing their code on screen.
