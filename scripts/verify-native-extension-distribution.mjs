import assert from 'node:assert/strict'
import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { satisfies, subset, valid as validSemVer, validRange } from 'semver'

const PRODUCTION_BROWSER_ORIGIN = 'https://app.inkcre.dev'
const EXTENSION_NAME_PATTERN =
  /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?\/[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/

function assertSafeRelativePath(value, label) {
  assert.equal(typeof value, 'string', `${label} must be a string`)
  assert.ok(value.length > 0, `${label} must not be empty`)
  assert.ok(!value.startsWith('/'), `${label} must be relative`)
  assert.ok(!value.includes('\\'), `${label} must use POSIX separators`)
  assert.ok(!value.includes('://'), `${label} must not contain an origin`)
  assert.ok(!value.includes('?') && !value.includes('#'), `${label} must be URL-safe`)
  assert.ok(
    !value.split('/').some((segment) => segment === '' || segment === '.' || segment === '..'),
    `${label} must be normalized and traversal-free`
  )
}

function remoteEntryPath(metadata) {
  assert.ok(metadata.remoteEntry && typeof metadata.remoteEntry === 'object')
  const { name, path: remotePath = '' } = metadata.remoteEntry
  assert.equal(typeof name, 'string', 'metaData.remoteEntry.name must be a string')
  assert.equal(typeof remotePath, 'string', 'metaData.remoteEntry.path must be a string')
  const combined = remotePath ? `${remotePath.replace(/\/$/, '')}/${name}` : name
  const relativePath = combined.replace(/^\.\//, '')
  assertSafeRelativePath(relativePath, 'Module Federation Remote entry')
  return relativePath
}

function assetReferences(items, collectionName) {
  assert.ok(Array.isArray(items), `${collectionName} must be an array`)
  const references = new Set()
  for (const item of items) {
    assert.ok(item && typeof item === 'object', `${collectionName} entries must be objects`)
    const assets = item.assets ?? {}
    assert.ok(assets && typeof assets === 'object', `${collectionName} assets must be objects`)
    for (const kind of ['js', 'css']) {
      const groups = assets[kind] ?? {}
      assert.ok(groups && typeof groups === 'object', `${collectionName} ${kind} must be an object`)
      for (const timing of ['sync', 'async']) {
        const paths = groups[timing] ?? []
        assert.ok(
          Array.isArray(paths) && paths.every((assetPath) => typeof assetPath === 'string'),
          `${collectionName} ${kind}.${timing} must be a string array`
        )
        for (const assetPath of paths) {
          assertSafeRelativePath(assetPath, `${collectionName} asset`)
          references.add(assetPath)
        }
      }
    }
  }
  return references
}

export function manifestClosure(manifest) {
  assert.ok(manifest && typeof manifest === 'object', 'mf-manifest.json must contain an object')
  assert.ok(manifest.metaData && typeof manifest.metaData === 'object', 'metaData is required')
  assert.equal(manifest.metaData.publicPath, './', "metaData.publicPath must be './'")

  /** @type {Set<string>} */
  const references = new Set([remoteEntryPath(manifest.metaData)])
  for (const assetPath of assetReferences(manifest.shared ?? [], 'shared')) {
    references.add(assetPath)
  }
  for (const assetPath of assetReferences(manifest.exposes ?? [], 'exposes')) {
    references.add(assetPath)
  }
  return [...references].sort()
}

function readAssociation(extensionPackage, corePackage) {
  const association = extensionPackage.inkcre
  assert.ok(
    association && typeof association === 'object',
    'package.json inkcre metadata is required'
  )
  assert.match(association.name, EXTENSION_NAME_PATTERN, 'invalid canonical Extension Name')
  assert.equal(typeof association.nickname, 'string', 'Extension Nickname is required')
  assert.ok(association.nickname.length > 0, 'Extension Nickname is required')
  assert.equal(
    validSemVer(extensionPackage.version),
    extensionPackage.version,
    'invalid Release SemVer'
  )

  const distribution = association.module_federation
  assert.ok(distribution && typeof distribution === 'object', 'MF association is required')
  assert.equal(distribution.host_sdk, '@inkcre/core', 'Web Host SDK must be @inkcre/core')
  const hostRange = distribution.host_sdk_version?.replaceAll(',', ' ')
  assert.ok(validRange(hostRange), 'Host SDK version must be a valid SemVer range')
  assert.ok(
    satisfies(corePackage.version, hostRange),
    `@inkcre/core ${corePackage.version} does not satisfy ${distribution.host_sdk_version}`
  )

  return {
    name: association.name,
    nickname: association.nickname,
    version: extensionPackage.version,
    module_federation: {
      host_sdk: distribution.host_sdk,
      host_sdk_version: distribution.host_sdk_version,
    },
  }
}

export async function inspectNativeModuleFederation({
  packagePath,
  corePackagePath,
  artifactDirectory,
}) {
  const [extensionPackage, corePackage, manifest] = await Promise.all([
    readJson(packagePath),
    readJson(corePackagePath),
    readJson(path.join(artifactDirectory, 'mf-manifest.json')),
  ])
  const association = readAssociation(extensionPackage, corePackage)
  const closure = manifestClosure(manifest)

  for (const relativePath of closure) {
    const absolutePath = path.join(artifactDirectory, ...relativePath.split('/'))
    const stats = await lstat(absolutePath).catch(() => null)
    assert.ok(stats?.isFile(), `manifest references missing asset: ${relativePath}`)
    assert.ok(!stats.isSymbolicLink(), `manifest asset must not be a symlink: ${relativePath}`)
  }

  const coreShare = manifest.shared?.filter((shared) => shared.name === '@inkcre/core') ?? []
  const uiVersion =
    extensionPackage.dependencies?.['@inkcre/ui-web'] ??
    extensionPackage.devDependencies?.['@inkcre/ui-web']
  if (uiVersion) {
    const uiShare = manifest.shared?.filter((shared) => shared.name === '@inkcre/ui-web') ?? []
    assert.equal(uiShare.length, 1, 'manifest must share @inkcre/ui-web to inherit Host UI context')
    assert.equal(uiShare[0].requiredVersion, uiVersion)
  }
  assert.equal(coreShare.length, 1, 'manifest must contain exactly one @inkcre/core shared module')
  const sharedRange = coreShare[0].requiredVersion?.replaceAll(',', ' ')
  assert.ok(validRange(sharedRange), 'manifest @inkcre/core requiredVersion is invalid')
  const registryRange = association.module_federation.host_sdk_version.replaceAll(',', ' ')
  assert.ok(
    subset(sharedRange, registryRange) && subset(registryRange, sharedRange),
    'manifest @inkcre/core range must match the Registry Host SDK range'
  )
  assert.ok(
    satisfies(corePackage.version, sharedRange),
    `manifest shared range does not accept @inkcre/core ${corePackage.version}`
  )

  return {
    ...association,
    manifest_name: manifest.name,
    remote_entry: remoteEntryPath(manifest.metaData),
    referenced_assets: closure,
  }
}

export async function verifyPublicModuleFederation({
  registryUrl,
  packagePath,
  corePackagePath,
  artifactDirectory,
  fetchImplementation = globalThis.fetch,
}) {
  const local = await inspectNativeModuleFederation({
    packagePath,
    corePackagePath,
    artifactDirectory,
  })
  const registry = new URL(registryUrl)
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(registry.hostname)
  assert.ok(
    registry.protocol === 'https:' || (registry.protocol === 'http:' && loopback),
    'Registry URL must use HTTPS or loopback HTTP'
  )
  const [namespace, name] = local.name.split('/')
  const releaseUrl = new URL(
    `/v2/extensions/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/distributions/module_federation/releases/${encodeURIComponent(local.version)}`,
    registry
  )
  const releaseResponse = await fetchImplementation(releaseUrl, {
    headers: { Origin: PRODUCTION_BROWSER_ORIGIN, Accept: 'application/json' },
  })
  assert.ok(releaseResponse.ok, `public exact Release returned HTTP ${releaseResponse.status}`)
  assert.equal(
    releaseResponse.headers.get('access-control-allow-origin'),
    '*',
    'public exact Release must allow browser reads'
  )
  const release = await releaseResponse.json()
  assert.deepEqual(
    {
      name: release.name,
      nickname: release.nickname,
      version: release.version,
      state: release.state,
      distribution: release.distribution,
      module_federation: {
        host_sdk: release.module_federation?.host_sdk,
        host_sdk_version: release.module_federation?.host_sdk_version,
      },
    },
    {
      name: local.name,
      nickname: local.nickname,
      version: local.version,
      state: 'published',
      distribution: 'module_federation',
      module_federation: local.module_federation,
    },
    'public exact Release differs from checked association'
  )

  const manifestUrl = new URL(release.module_federation.manifest_url, registry)
  assert.equal(manifestUrl.origin, registry.origin, 'public manifest must remain Registry-hosted')
  const publicPrefix = new URL('.', manifestUrl).href
  const manifestResponse = await fetchImplementation(manifestUrl, {
    headers: { Origin: PRODUCTION_BROWSER_ORIGIN },
  })
  assertPublicArtifactResponse(manifestResponse, 'public mf-manifest.json')
  const publicManifest = await manifestResponse.json()
  const localManifest = await readJson(path.join(artifactDirectory, 'mf-manifest.json'))
  const expectedManifest = structuredClone(localManifest)
  expectedManifest.metaData.publicPath = publicPrefix
  assert.deepEqual(publicManifest, expectedManifest, 'Registry changed fields besides publicPath')

  // Manifest references omit transitive chunks, maps and other uploaded files.
  const snapshotFiles = await listSnapshotFiles(artifactDirectory)
  for (const relativePath of snapshotFiles.filter((file) => file !== 'mf-manifest.json')) {
    const response = await fetchImplementation(new URL(relativePath, publicPrefix), {
      headers: { Origin: PRODUCTION_BROWSER_ORIGIN },
    })
    assertPublicArtifactResponse(response, `public Module Federation asset ${relativePath}`)
    const [publicBytes, localBytes] = await Promise.all([
      response.arrayBuffer().then((value) => Buffer.from(value)),
      readFile(path.join(artifactDirectory, ...relativePath.split('/'))),
    ])
    assert.ok(publicBytes.equals(localBytes), `public asset bytes differ: ${relativePath}`)
  }

  return {
    name: local.name,
    version: local.version,
    manifest_url: manifestUrl.href,
    verified_assets: snapshotFiles.length,
  }
}

export async function listSnapshotFiles(directory, prefix = '') {
  /** @type {string[]} */
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relativePath = prefix + entry.name
    assertSafeRelativePath(relativePath, 'snapshot member')
    assert.ok(!entry.isSymbolicLink(), `snapshot member must not be a symlink: ${relativePath}`)
    if (entry.isDirectory()) {
      files.push(...(await listSnapshotFiles(path.join(directory, entry.name), `${relativePath}/`)))
    } else {
      assert.ok(entry.isFile(), `snapshot member must be a file: ${relativePath}`)
      files.push(relativePath)
    }
  }
  return files.sort()
}

function assertPublicArtifactResponse(response, label) {
  assert.ok(response.ok, `${label} returned HTTP ${response.status}`)
  assert.equal(
    response.headers.get('access-control-allow-origin'),
    '*',
    `${label} must allow browser reads`
  )
  // Immutable bytes still require revalidation so Registry blocking remains effective.
  assert.equal(
    response.headers.get('cache-control'),
    'public, no-cache',
    `${label} must revalidate Registry readability`
  )
  assert.ok(response.headers.get('etag'), `${label} must include an ETag`)
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'))
}

export function prepareBody(local, provenance) {
  assert.ok(provenance && typeof provenance === 'object', 'MF provenance is required')
  assert.equal(
    typeof provenance.source_repository,
    'string',
    'MF source_repository must be a string'
  )
  assert.ok(provenance.source_repository.length > 0, 'MF source_repository is required')
  assert.ok(
    provenance.source_repository.length <= 512,
    'MF source_repository must not exceed 512 characters'
  )
  assert.equal(typeof provenance.source_revision, 'string', 'MF source_revision must be a string')
  assert.ok(provenance.source_revision.length > 0, 'MF source_revision is required')
  assert.ok(
    provenance.source_revision.length <= 128,
    'MF source_revision must not exceed 128 characters'
  )
  if (provenance.build_id !== undefined) {
    assert.equal(typeof provenance.build_id, 'string', 'MF build_id must be a string')
    assert.ok(provenance.build_id.length > 0, 'MF build_id must not be empty')
    assert.ok(provenance.build_id.length <= 256, 'MF build_id must not exceed 256 characters')
  }

  return {
    nickname: local.nickname,
    version: local.version,
    module_federation: {
      ...local.module_federation,
      source_repository: provenance.source_repository,
      source_revision: provenance.source_revision,
      ...(provenance.build_id === undefined ? {} : { build_id: provenance.build_id }),
    },
  }
}

export function previewRelease(local) {
  return {
    name: local.name,
    nickname: local.nickname,
    version: local.version,
    state: 'published',
    distribution: 'module_federation',
    module_federation: {
      manifest_url: `/extensions/${local.name}/${local.version}/module-federation/mf-manifest.json`,
      ...local.module_federation,
    },
  }
}

function parseArguments(argumentList) {
  const [command, ...remaining] = argumentList
  assert.ok(command, 'a command is required')
  const options = {}
  for (let index = 0; index < remaining.length; index += 2) {
    const option = remaining[index]
    const value = remaining[index + 1]
    assert.ok(
      option?.startsWith('--') && value,
      `expected an option/value pair near ${option ?? ''}`
    )
    options[option.slice(2)] = value
  }
  return { command, options }
}

function requireOption(options, name) {
  assert.ok(options[name], `--${name} is required`)
  return options[name]
}

async function writeResult(outputPath, result) {
  const encoded = `${JSON.stringify(result, null, 2)}\n`
  if (!outputPath) {
    process.stdout.write(encoded)
    return
  }
  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeFile(outputPath, encoded)
}

async function main() {
  const { command, options } = parseArguments(process.argv.slice(2))
  const shared = {
    packagePath: requireOption(options, 'package'),
    corePackagePath: requireOption(options, 'core-package'),
    artifactDirectory: requireOption(options, 'artifact-directory'),
  }

  if (command === 'inspect-local') {
    await writeResult(options.output, await inspectNativeModuleFederation(shared))
    return
  }
  if (command === 'prepare-body') {
    await writeResult(
      options.output,
      prepareBody(await inspectNativeModuleFederation(shared), {
        source_repository: requireOption(options, 'source-repository'),
        source_revision: requireOption(options, 'source-revision'),
        ...(options['build-id'] === undefined ? {} : { build_id: options['build-id'] }),
      })
    )
    return
  }
  if (command === 'preview-release') {
    await writeResult(options.output, previewRelease(await inspectNativeModuleFederation(shared)))
    return
  }
  if (command === 'verify-public') {
    const result = await verifyPublicModuleFederation({
      ...shared,
      registryUrl: requireOption(options, 'registry-url'),
    })
    await writeResult(options.output, result)
    return
  }
  throw new Error(`unsupported command: ${command}`)
}

const currentFile = fileURLToPath(import.meta.url)
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  main().catch((error) => {
    console.error(`[ERROR] ${error.message}`)
    process.exitCode = 1
  })
}
