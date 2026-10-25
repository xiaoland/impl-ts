import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { expect, test } from '@playwright/test'
import { SignJWT } from 'jose'

const postgrestUrl = process.env.INKCRE_E2E_POSTGREST_URL!
const jwtSecret = process.env.INKCRE_E2E_JWT_SECRET!
const coreUrl = process.env.INKCRE_E2E_CORE_URL!
function getArchiveBase(): URL {
  return new URL('twitter/x-monkey/', coreUrl.endsWith('/') ? coreUrl : `${coreUrl}/`)
}

type BlockRow = { id: number; resolver: string; content: string }
type RelationRow = { from_: number; to_: number; content: string }
type LexicalJob = { id: number; status: string; state: Record<string, unknown> }
type CorePeerRow = {
  id: string
  application_version: string
  lease_expires_at: string
  capabilities: Array<{ id: string; inbound: { parameters: { url?: string } } }>
}

const CORE_LEXICAL_MAINTAIN_JOB = 'core.feature_retrieval.lexical.maintain.v1'

function coreBase(): URL {
  return new URL(coreUrl.endsWith('/') ? coreUrl : `${coreUrl}/`)
}

async function databaseToken(): Promise<string> {
  return new SignJWT({ role: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .setIssuer('inkcre-peer')
    .setAudience('inkcre-api')
    .sign(new TextEncoder().encode(jwtSecret))
}

async function databaseRows<Row>(path: string): Promise<Row[]> {
  const response = await fetch(new URL(path, postgrestUrl), {
    headers: { Authorization: `Bearer ${await databaseToken()}` },
    signal: AbortSignal.timeout(15_000),
  })
  const body = await response.text()
  expect(response.ok, body).toBe(true)
  return JSON.parse(body) as Row[]
}

async function archiveRequest(
  page: import('@playwright/test').Page,
  url: string,
  data?: unknown
): Promise<{ status: number; body: string }> {
  return page.evaluate(
    async ({ url, data }) => {
      const response = await fetch(url, {
        method: data === undefined ? 'GET' : 'POST',
        headers: { 'x-tweet-db-client': 'x-monkey', 'Content-Type': 'application/json' },
        body: data === undefined ? undefined : JSON.stringify(data),
        signal: AbortSignal.timeout(15_000),
      })
      return { status: response.status, body: await response.text() }
    },
    { url, data }
  )
}

async function maintainLexicalIndex(onCreated: (id: number) => Promise<void>): Promise<LexicalJob> {
  const authorization = { Authorization: `Bearer ${await databaseToken()}` }
  const created = await fetch(new URL('jobs', coreBase()), {
    method: 'POST',
    headers: { ...authorization, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: CORE_LEXICAL_MAINTAIN_JOB,
      parameters: { options: { max_records: 1000 } },
    }),
    signal: AbortSignal.timeout(15_000),
  })
  const createdBody = await created.text()
  expect(created.status, createdBody).toBe(201)
  const initial = JSON.parse(createdBody) as LexicalJob
  await onCreated(initial.id)

  const read = async (): Promise<LexicalJob> => {
    const response = await fetch(new URL(`jobs/${initial.id}`, coreBase()), {
      headers: authorization,
      signal: AbortSignal.timeout(15_000),
    })
    const body = await response.text()
    expect(response.ok, body).toBe(true)
    return JSON.parse(body) as LexicalJob
  }
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    const job = await read()
    if (job.status === 'finished') return job
    if (['failed', 'timed_out', 'aborted'].includes(job.status)) {
      throw new Error(
        `Lexical maintenance Job #${job.id} ${job.status}: ${JSON.stringify(job.state)}`
      )
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  throw new Error(`Lexical maintenance Job #${initial.id} did not finish within 120 seconds.`)
}

async function expectPostSearchResult(
  page: import('@playwright/test').Page,
  query: string,
  blockId: number
): Promise<import('@playwright/test').Locator> {
  if (new URL(page.url()).pathname !== '/') await page.goto('/')
  const search = page.getByRole('searchbox', { name: 'Search the info base' })
  await expect(search).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('.app-connection')).toBeHidden({ timeout: 30_000 })
  await search.fill(query)
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await expect(page).toHaveURL((url) => url.searchParams.get('q') === query)
  const result = page
    .locator('.info-base-list-view__matches li')
    // Excerpts vary with the query; the collapsed Details retain the exact Block identity.
    .filter({
      has: page.locator('details button').filter({ hasText: new RegExp(`^\\s*#${blockId}\\s+·`) }),
    })
  await expect(result).toBeVisible({ timeout: 30_000 })
  return result
}

test.afterEach(async ({ page: _page }, testInfo) => {
  const path = testInfo.outputPath('run.json')
  let record: Record<string, unknown>
  try {
    record = JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  await writeFile(path, `${JSON.stringify({ ...record, result: testInfo.status }, null, 2)}\n`)
  await testInfo.attach('candidate and fixture record', { path, contentType: 'application/json' })
})

test('HTTP transport failures do not log signed credentials or browser Cookies', async ({
  page,
  context,
}) => {
  const sentinel = 'FAKE_ACCEPTANCE_CREDENTIAL_SENTINEL'
  let sawAuthorization = false
  let sawCookie = false
  const server = createServer((request, response) => {
    if (request.url === '/disconnect') {
      sawAuthorization ||= request.headers.authorization === `Bearer ${sentinel}`
      sawCookie ||= request.headers.cookie?.includes(sentinel) ?? false
      request.socket.destroy()
    } else response.end('<!doctype html><title>Acceptance transport check</title>')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as { port: number }
  const base = `http://127.0.0.1:${address.port}`
  try {
    const signedError = await fetch(`${base}/disconnect`, {
      headers: { Authorization: `Bearer ${sentinel}` },
    }).catch((error: Error) => error)
    if (!(signedError instanceof Error)) throw new Error('Expected the connection to fail')
    expect(String(signedError)).not.toContain(sentinel)
    await context.addCookies([{ name: 'acceptance', value: sentinel, url: base }])
    await page.goto(base)
    const cookieError = await archiveRequest(page, `${base}/disconnect`).catch(
      (error: Error) => error
    )
    if (!(cookieError instanceof Error)) throw new Error('Expected the connection to fail')
    expect(String(cookieError)).not.toContain(sentinel)
    expect(sawAuthorization).toBe(true)
    expect(sawCookie).toBe(true)
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('Core self-hosted connection writes native records that the real Twitter MF can read', async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(240_000)
  for (const key of [
    'INKCRE_E2E_CORE_URL',
    'INKCRE_E2E_POSTGREST_URL',
    'INKCRE_E2E_WEB_URL',
    'INKCRE_E2E_JWT_SECRET',
    'INKCRE_E2E_CORE_SOURCE_SHA',
  ]) {
    if (!process.env[key])
      throw new Error(`${key} is required before this journey can write fixtures`)
  }
  if (!/^[a-f0-9]{40}$/.test(process.env.INKCRE_E2E_CORE_SOURCE_SHA!)) {
    throw new Error(
      'INKCRE_E2E_CORE_SOURCE_SHA must identify the Core candidate reported by its deployment owner'
    )
  }
  for (const value of [coreUrl, postgrestUrl, process.env.INKCRE_E2E_WEB_URL!]) {
    const url = new URL(value)
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      throw new Error(
        'Acceptance endpoints must be HTTP(S) URLs without embedded credentials, query or fragment'
      )
    }
  }
  const archiveBase = getArchiveBase()
  const webOrigin = new URL(process.env.INKCRE_E2E_WEB_URL!).origin
  const stamp = `${Date.now()}`
  const record: Record<string, unknown> = {
    started_at: new Date().toISOString(),
    core_url: coreUrl,
    postgrest_url: postgrestUrl,
    web_url: process.env.INKCRE_E2E_WEB_URL,
    declared_core_source_revision: process.env.INKCRE_E2E_CORE_SOURCE_SHA,
    fixture_stamp: stamp,
    cleanup:
      'The isolated info-base owner removes this run data; this script does not delete shared rows.',
  }
  await mkdir(testInfo.outputDir, { recursive: true })
  async function recordPhase(phase: string, observations: Record<string, unknown> = {}) {
    Object.assign(record, observations, { phase })
    await writeFile(testInfo.outputPath('run.json'), `${JSON.stringify(record, null, 2)}\n`)
  }
  await recordPhase('preflight')
  const ready = await fetch(new URL('readyz', coreBase()), { signal: AbortSignal.timeout(15_000) })
  if (!ready.ok) throw new Error(`Core readiness returned HTTP ${ready.status}`)
  const readiness = await ready.json()
  expect(readiness.database.status, 'Core must report an admitted database').toBe('ok')
  const candidateResponse = await fetch(new URL('preview-candidate.json', webOrigin), {
    signal: AbortSignal.timeout(15_000),
  })
  if (!candidateResponse.ok)
    throw new Error('Web candidate metadata is required; select a prepared Preview snapshot')
  const candidate = (await candidateResponse.json()) as {
    source_revision: string
    build_id: string
    distributions: Array<{ manifest: string }>
  }
  const twitterCandidate = candidate.distributions?.find((item) =>
    item.manifest.startsWith('/extensions/inkcre/twitter/')
  )
  if (!/^[a-f0-9]{40}$/.test(candidate.source_revision) || !twitterCandidate) {
    throw new Error('Web snapshot must identify its source and Twitter MF distribution')
  }
  let corePeers: CorePeerRow[] = []
  await expect
    .poll(
      async () => {
        const peers = await databaseRows<CorePeerRow>(
          'peers?select=id,application_version,lease_expires_at,capabilities'
        )
        corePeers = peers.filter(
          (peer) =>
            Date.parse(peer.lease_expires_at) > Date.now() &&
            peer.capabilities.some(
              (capability) =>
                capability.id === 'core.extension.management.v2' &&
                capability.inbound?.parameters?.url ===
                  new URL('extension-management/v2', coreBase()).href
            )
        )
        return corePeers.length
      },
      {
        timeout: 30_000,
        message: 'PostgREST must expose the live Core Peer selected for this journey',
      }
    )
    .toBe(1)
  const nativeResponse = await fetch(new URL('extension-management/v2', coreBase()), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${await databaseToken()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action: 'status', extension: 'inkcre/twitter' }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!nativeResponse.ok)
    throw new Error(`Native Distribution status returned HTTP ${nativeResponse.status}`)
  const nativeStatus = await nativeResponse.json()
  const nativeRows = nativeStatus.extensions.filter(
    (row: { name: string }) => row.name === 'inkcre/twitter'
  )
  const nativeDistributions = nativeRows.map(
    (row: {
      name: string
      distribution: string
      version: string
      loaded_version: string | null
      enabled: boolean
      running: boolean
      restart_required: boolean
      operation: string | null
    }) => ({
      peer_id: nativeStatus.peer_id,
      name: row.name,
      distribution: row.distribution,
      version: row.version,
      loaded_version: row.loaded_version,
      enabled: row.enabled,
      running: row.running,
      restart_required: row.restart_required,
      operation: row.operation,
    })
  )
  await recordPhase('preflight', { native_distributions: nativeDistributions })
  expect(nativeStatus.peer_id, 'Native status must belong to the observed Core Peer').toBe(
    corePeers[0].id
  )
  expect(nativeDistributions, 'The owner must select and enable the Python Distribution').toEqual([
    {
      peer_id: corePeers[0].id,
      name: 'inkcre/twitter',
      distribution: 'python',
      version: expect.stringMatching(/\S/),
      loaded_version: nativeDistributions[0]?.version,
      enabled: true,
      running: true,
      restart_required: false,
      operation: null,
    },
  ])
  await recordPhase('connecting', {
    core_peer: { id: corePeers[0].id, application_version: corePeers[0].application_version },
    database_contract: readiness.database.contract,
    migration: readiness.database.migration,
    web_candidate: candidate,
  })
  const userId = `${stamp}01`
  const postId = `${stamp}02`
  const quoteId = `${stamp}03`
  const replyId = `${stamp}04`
  const mediaId = `${stamp}05`
  const failedMediaId = `${stamp}07`
  const videoId = `${stamp}08`
  const alternateMediaId = `${stamp}09`
  const imageUrl = 'https://pbs.twimg.com/media/inkcre-acceptance-no-fetch.jpg'
  const failedImageUrl = 'https://pbs.twimg.com/media/inkcre-acceptance-controlled-failure.jpg'
  const videoCoverUrl = 'https://pbs.twimg.com/media/inkcre-acceptance-video-cover.jpg'
  const alternateImageUrl = 'https://media.example.net/inkcre-alternate.png'
  const lowVideoUrl = 'https://video.twimg.com/inkcre-acceptance-low.mp4'
  const highVideoUrl = 'https://clips.example.net/inkcre-acceptance-high.mp4'
  const playlistUrl = 'https://video.twimg.com/inkcre-acceptance.m3u8'

  expect((await page.context().cookies()).length).toBe(0)
  let secretTransmitted = false
  let webOpenedBeforeConnection = false
  let connectionComplete = false
  const secretRepresentations = [
    jwtSecret,
    encodeURIComponent(jwtSecret),
    JSON.stringify(jwtSecret).slice(1, -1),
  ]
  context.on('request', (request) => {
    // Fulfilled media routes may never deliver extra headers; audit these synchronously.
    const payload = [request.url(), JSON.stringify(request.headers()), request.postData() ?? '']
    secretTransmitted ||= payload.some((value) =>
      secretRepresentations.some((secret) => value.includes(secret))
    )
    if (!connectionComplete && new URL(request.url()).origin === webOrigin) {
      webOpenedBeforeConnection = true
    }
  })
  await page.context().grantPermissions(['local-network-access'], {
    origin: archiveBase.origin,
  })
  await page.goto(new URL('account', archiveBase).toString())
  await expect(page.getByRole('heading', { name: 'InKCre x-monkey 连接' })).toBeVisible()
  const secretInput = page.getByLabel('JWT_SECRET', { exact: true })
  await expect(secretInput).toBeVisible()
  await expect(secretInput).toHaveAttribute('type', 'password')
  // Avoid placing the secret in Playwright action names or failure call logs.
  await secretInput.evaluate((input: HTMLInputElement, secret) => {
    input.value = secret
  }, jwtSecret)
  const connectResponse = page.waitForResponse(
    (response) =>
      response.url() === new URL('session', archiveBase).toString() &&
      response.request().method() === 'POST'
  )
  await page.getByRole('button', { name: 'Connect', exact: true }).click()
  const connect = await connectResponse
  expect(connect.ok()).toBe(true)
  const connectRequest = connect.request()
  const connectHeaders = await connectRequest.allHeaders()
  secretTransmitted ||= secretRepresentations.some((secret) =>
    JSON.stringify(connectHeaders).includes(secret)
  )
  expect(new URL(connectRequest.url()).search).toBe('')
  expect(connectHeaders.origin).toBe(archiveBase.origin)
  expect(Boolean(connectHeaders.authorization?.startsWith('Bearer '))).toBe(true)
  await expect(page.getByText('Connected', { exact: true })).toBeVisible()
  const session = await archiveRequest(page, new URL('api/v1/session', archiveBase).toString())
  expect(session.status, session.body).toBe(200)
  expect((JSON.parse(session.body) as { authenticated: boolean }).authenticated).toBe(true)
  const sessionCookie = (
    await page.context().cookies(new URL('account', archiveBase).toString())
  ).find((cookie) => cookie.name === 'inkcre_twitter_archive')
  expect(sessionCookie?.httpOnly).toBe(true)
  expect(sessionCookie?.secure).toBe(true)
  expect(sessionCookie?.sameSite).toBe('None')
  expect(secretTransmitted, 'The Core connection must not transmit JWT_SECRET.').toBe(false)
  expect(webOpenedBeforeConnection, 'Connect through Core before opening InKCre Web.').toBe(false)
  const secretStored = await page.evaluate(
    (secret) =>
      [localStorage, sessionStorage].some((storage) =>
        Object.values(storage).some((value: string) => value.includes(secret))
      ),
    jwtSecret
  )
  expect(secretStored, 'The Core connection must not persist JWT_SECRET in Web Storage.').toBe(
    false
  )
  connectionComplete = true
  await page.screenshot({
    path: 'test-results/twitter-acceptance/twitter-core-connected.png',
    fullPage: true,
    mask: [secretInput],
  })

  await recordPhase('submitting', {
    native_ids: [
      userId,
      postId,
      quoteId,
      replyId,
      mediaId,
      failedMediaId,
      videoId,
      alternateMediaId,
    ],
  })
  const submit = await archiveRequest(
    page,
    new URL('api/v1/archive/submit', archiveBase).toString(),
    {
      users: [
        {
          id: userId,
          handle: `acceptance_${stamp}`,
          name: 'Archive Acceptance Author',
          bio: { text: 'Profile bio retained for lookup.' },
        },
      ],
      posts: [
        {
          id: quoteId,
          authorId: userId,
          createdAt: '2026-10-18T10:00:00Z',
          text: { text: 'Quoted native post.' },
        },
        {
          id: replyId,
          authorId: userId,
          createdAt: '2026-10-18T10:01:00Z',
          text: { text: 'Reply target native post.' },
        },
        {
          id: postId,
          authorId: userId,
          createdAt: '2026-10-18T10:02:00Z',
          text: {
            text: 'Rich text survives with its author and context.',
            styles: [{ range: [0, 9], styles: ['Bold'] }],
            entities: [{ type: 'url', range: [39, 47], expanded: 'https://example.com' }],
          },
          replyTo: { postId: replyId, userId, handle: `acceptance_${stamp}` },
          quote: { postId: quoteId, url: `https://x.com/${stamp}/status/${quoteId}` },
          mediaIds: [mediaId, failedMediaId, videoId, alternateMediaId],
          article: {
            id: `${stamp}06`,
            title: 'Long-form archive article title',
            blocks: [{ type: 'unstyled', text: 'Long-form paragraph remains readable.' }],
          },
          counts: { likes: 4 },
        },
      ],
      media: [
        { id: mediaId, type: 'photo', url: imageUrl, alt: 'Acceptance image metadata' },
        {
          id: failedMediaId,
          type: 'photo',
          url: failedImageUrl,
          alt: 'Controlled failure image metadata',
        },
        {
          id: videoId,
          type: 'video',
          url: videoCoverUrl,
          alt: 'Acceptance video metadata',
          video: {
            durationMs: 1200,
            variants: [
              { url: lowVideoUrl, type: 'video/mp4', bitrate: 128000 },
              { url: playlistUrl, type: 'application/x-mpegURL', bitrate: 900000 },
              { url: highVideoUrl, type: 'video/mp4', bitrate: 256000 },
            ],
          },
        },
        {
          id: alternateMediaId,
          type: 'photo',
          url: alternateImageUrl,
          alt: 'Alternate CDN image metadata',
        },
      ],
    }
  )
  expect(submit.status, submit.body).toBe(200)
  const submitted = JSON.parse(submit.body) as {
    summary: { accepted: number; failed: number; total: number }
  }
  expect(submitted.summary).toMatchObject({ accepted: 8, failed: 0, total: 8 })
  await recordPhase('submitted', {
    submit_summary: submitted.summary,
  })

  const query = await archiveRequest(
    page,
    new URL('api/v1/archive/query', archiveBase).toString(),
    {
      users: [userId],
      posts: [postId],
      media: [mediaId, failedMediaId, videoId, alternateMediaId],
    }
  )
  expect(query.status, query.body).toBe(200)
  const queried = JSON.parse(query.body) as {
    posts: Array<{ id: string; status: string; data?: unknown }>
  }
  expect(queried.posts).toEqual([
    {
      id: postId,
      status: 'found',
      data: expect.objectContaining({
        article: expect.any(Object),
        replyTo: expect.any(Object),
        quote: expect.any(Object),
      }),
    },
  ])

  const peerId = randomUUID()
  await page.context().grantPermissions(['local-network-access'], { origin: webOrigin })
  await page.addInitScript(
    ({ webOrigin, postgrestUrl, jwtSecret, peerId }) => {
      if (location.origin !== webOrigin) return
      localStorage.setItem(
        'inkcre_app_config',
        JSON.stringify({
          INKCRE_PGREST_URL: postgrestUrl,
          INKCRE_JWT_SECRET: jwtSecret,
          INKCRE_PEER_ID: peerId,
        })
      )
    },
    { webOrigin, postgrestUrl, jwtSecret, peerId }
  )
  const twitterRemoteEntries: import('@playwright/test').Response[] = []
  const moduleOrigins = new Set<string>()
  context.on('response', (response) => {
    const url = new URL(response.url())
    if (url.pathname.includes('/extensions/inkcre/twitter/')) {
      moduleOrigins.add(url.origin)
    }
    if (
      url.pathname.includes('/extensions/inkcre/twitter/') &&
      url.pathname.endsWith('/remoteEntry.js')
    )
      twitterRemoteEntries.push(response)
  })
  await page.goto('/peers')
  const currentPeerCard = page.locator('.peer-card').filter({ hasText: 'This browser' })
  await expect(currentPeerCard).toBeVisible({ timeout: 30_000 })
  await currentPeerCard.getByRole('button', { name: 'Edit Config', exact: true }).click()
  const peerConfig = page.getByRole('dialog', { name: 'Edit Config', exact: true })
  const registryOrigin = peerConfig.getByLabel('Extension registry URL')
  if ((await registryOrigin.inputValue()) !== webOrigin) {
    await registryOrigin.fill(webOrigin)
    await peerConfig.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(peerConfig).toBeHidden()
  } else {
    await peerConfig.getByRole('button', { name: 'Cancel', exact: true }).click()
  }
  await page.goto('/extensions')
  const twitter = page.locator('.extension-card[aria-label="Twitter"]')
  await expect(twitter).toBeVisible({ timeout: 30_000 })
  const currentPeer = twitter
    .locator('.extension-card__peer-row')
    .filter({ hasText: 'This browser' })
  const install = currentPeer.getByRole('button', { name: 'Install', exact: true })
  const enable = currentPeer.getByRole('button', { name: 'Enable', exact: true })
  if (await install.count()) {
    await install.click()
    const versionDialog = page.getByRole('dialog', { name: 'Install', exact: true })
    await expect(versionDialog.getByRole('button', { name: 'Save', exact: true })).toBeEnabled({
      timeout: 30_000,
    })
    await versionDialog.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(versionDialog).toBeHidden({ timeout: 30_000 })
    await expect(enable).toBeVisible({ timeout: 30_000 })
  }
  if (await enable.count()) await enable.click()
  await expect(currentPeer.getByText(/Running/)).toBeVisible({ timeout: 30_000 })
  await expect.poll(() => twitterRemoteEntries.length, { timeout: 30_000 }).toBeGreaterThan(0)
  const remoteEntry = twitterRemoteEntries.at(-1)!
  expect(remoteEntry.ok()).toBe(true)
  expect(new URL(remoteEntry.url()).origin).toBe(webOrigin)
  await recordPhase('reading', {
    web_peer_id: peerId,
    registry_origin: webOrigin,
    remote_entry_url: remoteEntry.url(),
  })
  const posts = await databaseRows<BlockRow>(
    'blocks?select=id,resolver,content&resolver=eq.extensions.twitter.tweet.v2&order=id.desc&limit=100'
  )
  const postBlock = posts.find((row) => (JSON.parse(row.content) as { id?: string }).id === postId)
  expect(postBlock).toBeDefined()
  const mediaBlocks = await databaseRows<BlockRow>(
    'blocks?select=id,resolver,content&resolver=eq.extensions.twitter.media.v1&order=id.desc&limit=100'
  )
  const mediaBlock = mediaBlocks.find(
    (row) => (JSON.parse(row.content) as { id?: string }).id === mediaId
  )
  expect(mediaBlock).toBeDefined()
  const failedMediaBlock = mediaBlocks.find(
    (row) => (JSON.parse(row.content) as { id?: string }).id === failedMediaId
  )
  expect(failedMediaBlock).toBeDefined()
  const videoBlock = mediaBlocks.find(
    (row) => (JSON.parse(row.content) as { id?: string }).id === videoId
  )
  expect(videoBlock).toBeDefined()
  const alternateMediaBlock = mediaBlocks.find(
    (row) => (JSON.parse(row.content) as { id?: string }).id === alternateMediaId
  )
  expect(alternateMediaBlock).toBeDefined()
  const relations = await databaseRows<RelationRow>(
    `relations?select=from_,to_,content&from_=eq.${postBlock!.id}`
  )
  expect(
    relations.some((row) => row.to_ === mediaBlock!.id && JSON.parse(row.content).type === 'media')
  ).toBe(true)
  expect(
    relations.some(
      (row) => row.to_ === failedMediaBlock!.id && JSON.parse(row.content).type === 'media'
    )
  ).toBe(true)
  expect(
    relations.some((row) => row.to_ === videoBlock!.id && JSON.parse(row.content).type === 'media')
  ).toBe(true)
  expect(
    relations.some(
      (row) => row.to_ === alternateMediaBlock!.id && JSON.parse(row.content).type === 'media'
    )
  ).toBe(true)

  const controlledMediaReads: string[] = []
  await page.route('https://pbs.twimg.com/media/**', async (route) => {
    const url = route.request().url()
    if (url === imageUrl) {
      controlledMediaReads.push(url)
      await route.fulfill({
        status: 200,
        contentType: 'image/png',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
          'base64'
        ),
      })
      return
    }
    if (url === failedImageUrl) {
      controlledMediaReads.push(url)
      await route.fulfill({
        status: 503,
        contentType: 'text/plain',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: 'controlled source failure',
      })
      return
    }
    controlledMediaReads.push(url)
    await route.fulfill({ status: 502, body: 'unexpected media request' })
  })
  await page.route(/https:\/\/(video\.twimg\.com|clips\.example\.net)\//, async (route) => {
    const url = route.request().url()
    controlledMediaReads.push(url)
    await route.fulfill({
      status: url === highVideoUrl ? 200 : 502,
      contentType: url === highVideoUrl ? 'video/mp4' : 'text/plain',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body:
        url === highVideoUrl
          ? readFileSync(new URL('./twitter-rendering/public/video.mp4', import.meta.url))
          : 'unexpected variant',
    })
  })
  await page.route(alternateImageUrl, async (route) => {
    controlledMediaReads.push(route.request().url())
    await route.fulfill({
      status: 200,
      contentType: 'image/png',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
        'base64'
      ),
    })
  })

  await page.goto(`/info-base/graph/blocks/${postBlock!.id}/content`)
  const content = page.locator('.solved-content-popup')
  await expect(content).toContainText('Archive Acceptance Author', { timeout: 30_000 })
  await expect(content.getByRole('link', { name: 'View original post on X' })).toHaveAttribute(
    'href',
    `https://x.com/i/status/${postId}`
  )
  const boldSegment = content.locator('.rich-text--bold').filter({ hasText: 'Rich text' })
  await expect(boldSegment).toBeVisible()
  expect(
    Number(await boldSegment.evaluate((element) => getComputedStyle(element).fontWeight))
  ).toBeGreaterThanOrEqual(600)
  await expect(content).toContainText('Long-form archive article title')
  await expect(content).toContainText('Long-form paragraph remains readable.')
  await expect(content).toContainText('Replying to @')
  await expect(content.getByRole('region', { name: 'Quoted post' })).toBeVisible()
  await expect(content).toContainText('Acceptance image metadata')
  await expect(content).toContainText('Controlled failure image metadata')
  await expect(content).toContainText('Acceptance video metadata')
  await expect(content).toContainText('Alternate CDN image metadata')
  const mediaCards = content.locator('.tweet-media')
  await expect(mediaCards).toHaveCount(4)
  const imageCard = mediaCards.filter({ hasText: 'Acceptance image metadata' })
  const failedMediaCard = mediaCards.filter({ hasText: 'Controlled failure image metadata' })
  const videoCard = mediaCards.filter({ hasText: 'Acceptance video metadata' })
  const alternateMediaCard = mediaCards.filter({ hasText: 'Alternate CDN image metadata' })
  await expect(imageCard.getByRole('button', { name: /^Load (photo|video)/ })).toBeVisible()
  await expect(failedMediaCard.getByRole('button', { name: /^Load (photo|video)/ })).toBeVisible()
  await expect(videoCard.getByRole('button', { name: /^Load (photo|video)/ })).toBeVisible()
  await expect(
    alternateMediaCard.getByRole('button', { name: /^Load (photo|video)/ })
  ).toBeVisible()
  expect(
    await page.evaluate(
      ({
        imageUrl,
        failedImageUrl,
        videoCoverUrl,
        alternateImageUrl,
        lowVideoUrl,
        highVideoUrl,
        playlistUrl,
      }) =>
        performance
          .getEntriesByType('resource')
          .map((entry) => entry.name)
          .filter((name) =>
            [
              imageUrl,
              failedImageUrl,
              videoCoverUrl,
              alternateImageUrl,
              lowVideoUrl,
              highVideoUrl,
              playlistUrl,
            ].includes(name)
          ),
      {
        imageUrl,
        failedImageUrl,
        videoCoverUrl,
        alternateImageUrl,
        lowVideoUrl,
        highVideoUrl,
        playlistUrl,
      }
    )
  ).toEqual([])
  expect(controlledMediaReads).toEqual([])
  const imageRead = page.waitForRequest((request) => request.url() === imageUrl)
  await imageCard.getByRole('button', { name: /^Load (photo|video)/ }).click()
  await imageRead
  const loadedImage = imageCard.locator('img')
  await expect(loadedImage).toBeVisible()
  await expect(loadedImage).toHaveJSProperty('naturalWidth', 1)
  const failedImageRead = page.waitForRequest((request) => request.url() === failedImageUrl)
  await failedMediaCard.getByRole('button', { name: /^Load (photo|video)/ }).click()
  await failedImageRead
  await expect(failedMediaCard.getByRole('alert')).toContainText('HTTP 503')
  const videoRead = page.waitForRequest((request) => request.url() === highVideoUrl)
  await videoCard.getByRole('button', { name: /^Load (photo|video)/ }).click()
  await videoRead
  await expect(videoCard.locator('video')).toBeVisible()
  expect(await videoCard.locator('video').getAttribute('src')).toMatch(/^blob:/)
  const alternateImageRead = page.waitForRequest((request) => request.url() === alternateImageUrl)
  await alternateMediaCard.getByRole('button', { name: /^Load (photo|video)/ }).click()
  await alternateImageRead
  await expect(alternateMediaCard.locator('img')).toHaveJSProperty('naturalWidth', 1)
  expect(controlledMediaReads).toEqual([imageUrl, failedImageUrl, highVideoUrl, alternateImageUrl])

  await content.getByRole('button', { name: /^Replying to @/ }).click()
  await expect(page).toHaveURL(
    new RegExp(
      `/info-base/graph/blocks/${relations.find((row) => row.content.includes('reply'))?.to_}/content$`
    )
  )

  const indexJob = await maintainLexicalIndex((id) =>
    recordPhase('indexing', { lexical_job_id: id })
  )
  await recordPhase('indexed', {
    lexical_job_id: indexJob.id,
    post_block_id: postBlock!.id,
    media_block_ids: [
      mediaBlock!.id,
      failedMediaBlock!.id,
      videoBlock!.id,
      alternateMediaBlock!.id,
    ],
  })
  expect(indexJob.state).toMatchObject({ failed: 0, unavailable: 0 })
  await recordPhase('searching')
  for (const query of [postId, `acceptance_${stamp}`]) {
    await expectPostSearchResult(page, query, postBlock!.id)
  }
  const bodySearch = await expectPostSearchResult(
    page,
    'Rich text survives with its author',
    postBlock!.id
  )
  await bodySearch.locator('.info-base-list-view__match').click()
  await expect(page).toHaveURL((url) => url.pathname === `/info-base/list/blocks/${postBlock!.id}`)
  const inspector = page.getByRole('dialog', { name: 'Block Inspector', exact: true })
  await expect(inspector).toContainText(`#${postBlock!.id}`)
  await inspector.getByRole('button', { name: 'View content', exact: true }).click()
  await expect(page.locator('.solved-content-popup')).toContainText(
    'Rich text survives with its author and context.'
  )
  expect(secretTransmitted, 'Application requests must not transmit JWT_SECRET.').toBe(false)
  await page.screenshot({
    path: 'test-results/twitter-acceptance/twitter-x-monkey-final.png',
    fullPage: true,
  })
  await recordPhase('reopening')
  const reopened = await context.newPage()
  await page.close()
  await reopened.goto(new URL(`/info-base/graph/blocks/${postBlock!.id}/content`, webOrigin).href)
  await expect(reopened.locator('.solved-content-popup')).toContainText(
    'Rich text survives with its author and context.',
    { timeout: 30_000 }
  )
  await expect(reopened.locator('.solved-content-popup')).toContainText('Archive Acceptance Author')
  await recordPhase('reopened', {
    module_origins: [...moduleOrigins].sort(),
    reopened_url: reopened.url(),
  })
  expect([...moduleOrigins]).toEqual([webOrigin])
  expect(secretTransmitted, 'Application requests must not transmit JWT_SECRET.').toBe(false)
  await reopened.screenshot({ path: testInfo.outputPath('reopened.png'), fullPage: true })
})
