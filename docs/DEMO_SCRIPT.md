# SYPRUS demonstration script

Twelve minutes, five scenes, one fictional candidate. Every figure quoted below is
read from the database by `npm run qa:demo` — if that command reports different
numbers, use the numbers it reports.

**Before presenting**

```bash
npm run qa:migrate && npm run qa:seed   # schema + fictional demonstration data
npm run qa:ai-demo                      # optional: live agent pass (uses provider credentials)
npm run qa:demo                         # prints the facts this script quotes
npm run qa:start                        # http://localhost:3100
```

Sign in as `anshika@example.com`, `people@meridian.example.com`, `admin@syprus.example.com`.
Passwords are the `SEED_DEMO_PASSWORD` in `.env`. All people, organisations, roles and
documents are fictional, created by the seed script.

These accounts live on `example.com`, which no mailer delivers to, so on this machine — which
declares `SYPRUS_DEMO_ENV=true` in `.env` — a sign-in code for them is either shown on the entry
screen (with the panel that says it was not emailed) or skipped entirely when
`DEMO_SKIP_EMAIL_CODE=true` as well, as it is in this checkout's `.env`. Either way the
walkthrough below is unchanged: password, and you are in. Say so out loud if a reviewer asks
how the account is protected — the honest answer is that both shortcuts are refused on any
server that has not declared itself a disposable demonstration environment, so codes are
required in production, and the sign-in screen itself says the same.

---

## Scene 0 · The question this answers (60 seconds)

Say: *"A conventional screening system sorts people by when they worked. It reads a CV
top-to-bottom, looks for the most recent continuous employment, and treats anything else
as a gap. This platform asks a different question: what can this person do, and what
evidence supports it?"*

Open `/#problem` on the landing page. Do not claim SYPRUS has integrated with, replaced
or benchmarked against any real applicant-tracking system — nothing here talks to one.

## Scene 1 · Timeline-first screening, in the employer's own words (2 minutes)

As administrator, open **Moderation** → *Brand Marketing Lead (demonstration of
exclusionary wording)*. Read two requirements from the posting verbatim:

> “working continuously in brand marketing for the last five years with no career breaks”

> “Minimum 8 years of continuous, unbroken agency-side experience.”

Say: *"This is what a timeline filter looks like when an employer writes it honestly. It
is not a rule SYPRUS invented; it is a fictional posting in the demo data, published so
the audit has something real to find."*

Point at the audit panel on the same role: **risk HIGH**, **9 findings**, categories
`culture_fit_vagueness`, `unnecessary_credential`, `career_continuity`,
`logistics_barrier`, `biased_tone`, and two continuity requirements flagged as likely
unnecessary. Note that the suggested rewrites are stored for a human, and that the
finding opened a review task — the model did not edit the posting.

## Scene 2 · What the candidate actually holds (3 minutes)

Sign in as **Anshika**.

1. **Profile and privacy** — 4 years recorded, 36-month break stored privately, sharing
   `ANONYMOUS_WITH_APPLY`. Say: *"The break is on her record, and it is not an input to
   any score."*
2. **Skills inventory** — 13 skills, each with a validation status. Point at the
   difference between *you confirmed*, *assessment-verified* and *suggested*.
3. **Suggestion inbox** — proposals from the discovery agent, each carrying the sentence
   it came from. Accept, edit the level, or reject. Nothing enters the inventory until
   she acts.
4. **Capability graph** — zoom, pan, click a skill node, add a note, drag a node and
   reload: the position and note come back from `graph_annotations`.

## Scene 3 · The number and how it was built (2 minutes)

**Recommended roles** → top role *Marketing Operations Coordinator* (Meridian Media,
verified) at **83%**. Open **Why this score**. Read the calculation out:

```
required 0.859 · preferred 0.881 · evidence 0.662 · constraints 0.912
weights 50 / 20 / 20 / 10  (weights prototype-2026-11-a, model rules-2026-11-a)
```

Say three things and no more:

- the four buckets are every input the function received;
- career-break length, break reason, age, caregiving status and employer names are
  listed under **never read**;
- these weights are a **configurable prototype assumption**, not a validated hiring
  instrument, and the screen says so.

## Scene 4 · Anonymised review, then consent (2 minutes)

Sign in as **people@meridian.example.com**.

1. **Candidates** — Anshika appears as her handle (`SYPR-…`), with skills, levels,
   evidence counts and durations. No name, no email, no employer names, no calendar
   dates, no break length. Ask the audience to search the page for her name; it is not
   there.
2. **Shortlist** her with a private note — an internal flag, not a contact.
3. **Ask to see who this is** — send a disclosure request with a reason. Nothing is
   revealed by the request itself.
4. Switch back to **Anshika** → **Disclosure requests** → share, or decline. Then:
   - approve → Meridian now sees her name, email and experience text, and the view is
     logged;
   - **withdraw** → the next employer load is anonymous again.
5. Show that she applied to one role, which is a separate consent the candidate gives at
   apply time.

## Scene 5 · Governance (2 minutes)

As administrator:

- **Human review queue** — open tasks that a model cannot close.
- **Fairness monitoring** — the sample is consent-gated: only profiles that granted
  research consent are measured (6 of the demonstration set). Read the verdict and the
  caveats, then read the panel's own sentence: monitoring is not a guarantee.
- **Matching weights** — versioned, sum-to-one enforced, required coverage floor 0.30,
  and scores keep the version that produced them.
- **Audit history** — sign-ins, moderation decisions, disclosure events, identity views.

## Closing line

*"Timeline-first screening asked when she last worked and found a three-year hole.
Skills-first screening asked what she can do and found 13 evidenced competencies and an
83% match. The difference is not that one is smarter — it is which field the system is
allowed to read."*

---

## What this demo must not claim

Say these out loud if asked; do not imply them.

| Claim | Status in this build |
| --- | --- |
| “SYPRUS verifies skills with AI” | No. A pass means this platform's own question set; a reviewer's acceptance means a person read a document here. |
| “It knows the live job market” | No. Agent 2 compares postings stored in this database and is labelled `DATABASE_POSTINGS`, `live signal false`. |
| “It removes bias” | No. Agent 4 flags language for a human; the fairness screen measures stored scores and reports a verdict with caveats. |
| “It places candidates” | No. There is no hiring, offer or placement automation — the pipeline records what a human did. |
| “Tested against a real ATS” | No. The timeline-first contrast is the fictional demonstration posting, not an integration. |
