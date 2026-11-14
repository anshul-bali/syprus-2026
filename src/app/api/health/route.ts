import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { matchModelVersion, policyVersion } from '@/lib/env'
import { aiConfigSummary } from '@/lib/ai/config'
import { mailConfig } from '@/lib/mail/config'

// Mail reports local configuration only, not function availability or delivery.
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`
  } catch {
    return NextResponse.json(
      {
        status: 'degraded',
        database: 'unreachable',
        checkedAt: new Date().toISOString(),
      },
      { status: 503 },
    )
  }

  const ai = aiConfigSummary()
  return NextResponse.json({
    status: 'ok',
    database: 'connected',
    scoring: 'deterministic',
    agents: ai.liveAvailable ? 'model-enabled' : 'rule-fallback',
    aiEnabled: ai.enabled,
    mail: mailConfig().delivery,
    policyVersion: policyVersion(),
    matchModelVersion: matchModelVersion(),
    checkedAt: new Date().toISOString(),
  })
}
