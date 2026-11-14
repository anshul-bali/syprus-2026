import { runRegistered } from './harness'

/**
 * Test entry point. Suites are imported for their registrations, then run.
 * Add a new suite by importing it here.
 */
import './ai.test'
import './assistant.test'
import './providers.test'
import './graph.test'
import './security.test'
import './security-boundaries.test'
import './verification.test'

async function main() {
  const { passed, failures } = await runRegistered()

  console.log(`\n${passed} passed, ${failures.length} failed\n`)

  if (failures.length > 0) {
    for (const failure of failures) {
      console.log(`FAILED  ${failure.suite} > ${failure.name}`)
      console.log(`  ${failure.error instanceof Error ? failure.error.message : String(failure.error)}`)
    }
    process.exit(1)
  }
}

main().catch((error) => {
  console.error('Test runner crashed:', error)
  process.exit(1)
})
