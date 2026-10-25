import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  main,
  savedCandidate,
  validateReceipt,
  verifyRelease,
  validateRecoveryRun,
} from './publish-core-sdk.mjs'

void test('partial reruns require the original unexpired SDK candidate', () => {
  assert.equal(savedCandidate([], '1'), undefined)
  assert.throws(() => savedCandidate([], '1', true), /original workflow candidate/)
  assert.throws(() => savedCandidate([], '2'), /Missing SDK candidate/)
  assert.throws(
    () => savedCandidate([{ name: 'core-sdk-candidate', expired: true }], '2'),
    /expired/
  )
  const original = { name: 'core-sdk-candidate', id: 23, expired: false }
  assert.equal(savedCandidate([original], '2'), original)
})

void test('draft recovery uploads missing saved assets without replacing an existing archive', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'inkcre-sdk-publish-test-'))
  const originalDirectory = process.cwd()
  const originalPath = process.env.PATH
  const originalSource = process.env.SOURCE_REVISION
  const originalSummary = process.env.GITHUB_STEP_SUMMARY
  const originalFetch = globalThis.fetch
  const source = 'c'.repeat(40)
  const bytes = Buffer.from('saved SDK package')
  const receipt = {
    name: '@inkcre/core',
    version: '0.4.0',
    source_revision: source,
    asset: 'inkcre-core-0.4.0.tgz',
    sha256: createHash('sha256').update(bytes).digest('hex'),
  }
  try {
    await mkdir(`${root}/packages/core`, { recursive: true })
    await mkdir(`${root}/.core-sdk-delivery`)
    await writeFile(`${root}/packages/core/package.json`, JSON.stringify({ version: '0.5.0' }))
    await writeFile(`${root}/.core-sdk-delivery/source.json`, JSON.stringify(receipt))
    await writeFile(`${root}/.core-sdk-delivery/${receipt.asset}`, bytes)
    await writeFile(
      `${root}/gh`,
      `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync('calls.jsonl', JSON.stringify(args) + '\\n');
const route = args[1];
const method = args[args.indexOf('--method') + 1];
let response;
const asset = (name) => ({ name, url: 'https://api.github.com/' + (name.endsWith('.tgz') ? 'archive' : 'receipt'), browser_download_url: 'https://api.github.com/' + (name.endsWith('.tgz') ? 'archive' : 'receipt') });
const release = () => ({ id: 12, tag_name: 'core-v0.4.0', target_commitish: process.env.SOURCE_REVISION, draft: !fs.existsSync('published'), assets: [fs.existsSync('archiveUploaded') && asset('inkcre-core-0.4.0.tgz'), fs.existsSync('uploaded') && asset('source.json')].filter(Boolean) });
if (route.startsWith('https://uploads.github.com/')) {
  const name = new URL(route).searchParams.get('name');
  fs.writeFileSync(name.endsWith('.tgz') ? 'archiveUploaded' : 'uploaded', 'yes');
  response = asset(name);
} else if (method === 'POST') {
  fs.writeFileSync('created', 'yes');
  response = release();
} else if (method === 'PATCH') {
  fs.writeFileSync('published', 'yes');
  response = release();
}
process.stdout.write(JSON.stringify(response));
`
    )
    await chmod(`${root}/gh`, 0o700)
    await writeFile(`${root}/created`, 'yes')
    await writeFile(`${root}/archiveUploaded`, 'yes')
    process.chdir(root)
    process.env.PATH = `${root}:${originalPath}`
    process.env.SOURCE_REVISION = source
    delete process.env.GITHUB_STEP_SUMMARY
    globalThis.fetch = async (url) => {
      if (url.endsWith('/archive')) return new Response(bytes)
      if (url.endsWith('/receipt')) return new Response(JSON.stringify(receipt))
      if (url.includes('/git/ref/'))
        return Response.json({ object: { type: 'commit', sha: source } })
      const exists = async (file) =>
        readFile(file).then(
          () => true,
          () => false
        )
      if (!(await exists('created')) || (await exists('invisibleList'))) return Response.json([])
      const assets = []
      if (await exists('archiveUploaded'))
        assets.push({
          name: receipt.asset,
          url: 'https://api.github.com/archive',
          browser_download_url: 'https://api.github.com/archive',
        })
      if (await exists('uploaded'))
        assets.push({
          name: 'source.json',
          url: 'https://api.github.com/receipt',
          browser_download_url: 'https://api.github.com/receipt',
        })
      return Response.json([
        {
          id: 12,
          tag_name: 'core-v0.4.0',
          draft: !(await exists('published')),
          prerelease: false,
          target_commitish: source,
          assets,
        },
      ])
    }
    await main('publish')
    const calls = (await readFile('calls.jsonl', 'utf8')).trim().split('\n').map(JSON.parse)
    assert.equal(calls.length, 2)
    assert.match(calls[0][1], /releases\/12\/assets\?name=source.json$/)
    assert.ok(calls[1].includes('PATCH'))
    await main('publish')
    assert.equal(
      await readFile('calls.jsonl', 'utf8'),
      calls.map((args) => JSON.stringify(args)).join('\n') + '\n'
    )
    for (const file of ['created', 'archiveUploaded', 'uploaded', 'published', 'calls.jsonl'])
      await rm(file)
    await writeFile('invisibleList', 'yes')
    await main('publish')
    const freshCalls = (await readFile('calls.jsonl', 'utf8')).trim().split('\n').map(JSON.parse)
    assert.equal(freshCalls.length, 4)
    assert.ok(
      freshCalls[0].includes('tag_name=core-v0.4.0'),
      'Recovered payload keeps its own version'
    )
    assert.match(freshCalls[1][1], /releases\/12\/assets/)
    assert.match(freshCalls[2][1], /releases\/12\/assets/)
    assert.ok(freshCalls[3].includes('PATCH'))
  } finally {
    process.chdir(originalDirectory)
    process.env.PATH = originalPath
    if (originalSource === undefined) delete process.env.SOURCE_REVISION
    else process.env.SOURCE_REVISION = originalSource
    if (originalSummary === undefined) delete process.env.GITHUB_STEP_SUMMARY
    else process.env.GITHUB_STEP_SUMMARY = originalSummary
    globalThis.fetch = originalFetch
    await rm(root, { recursive: true, force: true })
  }
})

void test('published SDK is verified against source tag and every saved package byte', async () => {
  const bytes = Buffer.from('original prebuilt SDK archive')
  const receipt = validateReceipt({
    name: '@inkcre/core',
    version: '0.4.0',
    source_revision: 'a'.repeat(40),
    asset: 'inkcre-core-0.4.0.tgz',
    sha256: createHash('sha256').update(bytes).digest('hex'),
  })
  const release = {
    draft: false,
    prerelease: false,
    assets: [
      {
        name: 'source.json',
        url: 'https://api.github.com/receipt',
        browser_download_url: 'https://api.github.com/receipt',
      },
      {
        name: receipt.asset,
        url: 'https://api.github.com/archive',
        browser_download_url: 'https://api.github.com/archive',
      },
    ],
  }
  const originalFetch = globalThis.fetch
  let archive = bytes
  let tag = receipt.source_revision
  globalThis.fetch = async (url, options) => {
    if (url.endsWith('/receipt') || url.endsWith('/archive'))
      assert.equal(
        options.headers.Authorization,
        undefined,
        'Published SDK bytes must be anonymously readable'
      )
    if (url.endsWith('/receipt')) return new Response(JSON.stringify(receipt))
    if (url.endsWith('/archive')) return new Response(archive)
    return Response.json({ object: { type: 'commit', sha: tag } })
  }
  try {
    assert.deepEqual(await verifyRelease(release, '0.4.0', receipt), receipt)
    archive = Buffer.from('changed archive')
    await assert.rejects(verifyRelease(release, '0.4.0', receipt), /bytes differ/)
    archive = bytes
    tag = 'b'.repeat(40)
    await assert.rejects(verifyRelease(release, '0.4.0', receipt))
    tag = receipt.source_revision
    await assert.rejects(
      verifyRelease(release, '0.4.0', { ...receipt, source_revision: 'b'.repeat(40) }),
      /other bytes\/source/
    )
    await assert.rejects(verifyRelease({ ...release, draft: true }, '0.4.0', receipt), /not public/)
  } finally {
    globalThis.fetch = originalFetch
  }
})

void test('recovery accepts only the same completed workflow from protected main history', () => {
  const run = {
    event: 'push',
    head_branch: 'main',
    path: '.github/workflows/core-sdk-release.yml',
    status: 'completed',
    head_sha: 'a'.repeat(40),
  }
  assert.equal(validateRecoveryRun(run, { status: 'ahead' }), run.head_sha)
  for (const field of ['event', 'head_branch', 'path', 'status', 'head_sha'])
    assert.throws(() => validateRecoveryRun({ ...run, [field]: 'invalid' }, { status: 'ahead' }))
  assert.throws(() => validateRecoveryRun(run, { status: 'diverged' }), /main history/)
})
