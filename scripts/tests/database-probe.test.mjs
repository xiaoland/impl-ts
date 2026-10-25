import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'

const run = promisify(execFile)
const probe = new URL('../probe-database.mjs', import.meta.url)

void test('database probe distinguishes stale provenance from transport failure without mutating the owner', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'inkcre-probe-'))
  let coreStatus = 200
  const requests = []
  const server = createServer((request, response) => {
    requests.push(request.method)
    response.writeHead(request.url === '/core/readyz' ? coreStatus : 401)
    response.end()
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  const descriptorPath = join(directory, 'runtime.json')
  const descriptor = {
    format: 1,
    owner_repository: 'InKCre/impl-py',
    identity: '0123456789abcdef',
    profile: 'development',
    project: 'inkcre-core-py-0123456789abcdef',
    docker: { daemon_id: 'isolated-fixture' },
    source_revision: 'a'.repeat(40),
    source_fingerprint: 'b'.repeat(64),
    contract_revision: 'fixture-v1',
    migration_head: 'fixture-head',
    urls: { core: `${origin}/core/`, postgrest: `${origin}/postgrest/` },
  }
  const readiness = {
    status: 'ok',
    runtime: {
      instance: descriptor.identity,
      owner_repository: descriptor.owner_repository,
      compose_project: descriptor.project,
      docker_daemon_id: descriptor.docker.daemon_id,
      source_revision: descriptor.source_revision,
      source_fingerprint: descriptor.source_fingerprint,
    },
    contract: { revision: descriptor.contract_revision },
    migration: { current: [descriptor.migration_head] },
  }
  async function inspect() {
    try {
      const result = await run(process.execPath, [probe.pathname, 'probe-fixture'], {
        env: {
          ...process.env,
          INKCRE_DATABASE_PROVIDER: 'external',
          INKCRE_DATABASE_RUNTIME_DESCRIPTOR: descriptorPath,
        },
        timeout: 5000,
      })
      return { code: 0, ...JSON.parse(result.stdout) }
    } catch (error) {
      return { code: error.code, ...JSON.parse(error.stdout) }
    }
  }
  try {
    const missing = await inspect()
    assert.equal(missing.code, 1)
    assert.equal(missing.stage, 'descriptor')
    assert.match(missing.reason, /ENOENT/)

    await writeFile(
      descriptorPath,
      JSON.stringify({ ...descriptor, owner_repository: 'InKCre/core-py' })
    )
    const staleOwner = await inspect()
    assert.equal(staleOwner.code, 1)
    assert.match(staleOwner.reason, /expected InKCre\/impl-py, got "InKCre\/core-py"/)

    await writeFile(descriptorPath, JSON.stringify(descriptor))
    await writeFile(
      join(directory, 'readiness.json'),
      JSON.stringify({
        ...readiness,
        runtime: { ...readiness.runtime, source_fingerprint: 'c'.repeat(64) },
      })
    )
    const staleSource = await inspect()
    assert.equal(staleSource.code, 1)
    assert.equal(staleSource.stage, 'contract')
    assert.match(staleSource.reason, /source_fingerprint mismatch/)
    assert.equal(requests.length, 0)

    await writeFile(join(directory, 'readiness.json'), JSON.stringify(readiness))
    coreStatus = 503
    const unavailable = await inspect()
    assert.equal(unavailable.code, 1)
    assert.equal(unavailable.stage, 'transport')
    assert.deepEqual(unavailable.checks, { tunnel: true, core: false, postgrest: true })

    coreStatus = 200
    const ready = await inspect()
    assert.equal(ready.code, 0)
    assert.equal(ready.ready, true)
    assert.equal(ready.runtime_instance, descriptor.identity)
    assert.equal(ready.source_fingerprint, descriptor.source_fingerprint)
    await assert.rejects(
      run(
        process.execPath,
        [new URL('../database-runtime.mjs', import.meta.url).pathname, 'stop', 'probe-fixture'],
        {
          env: {
            ...process.env,
            INKCRE_DATABASE_PROVIDER: 'external',
            INKCRE_DATABASE_RUNTIME_DESCRIPTOR: descriptorPath,
          },
        }
      ),
      /owned by impl-py; client-web cannot stop it/
    )
    assert.ok(requests.every((method) => method === 'GET'))
    assert.deepEqual(JSON.parse(await readFile(descriptorPath, 'utf8')), descriptor)
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
    await rm(directory, { recursive: true, force: true })
  }
})
