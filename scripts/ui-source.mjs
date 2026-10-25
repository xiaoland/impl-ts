import { createHash } from 'node:crypto'
import { access, readFile, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'

export const uiSourceEnvironmentVariable = 'INKCRE_UI_SOURCE_ROOT'

const uiSourceEntries = [
  ['@inkcre/ui-web', 'src/index.ts'],
  ['@inkcre/ui-web/styles', 'styles/index.scss'],
  ['@inkcre/ui-web/styles/functions', 'styles/_functions.scss'],
  ['@inkcre/ui-web/styles/mixins', 'styles/_mixins.scss'],
  ['@inkcre/ui-web/tokens/ref', 'styles/tokens/_ref.scss'],
  ['@inkcre/ui-web/tokens/sys', 'styles/tokens/_sys.scss'],
  ['@inkcre/ui-web/tokens/comp', 'styles/tokens/_comp.scss'],
  ['@inkcre/ui-web/utils', 'src/utils/index.ts'],
  ['@inkcre/ui-web/locales', 'src/locales/index.ts'],
  ['@inkcre/ui-web/uno', 'styles/uno/preset-ink.ts'],
]

export const uiSourceDedupe = ['unocss', 'vue']

function exactSpecifier(specifier) {
  const escaped = specifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^${escaped}$`)
}

export function isPathInside(directory, path) {
  const pathFromDirectory = relative(directory, path)
  return (
    pathFromDirectory === '' ||
    (!pathFromDirectory.startsWith('..') && !isAbsolute(pathFromDirectory))
  )
}

export function readUiSourceInput(argv, environment = process.env) {
  let argument

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index]
    if (current === '--ui-source') {
      argument = argv[index + 1]
      index += 1
      continue
    }
    if (current.startsWith('--ui-source=')) {
      argument = current.slice('--ui-source='.length)
      continue
    }
    throw new Error(`Unknown UI source option "${current}"`)
  }

  if (argument && environment[uiSourceEnvironmentVariable]) {
    throw new Error(`Use either --ui-source or ${uiSourceEnvironmentVariable}, not both`)
  }

  const input = argument ?? environment[uiSourceEnvironmentVariable]
  if (!input) {
    throw new Error(`Pass --ui-source <package-root> or set ${uiSourceEnvironmentVariable}`)
  }
  return input
}

export async function resolveUiSourcePackage(input, options = {}) {
  const cwd = options.cwd ?? process.cwd()
  const candidate = isAbsolute(input) ? input : resolve(cwd, input)
  const root = await realpath(candidate).catch(() => {
    throw new Error(`UI source package root does not exist: ${candidate}`)
  })
  const packagePath = resolve(root, 'package.json')
  const packageJson = JSON.parse(
    await readFile(packagePath, 'utf8').catch(() => {
      throw new Error(`UI source package is missing package.json: ${root}`)
    })
  )

  if (packageJson.name !== '@inkcre/ui-web') {
    throw new Error(
      `UI source package must be @inkcre/ui-web, found ${packageJson.name ?? 'an unnamed package'}`
    )
  }

  const entries = Object.fromEntries(
    await Promise.all(
      uiSourceEntries.map(async ([specifier, relativePath]) => {
        const path = resolve(root, relativePath)
        await access(path).catch(() => {
          throw new Error(`UI source package is missing ${relativePath}`)
        })
        return [specifier, path]
      })
    )
  )

  const globalComponents = resolve(root, 'src/components.d.ts')
  await access(globalComponents).catch(() => {
    throw new Error('UI source package is missing src/components.d.ts')
  })

  return {
    root,
    version: packageJson.version,
    identity: createHash('sha256').update(root).digest('hex').slice(0, 16),
    entries,
    globalComponents,
  }
}

export async function resolveUiSourceFromEnvironment(environment = process.env) {
  const input = environment[uiSourceEnvironmentVariable]
  if (!input) return null
  if (!isAbsolute(input)) {
    throw new Error(`${uiSourceEnvironmentVariable} must be an absolute package root`)
  }
  return resolveUiSourcePackage(input)
}

export async function resolveUiSourceForVite(command, environment = process.env) {
  const uiSource = await resolveUiSourceFromEnvironment(environment)
  if (!uiSource) return null
  if (command !== 'serve') {
    throw new Error(
      'The @inkcre/ui-web source overlay is development-only; unset INKCRE_UI_SOURCE_ROOT for builds'
    )
  }
  return uiSource
}

export function createUiSourceAliases(uiSource) {
  return uiSourceEntries.map(([specifier]) => ({
    find: exactSpecifier(specifier),
    replacement: uiSource.entries[specifier],
  }))
}

export function createUiSourceTsconfig(uiSource, appRoot, runtimeRoot) {
  let rootDir = resolve(appRoot, '../..')
  while (!isPathInside(rootDir, uiSource.root)) {
    const parent = dirname(rootDir)
    if (parent === rootDir) {
      throw new Error('UI source and impl-ts must share a filesystem root for type checking')
    }
    rootDir = parent
  }
  const paths = Object.fromEntries(
    uiSourceEntries.map(([specifier]) => [specifier, [uiSource.entries[specifier]]])
  )
  const peerPaths = Object.fromEntries(
    uiSourceDedupe.map((specifier) => [specifier, [resolve(appRoot, 'node_modules', specifier)]])
  )

  return {
    extends: resolve(appRoot, 'tsconfig.app.json'),
    compilerOptions: {
      rootDir,
      paths: {
        '@/*': [resolve(appRoot, 'src/*')],
        '@inkcre/core': [resolve(appRoot, '../../packages/core/src/index.ts')],
        '@inkcre/core/*': [resolve(appRoot, '../../packages/core/src/*')],
        ...paths,
        ...peerPaths,
      },
      tsBuildInfoFile: resolve(runtimeRoot, 'tsconfig.ui-source.tsbuildinfo'),
      types: [],
    },
    include: [
      resolve(appRoot, 'env.d.ts'),
      resolve(appRoot, 'src/**/*'),
      uiSource.globalComponents,
    ],
  }
}
