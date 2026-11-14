import Link from 'next/link'
import {
  ArrowRight,
  BadgeCheck,
  BarChart3,
  Compass,
  GitBranch,
  GraduationCap,
  Handshake,
  Lock,
  Scale,
  ScanSearch,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  Users,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { DemoBadge, InfoNote, ScoreBar, StatusBadge } from '@/components/common'
import { SectionImage } from '@/components/media/section-image'
import { SkillsDemo } from '@/components/public/skills-demo'

const HERO_POINTS = [
  { icon: Lock, title: 'Anonymised by default', text: 'Employers see capability, never your name, until you choose to apply.' },
  { icon: BadgeCheck, title: 'Every score explained', text: 'A match shows which skills covered which requirement, and what is missing.' },
  { icon: Scale, title: 'Break length is not an input', text: 'The ranking model does not read your gap, your age or your employer names.' },
]

const PROBLEM_POINTS = [
  {
    title: 'The timeline gets read before the skill',
    text: 'A résumé screened for continuity of service throws away years of coordinated, budgeted, negotiated work that simply was not paid.',
  },
  {
    title: 'Care work never appears on a CV',
    text: 'Managing medication schedules, a household budget, school systems and a rotating set of carers is operational work. There is no line for it on a standard form.',
  },
  {
    title: 'Reskilling advice is generic',
    text: '“Take a course” is not a plan. What helps is knowing which two or three skills stand between you and a specific role, and in what order.',
  },
  {
    title: 'Employers lose good shortlists',
    text: 'Screening on years-of-experience buckets filters out capable people early, then the hiring team has no way to see what was missed.',
  },
]

const STEPS = [
  {
    number: '01',
    title: 'Talk through your history',
    text: 'A guided onboarding asks predefined questions about your last paid role, what you handled during your break, and what you want next. Local rules, not a chat model, turn your wording into skill suggestions. Free text in your own words is enough to start.',
  },
  {
    number: '02',
    title: 'Build an evidenced skills inventory',
    text: 'Suggested skills arrive with the exact phrase from your answer that produced them. Accept, correct or delete each one, then attach evidence such as a certification, a project or a described outcome.',
  },
  {
    number: '03',
    title: 'See your capability graph',
    text: 'Skills are laid out by category with their strength and links to related competencies, so transferable depth is visible rather than implied.',
  },
  {
    number: '04',
    title: 'Get a gap report and a pathway',
    text: 'Choose a target role and the platform compares your inventory against its required and preferred skills, then assembles an ordered learning plan from the resource catalogue.',
  },
  {
    number: '05',
    title: 'Match on skills, apply on your terms',
    text: 'Verified employers browse anonymised profiles with explainable match scores. You shortlist, they invite, and identity is only disclosed when you apply.',
  },
]

const AGENTS = [
  {
    icon: Sparkles,
    name: 'Skills Discovery Agent',
    path: 'A model when AI is enabled; keyword rules answer otherwise',
    does: 'Reads your own wording against a curated skill taxonomy and proposes competencies, each carrying the phrase that triggered it.',
    output: 'Suggested skills with a confidence value and a level, plus the phrase that produced them. Each one says whether a rule or a model wrote it.',
    limits: 'It cannot verify a claim, assign an expert level from text, or read anything outside the text you entered.',
  },
  {
    icon: GitBranch,
    name: 'Capability Graph Agent',
    path: 'Local rules — no model call',
    does: 'Lays out your inventory by category and strength, and links related skills so transferable depth is visible.',
    output: 'An interactive graph you can explore, filter and open from any node.',
    limits: 'It shows relationships in the taxonomy. It is not a measurement of aptitude or a personality model.',
  },
  {
    icon: GraduationCap,
    name: 'Gap & Pathway Agent',
    path: 'Gap list is rules; plan can use an optional model',
    does: 'Compares your inventory against a target role or your closest matches, ranks the shortfalls by severity, then selects catalogue resources in a sensible order.',
    output: 'A readiness band, a prioritised gap list and an ordered learning plan with hour estimates. The plan states whether rules or a model ordered it.',
    limits: 'If the catalogue has nothing for a gap, the plan says so. It never invents a course or a credential.',
  },
  {
    icon: ScanSearch,
    name: 'Matching & Fairness Agent',
    path: 'Deterministic scoring engine — no model call',
    does: 'Scores role fit from weighted required and preferred skills, states the contribution of each skill, and measures stored scores against career-break length.',
    output: 'A match percentage with a per-skill contribution breakdown, plus band-level fairness statistics.',
    limits: 'Monitoring is not proof. A clean report means no penalty was measured in the current data — not that bias is gone.',
  },
]

const CANDIDATE_BENEFITS = [
  { icon: Compass, title: 'A vocabulary for what you did', text: 'Caregiving and community work map to named, employable competencies with evidence attached.' },
  { icon: Lock, title: 'Sharing you control', text: 'Anonymised by default. Consent is recorded per decision, per policy version, and can be withdrawn.' },
  { icon: GraduationCap, title: 'A plan, not a lecture', text: 'Learning steps ordered by how much each one moves you toward a specific role.' },
  { icon: BadgeCheck, title: 'Explainable scores', text: 'See why a role scored the way it did, including the skills that were missing.' },
  { icon: BarChart3, title: 'Progress you can point at', text: 'A tracker for every application, its stage, its history and the note the hiring team left.' },
  { icon: Users, title: 'Roles chosen for returners', text: 'Filter for returnships, flexible hours and re-entry-friendly commitments.' },
]

const EMPLOYER_BENEFITS = [
  { icon: ScanSearch, title: 'Screen capability first', text: 'Review anonymised profiles ranked by weighted skill coverage, not by résumé chronology.' },
  { icon: BadgeCheck, title: 'Defensible shortlists', text: 'Every score carries the skill-by-skill reasoning you can put in front of a hiring manager.' },
  { icon: GitBranch, title: 'Wider candidate pool', text: 'Transferable competencies surface people a years-of-experience filter would have dropped.' },
  { icon: Users, title: 'Structured pipeline', text: 'Roles, applicants, shortlists, interview invitations and status history in one place.' },
  { icon: Handshake, title: 'Returnship-ready listings', text: 'Flag flexible hours, returnship programmes and re-entry commitments on the role itself.' },
  { icon: Scale, title: 'Verification and moderation', text: 'Organisations are verified and roles are moderated before they reach candidates.' },
]

const TESTIMONIALS = [
  {
    quote:
      'I had four years of school-run logistics, a care plan for my mother and a household budget to describe. SYPRUS turned that into named skills with evidence, and I could finally answer “what have you been doing?”.',
    role: 'Former operations manager, re-entering as a project coordinator',
  },
  {
    quote:
      'The gap report told me exactly which two skills stood between me and the analyst roles I wanted, in the order worth doing them. That beat a list of forty courses.',
    role: 'Returning to work after a career break, targeting data analysis',
  },
  {
    quote:
      'We shortlisted on weighted skill coverage with the reasoning attached. Two of the people we interviewed would never have survived our old years-of-experience filter.',
    role: 'Talent partner at a hiring team using skills-first review',
  },
]

const FAQS = [
  {
    q: 'Does SYPRUS verify my skills?',
    a: 'No. Skill entries carry a validation status — self reported, suggested from your own words, or reviewed by a person on the platform. Nothing in this MVP claims independent or AI verification of a competency.',
  },
  {
    q: 'How are skills suggested?',
    a: 'Two engines write suggestions, and each suggestion carries the name of the one that produced it. A rule engine matches your wording against a curated taxonomy and its aliases. A language model can do the same task when AI is enabled for this deployment. Both produce a proposal with the phrase that triggered it and a confidence value — nothing becomes a skill until you accept it, and accepting marks it as you-confirmed, never as verified.',
  },
  {
    q: 'Does SYPRUS send my data to an AI model?',
    a: 'Only when you ask an agent for a suggestion and this deployment has AI enabled. The discovery payload carries the title, description and achievements text from your own experience entries plus the public skill taxonomy — your name, email, employer names, institution names, break length and break reason are not included. Skill-inference consent must be switched on first, and withdrawing it removes what the inference engines had produced. The administrator Agent health screen lists which endpoints are configured; no credential is ever shown there.',
  },
  {
    q: 'If a model answered last week, is it available now?',
    a: 'Not necessarily. Stored runs prove those calls happened, nothing more. Reachability depends on the credential, the request rate and the token budget at the moment you press the button, and a run that cannot reach a provider falls back to the deterministic engines. The mode that actually produced each answer is recorded and displayed with it.',
  },
  {
    q: 'What is SYPRUS Sona and what can it see?',
    a: 'Sona is the assistant inside the signed-in portals. When you ask something, the server first reads the records that belong to your account — profile completeness, skills and evidence counts, your closest scored roles, applications and consent decisions — and passes those facts, with the last few turns of your own conversation, to the configured model. Your name, email address and credentials are not part of that request, and career-break length is deliberately excluded. Each reply is labelled with the engine that produced it, and when no model is reachable Sona answers from the same facts directly. It cannot change a record, and its wording is not a verification, an assessment result or an offer.',
  },
  {
    q: 'Can employers see my career break?',
    a: 'No. Employer views return your handle, skills, evidence labels and durations of responsibility. Calendar dates are replaced with durations, and break length and reason are never included.',
  },
  {
    q: 'What goes into a match score?',
    a: 'Weighted required-skill coverage, preferred-skill coverage, stated experience against the role’s published range, and how much of your coverage is portable rather than tool-specific. The exact contribution per skill is listed under every score.',
  },
  {
    q: 'Is my identity shared automatically?',
    a: 'Only when you apply to a role — that one action discloses your name to that organisation. Everything before that is anonymised, and you can switch employer visibility off at any time under Privacy controls.',
  },
  {
    q: 'Does the platform guarantee I get hired?',
    a: 'No. SYPRUS surfaces capability and explains fit. Hiring decisions, interview outcomes and placement rates are not promised or predicted by this system.',
  },
  {
    q: 'How is fairness actually monitored?',
    a: 'Stored match scores are grouped by career-break band, and the correlation between break length and score is measured. The administrators dashboard reports the numbers, including how few samples exist. A clean report is a signal to keep watching, not proof of fairness.',
  },
  {
    q: 'Is this a live job board?',
    a: 'No. The roles and profiles in this build are seeded demonstration data for evaluation. There is no live labour-market feed and no external job source.',
  },
]

export default function LandingPage() {
  return (
    <>
      {/* ---------------------------------------------------------------- Hero */}
      <section className="syprus-hero relative overflow-hidden border-b border-border/60">
        <div aria-hidden className="syprus-grid absolute inset-0 opacity-60" />
        <div className="relative mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
          <div className="max-w-3xl">
            <Badge variant="secondary" className="bg-brand-100 text-brand-800">
              Skills-first career re-entry
            </Badge>
            <h1 className="mt-5 text-4xl font-semibold tracking-tight text-balance sm:text-5xl lg:text-[3.4rem] lg:leading-[1.05]">
              A career break is not a skill gap.
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted-foreground">
              SYPRUS reads what you have actually been doing — paid work, caregiving, volunteering, freelancing — turns
              it into an evidenced skills inventory, and puts that in front of employers instead of a timeline they have
              to judge.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button size="lg" className="bg-brand-600 hover:bg-brand-700" nativeButton={false} render={<Link href="/register?role=candidate" />}>Create your free profile
                  <ArrowRight className="size-4" aria-hidden />
                </Button>
              <Button size="lg" variant="outline" className="border-brand-300 bg-white/70 dark:bg-input/30" nativeButton={false} render={<Link href="/register?role=employer" />}>Post roles on skills</Button>
            </div>
          </div>

          <dl className="mt-10 grid gap-5 sm:grid-cols-3">
              {HERO_POINTS.map((point) => (
                <div key={point.title}>
                  <dt className="flex items-center gap-2 text-sm font-semibold">
                    <point.icon className="size-4 text-brand-600" aria-hidden />
                    {point.title}
                  </dt>
                  <dd className="mt-1 text-sm leading-relaxed text-muted-foreground">{point.text}</dd>
                </div>
              ))}
            </dl>

          {/* Artwork and snapshot side by side: the image gives the fold its
              scale, the card gives it something concrete to read. */}
          <div className="mt-12 grid gap-8 lg:mt-16 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:gap-12">
            <SectionImage
              image="hero-possibilities"
              ratioClassName="aspect-[16/10]"
              sizes="(max-width: 639px) 92vw, (max-width: 1023px) 84vw, (max-width: 1279px) 46vw, 44vw"
              frameClassName="ring-border/60"
            />

            {/* Illustrative snapshot, built from the same components the portal uses. */}
            <div className="relative">
            <div className="absolute -inset-4 -z-10 rounded-3xl bg-gradient-to-br from-brand-200/40 via-transparent to-transparent blur-2xl" />
            <Card className="overflow-hidden shadow-xl shadow-brand-900/10 dark:shadow-black/40">
              <CardHeader className="border-b border-border/70 bg-brand-50/60">
                <div className="flex items-center justify-between gap-3">
                  <CardTitle className="text-base">Capability snapshot</CardTitle>
                  <DemoBadge text="Illustrative" />
                </div>
                <CardDescription className="mt-1">
                  SYPR-7K2M · targeting Operations Coordinator · hybrid
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5 pt-5">
                <ScoreBar
                  score={0.78}
                  label="Match · Operations Coordinator"
                  breakdown={[
                    { label: 'Required', value: 0.82 },
                    { label: 'Preferred', value: 0.6 },
                    { label: 'Evidence', value: 0.71 },
                    { label: 'Preferences', value: 0.9 },
                  ]}
                />

                <Separator />

                <ul className="space-y-2.5">
                  {[
                    { name: 'Scheduling & Coordination', status: 'RULE_INFERRED', level: 'Advanced' },
                    { name: 'Stakeholder Management', status: 'HR_REVIEWED', level: 'Proficient' },
                    { name: 'Data Analysis', status: 'SELF_REPORTED', level: 'Functional' },
                  ].map((skill) => (
                    <li key={skill.name} className="flex items-center justify-between gap-3 text-sm">
                      <span className="min-w-0 truncate">{skill.name}</span>
                      <span className="flex shrink-0 items-center gap-2">
                        <span className="text-xs text-muted-foreground">{skill.level}</span>
                        <StatusBadge value={skill.status} />
                      </span>
                    </li>
                  ))}
                </ul>

                <div className="rounded-lg border border-dashed border-brand-200 bg-brand-50/50 p-3.5">
                  <p className="text-xs leading-relaxed text-brand-900">
                    <span className="font-medium">Gap flagged:</span> Excel needed at Proficient, currently Functional.
                    Learning plan step 1: “Spreadsheet modelling for reporting” — 9 hours.
                  </p>
                </div>
              </CardContent>
            </Card>
            </div>
          </div>
        </div>
      </section>

      {/* -------------------------------------------------------------- Problem */}
      <section id="problem" className="mx-auto max-w-7xl scroll-mt-20 px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
        <div className="grid gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold tracking-[0.16em] text-brand-600 uppercase">The problem</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
              Gap-based screening throws away the exact capability employers say is short.
            </h2>
            <p className="mt-4 text-muted-foreground">
              Re-entry is treated as a deficit to explain rather than a period of work to describe. The result is that
              capable people spend interviews apologising, and hiring teams never see the skill.
            </p>
          </div>

          <SectionImage
            image="transferable-experience"
            sizes="(max-width: 1023px) 92vw, 46vw"
            caption="The same coordination work, described three ways: a household, a volunteer crew, a reporting session."
          />
        </div>

        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {PROBLEM_POINTS.map((point) => (
            <Card key={point.title} className="syprus-card-hover">
              <CardHeader>
                <CardTitle className="text-[15px] leading-snug">{point.title}</CardTitle>
                <CardDescription className="mt-2 leading-relaxed">{point.text}</CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>

        <div className="mt-8">
          <InfoNote tone="privacy" title="What “skills-first” means here, concretely">
            The matching model reads skill levels, skill confidence, evidence counts, the role’s published experience
            range and nothing else. Break length, break reason, age, marital status, employer names and education
            institution names are not inputs. The administrators dashboard measures whether stored scores behave that
            way.
          </InfoNote>
        </div>
      </section>

      {/* --------------------------------------------------------- How it works */}
      <section id="how-it-works" className="scroll-mt-20 border-y border-border/60 bg-brand-50/40">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold tracking-[0.16em] text-brand-600 uppercase">How it works</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
              Five steps from “what have I been doing?” to a shortlist.
            </h2>
          </div>

          {/* The five milestones are drawn by the artwork; the labels next to
              them are text, so they are selectable, translatable and readable
              with images off. Five grid cells put each label under its icon. */}
          <figure className="mt-10 rounded-2xl bg-sand-100/70 p-4 ring-1 ring-border/60 sm:p-6">
            <SectionImage
              image="career-pathway"
              sizes="(max-width: 639px) 88vw, (max-width: 1023px) 80vw, 60rem"
              frameClassName="bg-transparent ring-0"
            />
            <ol className="mt-2 hidden grid-cols-5 gap-2 sm:grid">
              {STEPS.map((step) => (
                <li key={step.number} className="flex flex-col items-center gap-1 text-center">
                  <span className="grid size-6 place-items-center rounded-full bg-brand-600 text-[11px] font-semibold text-primary-foreground tabular-nums">
                    {step.number.replace('0', '')}
                  </span>
                  <span className="text-[11px] leading-snug font-medium sm:text-xs">{step.title}</span>
                </li>
              ))}
            </ol>
            <ol className="mt-4 flex flex-col gap-2.5 sm:hidden" aria-label="Pathway steps in order">
              {STEPS.map((step) => (
                <li key={step.number} className="flex items-start gap-2.5 text-left">
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-brand-600 text-[11px] font-semibold text-primary-foreground tabular-nums">
                    {step.number.replace('0', '')}
                  </span>
                  <span className="text-xs leading-snug font-medium">{step.title}</span>
                </li>
              ))}
            </ol>
          </figure>

          <ol className="mt-12 space-y-4">
            {STEPS.map((step, index) => (
              <li key={step.number}>
                <Card className="syprus-card-hover">
                  <CardContent className="flex flex-col gap-4 py-5 sm:flex-row sm:items-start sm:gap-6">
                    <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-brand-600 text-sm font-semibold text-primary-foreground tabular-nums">
                      {step.number}
                    </span>
                    <div className="min-w-0">
                      <h3 className="text-[17px] font-semibold">{step.title}</h3>
                      <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-muted-foreground">{step.text}</p>
                    </div>
                    {index === STEPS.length - 1 ? (
                      <Button variant="outline" size="sm" className="shrink-0 self-start sm:mt-1" nativeButton={false} render={<Link href="/register?role=candidate" />}>Start onboarding</Button>
                    ) : null}
                  </CardContent>
                </Card>
              </li>
            ))}
          </ol>

          {/* One interactive explanation, deliberately built on invented data so
              it cannot be mistaken for a score. It runs entirely in the browser:
              no request, no storage, no model call. */}
          <div id="skills-demo" className="mt-10 max-w-3xl scroll-mt-20">
            <SkillsDemo />
          </div>
        </div>
      </section>

      {/* -------------------------------------------------------------- Agents */}
      <section id="agents" className="mx-auto max-w-7xl scroll-mt-20 px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold tracking-[0.16em] text-brand-600 uppercase">Four agents</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
              Four agents, and which part of each one is a model.
            </h2>
            <p className="mt-4 text-muted-foreground">
              The guided onboarding is a scripted conversation with predefined questions, answered by local rules. The
              four agents below do heavier work: their scoring and layout steps are deterministic, and their suggestion
              steps can use a language model when this deployment has AI enabled. A card states which is which, and the
              screen you are on labels the mode that produced what you are reading.
            </p>
          </div>
        </div>

        <div className="mt-10 grid gap-5 md:grid-cols-2">
          {AGENTS.map((agent) => (
            <Card key={agent.name} className="syprus-card-hover flex">
              <CardHeader className="flex-1">
                <div className="flex items-center gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700 ring-1 ring-brand-100">
                    <agent.icon className="size-5" aria-hidden />
                  </span>
                  <CardTitle className="text-[17px]">{agent.name}</CardTitle>
                </div>
                <dl className="mt-4 space-y-3 text-sm">
                  <div>
                    <dt className="font-medium text-xs tracking-wide text-muted-foreground uppercase">Engine</dt>
                    <dd className="mt-1 leading-relaxed font-medium">{agent.path}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-xs tracking-wide text-muted-foreground uppercase">What it does</dt>
                    <dd className="mt-1 leading-relaxed">{agent.does}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-xs tracking-wide text-muted-foreground uppercase">What you get</dt>
                    <dd className="mt-1 leading-relaxed">{agent.output}</dd>
                  </div>
                  <div>
                    <dt className="flex items-center gap-1.5 font-medium text-xs tracking-wide text-amber-800 uppercase">
                      <TriangleAlert className="size-3.5" aria-hidden />
                      Limits
                    </dt>
                    <dd className="mt-1 leading-relaxed text-muted-foreground">{agent.limits}</dd>
                  </div>
                </dl>
              </CardHeader>
            </Card>
          ))}
        </div>

        <div className="mt-8">
          <InfoNote tone="warning" title="What is rules, what is a model, what is neither">
            <ul className="mt-1 space-y-1.5 leading-relaxed">
              <li>· The guided onboarding asks predefined questions and applies local rules. It is not a chat model.</li>
              <li>· Optional AI agents produce structured suggestions and explanations when this deployment has a model
                enabled; each one is stored with the provider and model that answered.</li>
              <li>· Match scores are calculated by the deterministic scoring engine — weighted skill coverage, stated
                experience and evidence. A model never produces a score.</li>
              <li>· When a provider is disabled, rate-limited, unreachable or returns output its own contract rejects,
                the same screen falls back to the rule engines, and the mode shown is the one that actually answered.</li>
              <li>· Successful calls recorded in the past do not prove a provider is reachable right now.</li>
              <li>· A suggestion is a proposal about your wording. It is not an independently verified credential, a
                test result, or a promise that an employer will hire you.</li>
              <li>· Sona, the assistant inside the portals, answers from your own stored records and labels the engine
                that replied. It cannot change anything, and it is not a person.</li>
            </ul>
          </InfoNote>
        </div>
      </section>

      {/* ---------------------------------------------------- Candidate benefits */}
      <section id="candidates" className="scroll-mt-20 border-y border-border/60 bg-muted/30">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
          <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr]">
            <div>
              <p className="text-xs font-semibold tracking-[0.16em] text-brand-600 uppercase">For candidates</p>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
                Built for the conversation you are dreading.
              </h2>
              <p className="mt-4 text-muted-foreground">
                You are not asked to explain the gap. You are asked what you did, what you handled and what you want
                next — and the platform does the work of turning that into something an employer can evaluate.
              </p>
              <div className="mt-7 flex flex-col gap-3 sm:flex-row">
                <Button className="bg-brand-600 hover:bg-brand-700" nativeButton={false} render={<Link href="/register?role=candidate" />}>Create candidate account
                    <ArrowRight className="size-4" aria-hidden />
                  </Button>
                <Button variant="ghost" nativeButton={false} render={<Link href="/login" />}>I already have one</Button>
              </div>

              <SectionImage
                image="candidate-return"
                className="mt-8"
                sizes="(max-width: 1023px) 92vw, 42vw"
                caption="Reading back her own answers, with the evidence quoted under each one."
              />
            </div>

            <ul className="grid gap-4 sm:grid-cols-2">
              {CANDIDATE_BENEFITS.map((benefit) => (
                <li key={benefit.title}>
                  <Card className="h-full">
                    <CardHeader>
                      <div className="flex items-start gap-3">
                        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-white text-brand-600 ring-1 ring-brand-100">
                          <benefit.icon className="size-4.5" aria-hidden />
                        </span>
                        <div>
                          <CardTitle className="text-[15px] leading-snug">{benefit.title}</CardTitle>
                          <CardDescription className="mt-1.5 leading-relaxed">{benefit.text}</CardDescription>
                        </div>
                      </div>
                    </CardHeader>
                  </Card>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ----------------------------------------------------- Employer benefits */}
      <section id="employers" className="mx-auto max-w-7xl scroll-mt-20 px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
        <div className="grid gap-10 lg:grid-cols-[1.1fr_0.9fr]">
          <ul className="grid gap-4 sm:grid-cols-2 lg:order-2">
            {EMPLOYER_BENEFITS.map((benefit) => (
              <li key={benefit.title}>
                <Card className="syprus-card-hover h-full">
                  <CardHeader>
                    <div className="flex items-start gap-3">
                      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700">
                        <benefit.icon className="size-4.5" aria-hidden />
                      </span>
                      <div>
                        <CardTitle className="text-[15px] leading-snug">{benefit.title}</CardTitle>
                        <CardDescription className="mt-1.5 leading-relaxed">{benefit.text}</CardDescription>
                      </div>
                    </div>
                  </CardHeader>
                </Card>
              </li>
            ))}
          </ul>

          <div className="lg:order-1">
            <p className="text-xs font-semibold tracking-[0.16em] text-brand-600 uppercase">For employers</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
              Shortlists you can defend, with the reasoning attached.
            </h2>
            <p className="mt-4 text-muted-foreground">
              Define required and preferred skills with levels and weights. Browse anonymised candidates scored against
              them. Open any score to see exactly which skill covered which requirement and what is still missing.
            </p>
            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <Button className="bg-brand-600 hover:bg-brand-700" nativeButton={false} render={<Link href="/register?role=employer" />}>Register an organisation
                  <ArrowRight className="size-4" aria-hidden />
                </Button>
            </div>
            <SectionImage
              image="employer-collaboration"
              className="mt-8"
              sizes="(max-width: 1023px) 92vw, 42vw"
              caption="Three reviewers, one screen, the skill-by-skill reasoning beside each score."
            />

            <div className="mt-6">
              <InfoNote tone="warning" title="Verification and moderation are real gates">
                An organisation must be verified by an administrator before its roles reach candidates, and each role
                passes moderation. Editing a published role sends it back through review.
              </InfoNote>
            </div>
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------------- Privacy */}
      <section id="privacy" className="scroll-mt-20 border-y border-border/60 bg-brand-50/40">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[0.95fr_1.05fr] lg:items-center lg:px-8 lg:py-24">
          <SectionImage
            image="privacy-control"
            sizes="(max-width: 1023px) 92vw, 44vw"
            caption="Anonymised by default: the layer you lift is the one you chose to lift."
            frameClassName="ring-border/70"
          />

          <div className="max-w-2xl">
            <p className="text-xs font-semibold tracking-[0.16em] text-brand-600 uppercase">Privacy and disclosure</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
              You decide when your name enters the room.
            </h2>
            <p className="mt-4 text-muted-foreground">
              Employers browse handles, skills and durations of responsibility. Nothing identifies you until you act,
              and every decision is stored with the policy version you agreed to.
            </p>
            <ul role="list" className="mt-6 grid gap-3 sm:grid-cols-2">
              {[
                'Anonymised browsing is a consent switch, and switching it off hides the profile immediately.',
                'Applying is the one action that discloses your name and contact details — to that one organisation.',
                'A separate identity request from an employer can be approved, left alone, or withdrawn later.',
                'Grants expire. Withdrawal ends the disclosure everywhere at once, and both are recorded.',
              ].map((line) => (
                <li key={line} role="listitem" className="flex gap-2.5 rounded-lg bg-card px-3.5 py-3 text-sm leading-relaxed ring-1 ring-border/70">
                  <ShieldCheck className="mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
            <p className="mt-5 text-xs leading-relaxed text-muted-foreground">
              Break length, break reason and calendar dates are never part of what an employer sees; dates are replaced
              with durations. See the{' '}
              <Link href="/#faq" className="font-medium text-brand-600 underline-offset-4 hover:underline">
                questions above
              </Link>{' '}
              for what the platform does not do.
            </p>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------- Testimonials */}
      <section id="testimonials" className="scroll-mt-20 border-y border-border/60 bg-brand-950">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8 lg:py-20">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-semibold tracking-[0.16em] text-brand-300 uppercase">Voices</p>
              <h2 className="mt-3 text-2xl font-semibold tracking-tight text-brand-50 sm:text-3xl">
                How returners describe the difference.
              </h2>
            </div>
            <Badge variant="outline" className="border-brand-700 bg-brand-900/60 text-brand-200">
              Illustrative examples — not real people or verified outcomes
            </Badge>
          </div>

          <ul className="mt-9 grid gap-5 md:grid-cols-3">
            {TESTIMONIALS.map((testimonial) => (
              <li key={testimonial.role}>
                <figure className="flex h-full flex-col justify-between rounded-xl border border-brand-800 bg-brand-900/40 p-5">
                  <blockquote className="text-sm leading-relaxed text-brand-100">“{testimonial.quote}”</blockquote>
                  <figcaption className="mt-4 border-t border-brand-800 pt-3 text-xs text-brand-300">
                    {testimonial.role}
                  </figcaption>
                </figure>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ------------------------------------------------------------------- FAQ */}
      <section id="faq" className="mx-auto max-w-4xl scroll-mt-20 px-4 py-16 sm:px-6 lg:py-24">
        <p className="text-xs font-semibold tracking-[0.16em] text-brand-600 uppercase">Questions asked honestly</p>
        <h2 className="mt-3 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          What this system does, and what it does not do.
        </h2>

        <div className="mt-9 divide-y divide-border rounded-xl border border-border bg-card">
          {FAQS.map((faq) => (
            <details key={faq.q} className="group px-5 py-4">
              <summary className="flex cursor-pointer list-none items-start justify-between gap-4 text-[15px] font-medium">
                {faq.q}
                <span
                  aria-hidden
                  className="mt-1 shrink-0 text-brand-600 transition-transform group-open:rotate-45 text-xl leading-none"
                >
                  +
                </span>
              </summary>
              <p className="mt-2.5 max-w-3xl text-sm leading-relaxed text-muted-foreground">{faq.a}</p>
            </details>
          ))}
        </div>

        <div className="mt-8">
          <InfoNote tone="warning" title="Read this before evaluating the build">
            SYPRUS in this state is a functional MVP with seeded demonstration data. It does not claim AI skill
            verification, live job-market intelligence, elimination of bias, or actual job placement. Those systems are
            not implemented or evaluated here. Optional agent calls do reach a configured model provider when AI is
            enabled for the deployment; whether yours did is stated next to the answer it produced.
          </InfoNote>
        </div>
      </section>

      {/* ----------------------------------------------------------------- CTA */}
      <section id="cta" className="border-t border-border/60 bg-brand-50/50">
        <div className="mx-auto flex max-w-7xl flex-col items-start gap-6 px-4 py-14 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
          <div className="max-w-2xl">
            <h2 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
              Start with your own words. No résumé required.
            </h2>
            <p className="mt-2 text-muted-foreground">
              Create a candidate profile and build the inventory, or register an organisation and define the skills a
              role actually needs.
            </p>
          </div>
          <div className="flex shrink-0 flex-col gap-3 sm:flex-row">
            <Button size="lg" className="bg-brand-600 hover:bg-brand-700" nativeButton={false} render={<Link href="/register?role=candidate" />}>I am returning to work</Button>
            <Button size="lg" variant="outline" className="border-brand-300 bg-white" nativeButton={false} render={<Link href="/register?role=employer" />}>I am hiring</Button>
          </div>
        </div>
      </section>
    </>
  )
}
