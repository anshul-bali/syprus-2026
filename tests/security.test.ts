import { describe, it, expect } from './harness'
import { aiConfig, aiEndpoints, endpointIsAllowed, resetAiConfig, resetAiEndpoints } from '../src/lib/ai/config'
import { createOpenAiCompatibleProvider } from '../src/lib/ai/providers/openai-compatible'
import { acquireTokenBudget, resetRateLimitState, tokenBudgetUsed } from '../src/lib/ai/rate-limit'
import { applicationCreateSchema, skillEvidenceSchema, candidateSignupSchema } from '../src/lib/validation'
import { scoreMatch, type MatchInput } from '../src/lib/engines/matching'
import type { ProviderRequest } from '../src/lib/ai/provider'
import { SUPABASE_ROOT_CA_SHA256, supabaseRootCaFingerprint, usesSupabasePooler } from '../src/lib/db/supabase-pooler'

const request: ProviderRequest = { agent: 'SKILLS_DISCOVERY', messages: [{ role: 'user', content: 'test' }], outputContract: '{}', temperature: 0, maxTokens: 200, timeoutMs: 2000, maxRetries: 0 }
const endpoint = { name: 'groq', baseUrl: 'https://api.groq.com/openai/v1', apiKey: 'fixture-secret-only', model: 'fixture', tokensPerMinute: 8000, jsonMode: true }

describe('QA credential and consent boundaries', () => {
  it('rejects script, data, relative and credential-bearing evidence links', () => {
    const base = { candidateSkillId: 'fixture', type: 'PROJECT_ARTIFACT', description: 'Evidence fixture' }
    for (const url of ['javascript:alert(1)', 'data:text/html,test', '/relative', 'https://user:secret@example.com']) {
      expect.false(skillEvidenceSchema.safeParse({ ...base, url }).success)
    }
    expect.true(skillEvidenceSchema.safeParse({ ...base, url: 'https://example.com/work' }).success)
    expect.true(skillEvidenceSchema.safeParse(base).success)
  })
  it('asks for eight characters, not ten, and still for a letter and a number', () => {
    const base = { name: 'Fixture', email: 'fixture@example.com', coreConsent: true }
    for (const value of ['abcdefg1', 'Abcdefg1', '1234abcde', 'pass word1']) {
      expect.true(
        candidateSignupSchema.safeParse({ ...base, password: value, confirmPassword: value }).success,
        `"${value}" is eight or more with a letter and a number`,
      )
    }
    for (const value of ['abcdef1', 'abcdefgh', '12345678', '1234567', 'a'.repeat(8) + '1' + 'x'.repeat(64)]) {
      expect.false(candidateSignupSchema.safeParse({ ...base, password: value, confirmPassword: value }).success, `"${value}" must be refused`)
    }
  })
  it('rejects passwords exceeding bcrypt UTF-8 byte length', () => {
    const password = 'a1' + 'é'.repeat(36)
    expect.false(candidateSignupSchema.safeParse({ name: 'Fixture', email: 'fixture@example.com', password, confirmPassword: password, coreConsent: true }).success)
  })
  for (const baseUrl of ['http://api.groq.com/openai/v1', 'https://openrouter.ai/api/v1', 'https://api.groq.com:444/openai/v1', 'https://user:pass@api.groq.com/openai/v1', 'https://api.groq.com/openai/v1?key=x', 'https://api.groq.com.evil.invalid/openai/v1']) {
    it(`rejects unsafe Groq endpoint ${baseUrl}`, () => expect.false(endpointIsAllowed('groq', baseUrl)))
  }
  it('accepts only provider-bound HTTPS endpoints', () => {
    expect.true(endpointIsAllowed('groq', endpoint.baseUrl))
    expect.true(endpointIsAllowed('openrouter', 'https://openrouter.ai/api/v1'))
    expect.true(endpointIsAllowed('gemini', 'https://generativelanguage.googleapis.com/v1beta/openai'))
  })
  it('adapter refuses cross-provider routing before any fetch', async () => {
    let calls = 0
    const original = globalThis.fetch
    globalThis.fetch = async () => { calls++; throw new Error('Unexpected fetch') }
    try {
      await expect.throws(() => createOpenAiCompatibleProvider({ ...endpoint, baseUrl: 'https://openrouter.ai/api/v1' }).complete(request), /not approved/)
      expect.equal(calls, 0)
    } finally { globalThis.fetch = original }
  })
  it('does not follow redirects and does not return provider error bodies', async () => {
    const original = globalThis.fetch
    let redirect: RequestRedirect | undefined
    globalThis.fetch = async (_url, options) => {
      redirect = options?.redirect
      return new Response(JSON.stringify({ error: { message: 'fixture-secret-only' } }), { status: 400 })
    }
    try {
      const error = await expect.throws(() => createOpenAiCompatibleProvider(endpoint).complete(request))
      expect.equal(redirect, 'error')
      expect.false(String(error).includes('fixture-secret-only'))
    } finally { globalThis.fetch = original }
  })
  it('disabled configuration cannot create a live fallback chain', () => {
    const original = { ...process.env }
    try {
      process.env.AI_ENABLED = 'false'; process.env.OPENROUTER_API_KEY = 'fixture-secret-only'
      resetAiConfig(); resetAiEndpoints()
      expect.false(aiConfig().liveAvailable)
      expect.length(aiEndpoints(), 0)
    } finally { process.env = original; resetAiConfig(); resetAiEndpoints() }
  })
  it('rejects an oversized first token reservation without consuming budget', async () => {
    resetRateLimitState()
    await expect.throws(() => acquireTokenBudget('qa', 8001, 8000), /Rate limit/)
    expect.equal(tokenBudgetUsed('qa'), 0)
    acquireTokenBudget('qa', 8000, 8000)
    await expect.throws(() => acquireTokenBudget('qa', 1, 8000), /Rate limit/)
  })
  it('application requires explicit consent rather than truthy strings', () => {
    for (const value of [undefined, false, 'false', 'true', 'yes']) {
      expect.false(applicationCreateSchema.safeParse({ jobId: 'test', identityConsent: value }).success)
    }
    expect.true(applicationCreateSchema.safeParse({ jobId: 'test', identityConsent: 'on' }).success)
  })
})

const input: MatchInput = {
  candidateSkills: [{ slug: 'excel', name: 'Excel', category: 'TECHNICAL', level: 'PROFICIENT', confidence: 1, validationStatus: 'ASSESSMENT_VERIFIED', evidenceCount: 3, transferable: false }],
  jobSkills: [{ slug: 'excel', name: 'Excel', level: 'PROFICIENT', requirement: 'REQUIRED', weight: 5 }, { slug: 'reporting', name: 'Reporting', level: 'FUNCTIONAL', requirement: 'PREFERRED', weight: 1 }],
  yearsOfExperience: 4, experienceYearsMin: 2, experienceYearsMax: 6, modelVersion: 'qa',
}

describe('QA exact matching arithmetic', () => {
  it('matches independently calculated 50/20/20/10 score', () => {
    const score = scoreMatch(input)
    expect.near(score.score, 0.8)
    expect.near(score.requiredScore, 1)
    expect.near(score.preferredScore, 0)
    expect.near(score.explanation.calculation.reduce((sum, line) => sum + line.contribution, 0), score.score)
  })
  it('uses alternate weights rather than silently using defaults', () => {
    const score = scoreMatch({ ...input, weights: { required: .4, preferred: .4, evidence: .1, preferences: .1 }, weightsVersion: 'qa-alternate' })
    expect.near(score.score, .6)
    expect.equal(score.explanation.weightsVersion, 'qa-alternate')
  })
  it('empty preferred bucket redistributes its weight', () => {
    const score = scoreMatch({ ...input, jobSkills: input.jobSkills.slice(0, 1) })
    expect.near(score.score, 1)
    expect.near(score.explanation.calculation.reduce((sum, line) => sum + line.weight, 0), 1)
  })
  it('changing career-gap and demographic extras cannot alter the score', () => {
    const extra = { ...input, careerBreakMonths: 120, name: 'Another person', age: 70, isCaregiving: true }
    expect.equal(scoreMatch(extra).score, scoreMatch(input).score)
  })
})

describe('Database trust anchor', () => {
  it('is the certificate whose fingerprint Supabase published, not one a connection handed us', () => {
    expect.equal(
      supabaseRootCaFingerprint(),
      SUPABASE_ROOT_CA_SHA256,
      'the pinned root must still hash to the value published in supabase/supabase#50862',
    )
    expect.equal(SUPABASE_ROOT_CA_SHA256.length, 64, 'a SHA-256 hex digest, not a truncated prefix')
    expect.notEqual(
      supabaseRootCaFingerprint('-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n'),
      SUPABASE_ROOT_CA_SHA256,
      'a different certificate must not pass as this one',
    )
  })

  it('pins only for the shared pooler, and never trusts a lookalike host', () => {
    expect.true(usesSupabasePooler('postgresql://postgres.ref:pw@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres'))
    for (const url of [
      'postgresql://syprus:syprus_local_dev@localhost:55433/syprus_qa',
      'postgresql://postgres:pw@db.ref.supabase.co:5432/postgres',
      'postgresql://postgres.ref:pw@aws-0-ap-southeast-2.pooler.supabase.com.attacker.tld:6543/postgres',
      'not a url',
      '',
    ]) {
      expect.false(usesSupabasePooler(url), `${url || 'empty'} must not take the pinned-CA branch`)
    }
    expect.false(usesSupabasePooler(undefined), 'an absent URL is not a pooler')
    expect.false(usesSupabasePooler(null), 'nor is a null one')
  })
})
