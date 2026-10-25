import { access, readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { inspectBrowserRuntimeSource } from './browser-runtime-contract.mjs'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const jsonOutput = process.argv.includes('--json')
const errors = []

async function exists(relativePath) {
  try {
    await access(`${repoRoot}/${relativePath}`)
    return true
  } catch {
    return false
  }
}

async function readJson(relativePath) {
  return JSON.parse(await readFile(`${repoRoot}/${relativePath}`, 'utf8'))
}

async function sourceFiles(relativeDirectory) {
  const directory = `${repoRoot}/${relativeDirectory}`
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const relativePath = `${relativeDirectory}/${entry.name}`
    if (entry.isDirectory()) {
      files.push(...(await sourceFiles(relativePath)))
    } else if (/\.(?:js|mjs|ts|tsx|vue)$/.test(entry.name)) {
      files.push(relativePath)
    }
  }

  return files
}

const rootPackage = await readJson('package.json')
const webPackage = await readJson('apps/client-web/package.json')
const svcConfig = await readJson('svc.json')

const nodeRuntime = rootPackage.devEngines?.runtime
if (
  nodeRuntime?.name !== 'node' ||
  nodeRuntime?.version !== '22.22.3' ||
  nodeRuntime?.onFail !== 'download'
) {
  errors.push('root devEngines.runtime must provision exact Node 22.22.3 through pnpm')
}
if (await exists('.node-version')) {
  errors.push('.node-version must remain absent; pnpm devEngines.runtime owns Node')
}
for (const [path, expectedNodeFile] of [
  ['.github/workflows/ci.yml', 'package.json'],
  ['.github/workflows/pages-cleanup.yml', 'controller/package.json'],
  ['.github/workflows/pages-preview.yml', 'candidate/package.json'],
  ['.github/workflows/pages-deploy.yml', 'release/package.json'],
]) {
  const workflow = await readFile(`${repoRoot}/${path}`, 'utf8')
  const configuredNodeFiles = [...workflow.matchAll(/node-version-file:\s*(\S+)/g)].map(
    (match) => match[1]
  )
  if (
    configuredNodeFiles.length === 0 ||
    configuredNodeFiles.some((nodeFile) => nodeFile !== expectedNodeFile)
  ) {
    errors.push(`${path} must derive every Node setup from ${expectedNodeFile}`)
  }
}
if (rootPackage.devDependencies?.portless !== '0.12.0') {
  errors.push('root devDependency "portless" must be exactly "0.12.0" for the Node 22 contract')
}
if (rootPackage.scripts?.dev !== 'node scripts/dev.mjs web') {
  errors.push('root "dev" script must enter the declared SVC web capability')
}
if (rootPackage.scripts?.['dev:ui'] !== 'node scripts/dev-ui.mjs') {
  errors.push('root "dev:ui" script must validate and enter the opt-in SVC web-ui capability')
}
if (rootPackage.scripts?.['type-check:ui'] !== 'node scripts/type-check-ui.mjs') {
  errors.push('root "type-check:ui" script must own the temporary source-graph check')
}
if (rootPackage.scripts?.['dev:webext'] !== 'node scripts/dev.mjs webext') {
  errors.push('root "dev:webext" script must enter the declared SVC webext capability')
}
if (rootPackage.scripts?.['dev:stop'] !== 'node scripts/dev-stop.mjs') {
  errors.push('root "dev:stop" script must clean up only the current worktree routes')
}

for (const dependency of ['@cloudflare/workers-types', 'hono', 'wrangler']) {
  if (webPackage.dependencies?.[dependency] || webPackage.devDependencies?.[dependency]) {
    errors.push(`static client must not depend on legacy runtime tool "${dependency}"`)
  }
}

for (const path of [
  'apps/client-web/.env.cloudflare',
  'apps/client-web/.env.example',
  'apps/client-web/server/index.ts',
  'apps/client-web/wrangler.jsonc',
  'deploy/profiles/legacy-endpoints.json',
  'deploy/profiles/production.json',
  'packages/core/src/database/production-profile.ts',
  'packages/core/src/database/profile.ts',
]) {
  if (await exists(path)) {
    errors.push(`legacy runtime/environment surface must remain absent: ${path}`)
  }
}

const runtimeSources = [
  ...(await sourceFiles('packages/core/src')),
  ...(await sourceFiles('packages/ext-dev-utils/src')),
  ...(await sourceFiles('apps/client-web/src')),
  ...(await sourceFiles('apps/client-webext/components')),
  ...(await sourceFiles('apps/client-webext/composables')),
  ...(await sourceFiles('apps/client-webext/entrypoints')),
  ...(await sourceFiles('apps/client-webext/logic')),
  ...(
    await Promise.all(
      (
        await readdir(`${repoRoot}/extensions`, { withFileTypes: true })
      )
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
        .map((entry) => sourceFiles(`extensions/${entry.name}/src`))
    )
  ).flat(),
].filter((path) => !/\.(?:spec|test)\.[cm]?[jt]sx?$/.test(path))

for (const path of runtimeSources) {
  const source = await readFile(`${repoRoot}/${path}`, 'utf8')
  errors.push(...inspectBrowserRuntimeSource(source, path))
}

const coreIndex = await readFile(`${repoRoot}/packages/core/src/index.ts`, 'utf8')
for (const legacyExport of ['httpAdapter', 'envAdapter', 'createEnvAdapter']) {
  if (coreIndex.includes(legacyExport)) {
    errors.push(`@inkcre/core public API must not export legacy adapter "${legacyExport}"`)
  }
}

const localTargets = svcConfig.dev?.targets
if (!localTargets) {
  errors.push('svc.json must declare development targets')
} else {
  const expectedTargets = {
    database: {
      probe: ['node', 'scripts/probe-database.mjs', '${dev.instance}'],
      command: ['node', 'scripts/database-runtime.mjs', 'ensure', '${dev.instance}'],
      environment: {
        INKCRE_DATABASE_PROVIDER: 'local',
      },
    },
    web: {
      probe: ['node', 'scripts/probe-dev.mjs', 'web', '${dev.instance}'],
      command: ['node', 'scripts/dev.mjs', 'web'],
    },
    'web-ui': {
      probe: ['node', 'scripts/probe-dev.mjs', 'web-ui', '${dev.instance}'],
      command: ['node', 'scripts/dev.mjs', 'web-ui'],
    },
    webext: {
      probe: ['node', 'scripts/probe-dev.mjs', 'webext', '${dev.instance}'],
      command: ['node', 'scripts/dev.mjs', 'webext'],
    },
  }

  for (const [name, expected] of Object.entries(expectedTargets)) {
    const target = localTargets[name]
    if (!target) {
      errors.push(`svc.json is missing local target "${name}"`)
      continue
    }
    if (target.scope !== 'worktree') {
      errors.push(`SVC target "${name}" must be worktree-scoped`)
    }
    if (
      target.probe?.kind !== 'exec' ||
      JSON.stringify(target.probe.argv) !== JSON.stringify(expected.probe)
    ) {
      errors.push(`SVC target "${name}" must use the identity probe that proves dev.instance`)
    }
    if (JSON.stringify(target.provision?.argv) !== JSON.stringify(expected.command)) {
      errors.push(`SVC target "${name}" must provision through scripts/dev.mjs`)
    }
    if (
      expected.environment &&
      JSON.stringify(target.provision?.env) !== JSON.stringify(expected.environment)
    ) {
      errors.push(`SVC target "${name}" must commit only the portable local provider default`)
    }
  }
}

const databaseCompose = await readFile(`${repoRoot}/runtime/database.compose.yml`, 'utf8')
for (const required of [
  "command: ['python', 'scripts/container.py', 'db', 'init', '--profile', 'development']",
  '${INKCRE_CORE_IMAGE:?INKCRE_CORE_IMAGE is required}',
  'database-contract:/database-contract',
  '${POSTGRES_PORT:-0}',
  '${POSTGREST_PORT:-0}',
  'PEER_ID: 00000000-0000-4000-8000-000000000002',
  'PEER_LEASE_RENEW_INTERVAL_SECONDS: 1',
]) {
  if (!databaseCompose.includes(required)) {
    errors.push(`database Compose is missing runtime contract fragment "${required}"`)
  }
}
for (const forbidden of [
  '5432:5432',
  '3000:3000',
  'sleep ',
  'CLIENT_BASE_URL:',
  'CLIENT_ID:',
  'CLIENT_NAME:',
  'CORE_PUBLIC_URL:',
]) {
  if (databaseCompose.includes(forbidden)) {
    errors.push(`database Compose contains forbidden fixed-order fragment "${forbidden}"`)
  }
}

const databaseProvider = await readFile(`${repoRoot}/scripts/database-provider.mjs`, 'utf8')
const remoteCompose = await readFile(`${repoRoot}/scripts/remote-compose.sh`, 'utf8')
for (const required of [
  "kind === 'local'",
  "kind === 'external'",
  "kind !== 'ssh'",
  'INKCRE_DATABASE_RUNTIME_DESCRIPTOR',
  "'BatchMode=yes'",
  'ExitOnForwardFailure=yes',
  'svc.local.json',
]) {
  if (!databaseProvider.includes(required)) {
    errors.push(`database provider is missing safety contract "${required}"`)
  }
}
if (remoteCompose.includes('eval ') || !remoteCompose.includes('"$docker_bin" compose')) {
  errors.push('remote Compose runner must preserve argv without eval or shell command construction')
}
const committedDatabaseEnvironment = svcConfig.dev.targets.database.provision.env
if (
  committedDatabaseEnvironment?.INKCRE_DATABASE_SSH_TARGET ||
  committedDatabaseEnvironment?.INKCRE_DATABASE_SSH_DOCKER_BIN ||
  committedDatabaseEnvironment?.INKCRE_DATABASE_RUNTIME_DESCRIPTOR
) {
  errors.push('committed SVC config must not contain machine-specific database provider values')
}

const devScript = await readFile(`${repoRoot}/scripts/dev.mjs`, 'utf8')
if (!devScript.includes("'database'")) {
  errors.push('pnpm dev must ensure the worktree-scoped database capability')
}

const uiSourceHelper = await readFile(`${repoRoot}/scripts/ui-source.mjs`, 'utf8')
for (const required of [
  "'@inkcre/ui-web'",
  "'@inkcre/ui-web/styles'",
  "'@inkcre/ui-web/styles/functions'",
  "'@inkcre/ui-web/styles/mixins'",
  "'@inkcre/ui-web/tokens/ref'",
  "'@inkcre/ui-web/tokens/sys'",
  "'@inkcre/ui-web/tokens/comp'",
  "'@inkcre/ui-web/utils'",
  "'@inkcre/ui-web/locales'",
  "'@inkcre/ui-web/uno'",
  'development-only',
]) {
  if (!uiSourceHelper.includes(required)) {
    errors.push(`UI source helper is missing contract fragment "${required}"`)
  }
}

for (const path of ['apps/client-web/vite.config.ts', 'extensions/twitter/vite.config.ts']) {
  const config = await readFile(`${repoRoot}/${path}`, 'utf8')
  for (const required of [
    'createUiSourceAliases',
    'isPathInside',
    'uiSourceDedupe',
    'searchForWorkspaceRoot',
  ]) {
    if (!config.includes(required)) {
      errors.push(`${path} is missing UI source contract "${required}"`)
    }
  }
  if (config.includes('/Volumes/') || config.includes('/Users/')) {
    errors.push(`${path} must not persist a machine-specific UI source path`)
  }
}

const wxtConfig = await readFile(`${repoRoot}/apps/client-webext/wxt.config.ts`, 'utf8')
if (wxtConfig.includes('--remote-debugging-port=9222')) {
  errors.push('WXT development must not reuse the fixed Chromium debugging port 9222')
}
if (!wxtConfig.includes('INKCRE_WXT_PROFILE_DIR')) {
  errors.push('WXT development must use a worktree-owned Chromium profile directory')
}
if (!wxtConfig.includes('INKCRE_CHROMIUM_BINARY') || !wxtConfig.includes('disabled: true')) {
  errors.push('WXT development must make automatic browser launch explicit and optional')
}

const result = {
  ok: errors.length === 0,
  targets: localTargets ? Object.keys(localTargets).sort() : [],
  configAuthority: 'browser-local',
  errors,
}

if (jsonOutput) {
  console.log(JSON.stringify(result, null, 2))
} else if (result.ok) {
  console.log('[OK] static/browser-local runtime and worktree development contracts are explicit')
} else {
  for (const error of errors) {
    console.error(`[ERROR] ${error}`)
  }
}

process.exitCode = result.ok ? 0 : 1
