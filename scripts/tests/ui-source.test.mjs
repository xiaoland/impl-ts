import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createUiSourceTsconfig } from '../ui-source.mjs'

const require = createRequire(import.meta.url)

void test('UI source type checking accepts an external checkout and rejects its type errors', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'inkcre-ui-types-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const appRoot = join(root, 'impl-ts/apps/client-web')
  const uiRoot = join(root, 'ui/packages/web')
  const runtimeRoot = join(root, 'impl-ts/.runtime/ui-source')
  for (const path of [join(appRoot, 'src'), uiRoot, runtimeRoot]) {
    await mkdir(path, { recursive: true })
  }
  const uiEntry = join(uiRoot, 'index.ts')
  const uiSource = {
    root: uiRoot,
    globalComponents: join(uiRoot, 'components.d.ts'),
    entries: Object.fromEntries(
      [
        '@inkcre/ui-web',
        '@inkcre/ui-web/styles',
        '@inkcre/ui-web/styles/functions',
        '@inkcre/ui-web/styles/mixins',
        '@inkcre/ui-web/tokens/ref',
        '@inkcre/ui-web/tokens/sys',
        '@inkcre/ui-web/tokens/comp',
        '@inkcre/ui-web/utils',
        '@inkcre/ui-web/locales',
        '@inkcre/ui-web/uno',
      ].map((specifier) => [specifier, uiEntry])
    ),
  }
  await writeFile(
    join(appRoot, 'tsconfig.app.json'),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        noEmit: true,
        target: 'ES2020',
        module: 'ESNext',
        moduleResolution: 'bundler',
        rootDir: join(root, 'impl-ts'),
      },
    })
  )
  await writeFile(join(appRoot, 'env.d.ts'), '')
  await writeFile(uiSource.globalComponents, '')
  await writeFile(join(appRoot, 'src/index.ts'), "export { value } from '@inkcre/ui-web'\n")
  await writeFile(uiEntry, 'export const value: number = 1\n')
  const configPath = join(runtimeRoot, 'tsconfig.json')
  await writeFile(
    configPath,
    JSON.stringify(createUiSourceTsconfig(uiSource, appRoot, runtimeRoot))
  )
  const check = () =>
    spawnSync(process.execPath, [require.resolve('typescript/lib/tsc'), '-p', configPath], {
      cwd: appRoot,
      encoding: 'utf8',
    })
  const valid = check()
  assert.equal(valid.status, 0, valid.stdout + valid.stderr)
  await writeFile(uiEntry, 'export const value: number = "wrong"\n')
  const invalid = check()
  assert.notEqual(invalid.status, 0)
  assert.match(invalid.stdout, /TS2322/)
})
