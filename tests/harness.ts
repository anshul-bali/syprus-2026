/**
 * Minimal test harness. No test framework is installed in this project, so the
 * suite runs on these primitives: `npm test` executes every registered case and
 * exits non-zero if any fails.
 */

type TestCase = { name: string; run: () => void | Promise<void> }

const registry: { suite: string; cases: TestCase[] }[] = []
let current: { suite: string; cases: TestCase[] } | null = null

export function describe(suite: string, body: () => void) {
  current = { suite, cases: [] }
  registry.push(current)
  body()
  current = null
}

export function it(name: string, run: TestCase['run']) {
  if (!current) throw new Error(`it("${name}") must be inside describe()`)
  current.cases.push({ name, run })
}

function fail(message: string): never {
  throw new Error(message)
}

export const expect = {
  true(value: unknown, message = 'expected truthy') {
    if (!value) fail(`${message} — got ${JSON.stringify(value)}`)
  },
  false(value: unknown, message = 'expected falsy') {
    if (value) fail(`${message} — got ${JSON.stringify(value)}`)
  },
  equal<T>(actual: T, expected: T, message = 'values differ') {
    if (actual !== expected) fail(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  },
  notEqual<T>(actual: T, other: T, message = 'values are identical') {
    if (actual === other) fail(`${message}: both were ${JSON.stringify(actual)}`)
  },
  near(actual: number, expected: number, tolerance = 0.0001, message = 'numbers differ') {
    if (Math.abs(actual - expected) > tolerance) {
      fail(`${message}: expected ${expected} ±${tolerance}, got ${actual}`)
    }
  },
  includes<T>(haystack: readonly T[], needle: T, message = 'value not found') {
    if (!haystack.includes(needle)) fail(`${message}: ${JSON.stringify(needle)} not in ${JSON.stringify(haystack)}`)
  },
  notIncludes<T>(haystack: readonly T[], needle: T, message = 'value unexpectedly present') {
    if (haystack.includes(needle)) fail(`${message}: ${JSON.stringify(needle)} was present`)
  },
  length<T>(value: readonly T[], expected: number, message = 'length differs') {
    if (value.length !== expected) fail(`${message}: expected ${expected}, got ${value.length}`)
  },
  async throws(body: () => unknown | Promise<unknown>, match?: RegExp, message = 'expected a throw') {
    let caught: unknown
    try {
      await body()
    } catch (error) {
      caught = error
    }
    if (!caught) fail(`${message}: nothing was thrown`)
    if (match && !match.test(String(caught))) {
      fail(`${message}: error did not match ${match} — got ${String(caught)}`)
    }
    return caught
  },
  async doesNotThrow(body: () => unknown | Promise<unknown>, message = 'unexpected throw') {
    try {
      await body()
    } catch (error) {
      fail(`${message}: ${String(error)}`)
    }
  },
}

export type Failure = { suite: string; name: string; error: unknown }

export async function runRegistered(): Promise<{ passed: number; failures: Failure[] }> {
  let passed = 0
  const failures: Failure[] = []

  for (const suite of registry) {
    console.log(`\n${suite.suite}`)
    for (const testCase of suite.cases) {
      try {
        await testCase.run()
        passed += 1
        console.log(`  PASS  ${testCase.name}`)
      } catch (error) {
        failures.push({ suite: suite.suite, name: testCase.name, error })
        console.log(`  FAIL  ${testCase.name}`)
        console.log(`        ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  return { passed, failures }
}
