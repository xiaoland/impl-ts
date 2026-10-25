import { readFile, readdir, realpath, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'

export async function preparePagesPreview(directory, { sourceRevision, buildId }) {
  if (!/^[a-f0-9]{40}$/.test(sourceRevision ?? '') || !/^\d+-\d+$/.test(buildId ?? '')) {
    throw new Error('Preview requires an exact source SHA and run-attempt build identity')
  }
  const root = await realpath(directory)
  const entries = await readdir(root, { recursive: true, withFileTypes: true })
  if (entries.some((entry) => entry.isSymbolicLink())) {
    throw new Error('Preview staging must not contain symbolic links')
  }
  const manifests = entries
    .filter((entry) => entry.isFile() && entry.name === 'mf-manifest.json')
    .map((entry) => relative(root, join(entry.parentPath, entry.name)))
    .filter((path) =>
      /^extensions\/[^/]+\/[^/]+\/[^/]+\/module-federation\/mf-manifest\.json$/.test(path)
    )
    .sort()
  if (!manifests.length) throw new Error('Preview facade contains no Module Federation manifests')

  const distributions = []
  for (const path of manifests) {
    const manifest = JSON.parse(await readFile(join(root, path), 'utf8'))
    if (typeof manifest.metaData?.publicPath !== 'string') {
      throw new Error(`Missing Module Federation publicPath: ${path}`)
    }
    // The locked MF runtime resolves "auto" from the fetched manifest, not the moving PR alias.
    manifest.metaData.publicPath = 'auto'
    await writeFile(join(root, path), `${JSON.stringify(manifest, null, 2)}\n`)

    distributions.push({ manifest: `/${path}` })
  }
  const candidate = { source_revision: sourceRevision, build_id: buildId, distributions }
  await writeFile(join(root, 'preview-candidate.json'), `${JSON.stringify(candidate, null, 2)}\n`)
  return candidate
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await preparePagesPreview(process.argv[2], {
    sourceRevision: process.env.INKCRE_PREVIEW_SOURCE_SHA,
    buildId: `${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`,
  })
}
