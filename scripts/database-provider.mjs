import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const composeFile = `${repoRoot}/runtime/database.compose.yml`
const remoteRunner = `${repoRoot}/scripts/remote-compose.sh`
const localConfigFile = `${repoRoot}/svc.local.json`
const baseConfigFile = `${repoRoot}/svc.json`

const providerEnvironmentKeys = {
  kind: 'INKCRE_DATABASE_PROVIDER',
  target: 'INKCRE_DATABASE_SSH_TARGET',
  dockerBin: 'INKCRE_DATABASE_SSH_DOCKER_BIN',
  forwardHost: 'INKCRE_DATABASE_SSH_FORWARD_HOST',
  descriptor: 'INKCRE_DATABASE_RUNTIME_DESCRIPTOR',
}

function optionalJson(path) {
  if (!existsSync(path)) return {}
  return JSON.parse(readFileSync(path, 'utf8'))
}

function provisionEnvironment(config) {
  return config.dev?.targets?.database?.provision?.env ?? {}
}

function declaredProviderEnvironment() {
  const base = optionalJson(baseConfigFile)
  const local = optionalJson(localConfigFile)
  return {
    ...provisionEnvironment(base),
    ...provisionEnvironment(local),
  }
}

function configuredValue(name, declared) {
  return process.env[name] ?? declared[name]
}

function validateSshTarget(value) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value)) {
    throw new Error('SSH provider target must be one host alias from the user SSH config')
  }
  return value
}

function validateRemoteValue(value, label) {
  if (!value || value.length > 512 || value.includes('\0') || /[\r\n]/.test(value)) {
    throw new Error(`${label} must be one non-empty line`)
  }
  return value
}

export function resolveDatabaseProviderConfig() {
  const declared = declaredProviderEnvironment()
  const kind = configuredValue(providerEnvironmentKeys.kind, declared) ?? 'local'
  if (kind === 'local') return { kind }
  if (kind === 'external') {
    const descriptor = configuredValue(providerEnvironmentKeys.descriptor, declared)
    if (
      !descriptor ||
      !isAbsolute(descriptor) ||
      descriptor.includes('\0') ||
      /[\r\n]/.test(descriptor)
    ) {
      throw new Error(
        'external database provider requires one absolute INKCRE_DATABASE_RUNTIME_DESCRIPTOR'
      )
    }
    return {
      kind,
      descriptor: resolve(descriptor),
    }
  }
  if (kind !== 'ssh') {
    throw new Error(`unsupported database provider: ${kind}`)
  }

  const target = configuredValue(providerEnvironmentKeys.target, declared)
  if (!target) {
    throw new Error('SSH database provider requires INKCRE_DATABASE_SSH_TARGET')
  }

  const dockerBin = configuredValue(providerEnvironmentKeys.dockerBin, declared) ?? 'docker'
  const forwardHost = configuredValue(providerEnvironmentKeys.forwardHost, declared) ?? '127.0.0.1'

  return {
    kind,
    target: validateSshTarget(target),
    docker_bin: validateRemoteValue(dockerBin, 'remote Docker executable'),
    forward_host: validateSshTarget(forwardHost),
  }
}

export function sameDatabaseProvider(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function writeArguments(path, args) {
  for (const arg of args) {
    if (typeof arg !== 'string' || arg.includes('\0') || /[\r\n]/.test(arg)) {
      throw new Error('Compose arguments must be newline-free strings')
    }
  }
  writeFileSync(path, `${args.join('\n')}\n`, { mode: 0o600 })
}

const remoteBootstrap = [
  'set -eu',
  'umask 077',
  'payload_dir=$(mktemp -d "${TMPDIR:-/tmp}/inkcre-compose.XXXXXX")',
  'trap \'rm -rf "$payload_dir"\' EXIT HUP INT TERM',
  'tar -m -xf - -C "$payload_dir"',
  'chmod 700 "$payload_dir/remote-compose.sh"',
  '"$payload_dir/remote-compose.sh" "$payload_dir"',
].join('; ')

function remoteCompose(provider, composeEnvironmentPath, args, options) {
  const bundle = mkdtempSync(`${tmpdir()}/inkcre-compose-`)
  try {
    copyFileSync(composeFile, `${bundle}/database.compose.yml`)
    copyFileSync(composeEnvironmentPath, `${bundle}/compose.env`)
    copyFileSync(remoteRunner, `${bundle}/remote-compose.sh`)
    writeArguments(`${bundle}/compose.args`, args)
    chmodSync(`${bundle}/compose.env`, 0o600)

    const archive = execFileSync(
      'tar',
      [
        '--format=ustar',
        '-C',
        bundle,
        '-cf',
        '-',
        'database.compose.yml',
        'compose.env',
        'compose.args',
        'remote-compose.sh',
      ],
      {
        cwd: repoRoot,
        encoding: null,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 10_000,
      }
    )
    const output = execFileSync(
      'ssh',
      ['-T', '-o', 'BatchMode=yes', provider.target, remoteBootstrap],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        input: archive,
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: options.timeout ?? 180_000,
      }
    )
    if (options.stdio === 'inherit' && output) process.stdout.write(output)
    return output
  } finally {
    rmSync(bundle, { recursive: true, force: true })
  }
}

function localCompose(composeEnvironmentPath, project, args, options) {
  return execFileSync(
    'docker',
    [
      'compose',
      '--file',
      composeFile,
      '--env-file',
      composeEnvironmentPath,
      '--project-name',
      project,
      ...args,
    ],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'],
      timeout: options.timeout ?? 180_000,
    }
  )
}

export function runDatabaseCompose(state, composeEnvironmentPath, args, options = {}) {
  if (state.provider.kind === 'external') {
    throw new Error('external database runtime is owned by impl-py; Compose is unavailable')
  }
  if (state.provider.kind === 'local') {
    return localCompose(composeEnvironmentPath, state.project, args, options)
  }
  return remoteCompose(state.provider, composeEnvironmentPath, args, options)
}

function controlSocket(state) {
  const identity = createHash('sha256')
    .update(`${repoRoot}/${state.identity}`)
    .digest('hex')
    .slice(0, 20)
  return `/tmp/inkcre-ssh-${identity}`
}

function checkControlSocket(state) {
  if (state.provider.kind !== 'ssh' || !state.tunnel?.control_socket) return false
  try {
    execFileSync('ssh', ['-S', state.tunnel.control_socket, '-O', 'check', state.provider.target], {
      cwd: repoRoot,
      stdio: ['ignore', 'ignore', 'ignore'],
      timeout: 5000,
    })
    return true
  } catch {
    return false
  }
}

export function openDatabaseAccess(state) {
  if (state.provider.kind !== 'ssh') return state
  if (checkControlSocket(state)) return state

  const socket = controlSocket(state)
  if (existsSync(socket)) unlinkSync(socket)

  const forwards = Object.keys(state.local_ports).flatMap((name) => [
    '-L',
    `${state.local_ports[name]}:${state.provider.forward_host}:${state.remote_ports[name]}`,
  ])
  execFileSync(
    'ssh',
    [
      '-M',
      '-S',
      socket,
      '-fnNT',
      '-o',
      'BatchMode=yes',
      '-o',
      'ExitOnForwardFailure=yes',
      ...forwards,
      state.provider.target,
    ],
    {
      cwd: repoRoot,
      stdio: ['ignore', 'ignore', 'pipe'],
      timeout: 15_000,
    }
  )
  return {
    ...state,
    tunnel: {
      control_socket: socket,
    },
  }
}

export function databaseAccessReady(state) {
  return state.provider.kind !== 'ssh' || checkControlSocket(state)
}

export function closeDatabaseAccess(state) {
  if (state.provider.kind !== 'ssh' || !state.tunnel?.control_socket) return
  try {
    execFileSync('ssh', ['-S', state.tunnel.control_socket, '-O', 'exit', state.provider.target], {
      cwd: repoRoot,
      stdio: ['ignore', 'ignore', 'ignore'],
      timeout: 5000,
    })
  } catch {
    // A missing control master is already stopped.
  }
  if (existsSync(state.tunnel.control_socket)) {
    unlinkSync(state.tunnel.control_socket)
  }
}

function temporaryProviderEnvironment(provider) {
  const directory = mkdtempSync(`${tmpdir()}/inkcre-provider-`)
  const path = `${directory}/compose.env`
  const values = [
    "INKCRE_COMPOSE_PROJECT_NAME='inkcre-provider-check'",
    `INKCRE_REMOTE_DOCKER_BIN='${provider.docker_bin.replaceAll("'", "'\\''")}'`,
    '',
  ]
  writeFileSync(path, values.join('\n'), { mode: 0o600 })
  return { directory, path }
}

export function runDatabaseDocker(provider, args, options = {}) {
  if (provider.kind === 'external') {
    throw new Error('external database runtime does not expose its Docker owner')
  }
  if (provider.kind === 'local') {
    return execFileSync('docker', args, {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'],
      timeout: options.timeout ?? 180_000,
    }).trim()
  }

  const temporary = temporaryProviderEnvironment(provider)
  try {
    return remoteCompose(provider, temporary.path, ['__docker__', ...args], options).trim()
  } finally {
    rmSync(temporary.directory, { recursive: true, force: true })
  }
}

export function readExternalDatabaseDescriptor(provider) {
  const descriptor = JSON.parse(readFileSync(provider.descriptor, 'utf8'))
  if (descriptor.owner_repository !== 'InKCre/impl-py') {
    throw new Error(
      `external database owner: expected InKCre/impl-py, got ${JSON.stringify(descriptor.owner_repository ?? null)}; select the owner's current runtime.json in svc.local.json`
    )
  }
  if (
    descriptor.format !== 1 ||
    !/^[a-f0-9]{16}$/.test(descriptor.identity) ||
    descriptor.profile !== 'development'
  ) {
    throw new Error(
      'external database requires format 1, a 16-digit hex identity and development profile'
    )
  }
  if (descriptor.converging) {
    throw new Error(
      `external database ${descriptor.identity} is converging; inspect its impl-py owner with svc dev status database --repo <owner> --json`
    )
  }
  if (
    descriptor.project !== `inkcre-core-py-${descriptor.identity}` ||
    !descriptor.docker?.daemon_id ||
    !/^[a-f0-9]{64}$/.test(descriptor.source_fingerprint) ||
    typeof descriptor.contract_revision !== 'string' ||
    descriptor.contract_revision.length === 0
  ) {
    throw new Error(
      'external database provenance is incomplete: check project, Docker daemon, source fingerprint and contract revision with the impl-py owner'
    )
  }
  return descriptor
}

export function diagnoseDatabaseProvider(provider) {
  if (provider.kind === 'external') {
    const descriptor = readExternalDatabaseDescriptor(provider)
    return {
      kind: provider.kind,
      owner_repository: descriptor.owner_repository,
      runtime_instance: descriptor.identity,
      daemon_id: descriptor.docker.daemon_id,
      engine: descriptor.docker.engine,
      compose: descriptor.docker.compose,
    }
  }
  if (provider.kind === 'local') {
    const engine = execFileSync('docker', ['info', '--format', '{{.ServerVersion}}'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10_000,
    }).trim()
    const compose = execFileSync('docker', ['compose', 'version', '--short'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10_000,
    }).trim()
    return { kind: provider.kind, engine, compose }
  }

  execFileSync('ssh', ['-G', provider.target], {
    cwd: repoRoot,
    stdio: ['ignore', 'ignore', 'pipe'],
    timeout: 5000,
  })
  const temporary = temporaryProviderEnvironment(provider)
  try {
    const output = remoteCompose(provider, temporary.path, ['__provider-check__'], {
      timeout: 15_000,
    })
    const [engine, compose] = output.trim().split('\n')
    if (!engine || !compose) {
      throw new Error('remote Docker provider returned incomplete diagnostics')
    }
    return {
      kind: provider.kind,
      target: provider.target,
      engine,
      compose,
    }
  } finally {
    rmSync(temporary.directory, { recursive: true, force: true })
  }
}
