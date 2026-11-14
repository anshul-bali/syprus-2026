# Quality assurance, security and deployment readiness

Date: 2026-11-05. Scope: the whole platform as it runs today. Everything below was
executed against the code in this repository; where a check was **not** run, it says so.

---

## 1. Verdict

The platform is **demo-ready and reviewable**. It is **not** production-ready: evidence
uploads are stored on the server's own disk, provider budgets live in one process's
memory, and no external penetration test or load test has been run. Section 6 lists the
blockers in the order they should be fixed.

Nothing in the verified journeys is a mock: the browser tests drive the real server
functions, the real PostgreSQL, and the production build.

A follow-up pass on 2026-11-06 fixed four defects reported from use of the running demo —
the account menu crashing the page it was on, marketing copy that denied model calls the
agents actually make, "What is still missing" shown at 100% completion, and clipped
dashboard labels — and added the regression coverage that was missing for the first three.
See §2 "Re-run" and §4 defects 22-25.

A third pass the same day added email verification — a six-digit code and a clickable link at
registration and at every sign-in, SendGrid as the transport, an explicit waiver for the seeded
demonstration accounts — and then the fixes asked for afterwards: forms that keep what was typed,
eight-character passwords with a reveal button, and the link path. Its results and the 17 defects
found in it, most of them in code written during that same pass (including a form that cleared
itself on every rejected submit, and the half-ticked consent box that came with fixing it), are in
**§9**.

---

## 2. Tests executed, with their real results

| Command | What it covers | Result this pass |
| --- | --- | --- |
| `npm run typecheck` | whole project, strict | **clean** |
| `npm run lint` | ESLint flat config | **0 errors, 0 warnings** |
| `npm test` | 73 unit checks: extraction mapping, guardrails, authorization, matching arithmetic, provenance bands, provider chain, credential↔endpoint binding, consent semantics | **73 passed, 0 failed** |
| `npm run check:engines` | 25 rule-engine invariants, no database | **25 passed** |
| `npm run test:integration` | 22 checks over the real services *and* real HTTP APIs against a dedicated local database | **22 passed, 0 failed** |
| `npm run test:e2e` | 4 Playwright journeys against the **production** build (`next build` → `next start`) | **4 passed (44.0 s)** — details in §3 |
| `npm run check:security` | migration state, RLS, Data API privileges | **48 tables, RLS enabled 48, `anon`/`authenticated` table access 0** |
| `npx tsx scripts/check-failover.ts` | live provider chain + forced failover | **Groq 1181 ms/421 tok · OpenRouter 1025 ms/152 tok · Gemini 6475 ms/207 tok; broken primary answered by OpenRouter after 2 attempts** |
| `npm run check:fallback` | which failover credentials actually work | **OpenRouter 418 models, JSON call ok; Gemini 61 models, JSON call ok** |
| `npm run qa:ai-demo` | all four agents through the product services, live | **agent 1 AI/Groq 4 proposals · agent 4 AI on 8 roles · agent 2 AI 83% labelled `DATABASE_POSTINGS`/live false · agent 3 deterministic, honestly 0 gaps · workflow COMPLETED** |
| `npx tsx scripts/demo-audit.ts` | reads the demonstration facts the script quotes | **Anshika: 13 skills, 12 stored matches, top 83%, 2 applications** |

Production build: compiles, type-checks, **47 routes**, no warnings. An earlier build
traced the whole project because the upload directory was built from a dynamic
filesystem path; that is fixed and the build is clean.

### Re-run after the 2026-11-06 fixes (§4, defects 22-25)

| Command / check | Result |
| --- | --- |
| `npm run typecheck` · `npm run lint` | **clean** · **0 errors, 0 warnings** |
| `npm test` | **73 passed, 0 failed** |
| `npm run check:engines` | **all engine checks passed** |
| `npm run test:integration` | **22 passed, 0 failed** |
| `npm run test:e2e` | **7 passed (4 journeys + 3 new account-menu regressions)** in 50.5 s against the production build |
| `REPRO_BASE=http://localhost:3000 npx tsx scripts/repro-account-menu.ts` | **12/12** — pointer open on 6 routes across 3 portals, keyboard open/arrows/Escape, sign-out landing on `/` with the portal then redirecting to `/login` |
| `npx tsx scripts/check-dashboard-layout.ts http://localhost:3000 final` | **no clipping at 375/768/1024/1440** on `/candidate`, `/candidate/jobs`, `/candidate/gap-report`, `/candidate/profile`; complete profile → "Your profile is complete" + status line, fresh profile (0%) → "What is still missing" + one named next step |

### Re-run after the image integration (2026-11-06, later the same day)
| Command / check | Result |
| --- | --- |
| `npm run lint` · `npm run typecheck` | **0 errors, 0 warnings** · clean |
| `npm test` · `npm run check:engines` | **73 passed** · **all engine checks passed** |
| `npm run test:integration` | **22 passed, 0 failed** |
| `npm run test:e2e` | **7 passed (54.2 s)** — the four journeys and the three account-menu regressions, on the build that now carries the image library |
| `npx tsx scripts/shoot-pages.ts http://localhost:3000 final 375,768,1024,1440 …` | **11 pages × 4 widths: 0 failed images, 0 aspect drift, 0 collapsed figures, 0 horizontal overflow**; populated screens report `images=0`, so no data screen gained decoration |
| per-asset scroll check on `/` | all six homepage images load when scrolled into view, served at 640w–1080w (not 3840w) and at their intrinsic ratio |
| `REPRO_BASE=http://localhost:3000 npx tsx scripts/repro-account-menu.ts` | **12/12** still passing after the image work |
| reduced-motion + narrow-screen probe | `offenders=0` images with transitions, `scroll-behavior: auto`, login panel `display: none` at 375 px with the form still reachable |

### Re-run after the hero pairing and the dark theme (2026-11-06, later the same day)

| Command / check | Result |
| --- | --- |
| `npm run typecheck` · `npm run lint` | clean · **0 errors, 0 warnings** |
| `npm test` · `npm run check:engines` | **89 passed** · **all engine checks passed** — no scoring behaviour changed in this pass |
| `npm run test:integration` | **24 passed, 0 failed** |
| `npm run test:e2e` | **11 passed (2.3 m)** — the three account-menu regressions now walk the Appearance radio group by keyboard instead of assuming the second item is an action |
| `npx tsx scripts/check-dark-mode.ts http://localhost:3000` | dark class applied before paint from the stored preference; header control and menu agree; **text contrast ≥ 3.6:1 on fifteen screens** (twelve portal screens plus `/`, `/login`, `/register`); no console errors |
| `npx tsx scripts/check-theme-menu.ts http://localhost:3000` | 14 checks: device-following default, Light/Dark overrides, `aria-checked` on the active choice, axe clean with the group inside the menu, Escape closes, keyboard selection works |
| `npx tsx scripts/sweep-site.ts http://localhost:3000` | **113 pages, 0 findings** on the clean run. An earlier run stopped at 105 pages with six findings on `/candidate/jobs`, all traceable to one cause: `Can't reach database server at db…supabase.co:5432` — a transient host blip, confirmed by `npm run check:supabase` passing immediately afterwards and the sweep returning 0 findings on re-run |
| horizontal overflow at 375 px | `/`, `/login`, `/register`, `/no-access`, candidate dashboard, graph, gap report, Sona panel open, employer × 3, admin × 3 — **all 375/375, no page scroll** |

Defects found and fixed inside this pass, in my own work:

| # | Defect | How it was found | Fix |
| --- | --- | --- | --- |
| 41 | The header theme control pushed the portal header 4 px past the viewport at 375 px, so every portal page gained a horizontal scroll — caught by the Sona mobile-width assertion | `noOverflow` in the browser suite failed on the candidate dashboard at 375 px; measuring element right edges showed the header action group at 379 px | the icon control is `hidden sm:inline-flex`; the account menu carries the same choice on every width, so nothing is lost on a phone |
| 42 | The account-menu keyboard test asserted that one ArrowDown lands on an action; with the Appearance group inserted, the walk now passes through three radio items first, and the test failed on a menu that was behaving correctly | the same e2e run, three portals | the test walks up to eight items and asserts Notifications, the three appearance choices and Sign out are all reachable — a stronger claim than the one it replaced |
| 43 | `theme-color` for browser chrome was a guessed hex that did not match the dark background token | converting the actual `oklch` tokens to sRGB | the meta values are now `#fcfdff` / `#0f141d`, the measured light and dark backgrounds |
| 44 | The capability graph stayed on React Flow's light theme in dark mode (white minimap, light canvas tokens) because `colorMode="light"` was hard-coded | reading the component while auditing surfaces | `colorMode` follows the resolved theme, and the dot-grid colour changes with it |
| 45 | Two chart fills were literal hex (`#b9d3f0`, `#2f6fcb`), so the gap chart kept light-mode colours on a dark card | the dark screenshot pass | both now read `var(--color-brand-300)` / `var(--color-brand-500)` |
| 46 | A `text-brand-950` label on a tint that becomes deep in dark mode would have been unreadable | grepping for shades whose role differs between tint and text | that one label moved to `text-brand-800`, which the dark block already remaps |

### Re-run after the dynamic visualisation pass (2026-11-06, later the same day)

| Command / check | Result |
| --- | --- |
| `npm run typecheck` · `npm run lint` | clean · **0 errors, 0 warnings** |
| `npm test` | **89 passed** — new case: the readiness components multiplied by `GAP_READINESS_WEIGHTS` must rebuild the stored readiness, the weights must be a partition, and every gap row must carry requirement, 1–5 weight and whole level steps |
| `npm run check:engines` | **all engine checks passed** after the weights were extracted into named constants |
| `npm run test:integration` | **24 passed, 0 failed** |
| `npm run test:e2e` | **11 passed (2.2 m)** — the nine earlier tests plus two new visualisation regressions (gap arithmetic reconciled from one DOM pass; admin charts add up to the counts they claim) |
| `npx tsx scripts/sweep-site.ts http://localhost:3000` | **112 pages across all three portals and the public site, 0 findings** — no error boundary, no console error, no failed subresource |
| `scripts/check-gap-viz.ts` | readiness components add to the stated total, weights sum to 100%, the substituted experience component is labelled “no data”, required + preferred = every gap, filter announcements match the rows, weights read as /5, distances are whole steps, 0 px overflow at 375/768/1024 |
| `scripts/check-pathway-viz.ts` | steps in recorded order, next action = first open step, hours line equals the per-step durations, links are real URLs, completing and reverting a step moves and restores the counts, keyboard-operated, 0 px overflow |
| `scripts/check-applications-viz.ts` (both databases) | every stage chip is backed by a recorded event, a stage named as missing is never drawn as reached, an interview date appears only with a stored date, group headings match the badges, header count = cards |
| `scripts/check-interview-date.ts` | an employer moved a shortlisted application to Interview invited with a slot; the candidate screen then showed the stage, the date and the attribution “recorded by the employer or a reviewer” |
| `scripts/check-employer-dash.ts` (both databases) | per-role totals add to the all-roles total, chart/list/summary sentence/header stat all agree, history “ever reached” ≥ current stage, no conversion rate invented, no candidate name or email on the screen |
| `scripts/check-admin-dash.ts` · `check-ai-health-viz.ts` · `check-fairness-viz.ts` | composition charts equal their tables and totals; trends drawn only when the window has rows; AI figures reconcile across mode, status, provider and fallback reason, and the token column totals the token stat; fairness counts reconcile, no bias-free claim, no handle or email rendered, and a candidate is refused the page |
| `scripts/check-public-demo.ts` | the demo recomputes correctly from the DOM, toggles by pointer and keyboard, names the selected role, never predicts, and makes **no request at all** |

Defects found and fixed inside this pass, in my own work:

| # | Defect | How it was found | Fix |
| --- | --- | --- | --- |
| 31 | The gap chart’s datum demanded a `targetAssumed` flag the engine can never produce — `job_skills.level` is always stated — so it would have printed “assumed — role states no level” against data that is not missing | reading `prisma/schema.prisma` and `src/server/skill-catalog.ts` before wiring the caller | replaced with the two absences that are real: no level on the candidate’s profile, and a union-of-roles target where the engine collapses duplicates to the highest level demanded |
| 32 | Skill weight rendered as `weight × 100` per cent, although `JobSkill.weight` is an integer 1–5 — every row would have shown “300%” | checking the employer skills editor and the seeded rows | the column is now “3/5 · medium”, the same wording the employer uses when setting it |
| 33 | `gapPoints.toFixed(1)` implied a tenth-of-a-level precision the engine never computes | reading `analyseGaps` | whole level steps, labelled as steps |
| 34 | The reconciliation test used an absolute 0.005 tolerance on a 0–100 figure, so correctly rounded engine components would have been reported as not adding up | the first run flagged a sum that was right | tolerance is scale-aware and the sentence states what it checked |
| 35 | When a filter emptied the gap chart the `role="status"` line disappeared with it, so the announcement a screen reader needs was exactly the case that went silent | `check-gap-viz.ts` timing out on the status locator after clicking Required with 0 rows | the announcement moved outside the branch and now explains an empty filter instead of implying full coverage |
| 36 | `aiHealth` mixed a capped 500-row sample with window aggregates, so the headline “Live model calls” and the per-agent table could describe different sets of runs | reading `runs.ts` while adding the charts, then reconciling tokens on the live page | mode, status, provider, fallback reason and every per-agent figure are now window aggregates |
| 37 | The employer overview clipped a candidate headline by 370 px at 375 px (`truncate`, with no way to read the rest) and silently dropped the role name when the role was no longer listed | the new overflow measurement in `check-employer-dash.ts` | the line wraps, and an unlisted or absent role says so |
| 38 | Fairness bands with zero matches were labelled “Small sample — treat the mean as indicative” while showing no mean at all | the band table dumped during the reconciliation check | an empty band now says no match falls in it; only populated thin bands claim to be indicative |
| 39 | Role values rendered as “EMPLOYER / CANDIDATE / ADMIN” in the new chart and in badges | the chart/list equality check failed on case | `LABELS` carries Candidate, Employer and Administrator |
| 40 | Two faults in my own checks: a template-string regex lost its backslash (`\d` became `d`), and reading components and total in two passes let a re-render land between them, reporting a 6.1-point gap that did not exist | the new browser test failed twice, correctly, on the harness rather than the app | the regex is escaped and the whole table is read in one `evaluate` — which is also the honest way to test a live region |

### Re-run after the assistant and stability pass (2026-11-06, same day)

| Command / check | Result |
| --- | --- |
| `npx tsx scripts/sweep-site.ts http://localhost:3000` | **109 pages across all three portals and the public site, 0 findings** — no error boundary, no console error, no failed subresource. The first version of this sweep reported 1 716 "failures", all of them App Router `?_rsc=` prefetch cancellations, which are framework behaviour and are now excluded rather than counted |
| `npx tsx scripts/check-sona.ts http://localhost:3000` | two live questions answered by **`model · openrouter`** (`google/gemini-2.5-flash-lite`), grounded in stored records ("profile is 100% complete… readiness 92%", "Marketing Operations Coordinator, 83% match"), turns persisted across a reload, auth panels shown at 820/900/1024 with 0 px overflow |
| `npx tsx scripts/check-assets.ts http://localhost:3000` | **11 of 11 reachable placements decoded at their real size** — `login-workspace` natural 352 in a 352 px box after the `sizes` fix, `review-queue-clear` reached by filtering to a task kind with no open rows |
| `npm run test:e2e` | **9 passed** — 4 journeys, 2 Sona panel tests, 3 account-menu regressions |
| `npm run test:integration` | **24 passed** (added: Sona answers from own records with the engine stored; transcripts are not readable by another account) |
| `npm test` | **88 passed** — includes `tests/assistant.test.ts`: citation-only figures, invented-statistic refusal, overstatement refusal, protected-characteristic refusal, deterministic answer, repair retry, guardrail-triggered fallback |
| `npm run check:fallback` | OpenRouter 418 models listed and callable; Gemini 61 models and callable; Groq retained as failover |
| admin Agent health | chain reads `1. openrouter · 2. groq · 3. gemini`, and Sona appears as its own agent row |

Defects found and fixed inside this pass, in my own work:

| # | Defect | How it was found | Fix |
| --- | --- | --- | --- |
| 26 | The authentication artwork was gated at `lg` (1024 px), so in the ~820–900 px panel a reviewer actually uses, login and registration showed no imagery at all — which is what "just pictures attached, not integrated" looks like | measured panel visibility at 820/900/1024/1200 | panel now appears from `md` upward in a narrower column, re-measured at all four widths |
| 27 | `sizes` asked the optimiser for 320 px into a 352 px box, upscaling the panel image | per-asset render check comparing `naturalWidth` with the rendered box | breakpoint-accurate `sizes` (240 / 320 / 352) |
| 28 | "Clear this conversation" never ran: Base UI `Button` defaults to `type="button"`, so its `formAction` was inert | browser test asserting the empty state returned after clearing | `type="submit"` added; the test passes |
| 29 | The transcript was mirrored between two action states through `useEffect`, which React's compiler rule rejects as a cascading render, and which left a stale list on screen | `npm run lint` error | both actions return a write sequence and the panel derives one transcript from the later of the two, with no effect |
| 30 | The chain hard-coded Groq as the primary name in two places, so promoting another provider would have silently dropped the primary from the list | reading `config.ts` and `providers/openai-compatible.ts` while making the order configurable | `providerNameForBaseUrl` resolves the primary from its canonical origin, and the failover loop skips whichever provider is already primary |

Before the fix, the same measurement clipped `Profile completion` by 47 px, `Unread
notifications` by 58 px and the score-breakdown names by 13-15 px at 1024 px, and the
dashboard said "What is still missing" at 100%.

`/api/health` now reports `scoring: deterministic`, `agents: model-enabled | rule-fallback`
and `aiEnabled`, instead of a hardcoded `engines: "rule-based"` that contradicted the
portal. The unused `SelectLabel` wrapper still renders `Select.GroupLabel` without a
`Select.Group`, i.e. the same latent footgun defect 22 fixed for menus; no screen uses it,
so it was left alone rather than changed blind.

`npm audit` still reports **16 advisories (2 low, 11 moderate, 3 high)**. All of them
arrive through development-only tooling (`prisma`, `shadcn`, `eslint-config-next` and
their transitive dependencies) — none is a runtime dependency of the shipped app.
`npm audit fix --force` would jump Prisma 6→7 and `eslint-config-next` 16→15, both
breaking, so it was **not** run.

---

## 3. The four browser journeys

`tests/browser.spec.ts` runs against `next start` with the QA environment. Screenshots
and traces land in `test-results/`. All four passed in the run recorded above; the
journeys are written so a failure names the boundary that broke rather than the page it
happened to be on.

1. **Candidate** — register → conversational onboarding (all eight steps, real consent
   rows) → confirm a proposal at an edited level → skill note saved through the
   inventory dialog → capability graph: click, annotate, **drag a node, reload, the
   position and note come back from the database** → pathway built → "Why this score"
   dialog → apply **without** ticking identity consent → refused with a message → tick →
   application stored → tracker shows it.
2. **Employer** — register organisation → draft a role with a skills row → administrator
   verifies the organisation → role submitted, moderated, published → matched candidate
   appears **without** name or email → shortlist → disclosure request → candidate
   approves from their own screen → employer now sees the identity → candidate
   **withdraws** → employer reload and the identity is gone → candidate applies →
   shortlist → interview invitation with a slot → candidate sees the invitation.
3. **Assessment, administration, accessibility** — start an assessment (the redirect is
   not swallowed any more) → answer all questions → pass recorded and the skill becomes
   assessment-verified → all admin screens return 200 with no error boundary → weight
   entered as **50** stores **0.50** → axe checks at 390 px and 1440 px on the public
   screens report **no violations**.
4. **Navigation** — every internal link reachable from the public site and from all
   three portal navigations is requested; the run asserts **no 4xx/5xx**, no render
   errors, an unknown route shows "This page does not exist", a candidate at `/admin`
   lands on `/no-access`, a signed-out visitor at `/candidate/graph` lands on `/login`,
   the candidate dashboard, recommended roles and privacy screens pass axe at both
   widths, and neither the public site nor the mobile graph canvas overflows horizontally.

Cross-account isolation is asserted inside journeys 1–3 as well as in the integration
suite rather than assumed from the UI.

---

## 4. Defects found by this pass and fixed

These were live, reproducible failures — most of them survived the earlier service-level
test suite, which is exactly why the browser pass was worth running.

| # | Defect | How it was found | Fix |
| --- | --- | --- | --- |
| 1 | Starting an assessment threw the redirect into its own `catch`, so the quiz never opened | browser journey 3 | `redirect()` moved outside the `try` |
| 2 | Weight editor asked for whole percentages and stored them raw, so every set was rejected (or, entered as 0.5, stored as 0) | code review + journey 3 | percentages converted to fractions at the boundary; verified `50 → 0.50` |
| 3 | Proposal edit, review-task note and upload note posted field names the action never read (`level-<id>`, `note-<id>`), so edits silently became empty | code review | fields gained a real `name` prop; HTML ids stay unique for labels; integration + journey 1 confirm |
| 4 | The admin review queue rendered a client render-prop from a server component inside a map | code review | extracted `UploadReviewForm`; queue now renders and links to the document |
| 5 | Employer "compare against stored postings" called the candidate-scoped agent and always failed | code review | new `compareStoredPostings` scoped to the employer's own role, with its own audit action and honest copy |
| 6 | The anonymised projection passed through headline, summary, target role/industry, education text, location and experience titles — a free-text identity leak in first-stage review | security audit | all free-text fields withheld until a live consent; asserted by integration check that the email string is absent from the employer payload |
| 7 | Identity disclosure had no expiry check at decision time, no revocation, and a second decision on one consent type collided with a unique index | security audit | expiry enforced, `revokeDisclosure` added with audit + notification, consent history made append-only (index migration) |
| 8 | Applying disclosed identity without any explicit consent act | privacy audit | `identityConsent` checkbox + schema literal + `identityConsentAt` column; withdrawal removes the grant |
| 9 | Fairness monitoring read career-break and caregiving attributes for **every** profile, including those who never opted into research | privacy audit | consent-gated sample, counts shown on the screen |
| 10 | Graph annotation skipped its membership check whenever the profile had any hidden node, so another candidate's node key could be written | security audit | membership must match a visible or explicitly hidden node; integration test covers the bypass |
| 11 | A provider key could be sent to a different allow-listed provider's host; failover also kept one chain per process | security audit | exact per-endpoint base-URL binding, `redirect: 'error'`, credentials never bound to a host they were not issued for, per-call chain |
| 12 | A first token reservation larger than the window was accepted, and provider error bodies (which can carry a key) were echoed into stored fallback reasons | unit tests | oversized reservations rejected; provider messages replaced with a status-only message |
| 13 | Evidence uploads trusted the browser MIME string, and rejecting one marked the whole skill disputed | security audit | magic-byte verification; rejection declines the document only; matching recomputed after every decision |
| 14 | `/api/matches/recompute` accepted form-encoded bodies and any origin | security audit | JSON content-type, same-origin check, admin permission retained |
| 15 | Session decoding used a hand-rolled cookie walk | code review | `getToken` with the exact cookie name, which handles chunked cookies |
| 16 | Employer role page listed candidate-specific market insights; applications listed candidate headlines | privacy audit | insights scoped to the organisation and role-level only; headlines removed from employer payloads |
| 17 | Stale match rows survived when a profile lost all skills, when a role lost its skills, or when a job closed | code review | clearing rules widened; integration check asserts an empty inventory clears matches |
| 18 | React Flow attribution hidden (requires a paid plan), `scroll-behavior` route-transition warning, an uncontrolled `Select` mutated after init, a ref written during render, `setState` inside effects, and an `<a href="/">` in the error boundary | browser console warnings | attribution restored, `data-scroll-behavior` added, `Select` keyed to remount, React issues fixed |
| 19 | Build traced the entire project through a dynamic upload path | production build warning | storage path statically scoped under `storage/` |
| 20 | One seeded assessment question had two defensible answers | content review | rewritten so exactly one option is correct |
| 21 | **Found in my own fixes:** two anonymity patches hid profile text *even when the candidate had consented*, so the employer applications list showed "No headline shared" for consented applicants and the profile-views feed hid text that identity disclosure had already revealed | a new integration check asserting consent in both directions | reveal rules now follow the consent record itself — live consented application or unexpired disclosure grant — and withdrawal ends the disclosure everywhere at once |

### Second pass (reported from use, 2026-11-06)

| # | Defect | How it was found | Fix |
| --- | --- | --- | --- |
| 22 | Opening the account menu replaced the whole portal page with the error boundary — in all three portals, and it made sign-out unreachable from the UI | reproduced against the dev server for the unminified invariant: `Base UI: MenuGroupContext is missing. Menu group parts must be used within <Menu.Group> or <Menu.RadioGroup>` thrown from `MenuGroupLabel` | the shared `DropdownMenuLabel` wrapper now composes `Menu.Group` around `Menu.GroupLabel`, so the context contract cannot be broken by a call site; regression coverage added for pointer open, keyboard open/arrows/Escape, axe on the open menu and sign-out in each portal |
| 23 | Marketing copy claimed "this build makes no external model call" while the discovery, pathway and wording-audit agents do call a provider when one is enabled, and the suggestions screen printed the *configured* model name rather than the one that produced the stored suggestions | copy audit against the call graph | homepage agents section, FAQ, footer, step 01, skills-board and onboarding notes now separate scripted onboarding, optional model agents, deterministic scoring, fallback with the mode labelled, history-not-availability, and no-verification; the suggestions card counts what actually produced the rows on screen, and pathways show the engine recorded with the plan |
| 24 | The candidate dashboard said "What is still missing" at 100% completion | measured on the demo profile at four widths | heading and description branch on the checklist; a complete profile gets a status line, an incomplete one gets the outstanding steps plus one named next action with a link; the list carries `role="list"` and a screen-reader "Done:/Not done:" prefix |
| 25 | At ~1024px the dashboard clipped "Profile completion" by 47px, "Unread notifications" by 58px and the score breakdown names by 13-15px | measured by comparing `scrollWidth` with `clientWidth` per element | `StatCard` labels wrap instead of truncating, long values wrap at a fitting size, and `ScoreBar` keeps two component columns at every width so names never get cut |

---

## 5. Security posture, stated honestly

**Verified by tests**

- Passwords bcrypt cost 12, 72-byte UTF-8 guard; five failures lock for 15 minutes;
  identical unknown-email/wrong-password replies.
- JWT carries only `userId`; role, status, organisation and permissions are re-read from
  PostgreSQL every request, so suspension bites immediately.
- Every server function re-resolves the principal; ownership is enforced inside the
  query (`candidateProfileId` / `organizationId`), not in the UI.
- Cross-account probes: candidate→candidate, employer→employer, employer→other-org job,
  candidate→other's skill/upload/attempt/proposal, and role→wrong-portal all refused.
- API: 401 unauthenticated, 400 invalid query, 403 wrong role/origin, 404 for someone
  else's document; the document route sends `nosniff`, `private, no-store` and a CSP
  sandbox.
- Database: 48 public tables, RLS enabled on all, `anon`/`authenticated` hold **no**
  table privileges (hardening migration `20261105130000_data_api_isolation`, applied to
  both the QA database and the Supabase project).
- Disclosure is asserted in **both** directions: text a candidate consented to share is
  actually shown to that organisation, and the same text disappears again when they
  withdraw or the grant expires. Anonymity that hid consented content was itself treated
  as a defect (§4, item 21).
- No secret reaches the browser: the only `NEXT_PUBLIC_*` variable is the app URL.
- AI credentials are bound to the endpoint that issued them; the chain is described in
  the admin UI as presence + host + model, never the key.

**Residual risks you should know about**

1. **Credentials shared in this chat are burned.** The Groq key, OpenRouter key, Gemini
   key, Supabase database password and service key were pasted into the conversation and
   appeared in earlier command output. **Rotate all of them before any real use.**
2. A stolen session cookie is valid for up to **12 hours** (`session.maxAge`); there is
   no server-side session revocation.
3. RLS exists but has **zero policies**, because the app connects as the owner role. If
   anyone later adds a browser-side Supabase client, that is a new trust boundary and
   policies become mandatory.
4. `SUPABASE_SERVICE_ROLE_KEY` bypasses RLS entirely. It is only used by the reachability
   checker; keep it server-side or delete it from `.env` if you do not need it.
5. The proxy is a redirect convenience, never the authorising layer — layouts and server
   functions re-check.
6. No rate limiting on sign-in attempts per IP (only per account), and no CSRF token on
   the JSON APIs beyond the same-origin check on the mutating one.

---

## 6. Deployment readiness

| Item | Status | Note |
| --- | --- | --- |
| Environment configuration | **ready** | `.env.example` documents every variable; `src/lib/env.ts` fails loudly on a missing `DATABASE_URL`/`AUTH_SECRET` |
| Migrations | **ready** | 6 migrations, `prisma migrate deploy`; verified applied to both databases |
| Build | **ready** | clean production build, 47 routes |
| Evidence uploads | **blocker for serverless** | written to `storage/<dir>` on the local disk; Vercel is read-only outside `/tmp`, so this must move to object storage before production |
| Provider budgets | **blocker for multi-instance** | per-process in-memory token window and daily budget; N instances = N budgets. Needs Redis or a DB-backed counter |
| Health check | **ready** | `/api/health` reports database connectivity, policy and model versions |
| Horizontal scaling | **not evaluated** | no load test executed |
| Penetration testing | **not performed** | only the boundary checks listed above |

### Environment-specific advice

- **Vercel**: set `DATABASE_URL` (Supabase *direct* connection, not the pooled
  transaction endpoint, or `prisma migrate deploy` cannot run), `AUTH_SECRET`,
  `AUTH_URL`, `AUTH_TRUST_HOST=true`, and the AI keys as secrets. Vercel's filesystem is
  read-only, so uploads must be moved before deploying. Pin `prisma migrate deploy` as a
  build or release command, not inside a request.
- **Managed Postgres**: keep SSL on, provision a least-privilege role for the app, and
  if the Data API is exposed, keep `anon`/`authenticated` revoked as this pass does.
- **Never** prefix a secret with `NEXT_PUBLIC_`.

---

## 7. Fairness, validity and honesty limits

- The 50/20/20/10 weights are a **configurable prototype assumption**. Nothing validates
  them against hiring outcomes; changing them changes arithmetic, not fairness.
- On the demonstration data (6 opted-in profiles, 12 stored matches) the fairness
  verdict is descriptive only. At that sample size it should not be presented as
  evidence about real populations, and the screen says so.
- Agent 4 reports language patterns; it does not read intent and cannot certify a
  posting bias-free. On the fictional exclusionary role it reported 9 findings, risk
  HIGH, and queued a human review task; on the inclusive seeded roles it reports 0–1.
- Skill "verification" means *this platform's* question set or *this platform's*
  reviewer. There is no external credential check.
- Agent 2 compares postings stored in this database. It is labelled
  `DATABASE_POSTINGS` and `live signal false`; no real-time labour-market feed is
  connected, and none is claimed.
- Nothing here places anyone in a job.

---

## 8. Not executed in this pass

- Firefox and WebKit runs (only Chromium is installed).
- Playwright coverage of the multi-user employer invitation screens and of the
  research-catalogue admin screens.
- Any performance, load or penetration test.
- A destructive re-seed of the **Supabase** demo database (prior rows remain; the
  additive consent backfill was applied instead).
- Any deployment: nothing was pushed to Vercel or any host.

---

## 9. Round of 6 November 2026 — email verification, and the demonstration waiver

Sign-up and every sign-in now require a six-digit emailed code. The design is in
[the README](../README.md#email-verification); this section is what was measured.

| Command / check | Result |
| --- | --- |
| `npm run typecheck` · `npm run lint` | clean · **0 errors, 0 warnings** |
| `npm test` | **115 passed, 0 failed** — 26 new: ticket signing, edited claims, stretched expiry, stale expiry, per-request nonce; the reserved-domain matrix (subdomains in, lookalikes out); the `MAIL_MODE` and key/from configuration; eight SendGrid failure classifications, each also asserted not to repeat the key, the code, the sender or the address; the code field's space/dash normalisation; the waiver's flag-and-domain rule and its notice text |
| `npm run test:integration` | **36 passed, 0 failed** — see the list in the README row; the eleven verification checks all ran against the QA cluster with codes required |
| `npm run test:e2e` | **17 passed (2.3 m)** on the production build, including the new code-screen test (not-emailed panel, wrong code with attempts left, start-over control, keyboard-only entry, axe clean, no overflow at 375 px) and the two input-retention tests added after defect 58 |
| `npm run check:security` | **48 public tables, RLS enabled 48**, `anon`/`authenticated` table access 0, **11 migrations** applied, consent column present |
| `npx tsx scripts/check-demo-login.ts` | **all five seeded roles land in their own portal** on the demo server |
| `npx tsx scripts/check-verification.ts http://localhost:3000` | **4 OK** — waiver announced on the screen, no code asked for, the resulting session is served by the API, and a fresh browser guessing a portal URL is bounced to sign-in |
| `QA_BASE_URL=http://localhost:3100 npx tsx scripts/check-verification.ts --signup` | **6 OK** — no waiver notice, the code step is required, and an address that could receive mail is stopped by "This server has no mail delivery configured" rather than being signed in |
| Migrations | `20261106173000_email_verification`, `20261106181000_verification_redeemed_stamp` and `20261107070000_verification_link`, all additive, applied to the Supabase demo database and the QA cluster. Nothing was reset or reseeded |

Defects found and fixed inside this pass, including in my own work:

| # | Defect | How it was found | Fix |
| --- | --- | --- | --- |
| 47 | `content-type` written as a bare object key in the SendGrid request is not valid JavaScript — the file failed to parse, and the error pointed into the middle of the object literal | `npm run typecheck` | quoted the key |
| 48 | `reservedDomainFor` matched only exact domains, so `people@meridian.example.com` and `admin@syprus.example.com` counted as deliverable; with no SendGrid key those four demo accounts could not sign in at all | 4 of 5 rows failing in `check-demo-login`, then the transport column reading `SENDGRID` for example addresses | reserved domains match their subdomains too, and the case fold is tested |
| 49 | A refused resend stranded the person: the cooldown looked at the newest row of *any* state, so a second sign-in within 30 seconds of a *spent* code was refused with "a code was sent moments ago, use it" — and there was nothing to use | a browser journey never reaching `/verify-email`, then the alert text read off the live screen | the cooldown considers only a code that is still usable and hands its id back, so the screen can still be shown |
| 50 | The cooldown hint could report 31 seconds for a 30-second rule (PostgreSQL stamps the row, the application measures the gap) | the check asserting the hint stays within the rule | every wait hint is clamped to the ceiling of the rule it describes |
| 51 | The production send ceiling was tripped by ordinary suite traffic, so repeated runs failed only on the seeded accounts | passing runs going red on `admin@`/`people@meridian@` while fresh accounts passed | the ceiling is `VERIFICATION_MAX_SENDS_PER_HOUR` (default 6); only `scripts/qa.ts` raises it, and the rule is still tested at a number the test itself sets |
| 52 | The shared error band failed WCAG AA: `--destructive` at 0.577 renders 4.36:1 on its own 5% tint at 14 px — every form error in the app, not just the new screen | axe on the code screen, then measured on the live login page (`#e7000b` on `#fef2f3`) | token moved to `oklch(0.54 0.245 27.325)`: 4.85:1 on the tint, 5.32:1 on white, and white-on-destructive buttons rise from 4.77 to 5.32 |
| 53 | Two concurrent claims on one redeemed grant could each produce a session | reading the provider against the redemption path it sits beside | the grant is spent by one atomic `updateMany`; only `count === 1` continues |
| 54 | The code field's client `pattern="[0-9]{6}"` rejected a pasted `491 327` before the server's normalisation could accept it | comparing the attribute with the schema it feeds | the pattern allows spaces and dashes; the server stays the authority |
| 55 | `cancelVerificationAction` was written and never wired to anything | grepping for its callers | it is the code screen's "Go back to sign-in" control, which now also drops the ticket |
| 56 | A check I added drove Auth.js's raw callback endpoint by hand. Its negative assertion passed for the wrong reason — the request shape was wrong, not the door closed | its own positive control failed | the check was removed and the README claim rewritten to say only what the suites demonstrate |
| 57 | A verification check issued a second code inside its own cooldown and so refused itself | integration run | it now uses the live code the cooldown hands back, which is the behaviour worth proving |
| 58 | **Every rejected submit cleared the form.** React 19 resets uncontrolled inputs when a server action returns, and no field had a `defaultValue` sourced from the returned state — so one bad password wiped a name, an address and eight organisation fields and made people retype them | reported from use of the running demo, then reproduced in a browser test | `parseFormData` now returns the submitted non-secret values, `errorState` carries them, all 27 rejection paths in `src/server/actions` pass them, and `restored()` feeds them into `defaultValue` across the auth, role, employer, candidate and admin forms. Passwords, the code field and any secret are deliberately never echoed back |
| 59 | Fixing 58 exposed a worse one: the consent box looked ticked but submitted unchecked, so the browser blocked the resubmit with "Please check this box if you want to proceed" and the screen showed no server error at all | the new test's second submit never left `/register`, and the failure screenshot showed the native bubble | the checkbox re-initialises from the submitted value (`defaultChecked={state.values?.coreConsent === 'on'}`) with a key that changes per attempt, so the visible tick and the form data can no longer disagree |
| 60 | Two assertions in the tests I wrote for this were aimed at the wrong node or the wrong expectation — `getByRole('alert')` matched Next's route announcer as well, and `data-checked` lives on Base UI's span while the submitted value lives on its hidden input | both failed on a correct product | selectors scoped to `#main [role="alert"]` and `input#core-consent`, so the test asserts what the browser will actually send |
| 61 | The verification link screen rendered, auto-submitted, and then said "That link is incomplete" — the card never carried the token into the form | the new browser test, and the failure screenshot, which showed the message rather than a stack trace | the card posts a hidden `token` field; the URL the person clicked is the only place the token appears in the document, and the link carries `referrerPolicy="no-referrer"` |
| 62 | Issuing a verification threw `headers was called outside a request scope` as soon as the email needed an origin — seven integration checks went red at once, because the digest, the mail body and the on-screen link all want the public origin | the integration run after the link columns landed | `appOrigin()` reads the request's own host when there is one and falls back to `NEXT_PUBLIC_APP_URL` when there is not, with the reason in a comment; the fallback is documented rather than silent |
| 63 | Two things the client asked for that the build had got wrong: the password rule was ten characters where eight was wanted, and no field had a way to see what was typed | reported from use of the running demo | `password()` is `min(8)` with the letter-and-number rule kept, the hint and `minLength` follow it, and every password field gained a reveal button that flips the input's `type` — the value is never copied into state, a data attribute or the URL |

Still not covered, and said plainly: no real SendGrid call was made by any test — the transport is
exercised against a stubbed `fetch`, so the classifications, the headers and the leak rules are
proven but the provider's own acceptance is not. With no `SENDGRID_API_KEY` configured, a code
address that could receive mail is refused sign-in rather than shown the code, which is the
intended failure but is also why the demo server needs the waiver or a key. Focus restoration on
`/verify-email` after a redirect is not asserted. Nothing was deployed.

---

## 10. Round of 7 November 2026 — the mail transport moved from SendGrid to Supabase

The client asked for SendGrid to go and Supabase to be the way mail leaves. What that could
actually mean was checked against Supabase's own documentation first, because their built-in mailer
is capped at "2 messages per hour", answers `Email address not authorized` for anybody outside the
project's own team, and is described as "not meant for production use" — so the provider secret had
to live somewhere, and the place it now lives is the client's Supabase project rather than this
application. SendGrid was deleted outright, on request: no `src/lib/mail/sendgrid.ts`, no
`SENDGRID_API_KEY`, no `MAIL_FROM_ADDRESS` anywhere in the code, tests or docs.

| Command / check | Result |
| --- | --- |
| `npm run typecheck` · `npm run lint` | clean · **0 errors, 0 warnings** |
| `npm test` | **116 passed, 0 failed** — the eleven SendGrid cases are gone and 13 of their own kind took their place: host allow-list (a `SUPABASE_URL` that is not a Supabase project never receives the key, and no request is built at all), the endpoint shape, the custom function slug, a truncated key failing closed, an unknown `MAIL_MODE` failing closed, `preview` overriding a fully configured project, the posted body carrying no `from` field, ten classifications each also asserted not to repeat the key, the code, the address or the project host, and a provider complaint that quotes the recipient being unable to carry it into our own message |
| `npm run test:integration` | **36 passed, 0 failed** — unchanged in substance: the QA cluster runs `MAIL_MODE=preview`, so the second factor is still required for every journey and no test run can post a letter |
| `npm run test:e2e` | **17 passed (2.5 m)** on the production build, after the transport swap and the health-probe change |
| `npm run check:security` | **48 public tables, RLS enabled 48**, `anon`/`authenticated` table access 0, **12 migrations** applied, consent column present |
| `npx tsx scripts/check-demo-login.ts` | **all five seeded roles land in their own portal** on the demo server |
| `npx tsx scripts/check-verification.ts http://localhost:3000` | **4 OK**, and the new line it prints reads `mail this server shows codes on screen and sends nothing — a real address gets no code until SUPABASE_URL (or a URL that is not a Supabase project host), SUPABASE_SERVICE_ROLE_KEY is set and the function is deployed` |
| `QA_BASE_URL=http://localhost:3100 npx tsx scripts/check-verification.ts --signup` | **6 OK** — the QA server answers `mail: screen-only` because `scripts/qa.ts` pins `MAIL_MODE=preview`, the code step is still required with no waiver on screen, and an address that could receive mail is sent to that step rather than waved through; it is not signed in by registering |
| Migration | `20261107100000_supabase_mail_transport` renames the one enum value `SENDGRID` → `SUPABASE`. Applied to the Supabase demo database and the QA cluster; nothing reset or reseeded |
| Before and after that migration, measured in both databases | demo: `SENDGRID=10 PREVIEW=7` → `SUPABASE=10 PREVIEW=7`, enum labels now `SUPABASE, PREVIEW`; QA: `PREVIEW=17` → `PREVIEW=25` (suite traffic). Under the new label: **0 live, 0 unredeemed, 0 carrying a code that was shown on screen** — checked first, because the column decides whether an entry screen may print a code at all |

Defects found and fixed inside this pass, including in my own work:

| # | Defect | How it was found | Fix |
| --- | --- | --- | --- |
| 64 | The new diagnostic in `scripts/check-verification.ts` read the *machine's* `.env` and printed `mode=auto` about a server that `scripts/qa.ts` had pinned to `preview` — a check that describes the wrong process is worse than no check | my own reading of its first output, which contradicted the behaviour two lines below it | `/api/health` now answers `mail: "function" \| "screen-only"`, derived by the same `mailConfig()` the entry flow uses, and the script asks the server instead of guessing. Only that one word is published: no key, no sender, no timeout |
| 65 | My first `classify()` keyed on the HTTP status before the function's machine code, so a provider refusal of an *unverified sender* that reached us as a 403 would have been reported as "this server's key is wrong" — the operator would have rotated a good key and left the real fault alone | reading the forwarded-status path against the two failures it can now confuse | the function always answers **502** for a provider problem and says which in `code`; the app reads `code` first and the status only backs it up |
| 66 | `allowedMailUrl` had to be written before `sendMail` could be trusted with the service-role key: a `SUPABASE_URL` typed as `https://supabase.co.attacker.tld` would otherwise have carried that key — which bypasses Row Level Security — to a host nobody configured | while writing the transport, checked against the `ALLOWED_AI_HOSTS` rule the AI layer already enforces | suffix matching is on `.` boundaries only, `http:` is accepted for `localhost`/`127.0.0.1` (the CLI's local project) and nowhere else, and the unit case asserts **no request is built at all** rather than that it fails |
| 67 | The Edge Function is Deno code sitting inside tsconfig's `**/*.ts` include and inside eslint's reach: `Deno.serve`, `npm:nodemailer@…` and a `https://` triple-slash reference would each have failed the app's own typecheck | read before running, and then confirmed by `npm run typecheck` after excluding | `supabase` is excluded from `tsconfig.json` and eslint's `globalIgnores`; the dead triple-slash reference was dropped rather than guessed at |
| 68 | Renaming an enum value looked like the kind of statement that fails inside a transaction (`ALTER TYPE … ADD VALUE` does) and would have been attempted against the client's live database | applied to the isolated QA cluster first, then to the demo database | `RENAME VALUE` is legal inside Prisma's transaction and both runs reported the migration applied; the row census in the table above was measured *before* writing it |

Still not covered, and said plainly: **no letter has been delivered by anything in this pass.** The
function has not been deployed (that needs the client's Supabase login and their choice of mail
provider), so `sendMail` has only ever been exercised against a stubbed `fetch` — the endpoint,
headers, host allow-list, timeouts, classifications and the no-leak rules are proven; a real
provider's acceptance, the JWT verification the platform applies to the deployed function, and
`nodemailer`'s SMTP path from inside a Deno function are not. The last of those is why the Resend
branch is the documented default: Supabase's own Edge Function example sends over HTTPS, and
functions have a short CPU budget that an SMTP handshake can exceed. `DENO` is not installed here,
so the function's syntax was checked with `esbuild` and its behaviour is reasoned from its source,
not measured. Nothing was deployed.
