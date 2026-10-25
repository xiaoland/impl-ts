import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import {
  authStore,
  Block,
  configStore,
  databaseRuntimeContract,
  peerJwtContract,
  presentLexicalMatches,
  Resolver,
  TextResolver,
} from '../../packages/core/dist/index.js'

void test('SDK 0.4 preserves the legacy JWT default without changing database admission truth', async () => {
  const generated = JSON.parse(
    await readFile(
      new URL('../../packages/core/src/database/runtime-contract.generated.json', import.meta.url),
      'utf8'
    )
  )
  assert.equal(Object.hasOwn(generated.jwt, 'maximum_lifetime_seconds'), false)
  assert.equal(peerJwtContract.maximum_lifetime_seconds, 86_400)
  assert.equal(databaseRuntimeContract.jwt, peerJwtContract)
  configStore.metaConfig.INKCRE_JWT_SECRET = 'sdk-compatibility-test-only'
  try {
    const token = await authStore.newToken()
    const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())
    assert.equal(claims.exp - claims.iat, peerJwtContract.maximum_lifetime_seconds)
  } finally {
    configStore.metaConfig.INKCRE_JWT_SECRET = ''
  }
})

void test('optional recall APIs preserve an ordinary resolver and its original match', async () => {
  TextResolver.previewRenderer = { render: () => null }
  TextResolver.solvedContentRenderer = { render: () => null }
  Resolver.register(TextResolver.type, TextResolver)
  const block = Block.parse({
    id: 1,
    resolver: TextResolver.type,
    content: 'article',
    storage: null,
    updated_at: '2026-10-21T00:00:00Z',
  })
  const match = { block, label: 'Article', excerpt: 'article', evidence: 'text_substring', rank: 1 }
  const resolver = new TextResolver(block)
  assert.equal(await resolver.getRecallTarget(match), null)
  const [group] = await presentLexicalMatches([match])
  assert.equal(group.block, block)
  assert.equal(group.readable, false)
  assert.equal(group.matches[0], match)
})
