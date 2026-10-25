import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { preparePagesPreview } from '../prepare-pages-preview.mjs'

const requireWeb = createRequire(new URL('../../apps/client-web/package.json', import.meta.url))
const requireRuntime = createRequire(requireWeb.resolve('@module-federation/runtime'))
const { generateSnapshotFromManifest } = requireRuntime('@module-federation/sdk')

void test('preview MF resolves from each selected snapshot and records its build identity', async () => {
  const root = await mkdtemp(join(tmpdir(), 'inkcre-preview-'))
  const path = 'extensions/inkcre/example/1.0.0/module-federation'
  const manifest = {
    metaData: {
      publicPath: `https://moving-pr.pages.dev/${path}/`,
      remoteEntry: { name: 'remoteEntry.js', path: '', type: 'module' },
      buildInfo: { buildVersion: '1.0.0' },
    },
    shared: [],
    exposes: [],
  }
  const identity = { sourceRevision: 'a'.repeat(40), buildId: '123-1' }
  try {
    await mkdir(join(root, path), { recursive: true })
    await writeFile(join(root, path, 'mf-manifest.json'), JSON.stringify(manifest))
    await writeFile(join(root, path, 'remoteEntry.js'), 'export const candidate = "A"')
    const candidate = await preparePagesPreview(root, identity)
    assert.deepEqual(candidate, {
      source_revision: identity.sourceRevision,
      build_id: identity.buildId,
      distributions: [{ manifest: `/${path}/mf-manifest.json` }],
    })
    const prepared = JSON.parse(await readFile(join(root, path, 'mf-manifest.json'), 'utf8'))
    assert.deepEqual(prepared, {
      ...manifest,
      metaData: { ...manifest.metaData, publicPath: 'auto' },
    })
    for (const origin of ['https://snapshot-a.pages.dev', 'https://snapshot-b.pages.dev']) {
      const snapshot = generateSnapshotFromManifest(prepared, {
        version: `${origin}/${path}/mf-manifest.json`,
      })
      assert.equal(
        `${snapshot.publicPath}${snapshot.remoteEntry}`,
        `${origin}/${path}/remoteEntry.js`
      )
    }
    assert.deepEqual(
      JSON.parse(await readFile(join(root, 'preview-candidate.json'), 'utf8')),
      candidate
    )
    assert.deepEqual(await preparePagesPreview(root, identity), candidate)
    await symlink(join(root, path, 'remoteEntry.js'), join(root, path, 'linked.js'))
    await assert.rejects(preparePagesPreview(root, identity), /symbolic links/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
