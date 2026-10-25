import assert from 'node:assert/strict'
import test from 'node:test'

import { inspectCoreRelease, validateCoreReleaseConfig } from '../core-release-lib.mjs'

const imageId = `sha256:${'a'.repeat(64)}`
const digest = `ghcr.io/inkcre/impl-py@${imageId}`
const manifest = {
  format: 1,
  contract_revision: 'test-contract',
  source_revision: 'b'.repeat(40),
  schema: { path: '/app/database-contract/database-schema.sql', sha256: 'c'.repeat(64), size: 1 },
  roles: { path: '/app/database-contract/database-roles.sql', sha256: 'd'.repeat(64), size: 1 },
  runtime_contract: {
    path: '/app/database-contract/runtime-contract.json',
    sha256: 'e'.repeat(64),
    size: 1,
  },
}
const contract = {
  format: 1,
  revision: manifest.contract_revision,
  source_revision: manifest.source_revision,
  protocol: { schema: 'inkcre' },
  jwt: { algorithm: 'HS256', role: 'authenticated' },
}

void test('explicit local inspection pins all artifact reads to the same existing image', () => {
  const calls = []
  const runDocker = (args) => {
    calls.push(args)
    if (args[0] === 'image') return imageId
    assert.equal(args[2], imageId)
    return JSON.stringify(args[3] === 'cat' ? contract : manifest)
  }
  const release = inspectCoreRelease(runDocker, imageId, { allowLocalImage: true })
  assert.equal(release.image, imageId)
  assert.equal(release.runtime_contract.revision, manifest.contract_revision)
  assert.deepEqual(calls[0], ['image', 'inspect', '--format={{.Id}}', imageId])
  assert.equal(
    calls.some((args) => args.includes('pull')),
    false
  )
})

void test('local identity opt-in never admits a mutable tag or mismatched image', () => {
  const unexpectedDocker = () => assert.fail('invalid identity must fail before Docker')
  assert.throws(() => inspectCoreRelease(unexpectedDocker, imageId), /digest-pinned/)
  assert.throws(
    () => inspectCoreRelease(unexpectedDocker, 'candidate:latest', { allowLocalImage: true }),
    /digest-pinned/
  )
  assert.throws(
    () => inspectCoreRelease(() => 'sha256:other', imageId, { allowLocalImage: true }),
    /identity does not match/
  )
})

void test('published digest admission and artifact checks remain independent of local opt-in', () => {
  const runDocker = (args) => JSON.stringify(args[3] === 'cat' ? contract : manifest)
  assert.equal(inspectCoreRelease(runDocker, digest).image, digest)
  assert.throws(
    () =>
      inspectCoreRelease((args) => (args[0] === 'image' ? imageId : '{}'), imageId, {
        allowLocalImage: true,
      }),
    /schema manifest identity is invalid/
  )
  assert.throws(
    () =>
      validateCoreReleaseConfig({
        format: 1,
        repository: 'InKCre/impl-py',
        stable_image: 'ghcr.io/inkcre/impl-py:stable',
        canonical_candidate: {
          image: imageId,
          source_revision: manifest.source_revision,
          contract_revision: manifest.contract_revision,
        },
      }),
    /published repository digest/
  )
})
