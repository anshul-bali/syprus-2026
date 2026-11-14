#!/usr/bin/env node
// Starts a real, local PostgreSQL cluster for SYPRUS development without Docker.
// Data lives in .postgres/data and survives restarts. Run with: npm run db:pg

import fs from 'node:fs'
import path from 'node:path'
import EmbeddedPostgres from 'embedded-postgres'

const root = process.cwd()
const databaseDir = path.resolve(root, process.env.PGDATA || '.postgres/data')
const port = Number(process.env.PGPORT || 55432)
const user = process.env.PGUSER || 'syprus'
const password = process.env.PGPASSWORD || 'syprus_local_dev'
const database = process.env.PGDATABASE || 'syprus'

const isNewCluster = !fs.existsSync(path.join(databaseDir, 'PG_VERSION'))

const pg = new EmbeddedPostgres({
  databaseDir,
  persistent: true,
  port,
  user,
  password,
  authMethod: 'scram-sha-256',
  initdbFlags: ['--encoding=UTF8', '--locale=C', '--lc-collate=C'],
  onLog: (message) => process.stdout.write(`[postgres] ${message}\n`),
  onError: (message) => process.stderr.write(`[postgres] ${String(message)}\n`),
})

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function databaseExists() {
  const client = pg.getPgClient('postgres')
  await client.connect()
  try {
    const result = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [database])
    return result.rowCount > 0
  } finally {
    await client.end()
  }
}

if (isNewCluster) {
  process.stdout.write(`Initialising PostgreSQL cluster in ${databaseDir}\n`)
  await pg.initialise()
}

await pg.start()

// pg_start can report ready a moment before it accepts connections.
for (let attempt = 0; attempt < 20; attempt++) {
  try {
    const probe = pg.getPgClient('postgres')
    await probe.connect()
    await probe.end()
    break
  } catch {
    if (attempt === 19) throw new Error('PostgreSQL did not become reachable')
    await sleep(500)
  }
}

if (!(await databaseExists())) {
  process.stdout.write(`Creating database "${database}"\n`)
  await pg.createDatabase(database)
}

process.stdout.write(
  `\nSYPRUS PostgreSQL ready on localhost:${port}, database ${database}\n  press Ctrl+C to stop\n\n`,
)

let shuttingDown = false
async function shutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true
  process.stdout.write(`\nStopping PostgreSQL (${signal})\n`)
  try {
    await pg.stop()
  } catch (error) {
    process.stderr.write(`Unclean shutdown: ${String(error)}\n`)
  }
  process.exit(0)
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))
setInterval(() => {}, 1 << 30)
