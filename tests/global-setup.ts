import { expect, type FullConfig } from '@playwright/test'
import { PrismaClient } from '@prisma/client'

/**
 * A cold Next.js dev build compiles each route on first request, and Fast Refresh
 * reloads the page while it does. Against a browser test that looks like a random
 * detached-element failure, so every route a journey touches is requested here
 * and awaited until it serves, once per run.
 */
const WARM_ROUTES = [
  '/',
  '/login',
  '/register',
  '/verify-email',
  '/candidate',
  '/candidate/onboarding',
  '/candidate/skills',
  '/candidate/graph',
  '/candidate/jobs',
  '/candidate/applications',
  '/candidate/disclosures',
  '/candidate/assessments',
  '/candidate/pathways',
  '/candidate/gap-report',
  '/candidate/profile',
  '/employer',
  '/employer/jobs',
  '/employer/jobs/new',
  '/employer/candidates',
  '/employer/applications',
  '/employer/shortlist',
  '/admin',
  '/admin/organisations',
  '/admin/moderation',
  '/admin/review',
  '/admin/weights',
  '/admin/fairness',
  '/admin/engines',
  '/admin/audit',
  '/api/health',
]

async function warm(baseUrl: string, path: string) {
  const deadline = Date.now() + 120_000
  let lastStatus = 0
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}${path}`, { redirect: 'manual' })
      lastStatus = response.status
      // 3xx is correct here: unauthenticated portal routes redirect to sign-in.
      if (response.status < 500) return
    } catch {
      // The dev server may still be booting; keep polling.
    }
    await new Promise((resolve) => setTimeout(resolve, 1_500))
  }
  throw new Error(`Route ${path} never became ready (last status ${lastStatus}).`)
}

/**
 * Same guard as the suites themselves: this file touches data, so it refuses to
 * run against anything but the isolated local QA database.
 */
function qaDatabase() {
  const url = new URL(process.env.DATABASE_URL || 'http://invalid')
  if (url.hostname !== 'localhost' || url.port !== '55433' || url.pathname !== '/syprus_qa') {
    throw new Error('Browser tests must run through scripts/qa.ts against the isolated local QA database.')
  }
  return url.toString()
}

export default async function globalSetup(config: FullConfig) {
  const baseUrl = String(config.projects[0]?.use?.baseURL ?? 'http://localhost:3100')
  const health = await fetch(`${baseUrl}/api/health`).then((response) => response.json())
  expect(health.database, 'QA suite requires a reachable database').toBe('connected')

  // Every sign-in on this cluster issues a code, and the send ceiling counts
  // them per account per hour. Rows that have already expired can never be
  // redeemed, so they are cleared here: a repeat run measures the product, not
  // the residue of the last one. Live codes are left alone.
  qaDatabase()
  const prisma = new PrismaClient()
  try {
    const pruned = await prisma.emailVerification.deleteMany({ where: { expiresAt: { lt: new Date() } } })
    if (pruned.count > 0) console.log(`QA setup: cleared ${pruned.count} expired verification code(s)`)
  } finally {
    await prisma.$disconnect()
  }

  await Promise.all(WARM_ROUTES.map((path) => warm(baseUrl, path)))
}
