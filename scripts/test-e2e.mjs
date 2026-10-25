import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'

import {
  availablePort,
  compose,
  ensureDatabaseRuntime,
  exists,
  repoRoot,
  runtimeCredentials,
  runtimeDirectory,
  stopDatabaseRuntime,
  waitForRuntime,
} from './database-runtime-lib.mjs'
import { resolveDatabaseProviderConfig } from './database-provider.mjs'

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: options.env ?? process.env,
    stdio: options.stdio ?? 'inherit',
    timeout: options.timeout ?? 300_000,
  })
}

function developmentFingerprint(instance) {
  return compose(instance, [
    'run',
    '--rm',
    '--no-deps',
    '--entrypoint',
    'python',
    'init',
    '-c',
    'from app.database_contract.catalog import development_baseline_fingerprint as f; print(f())',
  ]).trim()
}

async function waitForWeb(url) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) })
      if (response.ok) return
    } catch {
      // Vite preview is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`built web artifact did not become ready at ${url}`)
}

const identityHash = createHash('sha256')
  .update(`${repoRoot}/${process.pid}/${Date.now()}`)
  .digest('hex')
  .slice(0, 16)
const instance = `e2e-${identityHash}`
let preview
let credentials

if (resolveDatabaseProviderConfig().kind === 'external') {
  process.env.INKCRE_DATABASE_PROVIDER = process.env.INKCRE_E2E_DATABASE_PROVIDER ?? 'ssh'
}

function redact(value) {
  if (!credentials) return value
  return Object.entries(credentials).reduce(
    (redacted, [name, secret]) =>
      name === 'format' ? redacted : redacted.replaceAll(secret, `[REDACTED:${name}]`),
    value
  )
}

try {
  const state = await ensureDatabaseRuntime(instance)
  await waitForRuntime(state)
  const ownsRuntime = state.provider.kind !== 'external'
  const baseline = ownsRuntime ? developmentFingerprint(instance) : null

  run('pnpm', ['--filter', '@inkcre/client-web', 'build-only'])
  run('pnpm', ['--filter', '@inkcre/ext-github...', 'build'])
  const webPort = await availablePort()
  const webUrl = `http://127.0.0.1:${webPort}/`
  preview = spawn(
    'pnpm',
    [
      '--filter',
      '@inkcre/client-web',
      'exec',
      'vite',
      'preview',
      '--host',
      '127.0.0.1',
      '--port',
      String(webPort),
      '--strictPort',
    ],
    {
      cwd: repoRoot,
      env: process.env,
      stdio: 'inherit',
    }
  )
  await waitForWeb(webUrl)

  credentials = await runtimeCredentials(instance)
  run(
    'pnpm',
    ['exec', 'playwright', 'test', '--project', 'web-database', ...process.argv.slice(2)],
    {
      // Playwright owns its suite deadline so reporters and teardown can finish.
      timeout: 0,
      env: {
        ...process.env,
        INKCRE_E2E_CORE_URL: state.urls.core,
        INKCRE_E2E_POSTGREST_URL: state.urls.postgrest,
        INKCRE_E2E_WEB_URL: webUrl,
        INKCRE_E2E_JWT_SECRET: credentials.JWT_SECRET,
      },
    }
  )

  if (ownsRuntime) {
    compose(instance, [
      'run',
      '--rm',
      '--no-deps',
      'init',
      'python',
      'scripts/container.py',
      'db',
      'reset-dev',
      '--confirm',
      'reset-development-data',
    ])
    const resetBaseline = developmentFingerprint(instance)
    if (resetBaseline !== baseline) {
      throw new Error('reset-dev did not restore the deterministic E2E baseline')
    }
  }
} catch (error) {
  const evidenceDirectory = `${repoRoot}/test-results/database`
  await mkdir(evidenceDirectory, { recursive: true })

  const failure = error instanceof Error ? (error.stack ?? error.message) : String(error)
  await writeFile(`${evidenceDirectory}/orchestration-error.txt`, `${redact(failure)}\n`)

  try {
    if (await exists(`${runtimeDirectory(instance)}/runtime.json`)) {
      const logs = compose(instance, ['logs', '--no-color'], { timeout: 30_000 })
      await writeFile(`${evidenceDirectory}/compose.log`, redact(logs))
    }
  } catch (logError) {
    const message = logError instanceof Error ? logError.message : String(logError)
    await writeFile(`${evidenceDirectory}/compose-log-error.txt`, `${redact(message)}\n`)
  }

  console.error(redact(failure))
  process.exitCode = 1
} finally {
  preview?.kill('SIGTERM')
  try {
    if (await exists(`${runtimeDirectory(instance)}/runtime.json`)) {
      await stopDatabaseRuntime(instance)
    }
  } catch (cleanupError) {
    // Keep the descriptor when cleanup fails, and preserve the original test failure above.
    console.error(`E2E cleanup failed for ${instance}: ${redact(String(cleanupError))}`)
    process.exitCode = 1
  }
}
