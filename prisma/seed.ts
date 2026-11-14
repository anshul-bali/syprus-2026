/**
 * SYPRUS demonstration data.
 *
 * Everything written by this script is sample content for evaluating the
 * product: the people, organisations and roles are invented, and each record is
 * either named with a `.example` domain or carries a `demonstration` marker.
 * Skill levels, match scores and gap reports are produced by the same rule
 * engines the running app uses, so the numbers on screen are genuinely derived
 * from the seeded text rather than typed in by hand.
 *
 * Run with: npm run db:seed
 *
 * It deletes every table first, so it refuses to start unless the environment is
 * declared disposable, the wipe is explicitly asked for, and DATABASE_URL names
 * a loopback database. See `src/lib/db/seed-guard.ts`. `npm run qa:seed` supplies
 * all three for the isolated QA cluster.
 */

import { PrismaClient, type ProficiencyLevel } from '@prisma/client'
import bcrypt from 'bcryptjs'

// Node loads .env explicitly here: the seed runs outside the Next.js runtime,
// which is the only place Prisma's own env loading applies.
if (!process.env.DATABASE_URL) {
  process.loadEnvFile('.env')
}

import {
  ADMIN_PERMISSIONS,
  CANDIDATE_PERMISSIONS,
  EMPLOYER_PERMISSIONS,
} from '../src/lib/permissions'
import { SKILL_TAXONOMY, CAREGIVING_ACTIVITIES } from '../src/lib/taxonomy/skills'
import { scoreMatch } from '../src/lib/engines/matching'
import { analyseGaps } from '../src/lib/engines/gap'
import { buildLearningPlan } from '../src/lib/engines/pathway'
import { anonymousHandle } from '../src/lib/utils'
import { seedTargetFromEnv } from '../src/lib/db/seed-guard'

// Before a client exists, and long before the delete transaction below: this
// script wipes every table, so the target has to be judged first. Exiting here
// means an unsafe invocation cannot write a single row.
function requireSeedTarget() {
  const decision = seedTargetFromEnv()
  if (!decision.allowed) {
    console.error(`\nSeed refused — nothing was written.\n\n  ${decision.reason}\n`)
    console.error('To seed a disposable local cluster, all three are required:')
    console.error('  SYPRUS_DEMO_ENV=true   this environment is disposable')
    console.error('  SEED_ALLOW_RESET=true  deleting every table is intended')
    console.error('  DATABASE_URL           a loopback host and a named database\n')
    console.error('`npm run qa:seed` sets these for the isolated QA cluster.\n')
    process.exit(1)
  }
  return decision
}

/**
 * No built-in fallback. A password committed to a public repository is a
 * published credential for every account this script creates, an administrator
 * among them, so the operator has to supply one.
 */
function requireSeedPassword() {
  const password = process.env.SEED_DEMO_PASSWORD
  if (!password || password.length < 12) {
    console.error('\nSeed refused — nothing was written.\n\n  SEED_DEMO_PASSWORD must be set to at least 12 characters.\n')
    console.error('Every demonstration account, including the administrator, shares it. Choose a value')
    console.error('that is not published anywhere, and keep it in .env rather than in the repository.\n')
    process.exit(1)
  }
  return password
}

const target = requireSeedTarget()
const DEMO_PASSWORD = requireSeedPassword()
const prisma = new PrismaClient()

const POLICY_VERSION = process.env.POLICY_VERSION || '2026-11-01'
const MODEL_VERSION = process.env.MATCH_MODEL_VERSION || 'rules-2026-11-a'
const WEIGHT_VERSION = 'prototype-2026-11-a'

const MONTH = 30 * 24 * 60 * 60 * 1000

function yearsAgo(years: number) {
  return new Date(Date.now() - years * 12 * MONTH)
}

function monthsAgo(months: number) {
  return new Date(Date.now() - months * MONTH)
}

// ---------------------------------------------------------------------------
// Candidates
// ---------------------------------------------------------------------------

type DemoSkill = { slug: string; level: ProficiencyLevel; confidence: number; evidence?: string }

type DemoCandidate = {
  email: string
  name: string
  headline: string
  summary: string
  city: string
  country: string
  workPreference: 'REMOTE' | 'HYBRID' | 'ONSITE' | 'FLEXIBLE' | 'OPEN'
  availabilityHours: number
  targetRole: string
  targetIndustry: string
  breakMonths: number
  returnTimeline: string
  education: string
  visible: boolean
  sharingMode: 'ANONYMOUS_ONLY' | 'ANONYMOUS_WITH_APPLY' | 'NOT_VISIBLE'
  paid: {
    title: string
    organization: string
    description: string
    years: number
  } | null
  caregiving: { activities: string[]; description: string }
  skills: DemoSkill[]
}

const CANDIDATES: DemoCandidate[] = [
  {
    email: 'priya.n@example.com',
    name: 'Priya Raman (demonstration)',
    headline: 'Operations coordinator seeking a hybrid operations role',
    summary:
      'Six years in retail operations before a career break. During the break I ran a household of five including a parent with limited mobility, coordinated three carers and a school system, and kept a five-line budget to plan.',
    city: 'Bengaluru',
    country: 'India',
    workPreference: 'HYBRID',
    availabilityHours: 40,
    targetRole: 'Operations Coordinator',
    targetIndustry: 'Retail and e-commerce',
    breakMonths: 38,
    returnTimeline: '1-3',
    education: 'B.Com, operations management diploma',
    visible: true,
    sharingMode: 'ANONYMOUS_WITH_APPLY',
    paid: {
      title: 'Operations Executive',
      organization: 'Northline Retail',
      description:
        'Coordinated store replenishment across four locations, tracked inventory in SAP, built the weekly stock report in Excel with pivot tables, resolved delivery escalations with suppliers and negotiated return windows. Trained four new joiners on the rostering process and ran daily shift planning.',
      years: 4,
    },
    caregiving: {
      activities: ['medical_logistics', 'household_budget', 'care_team'],
      description:
        'Managed medication schedules and hospital appointments for my father, kept the care records and insurance paperwork, coordinated a rotating set of three carers, and ran the household budget including school fees and bills.',
    },
    skills: [
      { slug: 'scheduling-coordination', level: 'ADVANCED', confidence: 0.85, evidence: 'Built weekly rosters for 18 staff across four stores.' },
      { slug: 'inventory-resource-management', level: 'PROFICIENT', confidence: 0.8, evidence: 'Reconciliation of four store stocks with under 1% shrinkage variance.' },
      { slug: 'vendor-supplier-management', level: 'PROFICIENT', confidence: 0.75 },
      { slug: 'excel', level: 'PROFICIENT', confidence: 0.8, evidence: 'Pivot-table weekly stock and wastage report used by three regional managers.' },
      { slug: 'stakeholder-management', level: 'PROFICIENT', confidence: 0.7 },
      { slug: 'healthcare-coordination', level: 'ADVANCED', confidence: 0.7, evidence: 'Care plan and appointment log maintained for 30 months.' },
      { slug: 'household-financial-management', level: 'PROFICIENT', confidence: 0.68 },
      { slug: 'mentoring', level: 'FUNCTIONAL', confidence: 0.6 },
      { slug: 'data-analysis', level: 'FUNCTIONAL', confidence: 0.62 },
      { slug: 'reporting', level: 'FUNCTIONAL', confidence: 0.65 },
    ],
  },
  {
    email: 'sana.q@example.com',
    name: 'Sana Qureshi (demonstration)',
    headline: 'Finance professional returning to bookkeeping and reporting work',
    summary:
      'Five years in accounts and bookkeeping, then a break caring for two children in their first school years. I kept the household finances, ran the parents-association budget and finished two online courses.',
    city: 'Pune',
    country: 'India',
    workPreference: 'FLEXIBLE',
    availabilityHours: 30,
    targetRole: 'Accounts and Bookkeeping Specialist',
    targetIndustry: 'Banking and finance',
    breakMonths: 52,
    returnTimeline: '3-6',
    education: 'B.Com (Hons)',
    visible: true,
    sharingMode: 'ANONYMOUS_ONLY',
    paid: {
      title: 'Accounts Executive',
      organization: 'Meridian Services',
      description:
        'Handled accounts payable and receivable for 120 vendors, bank reconciliation in Tally, GST returns monthly, expense reports and month-end close support. Verified invoices against purchase orders and corrected recurring posting errors.',
      years: 5,
    },
    caregiving: {
      activities: ['household_budget', 'child_learning', 'volunteering'],
      description:
        'Ran the household budget, insurance renewals and education-fee planning; tracked two children’s school progress; ran the parents-association budget for a 90-family group, including collecting, reconciling and reporting spend.',
    },
    skills: [
      { slug: 'bookkeeping', level: 'ADVANCED', confidence: 0.88, evidence: '120-vendor AP/AR cycle with monthly bank reconciliation.' },
      { slug: 'financial-literacy', level: 'ADVANCED', confidence: 0.85 },
      { slug: 'accounting-software', level: 'PROFICIENT', confidence: 0.8, evidence: 'Tally daily use for two years, GST filings monthly.' },
      { slug: 'attention-to-detail', level: 'ADVANCED', confidence: 0.78 },
      { slug: 'reporting', level: 'PROFICIENT', confidence: 0.72 },
      { slug: 'excel', level: 'PROFICIENT', confidence: 0.7 },
      { slug: 'household-financial-management', level: 'PROFICIENT', confidence: 0.7 },
      { slug: 'child-development-knowledge', level: 'FUNCTIONAL', confidence: 0.6 },
      { slug: 'learning-agility', level: 'PROFICIENT', confidence: 0.68, evidence: 'Completed two accounting-automation courses during the break.' },
    ],
  },
  {
    email: 'maria.d@example.com',
    name: 'Maria D’Souza (demonstration)',
    headline: 'Customer experience lead moving into remote support coordination',
    summary:
      'Team lead in a contact centre for four years before relocating for family. Since then I have run a small home tuition business, volunteered with a neighbourhood health drive and kept my CRM skills current.',
    city: 'Goa',
    country: 'India',
    workPreference: 'REMOTE',
    availabilityHours: 35,
    targetRole: 'Customer Service Team Lead (Returnship)',
    targetIndustry: 'Technology',
    breakMonths: 26,
    returnTimeline: 'now',
    education: 'BA English, ITIL Foundation',
    visible: true,
    sharingMode: 'ANONYMOUS_WITH_APPLY',
    paid: {
      title: 'Senior Customer Associate',
      organization: 'Vertex Contact Solutions',
      description:
        'Handled escalations in Salesforce, led a team of six agents, ran quality monitoring and coached new joiners through their first month. Wrote the response templates that cut average handling time and reported weekly service levels to the client.',
      years: 4,
    },
    caregiving: {
      activities: ['relocation', 'freelance_small', 'volunteering', 'upskilling'],
      description:
        'Relocated across states and rebuilt all admin from scratch, ran a home tuition service with 14 students and their parents, volunteered with a neighbourhood health awareness drive, and completed an ITIL Foundation course.',
    },
    skills: [
      { slug: 'customer-service', level: 'EXPERT', confidence: 0.9, evidence: 'Four years of escalation handling; authored the template library.' },
      { slug: 'team-leadership', level: 'PROFICIENT', confidence: 0.8, evidence: 'Led six agents including onboarding and coaching.' },
      { slug: 'crm-software', level: 'PROFICIENT', confidence: 0.82 },
      { slug: 'written-communication', level: 'ADVANCED', confidence: 0.8 },
      { slug: 'conflict-resolution', level: 'PROFICIENT', confidence: 0.76 },
      { slug: 'teaching', level: 'PROFICIENT', confidence: 0.7, evidence: '14 students taught across three subjects over two years.' },
      { slug: 'community-mobilisation', level: 'FUNCTIONAL', confidence: 0.62 },
      { slug: 'adaptability', level: 'ADVANCED', confidence: 0.72 },
      { slug: 'sales-business-development', level: 'FUNCTIONAL', confidence: 0.6 },
      { slug: 'digital-literacy', level: 'PROFICIENT', confidence: 0.75 },
    ],
  },
  {
    email: 'farah.k@example.com',
    name: 'Farah Khan (demonstration)',
    headline: 'Data analyst building toward a reporting-focused role',
    summary:
      'Two years as a junior analyst before a break, then 30 months caring for a parent. I have been rebuilding technical depth through structured study and a portfolio of practice projects.',
    city: 'Hyderabad',
    country: 'India',
    workPreference: 'HYBRID',
    availabilityHours: 40,
    targetRole: 'Patient Data Reporting Associate',
    targetIndustry: 'Technology',
    breakMonths: 30,
    returnTimeline: '1-3',
    education: 'B.Sc Statistics',
    visible: true,
    sharingMode: 'ANONYMOUS_ONLY',
    paid: {
      title: 'Junior Data Analyst',
      organization: 'Quantlytics Labs',
      description:
        'Cleaned and validated data extracts, wrote SQL queries for the reporting team, built Excel and dashboard models, presented monthly findings to two stakeholders and documented the metric definitions.',
      years: 2,
    },
    caregiving: {
      activities: ['medical_logistics', 'care_team', 'upskilling'],
      description:
        'Primary coordinator for a parent’s oncology appointments, medication timetable and insurer paperwork, coordinating four specialists and two carers. Studied Python and SQL across that period with three practice projects.',
    },
    skills: [
      { slug: 'data-analysis', level: 'PROFICIENT', confidence: 0.8, evidence: 'Three portfolio projects plus two years of production extracts.' },
      { slug: 'excel', level: 'ADVANCED', confidence: 0.85 },
      { slug: 'reporting', level: 'PROFICIENT', confidence: 0.75 },
      { slug: 'programming', level: 'FUNCTIONAL', confidence: 0.66, evidence: 'Python scripting for three practice datasets.' },
      { slug: 'database-management', level: 'FUNCTIONAL', confidence: 0.6 },
      { slug: 'attention-to-detail', level: 'ADVANCED', confidence: 0.8 },
      { slug: 'healthcare-coordination', level: 'ADVANCED', confidence: 0.74 },
      { slug: 'records-management', level: 'PROFICIENT', confidence: 0.7 },
      { slug: 'learning-agility', level: 'ADVANCED', confidence: 0.78 },
      { slug: 'written-communication', level: 'PROFICIENT', confidence: 0.7 },
    ],
  },
  {
    email: 'ananya.s@example.com',
    name: 'Ananya Sharma (demonstration)',
    headline: 'HR and recruitment professional returning part time',
    summary:
      'Ran full-cycle recruitment for eight years, then took a break for a child’s early years and a partner relocation. Kept the domain current through volunteering on hiring committees for a non-profit.',
    city: 'Delhi',
    country: 'India',
    workPreference: 'HYBRID',
    availabilityHours: 25,
    targetRole: 'HR Coordinator',
    targetIndustry: 'Non-profit and development',
    breakMonths: 14,
    returnTimeline: 'now',
    education: 'MBA Human Resources',
    visible: false,
    sharingMode: 'NOT_VISIBLE',
    paid: {
      title: 'HR and Recruitment Manager',
      organization: 'Cedar Group',
      description:
        'Full-cycle recruitment on Workday and the applicant tracking system, screening resumes, scheduling interviews across three countries, onboarding new staff, payroll coordination and statutory compliance reporting.',
      years: 8,
    },
    caregiving: {
      activities: ['child_learning', 'relocation', 'volunteering'],
      description:
        'Managed early-years schooling decisions and daily care logistics, handled an interstate relocation with all documentation, and volunteered on a non-profit’s hiring shortlisting committee.',
    },
    skills: [
      { slug: 'recruitment', level: 'EXPERT', confidence: 0.92, evidence: 'Eight years full-cycle, including 300+ offers closed.' },
      { slug: 'hr-payroll-systems', level: 'ADVANCED', confidence: 0.85 },
      { slug: 'hr-policy-compliance', level: 'PROFICIENT', confidence: 0.8 },
      { slug: 'scheduling-coordination', level: 'ADVANCED', confidence: 0.84 },
      { slug: 'stakeholder-management', level: 'ADVANCED', confidence: 0.82 },
      { slug: 'mentoring', level: 'PROFICIENT', confidence: 0.76 },
      { slug: 'records-management', level: 'PROFICIENT', confidence: 0.78 },
      { slug: 'data-privacy-security', level: 'PROFICIENT', confidence: 0.7 },
    ],
  },
  {
    // Prompt 3 demonstration profile: the guided walkthrough on the candidate side.
    email: 'anshika@example.com',
    name: 'Anshika (demonstration)',
    headline: 'Marketing analyst returning to campaign and reporting work',
    summary:
      'Four years in marketing analytics before a three-year caregiving break. During the break I ran the medical and school calendar for two children and an elderly parent, kept the household accounts, and volunteered on the school management committee where I produced the annual report.',
    city: 'Mumbai',
    country: 'India',
    workPreference: 'HYBRID',
    availabilityHours: 30,
    targetRole: 'Marketing Operations Coordinator',
    targetIndustry: 'Media and marketing',
    breakMonths: 36,
    returnTimeline: '1-3',
    education: 'BBA Marketing, Digital Analytics certificate',
    visible: true,
    sharingMode: 'ANONYMOUS_WITH_APPLY',
    paid: {
      title: 'Marketing Analyst',
      organization: 'Bluewave Retail',
      description:
        'Built the weekly campaign performance report in Excel with pivot tables, tracked spend across four agency accounts, wrote client-facing update notes, coordinated creative briefs and launch calendars, and presented monthly results to category managers. Ran SEO reporting and monitored CRM campaigns in HubSpot.',
      years: 4,
    },
    caregiving: {
      activities: ['child_learning', 'household_budget', 'care_team', 'volunteering'],
      description:
        'Ran the medical appointment and medication schedule for my father, coordinated two carers and a school routine for two children, kept the household budget with school fees and insurance renewals, and volunteered on the school management committee where I coordinated events and produced the annual report.',
    },
    skills: [
      { slug: 'data-analysis', level: 'PROFICIENT', confidence: 0.82, evidence: 'Weekly campaign performance report used by four category managers.' },
      { slug: 'excel', level: 'ADVANCED', confidence: 0.86, evidence: 'Pivot-table spend and performance model rebuilt each month.' },
      { slug: 'reporting', level: 'PROFICIENT', confidence: 0.84, evidence: 'Authored the school management committee annual report.' },
      { slug: 'marketing-fundamentals', level: 'PROFICIENT', confidence: 0.78 },
      { slug: 'content-creation', level: 'FUNCTIONAL', confidence: 0.62 },
      { slug: 'written-communication', level: 'PROFICIENT', confidence: 0.8 },
      { slug: 'project-coordination', level: 'PROFICIENT', confidence: 0.74, evidence: 'Coordinated creative briefs and launch calendars across four agencies.' },
      { slug: 'scheduling-coordination', level: 'ADVANCED', confidence: 0.72, evidence: 'Multi-person medical, school and carer rota maintained for three years.' },
      { slug: 'stakeholder-management', level: 'PROFICIENT', confidence: 0.7 },
      { slug: 'financial-literacy', level: 'PROFICIENT', confidence: 0.7, evidence: 'Tracked programme spend against budget and renewed household insurance.' },
      { slug: 'community-mobilisation', level: 'FUNCTIONAL', confidence: 0.6 },
      { slug: 'attention-to-detail', level: 'PROFICIENT', confidence: 0.72 },
      { slug: 'time-management', level: 'PROFICIENT', confidence: 0.68 },
    ],
  },
]

// ---------------------------------------------------------------------------
// Organisations and roles
// ---------------------------------------------------------------------------

type DemoJobSkill = { slug: string; requirement: 'REQUIRED' | 'PREFERRED'; level: ProficiencyLevel; weight: number }

type DemoJob = {
  org: string
  title: string
  description: string
  responsibilities: string[]
  requirementsText: string
  city: string
  workMode: 'REMOTE' | 'HYBRID' | 'ONSITE'
  employmentType: 'FULL_TIME' | 'PART_TIME' | 'CONTRACT' | 'RETURNISH'
  salaryMin: number
  salaryMax: number
  experienceYearsMin: number
  experienceYearsMax: number
  reEntryFriendly: boolean
  flexibleHours: boolean
  returnshipProgram: boolean
  skills: DemoJobSkill[]
}

const ORGANISATIONS = [
  {
    slug: 'northwind-logistics',
    name: 'Northwind Logistics (demonstration)',
    email: 'talent@northwind.example.com',
    name2: 'Kavya Menon (demonstration)',
    industry: 'Transport and logistics',
    sizeLabel: '200–500 people',
    city: 'Bengaluru',
    country: 'India',
    website: null as string | null,
    description:
      'Regional freight and last-mile operation. This is a demonstration organisation created by the seed script; it is not a real company.',
    flexPolicy: 'Job-share and 4-day week available for operations roles.',
    returnshipNote: 'Runs a paid 12-week return-to-work programme each year.',
    verification: 'VERIFIED' as const,
  },
  {
    slug: 'ashford-health-trust',
    name: 'Ashford Health Partners (demonstration)',
    email: 'recruitment@ashford.example.com',
    name2: 'Daniel Okafor (demonstration)',
    industry: 'Healthcare',
    sizeLabel: '50–200 people',
    city: 'Pune',
    country: 'India',
    website: null,
    description:
      'Multi-site clinic group covering primary care and chronic condition management. Demonstration organisation created by the seed script.',
    flexPolicy: 'Core-hours scheduling across all administrative roles.',
    returnshipNote: 'Pairing period for anyone returning after a break of 12 months or more.',
    verification: 'VERIFIED' as const,
  },
  {
    slug: 'meridian-media',
    name: 'Meridian Media Collective (demonstration)',
    email: 'people@meridian.example.com',
    name2: 'Rohit Verma (demonstration)',
    industry: 'Media and marketing',
    sizeLabel: '50–200 people',
    city: 'Mumbai',
    country: 'India',
    website: null,
    description:
      'Independent digital marketing studio working with consumer brands. Demonstration organisation created by the seed script; it is not a real company.',
    flexPolicy: 'Four-day week available across operations roles; core collaboration days on-site.',
    returnshipNote: 'Runs a structured return programme for people coming back after a career break.',
    verification: 'VERIFIED' as const,
  },
  {
    slug: 'lumen-analytics',
    name: 'Lumen Analytics (demonstration)',
    email: 'people@lumen.example.com',
    name2: 'Rhea Bhatt (demonstration)',
    industry: 'Technology',
    sizeLabel: '10–50 people',
    city: 'Hyderabad',
    country: 'India',
    website: null,
    description:
      'Reporting and analytics consultancy for non-profits. Demonstration organisation created by the seed script; verification is pending so its roles do not reach candidates yet.',
    flexPolicy: 'Fully remote with quarterly in-person.',
    returnshipNote: null,
    verification: 'PENDING' as const,
  },
]

const JOBS: DemoJob[] = [
  {
    org: 'northwind-logistics',
    title: 'Operations Coordinator',
    description:
      'Keep four depots running: rostering, stock movement, supplier follow-up and the reporting that regional managers act on each week. We hire on the skills listed here, not on continuity of employment.',
    responsibilities: [
      'Own the weekly roster across four depot sites',
      'Reconcile stock movement and flag variance',
      'Chase suppliers on delivery windows and returns',
      'Produce the weekly operations report',
    ],
    requirementsText: 'Prior coordination or operations work, in a paid, freelance or community setting.',
    city: 'Bengaluru',
    workMode: 'HYBRID',
    employmentType: 'FULL_TIME',
    salaryMin: 480000,
    salaryMax: 620000,
    experienceYearsMin: 2,
    experienceYearsMax: 6,
    reEntryFriendly: true,
    flexibleHours: true,
    returnshipProgram: false,
    skills: [
      { slug: 'scheduling-coordination', requirement: 'REQUIRED', level: 'PROFICIENT', weight: 5 },
      { slug: 'inventory-resource-management', requirement: 'REQUIRED', level: 'PROFICIENT', weight: 4 },
      { slug: 'vendor-supplier-management', requirement: 'REQUIRED', level: 'FUNCTIONAL', weight: 3 },
      { slug: 'excel', requirement: 'REQUIRED', level: 'PROFICIENT', weight: 4 },
      { slug: 'stakeholder-management', requirement: 'REQUIRED', level: 'FUNCTIONAL', weight: 3 },
      { slug: 'reporting', requirement: 'PREFERRED', level: 'FUNCTIONAL', weight: 2 },
      { slug: 'problem-solving', requirement: 'PREFERRED', level: 'PROFICIENT', weight: 2 },
    ],
  },
  {
    org: 'northwind-logistics',
    title: 'Customer Service Team Lead (Returnship)',
    description:
      'A twelve-week paid returnship converting to a permanent team-lead role. You will lead a support pod of five, own service-level reporting and rebuild tooling confidence with a named mentor.',
    responsibilities: [
      'Lead a pod of five support agents',
      'Own weekly service-level reporting',
      'Coach two new joiners through their first month',
      'Resolve escalated customer cases',
    ],
    requirementsText: 'Supervisory or coaching experience from any setting, including community and care coordination.',
    city: 'Bengaluru',
    workMode: 'HYBRID',
    employmentType: 'RETURNISH',
    salaryMin: 420000,
    salaryMax: 520000,
    experienceYearsMin: 2,
    experienceYearsMax: 8,
    reEntryFriendly: true,
    flexibleHours: true,
    returnshipProgram: true,
    skills: [
      { slug: 'customer-service', requirement: 'REQUIRED', level: 'PROFICIENT', weight: 5 },
      { slug: 'team-leadership', requirement: 'REQUIRED', level: 'FUNCTIONAL', weight: 4 },
      { slug: 'mentoring', requirement: 'REQUIRED', level: 'FUNCTIONAL', weight: 3 },
      { slug: 'conflict-resolution', requirement: 'REQUIRED', level: 'FUNCTIONAL', weight: 3 },
      { slug: 'crm-software', requirement: 'PREFERRED', level: 'FUNCTIONAL', weight: 2 },
      { slug: 'reporting', requirement: 'PREFERRED', level: 'FUNCTIONAL', weight: 2 },
    ],
  },
  {
    org: 'ashford-health-trust',
    title: 'Clinic Administrator',
    description:
      'Front-of-house and records ownership for two clinics: appointments, patient records, referral follow-up and the monthly activity report. Structured pairing for the first eight weeks.',
    responsibilities: [
      'Manage clinician diaries and appointment flow',
      'Maintain accurate, confidential patient records',
      'Chase referrals and specialist correspondence',
      'Prepare the monthly clinic activity report',
    ],
    requirementsText: 'Administrative coordination and record-keeping accuracy.',
    city: 'Pune',
    workMode: 'ONSITE',
    employmentType: 'PART_TIME',
    salaryMin: 300000,
    salaryMax: 380000,
    experienceYearsMin: 1,
    experienceYearsMax: 5,
    reEntryFriendly: true,
    flexibleHours: true,
    returnshipProgram: false,
    skills: [
      { slug: 'administrative-support', requirement: 'REQUIRED', level: 'PROFICIENT', weight: 4 },
      { slug: 'scheduling-coordination', requirement: 'REQUIRED', level: 'PROFICIENT', weight: 5 },
      { slug: 'records-management', requirement: 'REQUIRED', level: 'PROFICIENT', weight: 4 },
      { slug: 'healthcare-coordination', requirement: 'REQUIRED', level: 'FUNCTIONAL', weight: 3 },
      { slug: 'data-privacy-security', requirement: 'PREFERRED', level: 'FUNCTIONAL', weight: 2 },
      { slug: 'empathy', requirement: 'PREFERRED', level: 'PROFICIENT', weight: 2 },
    ],
  },
  {
    org: 'ashford-health-trust',
    title: 'Accounts and Bookkeeping Specialist',
    description:
      'Day-to-day books for the clinic group: vendor payments, bank reconciliation, GST preparation and month-end support, all in Tally with a second reviewer on close.',
    responsibilities: [
      'Process vendor payments and receipts',
      'Reconcile three bank accounts monthly',
      'Prepare GST schedules for review',
      'Support month-end close and expense reporting',
    ],
    requirementsText: 'Bookkeeping accuracy with a working knowledge of Indian GST cycles.',
    city: 'Pune',
    workMode: 'HYBRID',
    employmentType: 'FULL_TIME',
    salaryMin: 400000,
    salaryMax: 540000,
    experienceYearsMin: 3,
    experienceYearsMax: 10,
    reEntryFriendly: true,
    flexibleHours: false,
    returnshipProgram: false,
    skills: [
      { slug: 'bookkeeping', requirement: 'REQUIRED', level: 'PROFICIENT', weight: 5 },
      { slug: 'financial-literacy', requirement: 'REQUIRED', level: 'PROFICIENT', weight: 4 },
      { slug: 'accounting-software', requirement: 'REQUIRED', level: 'PROFICIENT', weight: 4 },
      { slug: 'attention-to-detail', requirement: 'REQUIRED', level: 'PROFICIENT', weight: 3 },
      { slug: 'excel', requirement: 'PREFERRED', level: 'PROFICIENT', weight: 2 },
      { slug: 'reporting', requirement: 'PREFERRED', level: 'FUNCTIONAL', weight: 2 },
    ],
  },
  {
    org: 'northwind-logistics',
    title: 'HR Coordinator',
    description:
      'Own scheduling and onboarding for a hiring pipeline of about 40 roles a year, keep the people records clean, and be the compliance checkpoint for documentation.',
    responsibilities: [
      'Schedule interviews across three sites',
      'Run onboarding checklists and documentation',
      'Maintain accurate employee records',
      'Support statutory compliance reporting',
    ],
    requirementsText: 'Recruitment coordination and record discipline.',
    city: 'Delhi',
    workMode: 'HYBRID',
    employmentType: 'PART_TIME',
    salaryMin: 340000,
    salaryMax: 460000,
    experienceYearsMin: 3,
    experienceYearsMax: 12,
    reEntryFriendly: true,
    flexibleHours: true,
    returnshipProgram: false,
    skills: [
      { slug: 'recruitment', requirement: 'REQUIRED', level: 'PROFICIENT', weight: 5 },
      { slug: 'scheduling-coordination', requirement: 'REQUIRED', level: 'PROFICIENT', weight: 4 },
      { slug: 'hr-policy-compliance', requirement: 'REQUIRED', level: 'FUNCTIONAL', weight: 3 },
      { slug: 'records-management', requirement: 'REQUIRED', level: 'PROFICIENT', weight: 3 },
      { slug: 'hr-payroll-systems', requirement: 'PREFERRED', level: 'PROFICIENT', weight: 2 },
      { slug: 'stakeholder-management', requirement: 'PREFERRED', level: 'PROFICIENT', weight: 2 },
    ],
  },
  {
    org: 'ashford-health-trust',
    title: 'Patient Experience Associate',
    description:
      'First point of contact for two clinics: handle enquiries and complaints, keep appointment flow sensible, and make sure nothing gets lost between departments.',
    responsibilities: [
      'Handle patient enquiries by phone and email',
      'Resolve or escalate complaints',
      'Coordinate referral hand-offs',
      'Track satisfaction follow-ups',
    ],
    requirementsText: 'Service recovery and clear written communication.',
    city: 'Pune',
    workMode: 'ONSITE',
    employmentType: 'FULL_TIME',
    salaryMin: 280000,
    salaryMax: 360000,
    experienceYearsMin: 1,
    experienceYearsMax: 6,
    reEntryFriendly: true,
    flexibleHours: true,
    returnshipProgram: true,
    skills: [
      { slug: 'customer-service', requirement: 'REQUIRED', level: 'PROFICIENT', weight: 5 },
      { slug: 'empathy', requirement: 'REQUIRED', level: 'PROFICIENT', weight: 4 },
      { slug: 'written-communication', requirement: 'REQUIRED', level: 'PROFICIENT', weight: 3 },
      { slug: 'conflict-resolution', requirement: 'REQUIRED', level: 'FUNCTIONAL', weight: 3 },
      { slug: 'multilingual-coordination', requirement: 'PREFERRED', level: 'FUNCTIONAL', weight: 2 },
    ],
  },
  {
    org: 'ashford-health-trust',
    title: 'Patient Data Reporting Associate',
    description:
      'Turn clinic activity data into the monthly report each practice manager acts on: extract, clean, summarise, and explain the numbers in plain language to a non-technical audience.',
    responsibilities: [
      'Build the monthly clinic activity report',
      'Clean and validate incoming extracts',
      'Document what each metric means',
      'Present findings to two practice managers',
    ],
    requirementsText: 'Analytical care with the ability to explain a number to a clinician.',
    city: 'Pune',
    workMode: 'HYBRID',
    employmentType: 'FULL_TIME',
    salaryMin: 420000,
    salaryMax: 560000,
    experienceYearsMin: 2,
    experienceYearsMax: 7,
    reEntryFriendly: true,
    flexibleHours: true,
    returnshipProgram: true,
    skills: [
      { slug: 'data-analysis', requirement: 'REQUIRED', level: 'PROFICIENT', weight: 5 },
      { slug: 'excel', requirement: 'REQUIRED', level: 'PROFICIENT', weight: 4 },
      { slug: 'reporting', requirement: 'REQUIRED', level: 'PROFICIENT', weight: 4 },
      { slug: 'records-management', requirement: 'REQUIRED', level: 'FUNCTIONAL', weight: 3 },
      { slug: 'database-management', requirement: 'PREFERRED', level: 'FUNCTIONAL', weight: 2 },
      { slug: 'written-communication', requirement: 'PREFERRED', level: 'PROFICIENT', weight: 2 },
    ],
  },
  {
    // Deliberately worded the way a real exclusionary posting is worded, so
    // agent 4 has something genuine to flag and the review queue is not empty.
    // The moderation screen and the posting-review panel both label it as such.
    org: 'meridian-media',
    title: 'Brand Marketing Lead (demonstration of exclusionary wording)',
    description:
      'We are looking for a high-energy culture fit who has been working continuously in brand marketing for the last five years with no career breaks. You must hold a full-time degree from a Tier-1 college and be comfortable travelling to client sites at short notice, including weekends. Candidates who have been out of the industry will not be considered, and we move fast — you should be available to start immediately in our Pune office.',
    responsibilities: [
      'Own brand campaigns end to end for two consumer clients',
      'Present directly to founders who expect polish from day one',
      'Be the face of the team at industry events',
    ],
    requirementsText:
      'Minimum 8 years of continuous, unbroken agency-side experience. Recent graduates without a full-time degree need not apply. Must fit our 24/7 hustle culture.',
    city: 'Pune',
    workMode: 'ONSITE',
    employmentType: 'FULL_TIME',
    salaryMin: 1200000,
    salaryMax: 1800000,
    experienceYearsMin: 8,
    experienceYearsMax: 15,
    reEntryFriendly: false,
    flexibleHours: false,
    returnshipProgram: false,
    skills: [
      { slug: 'content-creation', requirement: 'REQUIRED', level: 'PROFICIENT', weight: 5 },
      { slug: 'presentation-skills', requirement: 'REQUIRED', level: 'PROFICIENT', weight: 4 },
      { slug: 'marketing-fundamentals', requirement: 'REQUIRED', level: 'ADVANCED', weight: 4 },
      { slug: 'stakeholder-management', requirement: 'PREFERRED', level: 'PROFICIENT', weight: 2 },
    ],
  },
  {
    org: 'meridian-media',
    title: 'Marketing Operations Coordinator',
    description:
      'Keep four brand programmes moving: brief agency partners, hold the shared calendar, track spend against budget and publish the weekly performance readout. We assess the skills listed here, not whether your CV is continuous.',
    responsibilities: [
      'Own the cross-team campaign calendar and dependencies',
      'Brief and follow up with two agency partners',
      'Track programme spend against the approved budget',
      'Publish the weekly performance readout',
    ],
    requirementsText: 'Coordination depth and clear written updates; any sector counts.',
    city: 'Mumbai',
    workMode: 'HYBRID',
    employmentType: 'FULL_TIME',
    salaryMin: 520000,
    salaryMax: 680000,
    experienceYearsMin: 2,
    experienceYearsMax: 8,
    reEntryFriendly: true,
    flexibleHours: true,
    returnshipProgram: true,
    skills: [
      { slug: 'project-coordination', requirement: 'REQUIRED', level: 'PROFICIENT', weight: 5 },
      { slug: 'scheduling-coordination', requirement: 'REQUIRED', level: 'PROFICIENT', weight: 4 },
      { slug: 'reporting', requirement: 'REQUIRED', level: 'FUNCTIONAL', weight: 3 },
      { slug: 'stakeholder-management', requirement: 'REQUIRED', level: 'FUNCTIONAL', weight: 3 },
      { slug: 'excel', requirement: 'PREFERRED', level: 'PROFICIENT', weight: 2 },
      { slug: 'data-analysis', requirement: 'PREFERRED', level: 'FUNCTIONAL', weight: 2 },
    ],
  },
  {
    org: 'meridian-media',
    title: 'Digital Marketing Executive',
    description:
      'Write, publish and measure content for consumer brands. You will own a content calendar, draft campaign copy and turn performance into a short weekly note the client can act on.',
    responsibilities: [
      'Maintain the content calendar for two accounts',
      'Draft campaign copy and creative briefs',
      'Publish and check tracking links',
      'Summarise performance in a weekly note',
    ],
    requirementsText: 'Strong written communication and a portfolio of anything you have published.',
    city: 'Mumbai',
    workMode: 'HYBRID',
    employmentType: 'FULL_TIME',
    salaryMin: 420000,
    salaryMax: 560000,
    experienceYearsMin: 1,
    experienceYearsMax: 6,
    reEntryFriendly: true,
    flexibleHours: true,
    returnshipProgram: false,
    skills: [
      { slug: 'content-creation', requirement: 'REQUIRED', level: 'PROFICIENT', weight: 5 },
      { slug: 'marketing-fundamentals', requirement: 'REQUIRED', level: 'FUNCTIONAL', weight: 4 },
      { slug: 'written-communication', requirement: 'REQUIRED', level: 'PROFICIENT', weight: 4 },
      { slug: 'excel', requirement: 'REQUIRED', level: 'FUNCTIONAL', weight: 2 },
      { slug: 'crm-software', requirement: 'PREFERRED', level: 'FUNCTIONAL', weight: 2 },
      { slug: 'data-analysis', requirement: 'PREFERRED', level: 'FUNCTIONAL', weight: 2 },
    ],
  },
  {
    org: 'meridian-media',
    title: 'Campaign Performance Analyst',
    description:
      'Measure what our campaigns actually did: pull the numbers, check they are trustworthy, and explain the movement to a client who is not an analyst.',
    responsibilities: [
      'Build and QA campaign performance extracts',
      'Maintain the channel measurement model',
      'Explain month-on-month movement in writing',
      'Flag data quality problems before they reach a client',
    ],
    requirementsText: 'Analytical rigour and the ability to explain a number clearly.',
    city: 'Mumbai',
    workMode: 'REMOTE',
    employmentType: 'PART_TIME',
    salaryMin: 480000,
    salaryMax: 640000,
    experienceYearsMin: 2,
    experienceYearsMax: 9,
    reEntryFriendly: true,
    flexibleHours: true,
    returnshipProgram: false,
    skills: [
      { slug: 'data-analysis', requirement: 'REQUIRED', level: 'PROFICIENT', weight: 5 },
      { slug: 'excel', requirement: 'REQUIRED', level: 'ADVANCED', weight: 4 },
      { slug: 'reporting', requirement: 'REQUIRED', level: 'PROFICIENT', weight: 3 },
      { slug: 'marketing-fundamentals', requirement: 'REQUIRED', level: 'FUNCTIONAL', weight: 3 },
      { slug: 'database-management', requirement: 'PREFERRED', level: 'FUNCTIONAL', weight: 2 },
      { slug: 'presentation-skills', requirement: 'PREFERRED', level: 'FUNCTIONAL', weight: 2 },
    ],
  },
  {
    org: 'lumen-analytics',
    title: 'Reporting Analyst',
    description:
      'Turn messy non-profit data into reports their boards act on. SQL for extraction, Python for cleaning, a dashboard on top, and clear written definitions underneath.',
    responsibilities: [
      'Write and maintain SQL extractions',
      'Build and refresh reporting dashboards',
      'Document metric definitions',
      'Present monthly findings to two clients',
    ],
    requirementsText: 'Analytical rigour and the ability to explain a number to a non-analyst.',
    city: 'Hyderabad',
    workMode: 'REMOTE',
    employmentType: 'CONTRACT',
    salaryMin: 500000,
    salaryMax: 700000,
    experienceYearsMin: 2,
    experienceYearsMax: 8,
    reEntryFriendly: true,
    flexibleHours: true,
    returnshipProgram: false,
    skills: [
      { slug: 'data-analysis', requirement: 'REQUIRED', level: 'PROFICIENT', weight: 5 },
      { slug: 'database-management', requirement: 'REQUIRED', level: 'FUNCTIONAL', weight: 4 },
      { slug: 'reporting', requirement: 'REQUIRED', level: 'PROFICIENT', weight: 4 },
      { slug: 'excel', requirement: 'REQUIRED', level: 'ADVANCED', weight: 3 },
      { slug: 'programming', requirement: 'PREFERRED', level: 'FUNCTIONAL', weight: 3 },
      { slug: 'presentation-skills', requirement: 'PREFERRED', level: 'FUNCTIONAL', weight: 2 },
    ],
  },
]

// ---------------------------------------------------------------------------
// Learning resources (catalogue entries, marked as demonstration data)
// ---------------------------------------------------------------------------

const RESOURCES: {
  title: string
  provider: string
  url: string | null
  type: 'COURSE' | 'MICRO_CREDENTIAL' | 'CERTIFICATION' | 'WORKSHOP' | 'BOOTCAMP' | 'MENTORSHIP' | 'PRACTICE_PROJECT' | 'READING'
  format: 'SELF_PACED' | 'INSTRUCTOR_LED' | 'COHORT' | 'ONE_ON_ONE'
  skill: string
  targetLevel: ProficiencyLevel
  outcome: string
  hours: number
  isFree: boolean
  cost: string
}[] = [
  { title: 'Spreadsheet modelling for operations reporting', provider: 'Open learning catalogue', url: null, type: 'COURSE', format: 'SELF_PACED', skill: 'excel', targetLevel: 'PROFICIENT', outcome: 'Build a pivot-based weekly report with validated inputs.', hours: 9, isFree: true, cost: 'Free' },
  { title: 'Advanced Excel: lookups, pivots and dashboards', provider: 'FreeCodeCamp', url: 'https://www.freecodecamp.org', type: 'COURSE', format: 'SELF_PACED', skill: 'excel', targetLevel: 'ADVANCED', outcome: 'Produce a management dashboard from a raw extract.', hours: 18, isFree: true, cost: 'Free' },
  { title: 'Inventory and stock control essentials', provider: 'Operations learning library', url: null, type: 'MICRO_CREDENTIAL', format: 'SELF_PACED', skill: 'inventory-resource-management', targetLevel: 'PROFICIENT', outcome: 'Run cycle counts and reconcile variance.', hours: 12, isFree: false, cost: 'Low cost' },
  { title: 'Supplier negotiation for coordinators', provider: 'Open learning catalogue', url: null, type: 'WORKSHOP', format: 'COHORT', skill: 'vendor-supplier-management', targetLevel: 'PROFICIENT', outcome: 'Prepare a BATNA and run a supplier call.', hours: 6, isFree: false, cost: 'Low cost' },
  { title: 'Writing reports stakeholders act on', provider: 'Plain language writing project', url: null, type: 'COURSE', format: 'SELF_PACED', skill: 'reporting', targetLevel: 'PROFICIENT', outcome: 'Structure a one-page weekly update.', hours: 7, isFree: true, cost: 'Free' },
  { title: 'Bookkeeping fundamentals with a ledger project', provider: 'Accounting skills collective', url: null, type: 'COURSE', format: 'SELF_PACED', skill: 'bookkeeping', targetLevel: 'PROFICIENT', outcome: 'Post, reconcile and close a small ledger.', hours: 20, isFree: true, cost: 'Free' },
  { title: 'GST preparation practice set', provider: 'Compliance practice library', url: null, type: 'PRACTICE_PROJECT', format: 'SELF_PACED', skill: 'financial-literacy', targetLevel: 'PROFICIENT', outcome: 'Assemble a reviewable GST schedule.', hours: 10, isFree: false, cost: 'Low cost' },
  { title: 'Tally for reporting teams', provider: 'Practice software library', url: null, type: 'WORKSHOP', format: 'INSTRUCTOR_LED', skill: 'accounting-software', targetLevel: 'PROFICIENT', outcome: 'Drive daily ledger work without a consultant.', hours: 8, isFree: false, cost: 'Low cost' },
  { title: 'Customer service recovery masterclass', provider: 'Khan Academy', url: 'https://www.khanacademy.org', type: 'COURSE', format: 'SELF_PACED', skill: 'customer-service', targetLevel: 'ADVANCED', outcome: 'De-escalate and close a complaint with a documented outcome.', hours: 11, isFree: true, cost: 'Free' },
  { title: 'Leading a small support pod', provider: 'Team leadership series', url: null, type: 'MENTORSHIP', format: 'ONE_ON_ONE', skill: 'team-leadership', targetLevel: 'PROFICIENT', outcome: 'Run weekly 1:1s and a service-level review.', hours: 14, isFree: false, cost: 'Mentor programme' },
  { title: 'Coaching new joiners in their first month', provider: 'Open learning catalogue', url: null, type: 'COURSE', format: 'SELF_PACED', skill: 'mentoring', targetLevel: 'PROFICIENT', outcome: 'Design a four-week ramp-up plan.', hours: 5, isFree: true, cost: 'Free' },
  { title: 'Salesforce administrator basics', provider: 'Coursera', url: 'https://www.coursera.org', type: 'COURSE', format: 'SELF_PACED', skill: 'crm-software', targetLevel: 'PROFICIENT', outcome: 'Manage cases, queues and reports in a CRM.', hours: 22, isFree: false, cost: 'Audit free' },
  { title: 'Business writing for service teams', provider: 'Plain language writing project', url: null, type: 'COURSE', format: 'SELF_PACED', skill: 'written-communication', targetLevel: 'ADVANCED', outcome: 'Write a clear response that ends the thread.', hours: 6, isFree: true, cost: 'Free' },
  { title: 'Conflict resolution in service settings', provider: 'Mediation skills library', url: null, type: 'WORKSHOP', format: 'COHORT', skill: 'conflict-resolution', targetLevel: 'PROFICIENT', outcome: 'Handle a heated call without escalation.', hours: 4, isFree: false, cost: 'Low cost' },
  { title: 'SQL for reporting', provider: 'edX', url: 'https://www.edx.org', type: 'COURSE', format: 'SELF_PACED', skill: 'database-management', targetLevel: 'FUNCTIONAL', outcome: 'Write joins and aggregates for a reporting extract.', hours: 16, isFree: true, cost: 'Audit free' },
  { title: 'Python data cleaning practice set', provider: 'FreeCodeCamp', url: 'https://www.freecodecamp.org', type: 'PRACTICE_PROJECT', format: 'SELF_PACED', skill: 'programming', targetLevel: 'FUNCTIONAL', outcome: 'Clean and validate a real messy dataset.', hours: 20, isFree: true, cost: 'Free' },
  { title: 'Statistics for reporting analysts', provider: 'Khan Academy', url: 'https://www.khanacademy.org', type: 'COURSE', format: 'SELF_PACED', skill: 'data-analysis', targetLevel: 'PROFICIENT', outcome: 'Choose the right summary and defend it.', hours: 24, isFree: true, cost: 'Free' },
  { title: 'Presenting findings to non-analysts', provider: 'Communication skills series', url: null, type: 'WORKSHOP', format: 'INSTRUCTOR_LED', skill: 'presentation-skills', targetLevel: 'PROFICIENT', outcome: 'Run a ten-minute insight readout.', hours: 5, isFree: false, cost: 'Low cost' },
  { title: 'Recruitment coordination workshop', provider: 'Hiring practice library', url: null, type: 'WORKSHOP', format: 'COHORT', skill: 'recruitment', targetLevel: 'PROFICIENT', outcome: 'Run a two-week interview loop cleanly.', hours: 8, isFree: false, cost: 'Low cost' },
  { title: 'HR compliance in practice', provider: 'People policy library', url: null, type: 'COURSE', format: 'SELF_PACED', skill: 'hr-policy-compliance', targetLevel: 'PROFICIENT', outcome: 'Check a file set against statutory requirements.', hours: 12, isFree: false, cost: 'Low cost' },
  { title: 'HRIS and payroll systems orientation', provider: 'Practice software library', url: null, type: 'MICRO_CREDENTIAL', format: 'SELF_PACED', skill: 'hr-payroll-systems', targetLevel: 'PROFICIENT', outcome: 'Drive core HRIS transactions unaided.', hours: 9, isFree: true, cost: 'Free' },
  { title: 'Confidential records management', provider: 'Records practice network', url: null, type: 'COURSE', format: 'SELF_PACED', skill: 'records-management', targetLevel: 'ADVANCED', outcome: 'Design a retrievable, lawful filing scheme.', hours: 7, isFree: true, cost: 'Free' },
  { title: 'Healthcare appointment coordination', provider: 'Clinic operations library', url: null, type: 'COURSE', format: 'SELF_PACED', skill: 'healthcare-coordination', targetLevel: 'PROFICIENT', outcome: 'Coordinate multi-specialist care schedules.', hours: 10, isFree: false, cost: 'Low cost' },
  { title: 'Data protection for administrators', provider: 'Open learning catalogue', url: null, type: 'MICRO_CREDENTIAL', format: 'SELF_PACED', skill: 'data-privacy-security', targetLevel: 'PROFICIENT', outcome: 'Apply a lawful basis and document it.', hours: 6, isFree: true, cost: 'Free' },
  { title: 'Coordination practice project: school-run logistics', provider: 'Transferable skills project set', url: null, type: 'PRACTICE_PROJECT', format: 'SELF_PACED', skill: 'scheduling-coordination', targetLevel: 'ADVANCED', outcome: 'Model a repeatable multi-person schedule with constraints.', hours: 6, isFree: true, cost: 'Free' },
  { title: 'Stakeholder management for coordinators', provider: 'Communication skills series', url: null, type: 'WORKSHOP', format: 'COHORT', skill: 'stakeholder-management', targetLevel: 'PROFICIENT', outcome: 'Run a status update across three competing owners.', hours: 4, isFree: false, cost: 'Low cost' },
  { title: 'Problem solving with structured root-cause', provider: 'Improvement methods library', url: null, type: 'COURSE', format: 'SELF_PACED', skill: 'problem-solving', targetLevel: 'PROFICIENT', outcome: 'Run a five-why on a recurring defect.', hours: 8, isFree: true, cost: 'Free' },
  { title: 'Empathy in service conversations', provider: 'Service practice network', url: null, type: 'READING', format: 'SELF_PACED', skill: 'empathy', targetLevel: 'PROFICIENT', outcome: 'Name the emotion and the ask in one reply.', hours: 3, isFree: true, cost: 'Free' },
]

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

async function seedRoles() {
  const definitions = [
    { role: 'CANDIDATE' as const, label: 'Candidate', description: 'A professional returning to work after a break.', permissions: CANDIDATE_PERMISSIONS },
    { role: 'EMPLOYER' as const, label: 'Employer', description: 'A recruiter attached to a verified or pending organisation.', permissions: EMPLOYER_PERMISSIONS },
    { role: 'ADMIN' as const, label: 'Administrator', description: 'Platform operator with moderation and monitoring rights.', permissions: ADMIN_PERMISSIONS },
  ]

  for (const definition of definitions) {
    await prisma.roleDefinition.upsert({
      where: { role: definition.role },
      create: { role: definition.role, label: definition.label, description: definition.description },
      update: { label: definition.label, description: definition.description },
    })

    for (const permission of definition.permissions) {
      await prisma.rolePermission.upsert({
        where: { role_key: { role: definition.role, key: permission.id } },
        create: {
          role: definition.role,
          key: permission.id,
          label: permission.label,
          description: permission.description,
        },
        update: { label: permission.label, description: permission.description },
      })
    }
  }

  return definitions.reduce((total, definition) => total + definition.permissions.length, 0)
}

async function seedSkills() {
  for (const entry of SKILL_TAXONOMY) {
    await prisma.skill.upsert({
      where: { slug: entry.slug },
      create: {
        name: entry.name,
        slug: entry.slug,
        category: entry.category,
        transferable: entry.transferable,
        description: entry.description,
        aliases: entry.aliases,
        relatedSlugs: entry.relatedSlugs,
      },
      update: {
        name: entry.name,
        category: entry.category,
        transferable: entry.transferable,
        description: entry.description,
        aliases: entry.aliases,
        relatedSlugs: entry.relatedSlugs,
      },
    })
  }
  return SKILL_TAXONOMY.length
}

async function seedResources(skillIds: Map<string, string>) {
  let created = 0
  for (const resource of RESOURCES) {
    const existing = await prisma.learningResource.findFirst({ where: { title: resource.title } })
    if (existing) continue
    await prisma.learningResource.create({
      data: {
        title: resource.title,
        provider: resource.provider,
        url: resource.url,
        type: resource.type,
        format: resource.format,
        skillId: skillIds.get(resource.skill) ?? null,
        targetLevel: resource.targetLevel,
        outcome: resource.outcome,
        durationHours: resource.hours,
        costLabel: resource.cost,
        isFree: resource.isFree,
        demonstration: true,
      },
    })
    created += 1
  }
  return created
}

/**
 * Practice assessments. These are authored here, not generated: a question set
 * is content a human wrote, and the pass mark decides when a skill may be
 * labelled assessment-verified. Marked `demonstration` because they exist to
 * show the flow, not to certify anyone.
 */
const ASSESSMENTS: {
  slug: string
  title: string
  instructions: string
  passMark: number
  questions: { prompt: string; options: string[]; correctIndex: number; explanation: string }[]
}[] = [
  {
    slug: 'excel',
    title: 'Spreadsheet analysis — fundamentals',
    instructions:
      'Four scenario questions about the spreadsheet work a reporting role actually does. Answer from what you would do, not what you have read about. Nothing here is proctored.',
    passMark: 0.75,
    questions: [
      {
        prompt:
          'A pivot table shows a campaign row as “(blank)” in the region column. What is the cleanest first fix?',
        options: [
          'Delete the rows with blanks so the totals look right',
          'Trace the source cells: the region is missing at entry, so fix the source or label it explicitly',
          'Filter the pivot to hide blanks',
          'Replace the pivot with SUMIF formulas',
        ],
        correctIndex: 1,
        explanation:
          'A blank in a pivot is a data-entry gap. Deleting or hiding it changes the answer without fixing the cause; labelling it keeps the report honest.',
      },
      {
        prompt: 'Two sheets hold the same spend figures and they disagree by 4%. What do you do before reporting?',
        options: [
          'Use whichever matches last month’s number',
          'Average them',
          'Reconcile line by line to find which feed is stale, then state in the note which source is authoritative',
          'Ask the reader to allow a tolerance',
        ],
        correctIndex: 2,
        explanation:
          'Reconciling and documenting the chosen source is the reporting job. Silent averaging hides the discrepancy that someone downstream will find.',
      },
      {
        prompt: 'Which formula sums spend for a channel AND a specified region?',
        options: ['=SUMIF(channels, channel, spend)', '=SUMIFS(spend, channels, channel, regions, region)', '=COUNTIF(channels, channel)', '=VLOOKUP(channel, channels, 2)'],
        correctIndex: 1,
        explanation:
          'SUMIFS applies both channel and region criteria. SUMIF only applies the channel criterion here; COUNTIF counts rows and VLOOKUP retrieves a value rather than aggregating both conditions.',
      },
      {
        prompt: 'A stakeholder asks for “the same report but weekly”. The file is built on monthly aggregates. What is the right move?',
        options: [
          'Divide the monthly figure by 4.3 and label it weekly',
          'Rebuild from the transaction rows at week grain, then check the weekly totals still sum to the monthly control total',
          'Send the monthly report with a note',
          'Ask them to wait a quarter',
        ],
        correctIndex: 1,
        explanation:
          'A derived weekly figure from a monthly aggregate is an estimate dressed as data. Rebuilding at the right grain and tying back to a control total is the verifiable route.',
      },
    ],
  },
  {
    slug: 'stakeholder-management',
    title: 'Stakeholder coordination — judgement set',
    instructions:
      'Four situations. Pick the response that keeps the work moving and the relationship intact. There is no time limit and no invigilator.',
    passMark: 0.75,
    questions: [
      {
        prompt:
          'Two team leads have agreed different dates for the same handover, and both believe the other agreed. What do you do first?',
        options: [
          'Pick the earlier date and tell both',
          'Put the two dependencies side by side, show the conflict, and ask them to settle it in one conversation you host',
          'Escalate to their manager',
          'Send the plan with both dates',
        ],
        correctIndex: 1,
        explanation:
          'Naming the conflict and hosting the resolution keeps the decision with the people who own the work. Choosing silently or escalating both cost credibility.',
      },
      {
        prompt: 'A vendor is a day late with an asset you need for a launch that cannot move. Best first action?',
        options: [
          'Move the launch',
          'Ask for a partial or lower-fidelity asset that unblocks the launch, and get the revised vendor date in writing',
          'Wait until end of day',
          'Complain to the vendor’s account manager',
        ],
        correctIndex: 1,
        explanation:
          'A workable substitute plus a written commitment protects the deadline and the relationship; waiting or complaining protects neither.',
      },
      {
        prompt: 'An executive keeps asking for updates you already send. What changes?',
        options: [
          'Send them more often',
          'Ask what decision they are trying to make, then put that measure at the top of the existing update',
          'Stop sending updates',
          'Ask them to read the report',
        ],
        correctIndex: 1,
        explanation:
          'Repeated requests usually mean the update answers the wrong question. Leading with their decision measure ends the loop.',
      },
      {
        prompt: 'You promised a team feedback “by Friday”, and you will miss it by two days. What do you do?',
        options: [
          'Say nothing until it is ready',
          'Tell them before Friday, give the new date and the reason, and offer the part you do have',
          'Deliver on Friday and apologise afterwards',
          'Ask them to wait for the full version',
        ],
        correctIndex: 1,
        explanation:
          'Advance notice with a specific new date is what keeps a commitment credible. Partial delivery is often enough to unblock them.',
      },
    ],
  },
]

async function seedAssessments(skillIds: Map<string, string>) {
  let count = 0
  for (const definition of ASSESSMENTS) {
    const skillId = skillIds.get(definition.slug)
    if (!skillId) continue
    const existing = await prisma.assessment.findFirst({ where: { skillId, title: definition.title } })
    if (existing) continue

    await prisma.assessment.create({
      data: {
        skillId,
        title: definition.title,
        instructions: definition.instructions,
        questionCount: definition.questions.length,
        passMark: definition.passMark,
        isActive: true,
        demonstration: true,
        questions: {
          create: definition.questions.map((question, index) => ({
            position: index + 1,
            prompt: question.prompt,
            options: question.options,
            correctIndex: question.correctIndex,
            explanation: question.explanation,
          })),
        },
      },
    })
    count += 1
  }
  return count
}

/**
 * The MVP weight set is stored rather than hard-coded, so the admin screen shows
 * a versioned profile and every match row can name the assumption that produced
 * it. These values are a prototype choice, and the note says so.
 */
async function seedWeightProfile(adminId: string) {
  const existing = await prisma.weightProfile.findFirst({ where: { version: WEIGHT_VERSION } })
  if (existing) return existing

  return prisma.weightProfile.create({
    data: {
      version: WEIGHT_VERSION,
      label: 'MVP prototype weights — skills-first',
      required: 0.5,
      preferred: 0.2,
      evidence: 0.2,
      preferences: 0.1,
      active: true,
      note: 'Configurable prototype assumptions from the product brief, not a validated hiring instrument. Required coverage is held at or above 30% so a match stays skills-first.',
      createdById: adminId,
    },
  })
}

async function main() {
  console.log('SYPRUS seed — writing DEMONSTRATION data only.')
  console.log(`  target: ${target.host}:${target.port}/${target.database}`)

  await prisma.$transaction([
    prisma.assessmentResponse.deleteMany({}),
    prisma.assessmentAttempt.deleteMany({}),
    prisma.assessmentQuestion.deleteMany({}),
    prisma.assessment.deleteMany({}),
    prisma.evidenceUpload.deleteMany({}),
    prisma.aiProposal.deleteMany({}),
    prisma.languageReview.deleteMany({}),
    prisma.marketInsight.deleteMany({}),
    prisma.orchestrationStep.deleteMany({}),
    prisma.orchestrationRun.deleteMany({}),
    prisma.reviewTask.deleteMany({}),
    prisma.aiRun.deleteMany({}),
    prisma.graphAnnotation.deleteMany({}),
    prisma.identityDisclosureRequest.deleteMany({}),
    prisma.weightProfile.deleteMany({}),
    prisma.applicationStatusEvent.deleteMany({}),
    prisma.application.deleteMany({}),
    prisma.shortlistEntry.deleteMany({}),
    prisma.shortlist.deleteMany({}),
    prisma.match.deleteMany({}),
    prisma.profileView.deleteMany({}),
    prisma.learningPlanItem.deleteMany({}),
    prisma.learningPlan.deleteMany({}),
    prisma.skillGapReport.deleteMany({}),
    prisma.skillEvidence.deleteMany({}),
    prisma.candidateSkill.deleteMany({}),
    prisma.experience.deleteMany({}),
    prisma.message.deleteMany({}),
    prisma.conversation.deleteMany({}),
    prisma.notification.deleteMany({}),
    prisma.consentRecord.deleteMany({}),
    prisma.jobSkill.deleteMany({}),
    prisma.job.deleteMany({}),
    prisma.organization.deleteMany({}),
    prisma.user.deleteMany({}),
    prisma.auditEvent.deleteMany({}),
    prisma.engineRun.deleteMany({}),
    prisma.learningResource.deleteMany({}),
  ])

  const permissionCount = await seedRoles()
  const skillCount = await seedSkills()

  const skills = await prisma.skill.findMany({ select: { id: true, slug: true, name: true, category: true, transferable: true } })
  const skillIds = new Map(skills.map((skill) => [skill.slug, skill.id]))
  const skillBySlug = new Map(skills.map((skill) => [skill.slug, skill]))

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12)

  // Administrator
  const admin = await prisma.user.create({
    data: {
      email: 'admin@syprus.example.com',
      name: 'Platform Administrator (demonstration)',
      role: 'ADMIN',
      status: 'ACTIVE',
      passwordHash,
      emailVerifiedAt: new Date(),
    },
  })

  // Organisations and employer accounts
  const organisations = new Map<string, string>()
  for (const definition of ORGANISATIONS) {
    const owner = await prisma.user.create({
      data: {
        email: definition.email,
        name: definition.name2,
        role: 'EMPLOYER',
        status: 'ACTIVE',
        passwordHash,
        emailVerifiedAt: new Date(),
      },
    })

    const organization = await prisma.organization.create({
      data: {
        name: definition.name,
        slug: definition.slug,
        website: definition.website,
        industry: definition.industry,
        sizeLabel: definition.sizeLabel,
        locationCity: definition.city,
        locationCountry: definition.country,
        description: definition.description,
        flexPolicy: definition.flexPolicy,
        returnshipNote: definition.returnshipNote,
        verificationStatus: definition.verification,
        verifiedAt: definition.verification === 'VERIFIED' ? monthsAgo(4) : null,
        verifiedById: definition.verification === 'VERIFIED' ? admin.id : null,
        verificationNote:
          definition.verification === 'VERIFIED'
            ? 'Demonstration organisation verified during seeding.'
            : 'Demonstration organisation awaiting verification — its roles stay unpublished.',
        ownerUserId: owner.id,
      },
    })
    organisations.set(definition.slug, organization.id)
  }

  // Roles
  const createdJobs: { id: string; organizationId: string; title: string; skills: DemoJobSkill[]; experienceYearsMin: number; experienceYearsMax: number }[] = []
  for (const job of JOBS) {
    const organizationId = organisations.get(job.org)
    if (!organizationId) continue
    const organizationVerified = ORGANISATIONS.find((entry) => entry.slug === job.org)?.verification === 'VERIFIED'

    const record = await prisma.job.create({
      data: {
        organizationId,
        title: job.title,
        description: job.description,
        responsibilities: job.responsibilities,
        requirementsText: job.requirementsText,
        locationCity: job.city,
        locationCountry: 'India',
        workMode: job.workMode,
        employmentType: job.employmentType,
        salaryMin: job.salaryMin,
        salaryMax: job.salaryMax,
        currency: 'INR',
        experienceYearsMin: job.experienceYearsMin,
        experienceYearsMax: job.experienceYearsMax,
        status: organizationVerified ? 'PUBLISHED' : 'PENDING_MODERATION',
        reEntryFriendly: job.reEntryFriendly,
        flexibleHours: job.flexibleHours,
        returnshipProgram: job.returnshipProgram,
        postedAt: organizationVerified ? monthsAgo(1) : null,
        closesAt: monthsAgo(-2),
        moderatedAt: organizationVerified ? monthsAgo(1) : null,
        moderatedById: organizationVerified ? admin.id : null,
        moderationNote: organizationVerified ? 'Demonstration role published during seeding.' : null,
      },
    })

    for (const skill of job.skills) {
      const skillId = skillIds.get(skill.slug)
      if (!skillId) {
        console.warn(`  skipped unknown skill slug in seed job: ${skill.slug}`)
        continue
      }
      await prisma.jobSkill.create({
        data: { jobId: record.id, skillId, level: skill.level, weight: skill.weight, requirement: skill.requirement },
      })
    }

    createdJobs.push({
      id: record.id,
      organizationId,
      title: job.title,
      skills: job.skills,
      experienceYearsMin: job.experienceYearsMin,
      experienceYearsMax: job.experienceYearsMax,
    })
  }

  const resourceCount = await seedResources(skillIds)
  const assessmentCount = await seedAssessments(skillIds)
  await seedWeightProfile(admin.id)

  // Candidates
  for (const candidate of CANDIDATES) {
    const user = await prisma.user.create({
      data: {
        email: candidate.email,
        name: candidate.name,
        role: 'CANDIDATE',
        status: 'ACTIVE',
        passwordHash,
        emailVerifiedAt: new Date(),
      },
    })

    const paidYears = candidate.paid?.years ?? 0
    const profile = await prisma.candidateProfile.create({
      data: {
        userId: user.id,
        anonymousHandle: anonymousHandle(user.id),
        headline: candidate.headline,
        summary: candidate.summary,
        locationCity: candidate.city,
        locationCountry: candidate.country,
        workPreference: candidate.workPreference,
        availabilityHours: candidate.availabilityHours,
        targetRole: candidate.targetRole,
        targetIndustry: candidate.targetIndustry,
        careerBreakMonths: candidate.breakMonths,
        breakReason: 'Demonstration record — caregiving and relocation.',
        returnTimeline: candidate.returnTimeline,
        yearsOfExperience: paidYears,
        educationSummary: candidate.education,
        sharingMode: candidate.sharingMode,
        visibleToEmployers: candidate.visible,
        onboardingComplete: true,
        profileCompletion: 100,
      },
    })

    for (const [type, granted] of [
      ['DATA_PROCESSING', true],
      ['SENSITIVE_DATA', true],
      ['ANONYMIZED_PROFILE_SHARING', candidate.visible],
      ['IDENTIFIED_PROFILE_SHARING', candidate.sharingMode === 'ANONYMOUS_WITH_APPLY'],
      ['RULE_BASED_INFERENCE', true],
      ['EMPLOYER_CONTACT', candidate.visible],
      ['PRODUCT_EMAILS', false],
      ['RESEARCH_CONTRIBUTION', true],
    ] as const) {
      await prisma.consentRecord.create({
        data: {
          userId: user.id,
          type,
          decision: granted ? 'GRANTED' : 'DECLINED',
          policyVersion: POLICY_VERSION,
        },
      })
    }

    if (candidate.paid) {
      await prisma.experience.create({
        data: {
          candidateProfileId: profile.id,
          type: 'PAID_EMPLOYMENT',
          title: candidate.paid.title,
          organization: candidate.paid.organization,
          description: candidate.paid.description,
          startDate: yearsAgo(paidYears + candidate.breakMonths / 12),
          endDate: monthsAgo(candidate.breakMonths),
          hoursPerWeek: 40,
          isCaregiving: false,
        },
      })
    }

    await prisma.experience.create({
      data: {
        candidateProfileId: profile.id,
        type: 'CAREGIVING',
        title: 'Caring and household responsibility',
        description: candidate.caregiving.description,
        startDate: monthsAgo(candidate.breakMonths),
        endDate: new Date(),
        ongoing: false,
        hoursPerWeek: 45,
        isCaregiving: true,
        achievements: `Responsibility areas recorded: ${candidate.caregiving.activities
          .map((key) => CAREGIVING_ACTIVITIES.find((activity) => activity.key === key)?.label ?? key)
          .join(', ')}.`,
      },
    })

    for (const skill of candidate.skills) {
      const skillId = skillIds.get(skill.slug)
      if (!skillId) continue
      const skillRow = skillBySlug.get(skill.slug)

      const candidateSkill = await prisma.candidateSkill.create({
        data: {
          candidateProfileId: profile.id,
          skillId,
          level: skill.level,
          confidence: skill.confidence,
          validationStatus: skill.evidence ? 'SELF_REPORTED' : 'RULE_INFERRED',
          source: skill.evidence ? 'MANUAL' : 'INFERENCE',
          note: skillRow ? `Claimed against ${skillRow.name.toLowerCase()}.` : null,
        },
      })

      await prisma.skillEvidence.create({
        data: {
          candidateSkillId: candidateSkill.id,
          type: skill.evidence ? 'PROJECT_ARTIFACT' : 'EXPERIENCE_DESCRIPTION',
          description:
            skill.evidence ??
            `Suggested from the wording in the candidate’s ${skillRow?.name.toLowerCase() ?? skill.slug} description.`,
        },
      })
      await prisma.candidateSkill.update({ where: { id: candidateSkill.id }, data: { evidenceCount: 1 } })
    }

    // ---- Matches, computed by the real matching engine -------------------
    const candidateSkillViews = candidate.skills
      .filter((skill) => skillBySlug.has(skill.slug))
      .map((skill) => {
        const row = skillBySlug.get(skill.slug)!
        return {
          slug: skill.slug,
          name: row.name,
          category: row.category,
          transferable: row.transferable,
          level: skill.level,
          confidence: skill.confidence,
          validationStatus: 'SELF_REPORTED' as const,
          evidenceCount: 1,
        }
      })

    const verifiedOrgIds = new Set(
      ORGANISATIONS.filter((org) => org.verification === 'VERIFIED')
        .map((org) => organisations.get(org.slug))
        .filter((id): id is string => Boolean(id)),
    )
    const publishedJobs = createdJobs.filter((job) => verifiedOrgIds.has(job.organizationId))

    for (const job of publishedJobs) {
      const jobSkills = job.skills
        .filter((skill) => skillBySlug.has(skill.slug))
        .map((skill) => ({
          slug: skill.slug,
          name: skillBySlug.get(skill.slug)!.name,
          level: skill.level,
          weight: skill.weight,
          requirement: skill.requirement,
        }))

      const scored = scoreMatch({
        candidateSkills: candidateSkillViews,
        jobSkills,
        yearsOfExperience: paidYears,
        experienceYearsMin: job.experienceYearsMin,
        experienceYearsMax: job.experienceYearsMax,
        modelVersion: MODEL_VERSION,
      })

      await prisma.match.create({
        data: {
          candidateProfileId: profile.id,
          jobId: job.id,
          score: scored.score,
          requiredScore: scored.requiredScore,
          preferredScore: scored.preferredScore,
          preferenceScore: scored.preferenceScore,
          evidenceScore: scored.evidenceScore,
          explanation: scored.explanation,
          modelVersion: MODEL_VERSION,
          status: 'COMPUTED',
        },
      })
    }

    // ---- Gap report and pathway for the target role ----------------------
    const targetJob =
      publishedJobs.find((job) => job.title === candidate.targetRole) ??
      publishedJobs.find((job) => job.title.startsWith(candidate.targetRole)) ??
      publishedJobs.find((job) => candidate.targetRole.startsWith(job.title)) ??
      publishedJobs[0]
    if (targetJob) {
      const jobSkills = targetJob.skills
        .filter((skill) => skillBySlug.has(skill.slug))
        .map((skill) => ({
          slug: skill.slug,
          name: skillBySlug.get(skill.slug)!.name,
          level: skill.level,
          weight: skill.weight,
          requirement: skill.requirement,
        }))

      const analysis = analyseGaps({
        candidateSkills: candidateSkillViews,
        targets: jobSkills,
        yearsOfExperience: paidYears,
        experienceYearsMin: targetJob.experienceYearsMin,
        contextLabel: targetJob.title,
      })

      const report = await prisma.skillGapReport.create({
        data: {
          candidateProfileId: profile.id,
          targetJobId: targetJob.id,
          readiness: analysis.readiness,
          readinessScore: analysis.readinessScore,
          strengths: analysis.strengths,
          gaps: analysis.gaps,
          transferables: analysis.transferables,
          scores: {
            coverage: analysis.coverage,
            evidenceQuality: analysis.evidenceQuality,
            experienceFit: analysis.experienceFit,
            contextLabel: analysis.contextLabel,
            note: analysis.generatedAtNote,
          },
        },
      })

      const catalogue = await prisma.learningResource.findMany({
        where: { skill: { slug: { in: analysis.gaps.map((gap) => gap.slug) } } },
        include: { skill: { select: { slug: true } } },
      })

      const plan = buildLearningPlan(analysis.gaps, catalogue.map(
        (resource) => ({
          id: resource.id,
          title: resource.title,
          provider: resource.provider,
          type: resource.type,
          format: resource.format,
          skillSlug: resource.skill?.slug ?? null,
          targetLevel: resource.targetLevel,
          durationHours: resource.durationHours,
          isFree: resource.isFree,
          costLabel: resource.costLabel,
          outcome: resource.outcome,
          url: resource.url,
          demonstration: resource.demonstration,
        }),
      ), targetJob.title)

      if (plan.items.length > 0) {
        const createdPlan = await prisma.learningPlan.create({
          data: {
            candidateProfileId: profile.id,
            userId: user.id,
            title: plan.title,
            goal: plan.goal,
            summary: plan.summary,
            status: 'ACTIVE',
            priority: 1,
            targetJobId: targetJob.id,
            generatedBy: 'PATHWAY_PLANNER_RULES',
          },
        })

        for (const item of plan.items) {
          await prisma.learningPlanItem.create({
            data: {
              planId: createdPlan.id,
              resourceId: item.resourceId,
              position: item.position,
              gapSkillSlug: item.gapSkillSlug,
              note: item.reason,
              status: item.position === 1 ? 'IN_PROGRESS' : 'NOT_STARTED',
            },
          })
        }
      }

      console.log(`  ${candidate.email}: readiness ${analysis.readiness}, ${analysis.gaps.length} gaps, plan steps ${plan.items.length}, report ${report.id.slice(0, 8)}`)
    }
  }

  // ---- Applications across three pipeline stages -------------------------
  const applications = await prisma.candidateProfile.findMany({
    select: { id: true, userId: true, user: { select: { email: true } } },
  })

  const jobByTitle = new Map(createdJobs.map((job) => [job.title, job]))
  const applicationPlan: { candidateEmail: string; jobTitle: string; status: 'SUBMITTED' | 'IN_REVIEW' | 'SHORTLISTED' | 'INTERVIEW_INVITED' }[] = [
    { candidateEmail: 'priya.n@example.com', jobTitle: 'Operations Coordinator', status: 'INTERVIEW_INVITED' },
    { candidateEmail: 'sana.q@example.com', jobTitle: 'Accounts and Bookkeeping Specialist', status: 'SHORTLISTED' },
    { candidateEmail: 'maria.d@example.com', jobTitle: 'Customer Service Team Lead (Returnship)', status: 'IN_REVIEW' },
    { candidateEmail: 'ananya.s@example.com', jobTitle: 'HR Coordinator', status: 'SUBMITTED' },
    { candidateEmail: 'anshika@example.com', jobTitle: 'Marketing Operations Coordinator', status: 'SHORTLISTED' },
    { candidateEmail: 'anshika@example.com', jobTitle: 'Campaign Performance Analyst', status: 'SUBMITTED' },
  ]

  for (const plan of applicationPlan) {
    const profile = applications.find((entry) => entry.user.email === plan.candidateEmail)
    const job = jobByTitle.get(plan.jobTitle)
    if (!profile || !job) continue

    const match = await prisma.match.findUnique({
      where: { candidateProfileId_jobId: { candidateProfileId: profile.id, jobId: job.id } },
    })

    const stages: ('SUBMITTED' | 'IN_REVIEW' | 'SHORTLISTED' | 'INTERVIEW_INVITED')[] = [
      'SUBMITTED',
      'IN_REVIEW',
      'SHORTLISTED',
      'INTERVIEW_INVITED',
    ]
    const targetIndex = stages.indexOf(plan.status)
    const sequence = stages.slice(0, targetIndex + 1)

    const application = await prisma.application.create({
      data: {
        candidateProfileId: profile.id,
        jobId: job.id,
        organizationId: job.organizationId,
        userId: profile.userId,
        status: plan.status,
        identityConsentAt: new Date(),
        coverLetter:
          'Demonstration cover note: my coordination and record-keeping work maps directly onto the skills listed for this role.',
        matchScoreSnapshot: match?.score ?? null,
        source: 'DIRECT',
        interviewScheduledAt: plan.status === 'INTERVIEW_INVITED' ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) : null,
        createdAt: monthsAgo(1),
      },
    })

    let previous: string | null = null
    for (const stage of sequence) {
      await prisma.applicationStatusEvent.create({
        data: {
          applicationId: application.id,
          fromStatus: previous ? (previous as (typeof stages)[number]) : undefined,
          toStatus: stage,
          note:
            stage === 'SUBMITTED'
              ? 'Submitted by the candidate.'
              : `Moved to ${stage.toLowerCase().replace(/_/g, ' ')} during demonstration pipeline setup.`,
          actorUserId: stage === 'SUBMITTED' ? profile.userId : admin.id,
          createdAt: new Date(Date.now() + stages.indexOf(stage) * 3 * 24 * 60 * 60 * 1000),
        },
      })
      previous = stage
    }
  }

  // ---- Notifications, audit and engine history --------------------------
  for (const profile of applications.slice(0, 4)) {
    await prisma.notification.create({
      data: {
        userId: profile.userId,
        type: 'NEW_MATCH',
        title: 'New roles matched to your skills',
        body: 'Demonstration notification generated by the seeded match run.',
        link: '/candidate/jobs',
      },
    })
  }

  const engineSeeds: { engine: 'SKILL_INFERENCE' | 'MATCHING' | 'GAP_ANALYSIS' | 'PATHWAY_PLANNER' | 'FAIRNESS_AUDIT'; processed: number; affected: number; duration: number }[] = [
    { engine: 'SKILL_INFERENCE', processed: CANDIDATES.length, affected: CANDIDATES.reduce((total, c) => total + c.skills.length, 0), duration: 340 },
    { engine: 'MATCHING', processed: publishedJobCount(), affected: CANDIDATES.length * createdJobs.length, duration: 1180 },
    { engine: 'GAP_ANALYSIS', processed: CANDIDATES.length, affected: CANDIDATES.length, duration: 260 },
    { engine: 'PATHWAY_PLANNER', processed: CANDIDATES.length, affected: CANDIDATES.length, duration: 190 },
    { engine: 'FAIRNESS_AUDIT', processed: 1, affected: 0, duration: 120 },
  ]

  function publishedJobCount() {
    return JOBS.filter((job) => ORGANISATIONS.find((org) => org.slug === job.org)?.verification === 'VERIFIED').length
  }

  for (const seed of engineSeeds) {
    const startedAt = new Date(Date.now() - seed.duration)
    await prisma.engineRun.create({
      data: {
        engine: seed.engine,
        status: 'SUCCESS',
        mode: 'RULE_BASED',
        itemsProcessed: seed.processed,
        itemsAffected: seed.affected,
        durationMs: seed.duration,
        modelVersion: MODEL_VERSION,
        inputSummary: { seeded: true, note: 'Created by the seed script so the health screen has real history.' },
        startedAt,
        finishedAt: new Date(),
      },
    })
  }

  await prisma.auditEvent.create({
    data: {
      actorUserId: admin.id,
      actorRole: 'ADMIN',
      action: 'system.seed',
      entityType: 'users',
      entityId: admin.id,
      visibility: 'ADMIN',
      metadata: {
        candidates: CANDIDATES.length,
        organisations: ORGANISATIONS.length,
        jobs: createdJobs.length,
        skills: skillCount,
        permissions: permissionCount,
        resources: resourceCount,
        assessments: assessmentCount,
      },
    },
  })

  console.log('\nDemonstration accounts (password: the SEED_DEMO_PASSWORD value, not printed here)')
  console.log('  admin       admin@syprus.example.com')
  for (const organization of ORGANISATIONS) {
    console.log(`  employer    ${organization.email}  (${organization.verification.toLowerCase()})`)
  }
  for (const candidate of CANDIDATES) {
    console.log(`  candidate   ${candidate.email}`)
  }
  console.log('\nSeed complete.')
}

main()
  .catch((error) => {
    console.error('Seed failed:', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
