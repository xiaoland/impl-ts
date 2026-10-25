import assert from 'node:assert/strict'
import test from 'node:test'
import {
  inspectBrowserArtifact,
  inspectBrowserRuntimeSource,
} from '../browser-runtime-contract.mjs'

void test('business links need no URL or hosting-provider approval in source or artifacts', () => {
  const source = `
<script setup lang="ts">
const documentation = 'https://docs.customer.example/api/config'
const localApiExample = 'http://127.0.0.1:8000'
const article = 'https://public-articles.herokuapp.com/posts/123'
const stopwordReference = 'https://raw.githubusercontent.com/stopwords-iso/stopwords-en/master/stopwords-en.json'
const businessRecord = 'https://records.example/13e8c5b7-4d62-42d0-ae54-a82261111234'
const DEFAULT_EXTENSION_REGISTRY_ORIGIN = 'https://registry.inkcre.dev'
const externalApi = new OpenAI({ baseURL: 'https://ai.customer.example/v1' })
</script>
<template>
  <a :href="\`https://x.com/i/status/\${post.id}\`">Original</a>
  <a :href="\`https://x.com/i/user/\${item.userId}\`">User</a>
  <a :href="\`https://x.com/hashtag/\${topic}\`">Topic</a>
  <a :href="\`https://x.com/search?q=\${query}\`">Search</a>
</template>`
  assert.deepEqual(inspectBrowserRuntimeSource(source, 'extensions/twitter/src/Post.vue'), [])
  assert.deepEqual(inspectBrowserArtifact(source), [])
  assert.deepEqual(inspectBrowserArtifact(JSON.stringify({ sourcesContent: [source] })), [])
})

void test('the same custom address is allowed as content and rejected as deployment configuration', () => {
  const source = "const endpoint = 'https://customer.example/service'\n"
  assert.deepEqual(
    inspectBrowserRuntimeSource(source + 'const article = { href: endpoint }', 'a.ts'),
    []
  )
  for (const assignment of [
    'const config = { INKCRE_PGREST_URL: endpoint }',
    'config.INKCRE_PGREST_URL = endpoint',
    "config['telemetry_peer_relay_url'] = endpoint",
    'const config = { extension_registry_url: z.string().default(endpoint) }',
    'config.INKCRE_PGREST_URL = configured || endpoint',
    'config.INKCRE_PGREST_URL ??= endpoint',
    'const { INKCRE_PGREST_URL: address = endpoint } = form',
    "const host = 'customer.example'; const config = { INKCRE_PGREST_URL: `https://${host}/rest` }",
    'new DBAPIClient("blocks", undefined, "inkcre", endpoint)',
    'new PostgrestClient(new URL("rest", endpoint).href)',
    'import { DBAPIClient as Database } from "@inkcre/core"; new Database("blocks", undefined, "inkcre", endpoint)',
    'const config = { INKCRE_PGREST_URL: z.preprocess(normalize, z.string().default(endpoint)) }',
    'new ExtensionRegistryOriginResolver(() => endpoint)',
    'rawPostgrestFetch("/rpc/read", { baseUrl: endpoint })',
    "useWebExtensionStorage('inkcreApi', endpoint)",
  ]) {
    const errors = inspectBrowserRuntimeSource(source + assignment, 'a.ts')
    assert.equal(errors.length, 1, assignment)
    assert.match(errors[0], /hardcodes .*runtime-owned configuration/)
  }
})

void test('runtime values, empty defaults, generated identity and shadowed constants stay valid', () => {
  const source = `
const endpoint = 'https://public.example'
const config = {
  INKCRE_PGREST_URL: urlSchema.default('').meta({ description: endpoint }),
  INKCRE_PEER_ID: z.uuid().default(() => crypto.randomUUID()),
  INKCRE_JWT_SECRET: z.string().default(''),
  extension_registry_url: peerConfig.extension_registry_url,
  telemetry_peer_relay_url: userConfig.telemetry_peer_relay_url,
}
function connect(endpoint: string) {
  config.INKCRE_PGREST_URL = endpoint
  new DBAPIClient('blocks', undefined, 'inkcre', endpoint)
}
for (const endpoint of runtimeEndpoints) {
  config.INKCRE_PGREST_URL = endpoint
}
function restore(form: unknown) {
  const { endpoint } = form
  config.INKCRE_PGREST_URL = endpoint
}
config.INKCRE_PGREST_URL = form.INKCRE_PGREST_URL
signDatabaseToken(config.INKCRE_JWT_SECRET)
rawPostgrestFetch('/rpc/read')
useWebExtensionStorage('inkcreApi', '')
`
  assert.deepEqual(inspectBrowserRuntimeSource(source, 'runtime.ts'), [])
})

void test('fixed identity and credential defaults fail without printing credential values', () => {
  const source = `
const credential = 'private-sample-credential'
const ConfiguredSecret = z.string().default(() => credential)
const config = { INKCRE_JWT_SECRET: ConfiguredSecret, INKCRE_PEER_ID: 'fixed-peer' }
signDatabaseToken(credential)
`
  const errors = inspectBrowserRuntimeSource(source, 'runtime.ts')
  assert.equal(errors.length, 3)
  assert.match(errors.join('\n'), /INKCRE_JWT_SECRET/)
  assert.match(errors.join('\n'), /INKCRE_PEER_ID/)
  assert.equal(errors.join('\n').includes('private-sample-credential'), false)
})

void test('Vue script assignments are checked without interpreting template links as configuration', () => {
  const errors = inspectBrowserRuntimeSource(
    `
<script setup lang="ts">
const endpoint = 'https://private.customer.example'
const config = { INKCRE_PGREST_URL: endpoint }
</script>
<template><a href="https://private.customer.example">Article</a></template>`,
    'Settings.vue'
  )
  assert.equal(errors.length, 1)
  assert.match(errors[0], /Settings.vue:4 hardcodes INKCRE_PGREST_URL/)
})

void test('retired bootstrap and credential channels remain rejected without blocking documentation URLs', () => {
  assert.deepEqual(
    inspectBrowserRuntimeSource(
      "const docs = 'https://docs.example/api/config'; fetch('/api/config')",
      'runtime.ts'
    ),
    ['runtime.ts uses the retired /api/config runtime-config channel']
  )
  assert.deepEqual(inspectBrowserArtifact('fetch("/api/config")'), [
    'retired /api/config runtime-config channel',
  ])
  assert.deepEqual(inspectBrowserArtifact('import.meta.env.VITE_INKCRE_JWT_SECRET'), [
    'build-supplied JWT credential channel',
  ])
  assert.deepEqual(inspectBrowserArtifact('const peer = "063cd1df-c495-5006-a119-67aa633b26be"'), [
    'environment-specific client identity',
  ])
  assert.deepEqual(
    inspectBrowserRuntimeSource(
      "fetch('https://raw.githubusercontent.com/stopwords-iso/stopwords-en/master/stopwords-en.json')",
      'runtime.ts'
    ),
    ['runtime.ts fetches the retired mutable stopword bootstrap fallback']
  )
})
