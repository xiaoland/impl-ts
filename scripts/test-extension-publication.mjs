import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { verifyPublicModuleFederation } from './verify-native-extension-distribution.mjs'
import {
  captureCandidates,
  checkCandidates,
  publishCandidates,
  selectSavedCandidate,
} from './publish-first-party-extensions.mjs'

void test('a rerun cannot replace a missing or expired release candidate', () => {
  const candidate = { id: 42, name: 'first-party-extension-candidate', expired: false }
  const unrelated = { id: 43, name: 'other-artifact', expired: false }
  assert.equal(selectSavedCandidate([unrelated], '1'), undefined)
  assert.equal(selectSavedCandidate([unrelated, candidate], '2'), candidate)
  assert.throws(() => selectSavedCandidate([unrelated], '2'), /missing on a rerun/)
  assert.throws(() => selectSavedCandidate([{ ...candidate, expired: true }], '2'), /expired/)
  assert.throws(() => selectSavedCandidate([candidate, candidate], '2'), /multiple/)
  assert.throws(() => selectSavedCandidate([], undefined), /current GitHub run attempt/)
})

// A real HTTP fault-injection boundary for the publisher, not a replacement Registry implementation.
void test('an unknown MF-only upload resumes the saved ZIP and verifies even an existing association', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'inkcre-publication-test-'))
  let registryUrl = 'https://registry.example.test'
  const prefix = '/extensions/test/source/1.0.0/module-federation/'
  const build = path.join(workspace, 'extensions/source/dist/client-web')
  const uploaded = path.join(workspace, 'uploaded')
  let prepared
  let published = false
  let uploads = 0
  let publishes = 0
  let writes = 0
  let corrupt = false
  let forceConflict = false
  const server = createServer(async (req, res) => {
    try {
      res.setHeader('Access-Control-Allow-Origin', '*')
      const json = (status, body) => {
        res.writeHead(status, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(body))
      }
      const record = () => ({
        name: 'test/source',
        nickname: 'Source',
        version: '1.0.0',
        state: 'published',
        distribution: 'module_federation',
        module_federation: {
          host_sdk: '@inkcre/core',
          host_sdk_version: '>=0.2.0 <0.4.0',
          manifest_url: `${prefix}mf-manifest.json`,
        },
      })
      if (req.method === 'POST') {
        writes++
        assert.equal(req.headers.authorization, 'Bearer test-only')
        const chunks = []
        for await (const chunk of req) chunks.push(chunk)
        const body = Buffer.concat(chunks)
        if (req.url.endsWith('/releases')) {
          if (forceConflict)
            return json(409, { detail: 'Module Federation association is immutable' })
          const value = JSON.parse(body)
          if (prepared) assert.deepEqual(value, prepared)
          prepared = value
          return json(200, { state: 'preparing' })
        }
        if (req.url.endsWith('/module-federation')) {
          uploads++
          const form = await new Response(body, {
            headers: { 'Content-Type': req.headers['content-type'] },
          }).formData()
          const zip = path.join(workspace, 'received.zip')
          await writeFile(zip, Buffer.from(await form.get('content').arrayBuffer()))
          execFileSync('unzip', ['-q', zip, '-d', uploaded])
          // Heroku can return H12 while the server keeps processing this exact archive.
          return json(503, { detail: 'H12 request timeout' })
        }
        if (req.url.endsWith('/publish')) {
          publishes++
          if (publishes === 1)
            return json(409, {
              detail: 'Release native Distribution objects are not completely available',
            })
          published = true
          return json(200, record())
        }
      }
      if (req.url.startsWith('/v2/'))
        return json(published ? 200 : 404, published ? record() : { detail: 'not found' })
      if (!published) return json(404, { detail: 'not found' })
      const relativePath = req.url.slice(prefix.length)
      let bytes = await readFile(path.join(uploaded, relativePath))
      if (relativePath === 'mf-manifest.json') {
        const manifest = JSON.parse(bytes)
        manifest.metaData.publicPath = `${registryUrl}${prefix}`
        bytes = Buffer.from(JSON.stringify(manifest))
      }
      if (corrupt && relativePath === 'transitive.js') bytes = Buffer.from('changed')
      res.writeHead(200, { 'Cache-Control': 'public, no-cache', ETag: '"snapshot"' })
      res.end(bytes)
    } catch (error) {
      res.writeHead(500)
      res.end(error.message)
    }
  })
  try {
    await mkdir(path.join(build, '.vite'), { recursive: true })
    await mkdir(path.join(workspace, 'extensions/.agents'))
    await mkdir(path.join(workspace, 'extensions/guidance'))
    await mkdir(path.join(workspace, 'packages/core'), { recursive: true })
    await writeFile(
      path.join(workspace, 'packages/core/package.json'),
      JSON.stringify({ version: '0.3.0' })
    )
    await writeFile(
      path.join(workspace, 'extensions/source/package.json'),
      JSON.stringify({
        version: '1.0.0',
        inkcre: {
          name: 'test/source',
          nickname: 'Source',
          module_federation: { host_sdk: '@inkcre/core', host_sdk_version: '>=0.2.0 <0.4.0' },
        },
      })
    )
    await writeFile(
      path.join(build, 'mf-manifest.json'),
      JSON.stringify({
        name: 'source',
        metaData: { publicPath: './', remoteEntry: { name: 'remoteEntry.js' } },
        shared: [{ name: '@inkcre/core', requiredVersion: '>=0.2.0 <0.4.0' }],
        exposes: [],
      })
    )
    await writeFile(path.join(build, 'remoteEntry.js'), 'import "./transitive.js"')
    await writeFile(path.join(build, 'transitive.js'), 'export default 42')
    await writeFile(path.join(build, '.vite/manifest.json'), '{}')
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const origin = `http://127.0.0.1:${server.address().port}`
    registryUrl = origin
    const options = {
      workspace,
      registryUrl,
      deliveryDirectory: path.join(workspace, 'candidate'),
      token: 'test-only',
      provenance: {
        source_repository: 'https://github.com/InKCre/impl-ts',
        source_revision: 'exact-source',
        build_id: 'same-run',
      },
      fetchImplementation: (url, init) => fetch(new URL(new URL(url).pathname, origin), init),
    }
    await assert.rejects(
      verifyPublicModuleFederation({
        registryUrl: 'http://registry.example.test',
        packagePath: path.join(workspace, 'extensions/source/package.json'),
        corePackagePath: path.join(workspace, 'packages/core/package.json'),
        artifactDirectory: build,
      }),
      /HTTPS or loopback HTTP/
    )
    await captureCandidates(options)
    assert.equal(writes, 0, 'capturing a candidate must not mutate the Registry')
    // A rebuild could produce other bytes; publication must still use the retained ZIP.
    await writeFile(path.join(build, 'transitive.js'), 'export default "different build"')
    await publishCandidates(options)
    assert.equal(uploads, 1)
    assert.equal(
      publishes,
      2,
      'MF-only preparation must progress through publish, not public GET alone'
    )
    await publishCandidates(options)
    assert.equal(uploads, 1, 'a ready candidate is verified without uploading it again')
    corrupt = true
    await assert.rejects(publishCandidates(options), /public asset bytes differ: transitive.js/)
    corrupt = false
    forceConflict = true
    const beforeConflict = writes
    await assert.rejects(publishCandidates(options), /association is immutable/)
    assert.equal(writes, beforeConflict + 1, 'immutable conflicts must not retry')
    forceConflict = false
    const beforeInvalid = writes
    await assert.rejects(
      checkCandidates({ ...options, provenance: { ...options.provenance, build_id: 'new-run' } }),
      /saved candidate must belong/
    )
    await writeFile(path.join(options.deliveryDirectory, 'source/snapshot.zip'), 'corrupt')
    await assert.rejects(publishCandidates(options), /saved ZIP digest differs/)
    assert.equal(writes, beforeInvalid, 'invalid saved candidates must fail before Registry writes')
    await rm(build, { recursive: true })
    const historical = await captureCandidates({
      ...options,
      deliveryDirectory: path.join(workspace, 'later-run'),
    })
    assert.deepEqual(
      historical.candidates,
      [],
      'unrelated builds must not claim to verify historical releases'
    )
    await writeFile(path.join(workspace, 'extensions/guidance/package.json'), '{invalid')
    await assert.rejects(
      captureCandidates({ ...options, deliveryDirectory: path.join(workspace, 'invalid-run') }),
      SyntaxError,
      'only absent package metadata may be skipped, not invalid package metadata'
    )
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
    await rm(workspace, { recursive: true })
  }
})
