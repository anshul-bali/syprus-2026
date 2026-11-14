# AI integration summary

How the four agents are wired, what each one is allowed to claim, and how every
result can be traced back to the row that produced it.

---

## 1. Shape of the system

```
candidate / employer / admin screen
        │  server action (src/server/actions/*)
        ▼
agent service (src/server/ai/agents.ts)
        │  builds a typed input, picks a provider
        ▼
runAgent (src/lib/ai/client.ts)
        │  rate limit → daily budget → provider chain
        ▼                 → Zod validate → 1 repair retry → guardrails
        │
        ├── AI output          (mode = 'AI')
        └── deterministic rule (mode = 'DETERMINISTIC' + a stored reason)
        ▼
agentRun (src/server/ai/runs.ts) writes one ai_runs row per attempt
```

Nothing in `src/lib/ai/**` performs database I/O, and nothing in the browser can
reach a provider: every call starts from a server action that re-resolves the
signed-in principal.

## 2. The five agents

| Agent | Contract in | Contract out | Rule engine it falls back to | Persisted to |
|---|---|---|---|---|
| 1 · Skills Discovery | `DiscoveryInput` (blocks of the candidate's own wording + catalogue taxonomy) | `DiscoveryOutput` (proposals with verbatim quotes, level, confidence) | `deterministicDiscovery` — keyword rules over the same text | `ai_proposals`, `ai_runs`, notification |
| 2 · Market Intelligence | `MarketInput` (stored requirement rows + score components) | `MarketOutput` (score, components, matched, gaps, `isLiveDemandSignal`) | the stored weighted-rule score itself | `market_insights`, `ai_runs` |
| 3 · Learning Pathways | `PathwayInput` (gaps + catalogue resources only) | `PathwayOutput` (ordered steps, why, effort, `uncoveredGaps`) | `buildLearningPlan` over the same catalogue | `learning_plans`, `learning_plan_items`, `ai_runs` |
| 4 · Bias Audit | `BiasAuditInput` (one posting's text) | `BiasAuditOutput` (findings, continuity checks, positives, fixed disclaimer) | `analysePosting` — 10 documented regex patterns | `language_reviews`, `review_tasks`, `ai_runs` |
| SYPRUS Sona · assistant | `AssistantInput` (role, question, last turns, and facts the server read for this account only) | `AssistantOutput` (answer, fact ids it cited, caveats, follow-ups) | `deterministicAssistant` — reads the same facts back, plainly | `assistant_sessions`, `assistant_messages`, `ai_runs`, audit |

Schemas live in `src/lib/ai/schemas.ts` (Zod v4). `contractSketch` sends the model
a compact shape description instead of the full JSON Schema — the full schema cost
thousands of reasoning tokens and pushed `gpt-oss-120b` past its output window on
the free tier. Server-side validation always uses the real schema.

## 3. Provider chain and failover

`src/lib/ai/config.ts` reads the environment and builds an ordered list of
endpoints. Each credential is bound to the **exact** endpoint it was issued for:
`endpointIsAllowed` compares the configured base URL against that provider's
canonical HTTPS origin and rejects anything else — plain HTTP, a non-standard port,
embedded `user:pass`, a query string, a trailing path or a look-alike hostname such
as `api.groq.com.evil.invalid`. The transport re-checks the same binding before it
sends a byte, and requests are made with `redirect: 'error'`, so neither a mis-set
variable nor a 302 can carry a key to a host that was not configured for it.

| Order | Name | Host | Model | Role |
|---|---|---|---|---|
| 1 | `openrouter` | `openrouter.ai` | `google/gemini-2.5-flash-lite` | primary (this deployment) |
| 2 | `groq` | `api.groq.com` | `openai/gpt-oss-120b` | failover |
| 3 | `gemini` | `generativelanguage.googleapis.com` | `models/gemini-flash-lite-latest` | failover |

The primary is whichever approved provider the `AI_BASE_URL` / `AI_API_KEY` /
`AI_MODEL` block points at — `providerNameForBaseUrl` recognises it by its exact
canonical origin — and the remaining providers are tried in the order below it,
each from its own `*_API_KEY`. Promoting a different provider is therefore a
configuration change, not a code change, and it cannot move one provider's key
onto another provider's host.

`createFailoverProvider` (`src/lib/ai/providers/failover.ts`) tries them in order
and moves on when an endpoint is rate-limited, times out, is unreachable or returns
a transport error. It does **not** fail over on `disabled` — a missing credential is
a configuration fault, not traffic.

Two distinctions matter and are easy to overstate. First, a reply that parses as
JSON but fails the agent's Zod contract does **not** go to the next endpoint: the
caller in `src/lib/ai/client.ts` makes one *repair* attempt, quoting the validation
failures back, and that attempt re-enters the chain from the top — so the endpoint
that answers a repair is usually Groq again. Second, a chain is created per call
rather than cached per process, so a long-lived server does not hold a stale chain
after the environment changes.

Two limits are enforced before a request leaves:

* a per-endpoint tokens-per-minute window (Groq's free tier is **8,000 TPM** on
  this key; a fresh window always admits its first request, later ones are
  skipped to the next endpoint), and
* a whole-platform daily token budget, which turns into the deterministic
  fallback rather than an error.

Transports retry inside an endpoint (`maxRetries`, equal-jitter backoff,
`Retry-After` honoured up to 30 s), and a 429 without `Retry-After` falls through
to the next endpoint instead of hammering the same one.

**Attribution.** `ai_runs.provider` and `ai_runs.model` are written from the
result, not from the config — so a failover is recorded as `openrouter`, never
as Groq. The admin screen at `/admin/engines` renders the chain and the runs.

Verified live on 2026-11-05 (`npm run check:fallback`, `npx tsx
scripts/check-failover.ts`, `npm run qa:ai-demo`):

```
Direct calls
  PASS  groq         1181ms  421 tokens  1 proposal(s)
  PASS  openrouter   1025ms  152 tokens  1 proposal(s)
  PASS  gemini       6475ms  207 tokens  1 proposal(s)

Chain with the primary pointed at a model that does not exist
  PASS  answered by openrouter (google/gemini-2.5-flash-lite) after 2 attempt(s)
        chain: groq:failed → openrouter:success

Live agent pass through the product services (QA database)
  agent 1  AI via groq: 4 new proposal(s)
  agent 4  AI on 8 roles: exclusionary demonstration role 9 finding(s), risk HIGH, review task queued
  agent 2  AI: score 83%, source DATABASE_POSTINGS, live signal false
  agent 3  DETERMINISTIC: 0 gap(s) — reported honestly, no invented course plan
  workflow COMPLETED (AI)
```

The credential-binding rules in §3 are not just asserted in prose: `npm test`
includes cases that hand the adapter a valid key pointed at the wrong provider, at
`http:`, at a non-standard port, at `user:pass@host`, at a host with a query string
and at a suffix-swapped look-alike domain, and asserts no request is made at all.

## 4. Guardrails (`src/lib/ai/guardrails.ts`)

The model never gets to decide what becomes a claim:

* **unknown-skill** — a slug outside the supplied taxonomy is refused; only the
  engine's own identifier survives.
* **unquoted-evidence** — a quote that is not a verbatim substring of the input
  text (after whitespace normalisation) is dropped.
* **category and transferability** are copied from the catalogue, not taken from
  the model.
* **care work is not professional competence** — evidence whose context is
  caregiving or volunteering caps the proposal at `PROFICIENT` and sets
  `requiresHumanReview`, and `professionallyVerified` is a Zod literal `false`.
* **pathways** — an invented `catalogueId` is discarded, `url` and
  `estimatedHours` are copied from the catalogue row, and if nothing survives the
  guardrail the run throws `no-valid-resources` and falls back. The system cannot
  cite a course that does not exist locally.
* **market** — `isLiveDemandSignal` is forced to `false` unless the source really
  is `LIVE_PROVIDER`, and the mandated exclusion list (break length, caregiving
  status, protected characteristics) is unioned in rather than trusted.
* **bias audit** — any non-empty `protectedCharacteristicsInferred` throws and the
  whole reply is discarded; excerpts must be verbatim; the disclaimer text is
  fixed by schema, not authored by the model.

Blocked and warning counts are stored on the run, and `/admin/engines` lists the
actual blocked items.

`aiHealth(windowHours)` aggregates the whole window with `groupBy` — by mode, by
status, by provider, by fallback reason and per agent (runs, tokens, mean
duration, last run) — so no figure on that screen is the sum of a truncated
sample. The screen names its window, the time it was read and the newest stored
run, and states that a stored call proves past behaviour only: it never probes a
provider, so nothing there can be read as current uptime or live connectivity.

## 5. Provenance is stored, not implied

`SkillValidationStatus` carries seven values, collapsed by `src/lib/provenance.ts`
into six visible bands (suggested / self-reported / you confirmed / assessed /
human reviewed / disputed). Only these paths can raise a status:

| Status | Set by |
|---|---|
| `RULE_INFERRED`, `AI_SUGGESTED` | the engines, always as a suggestion awaiting the candidate |
| `USER_CONFIRMED` | the candidate, from the suggestion inbox |
| `ASSESSMENT_VERIFIED` | a passed platform assessment, server-side scoring |
| `HR_REVIEWED` | an administrator accepting an evidence document |
| `DISPUTED` | an administrator rejecting one |

A candidate cannot set a reviewer-only status; there is no code path for it.

## 6. Orchestration

`src/server/ai/orchestration.ts` runs **Skills Discovery → Market Intelligence
(matching) → Learning Pathways**, persisting `orchestration_runs` and
`orchestration_steps`. Each step records its own status (`SUCCESS`, `FALLBACK`,
`FAILED`, `SKIPPED`), produced count, duration and fallback reason. A failed step
stops the run — pathways need fresh matching, so continuing would plan against
stale gaps. The Capability Graph needs no step: it is generated from the rows
these steps write.

Trigger from a candidate account or from `/admin/engines` (administrators pick the
profile). The whole sequence is also covered by `npm run test:e2e`.

## 7. Human review

Anything consequential is queued as a `review_task` and stays open until a
principal with `admin.job.moderate` decides it. Decisions require a note of at
least 10 characters, record who decided and when, and are audited. Kinds:
bias findings, shortlist decisions, interview invitations, identity disclosure,
profile visibility, skill verification. Screen: `/admin/review`.

Identity disclosure is the strictest path: an employer request writes a
`PENDING` row and changes nothing. Only the candidate's approval — or their
application — flips `canRevealIdentity`, and both write consent records plus
`audit_events`.

## 8. Failure semantics operators should expect

| Situation | What happens | What is stored |
|---|---|---|
| No credential anywhere | deterministic engines answer | `mode=DETERMINISTIC`, `fallbackReason=provider-not-configured` |
| Groq TPM window spent | next endpoint is tried | per-attempt trace in the run's provider field |
| Every endpoint down | deterministic answer, never an error page | `fallbackReason=provider-rate-limit`/`-unavailable`/`-timeout`, provider message verbatim |
| Output fails the schema | one repair retry quoting the exact issues | `provider-schema-violation` if it still fails |
| Output fails a guardrail | whole reply discarded | `guardrail-rejected` + the blocked items |
| Daily budget spent | deterministic, no request sent | `daily-budget-exhausted` |

## 9. What this build does not claim

* No live job-market intelligence: agent 2 compares against postings stored in
  this database. The connector interface (`src/lib/ai/job-source.ts`) refuses to
  return invented postings when uncredentialled — an HTTP source either returns
  real rows or throws.
* No external verification of any skill. `ASSESSMENT_VERIFIED` means this
  platform's own question set; `HR_REVIEWED` means a reviewer on this platform.
* No bias elimination. Agent 4 flags language for a human and the fairness
  monitor describes stored scores — its verdict on the seeded demo data is
  `REVIEW`, which is reported as-is.
* No placement promise, and no automated recruitment decision: shortlisting,
  interview invitations and disclosure all require a human action, and every
  consequential output goes to the review queue.

## 10. Where to look in code

| Concern | File |
|---|---|
| Provider config and the host allow list | `src/lib/ai/config.ts` |
| Transport, error classification | `src/lib/ai/providers/openai-compatible.ts` |
| Chain and failover | `src/lib/ai/providers/failover.ts` |
| Call ordering, repair retry, fallback | `src/lib/ai/client.ts` |
| Contracts | `src/lib/ai/schemas.ts` |
| Guardrails | `src/lib/ai/guardrails.ts` |
| Prompts (versioned) | `src/lib/ai/prompts.ts` |
| Rate limiting | `src/lib/ai/rate-limit.ts` |
| Run persistence + health | `src/server/ai/runs.ts` |
| Agent services | `src/server/ai/agents.ts` |
| Sona: facts, fallback answer, transcript | `src/server/ai/assistant.ts` |
| Sona: actions and panel | `src/server/actions/assistant.ts`, `src/components/assistant/sona-panel.tsx` |
| Suggestion decisions | `src/server/ai/proposals.ts` |
| Assessments | `src/server/ai/assessments.ts` |
| Evidence uploads | `src/server/ai/uploads.ts` |
| Orchestration | `src/server/ai/orchestration.ts` |
| Review queue | `src/server/review.ts` |
| Disclosure consent | `src/server/disclosure.ts` |
| Tests | `tests/ai.test.ts`, `tests/providers.test.ts`, `tests/graph.test.ts`, `scripts/e2e.ts` |
