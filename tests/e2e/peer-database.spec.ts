import { expect, test, type Page } from '@playwright/test'
import { SignJWT } from 'jose'
import { readFileSync } from 'node:fs'
import { registerGitHubNativeTests } from './github-native'

const postgrestUrl = process.env.INKCRE_E2E_POSTGREST_URL!
const jwtSecret = process.env.INKCRE_E2E_JWT_SECRET!
const coreUrl = process.env.INKCRE_E2E_CORE_URL!
const clientVersion = JSON.parse(
  readFileSync(new URL('../../apps/client-web/package.json', import.meta.url), 'utf8')
).version

/** Navigate to Settings without replacing the document, so in-page runtimes and
 *  route gates created before the navigation stay alive (page.goto would reload). */
async function openSettings(page: Page): Promise<void> {
  await page.locator('button[aria-controls="app-side-panel"]').click()
  // The redesigned side panel renders navigation as links inside a popup.
  await page.getByLabel('Primary').getByRole('link', { name: 'Settings', exact: true }).click()
  await expect(page.getByLabel('PostgREST URL')).toBeVisible()
}

async function token(secret = jwtSecret) {
  return new SignJWT({ role: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .setIssuer('inkcre-peer')
    .setAudience('inkcre-api')
    .sign(new TextEncoder().encode(secret))
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ({ postgrestUrl, jwtSecret }) => {
      if (localStorage.getItem('inkcre_app_config')) return
      localStorage.setItem(
        'inkcre_app_config',
        JSON.stringify({
          INKCRE_PGREST_URL: postgrestUrl,
          INKCRE_JWT_SECRET: jwtSecret,
          INKCRE_PEER_ID: '00000000-0000-4000-8000-000000000001',
        })
      )
    },
    { postgrestUrl, jwtSecret }
  )
})

test('built browser artifact reads and writes the peer protocol', async ({ page }) => {
  await page.goto('/')

  const authorization = `Bearer ${await token()}`
  const result = await page.evaluate(
    async ({ postgrestUrl, authorization }) => {
      const read = await fetch(
        `${postgrestUrl}peers?select=id,name&id=eq.00000000-0000-4000-8000-000000000001`,
        { headers: { Authorization: authorization } }
      )
      const write = await fetch(`${postgrestUrl}peers?on_conflict=id`, {
        method: 'POST',
        headers: {
          Authorization: authorization,
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates,return=representation',
        },
        body: JSON.stringify({
          id: '11111111-1111-4111-8111-111111111111',
          name: 'peer-e2e',
          labels: ['e2e'],
          config: {},
          config_schema: {},
          capabilities: [],
          lease_expires_at: null,
        }),
      })
      const writeBody = await write.json()
      const cleanup = await fetch(
        `${postgrestUrl}peers?id=eq.11111111-1111-4111-8111-111111111111`,
        { method: 'DELETE', headers: { Authorization: authorization } }
      )
      return {
        readStatus: read.status,
        readBody: await read.json(),
        writeStatus: write.status,
        writeBody,
        cleanupStatus: cleanup.status,
      }
    },
    { postgrestUrl, authorization }
  )

  expect(result.readStatus).toBe(200)
  expect(result.readBody).toHaveLength(1)
  expect(result.writeStatus).toBe(201)
  expect(result.writeBody[0].id).toBe('11111111-1111-4111-8111-111111111111')
  expect(result.cleanupStatus).toBe(204)
})

test('startup shows pending and failed states without trapping a deep link', async ({ page }) => {
  const path = '/sources?startup-check=preserved'
  let release!: () => void
  const pending = () =>
    new Promise<void>((resolve) => {
      release = resolve
    })
  let gate = pending()
  await page.route('**/peers?**', async (route) => {
    if (
      route.request().method() === 'GET' &&
      new URL(route.request().url()).searchParams.get('id') ===
        'eq.00000000-0000-4000-8000-000000000001'
    ) {
      await gate
      // 401 is terminal; network failures and 503 retain the SDK's transport retries.
      await route.fulfill({
        status: 401,
        headers: { 'Access-Control-Allow-Origin': '*' },
        json: { message: 'Startup credentials rejected' },
      })
    } else await route.continue()
  })

  try {
    await page.goto(path)
    const loading = page.getByRole('status', { name: 'Starting InKCre…' })
    await expect(loading).toBeVisible()
    release()
    await expect(page.getByRole('alert')).toHaveText(
      'Unable to start InKCre. Retry or check your connection in Settings.'
    )
    await expect(loading).toBeHidden()

    gate = pending()
    await page.getByRole('button', { name: 'Retry', exact: true }).click()
    await expect(loading).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`${path.replace('?', '\\?')}$`))
    await page.getByRole('link', { name: 'Settings', exact: true }).click()
    await expect(page).toHaveURL(/\/settings$/)
    await expect(page.getByLabel('PostgREST URL')).toHaveValue(postgrestUrl)
    await expect(page.getByLabel('JWT signing secret')).toHaveValue(jwtSecret)
    release()
    await page.unrouteAll({ behavior: 'wait' })

    await page.goto(path)
    await expect(page.getByRole('main')).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`${path.replace('?', '\\?')}$`))
    await expect(loading).toHaveCount(0)
  } finally {
    release()
    await page.unrouteAll({ behavior: 'ignoreErrors' })
  }
})

test('optional telemetry does not delay opening a business page', async ({ page }) => {
  await page.addInitScript(() => {
    const config = JSON.parse(localStorage.getItem('inkcre_app_config')!)
    localStorage.setItem(
      'inkcre_app_config',
      JSON.stringify({ ...config, telemetry_enabled: true })
    )
  })
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let observingTelemetry = false
  await page.route('**/configs?**', async (route) => {
    if (new URL(route.request().url()).searchParams.get('key') !== 'eq.inkcre.observability') {
      await route.continue()
      return
    }
    observingTelemetry = true
    await gate
    await route.fulfill({
      headers: { 'Access-Control-Allow-Origin': '*' },
      json: null,
    })
  })
  try {
    await page.goto('/sources')
    await expect.poll(() => observingTelemetry).toBe(true)
    await expect(page.getByRole('main')).toBeVisible()
    await expect(page.getByRole('status', { name: 'Starting InKCre…' })).toHaveCount(0)
  } finally {
    release()
    await page.unrouteAll({ behavior: 'ignoreErrors' })
  }
})

test('existing Peer pages open before registration finishes and report a background failure', async ({
  page,
}) => {
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let leaseRequests = 0
  let workerRequests = 0
  await page.route('**/rpc/renew_peer_lease', async (route) => {
    leaseRequests++
    await route.continue()
  })
  await page.route('**/jobs?**', async (route) => {
    workerRequests++
    await route.continue()
  })
  await page.route('**/peers?**', async (route) => {
    if (route.request().method() !== 'PATCH') {
      await route.continue()
      return
    }
    await gate
    await route.fulfill({
      status: 503,
      headers: { 'Access-Control-Allow-Origin': '*' },
      json: { message: 'Registration unavailable' },
    })
  })
  try {
    await page.goto('/sources')
    await expect(page.getByRole('main')).toBeVisible()
    await expect(
      page.getByText(
        'Connecting this Web Peer; database pages are available, local jobs are not running yet.'
      )
    ).toBeVisible()
    expect(leaseRequests).toBe(0)
    expect(workerRequests).toBe(0)
    release()
    await expect(page.getByRole('alert')).toContainText('This Web Peer could not connect.')
    await expect(page.getByRole('main')).toBeVisible()
    expect(leaseRequests).toBe(0)
    expect(workerRequests).toBe(0)
  } finally {
    release()
    await page.unrouteAll({ behavior: 'ignoreErrors' })
  }
})

test('a pending initial lease does not block pages or admit the browser worker', async ({
  page,
}) => {
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let workerRequests = 0
  let extensionReads = 0
  let enabledReleaseReads = 0
  let leasePending = false
  await page.route('**/extension_peer_participations?**', async (route) => {
    extensionReads++
    await route.fulfill({
      headers: { 'Access-Control-Allow-Origin': '*' },
      json: [
        {
          name: 'e2e/lease-order',
          peer_id: '00000000-0000-4000-8000-000000000001',
          distribution: 'module_federation',
          version: '1.0.0',
          enabled: true,
          config_schema: null,
        },
      ],
    })
  })
  await page.route(
    '**/v2/extensions/e2e/lease-order/distributions/module_federation/releases/1.0.0',
    async (route) => {
      enabledReleaseReads++
      await route.fulfill({
        status: 404,
        headers: { 'Access-Control-Allow-Origin': '*' },
        json: { detail: 'isolated missing release' },
      })
    }
  )
  await page.route('**/jobs?**', async (route) => {
    workerRequests++
    await route.continue()
  })
  await page.route('**/rpc/renew_peer_lease', async (route) => {
    leasePending = true
    await gate
    await route.continue()
  })
  try {
    await page.goto('/sources')
    await expect(page.getByRole('main')).toBeVisible()
    await expect.poll(() => leasePending).toBe(true)
    expect(workerRequests).toBe(0)
    await expect.poll(() => extensionReads).toBeGreaterThan(0)
    await expect.poll(() => enabledReleaseReads).toBe(1)
    release()
    await expect.poll(() => workerRequests).toBeGreaterThan(0)
    await expect.poll(() => extensionReads).toBeGreaterThan(0)
    await expect.poll(() => enabledReleaseReads).toBe(1)
    await expect(
      page.getByText(
        'Connecting this Web Peer; database pages are available, local jobs are not running yet.'
      )
    ).toHaveCount(0)
  } finally {
    release()
    await page.unrouteAll({ behavior: 'ignoreErrors' })
  }
})

test('reset invalidates pending registration before it can renew or start the worker', async ({
  page,
}) => {
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let registrationFinished = false
  let leaseRequests = 0
  let workerRequests = 0
  await page.route('**/rpc/renew_peer_lease', async (route) => {
    leaseRequests++
    await route.continue()
  })
  await page.route('**/jobs?**', async (route) => {
    workerRequests++
    await route.continue()
  })
  await page.route('**/peers?**', async (route) => {
    if (route.request().method() !== 'PATCH') {
      await route.continue()
      return
    }
    await gate
    const response = await route.fetch()
    await route.fulfill({ response })
    registrationFinished = true
  })
  try {
    await page.goto('/sources')
    await expect(page.getByRole('main')).toBeVisible()
    await page.goto('/settings')
    await page.getByRole('button', { name: 'Reset', exact: true }).click()
    await page.getByRole('button', { name: 'Confirm', exact: true }).click()
    await expect(page.getByLabel('PostgREST URL')).toHaveValue('')
    release()
    await expect.poll(() => registrationFinished).toBe(true)
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        )
    )
    // Observe beyond completion of the old request, rather than merely before the gate opens.
    await expect(page.getByLabel('PostgREST URL')).toHaveValue('')
    expect(leaseRequests).toBe(0)
    expect(workerRequests).toBe(0)
    await expect(page.getByRole('alert')).toHaveCount(0)
  } finally {
    release()
    await page.unrouteAll({ behavior: 'ignoreErrors' })
  }
})

test('switching connections cannot renew a pending old registration against either database', async ({
  page,
}) => {
  const alternateUrl = 'https://startup-cutover.invalid/'
  const alternateSecret = 'isolated-cutover-key-at-least-32-bytes'
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let registrationFinished = false
  let oldLeaseRequests = 0
  let newLeaseRequests = 0
  await page.route('**/rpc/renew_peer_lease', async (route) => {
    oldLeaseRequests++
    await route.continue()
  })
  await page.route('**/peers?**', async (route) => {
    if (route.request().method() !== 'PATCH') {
      await route.continue()
      return
    }
    await gate
    const response = await route.fetch()
    await route.fulfill({ response })
    registrationFinished = true
  })
  await page.route(`${alternateUrl}**`, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const headers = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers':
        'Authorization, Content-Type, Accept-Profile, Content-Profile, Prefer',
      'Access-Control-Allow-Methods': '*',
    }
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers })
      return
    }
    let json: unknown = []
    if (url.pathname === '/peers') {
      const row = {
        id: '00000000-0000-4000-8000-000000000001',
        name: 'Alternate connection',
        config: {},
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
      json = request.method() === 'GET' ? [row] : row
    } else if (url.pathname.endsWith('/renew_peer_lease')) {
      newLeaseRequests++
      json = new Date(Date.now() + 90_000).toISOString()
    }
    await route.fulfill({ headers, json })
  })
  try {
    await page.goto('/sources')
    await expect(page.getByRole('main')).toBeVisible()
    await openSettings(page)
    await page.getByLabel('PostgREST URL').fill(alternateUrl)
    await page.getByLabel('JWT signing secret').fill(alternateSecret)
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect.poll(() => newLeaseRequests).toBe(1)
    release()
    await expect.poll(() => registrationFinished).toBe(true)
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        )
    )
    await expect(page.getByLabel('PostgREST URL')).toHaveValue(alternateUrl)
    expect(oldLeaseRequests).toBe(0)
    expect(newLeaseRequests).toBe(1)
  } finally {
    release()
    await page.unrouteAll({ behavior: 'ignoreErrors' })
  }
})

test('a new browser identity waits for insertion before opening business pages', async ({
  page,
}) => {
  const peerId = crypto.randomUUID()
  await page.addInitScript((peerId) => {
    const config = JSON.parse(localStorage.getItem('inkcre_app_config')!)
    localStorage.setItem('inkcre_app_config', JSON.stringify({ ...config, INKCRE_PEER_ID: peerId }))
  }, peerId)
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let inserting = false
  let leaseRequests = 0
  await page.route('**/peers?**', async (route) => {
    const query = new URL(route.request().url()).searchParams
    if (route.request().method() === 'GET' && query.get('id') === `eq.${peerId}`) {
      await route.fulfill({ headers: { 'Access-Control-Allow-Origin': '*' }, json: [] })
    } else await route.continue()
  })
  await page.route('**/peers?select=*', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback()
      return
    }
    inserting = true
    const inserted = route.request().postDataJSON()
    expect(inserted.id).toBe(peerId)
    expect(inserted.application_version).toBe(clientVersion)
    expect(inserted.capabilities).toEqual([])
    await gate
    await route.fulfill({
      headers: { 'Access-Control-Allow-Origin': '*' },
      json: {
        ...inserted,
        config: {},
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    })
  })
  await page.route('**/rpc/renew_peer_lease', async (route) => {
    leaseRequests++
    await route.fulfill({
      headers: { 'Access-Control-Allow-Origin': '*' },
      json: new Date(Date.now() + 90_000).toISOString(),
    })
  })
  try {
    await page.goto('/sources')
    await expect.poll(() => inserting).toBe(true)
    await expect(page.getByRole('status', { name: 'Starting InKCre…' })).toBeVisible()
    await expect(page.locator('main:not(.app-startup)')).toHaveCount(0)
    expect(leaseRequests).toBe(0)
    release()
    await expect(page.getByRole('main')).toBeVisible()
    await expect.poll(() => leaseRequests).toBe(1)
  } finally {
    release()
    await page.unrouteAll({ behavior: 'ignoreErrors' })
  }
})

test('zero participation persists, stays idle, and a custom interval resumes lease and scans', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const config = JSON.parse(localStorage.getItem('inkcre_app_config')!)
    if (config.peer_lease_renew_interval_seconds === undefined)
      localStorage.setItem(
        'inkcre_app_config',
        JSON.stringify({ ...config, peer_lease_renew_interval_seconds: 0 })
      )
  })
  await page.clock.install()
  await page.clock.setFixedTime(new Date())
  const leaseTtls: number[] = []
  let scans = 0
  let extensionReads = 0
  await page.route('**/rpc/renew_peer_lease', async (route) => {
    leaseTtls.push(route.request().postDataJSON().ttl_seconds)
    await route.fulfill({
      headers: { 'Access-Control-Allow-Origin': '*' },
      json: new Date(Date.now() + 90_000).toISOString(),
    })
  })
  await page.route('**/jobs?**', async (route) => {
    if (new URL(route.request().url()).searchParams.get('status') === 'eq.pending') scans++
    await route.fulfill({ headers: { 'Access-Control-Allow-Origin': '*' }, json: [] })
  })
  await page.route('**/extension_peer_participations?**', async (route) => {
    extensionReads++
    await route.fulfill({ headers: { 'Access-Control-Allow-Origin': '*' }, json: [] })
  })
  await page.goto('/sources')
  await expect(page.getByRole('main')).toBeVisible()
  await expect(page.getByRole('status').first()).toBeVisible()
  await expect.poll(() => extensionReads).toBeGreaterThan(0)
  const initialExtensionReads = extensionReads
  await page.clock.fastForward(35_000)
  expect(leaseTtls).toEqual([])
  expect(scans).toBe(0)
  expect(extensionReads).toBe(initialExtensionReads)
  await page.reload()
  await expect(page.getByRole('status').first()).toBeVisible()
  await page.goto('/settings')
  await expect(
    page.getByLabel('Lease renewal and job check interval (seconds; 0 disables)')
  ).toHaveValue('0')
  await page.getByLabel('Lease renewal and job check interval (seconds; 0 disables)').fill('')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  expect(leaseTtls).toEqual([])
  const intervalInput = page.getByLabel(
    'Lease renewal and job check interval (seconds; 0 disables)'
  )
  await intervalInput.fill('2')
  await expect(intervalInput).toHaveValue('2')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(intervalInput).toHaveValue('2')
  await expect.poll(() => scans).toBeGreaterThan(0)
  expect(leaseTtls.length).toBeGreaterThan(0)
  expect(leaseTtls.every((ttl) => ttl === 6)).toBe(true)
  await expect.poll(() => extensionReads).toBeGreaterThan(0)
  const scansBefore = scans
  await page.clock.runFor(2_000)
  await expect.poll(() => scans).toBeGreaterThan(scansBefore)
  expect(leaseTtls.every((ttl) => ttl === 6)).toBe(true)
  expect(leaseTtls.length).toBeGreaterThan(1)
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const path = await (await downloadPromise).path()
  const exported = JSON.parse(readFileSync(path!, 'utf8'))
  expect(exported.metaConfig.peer_lease_renew_interval_seconds).toBe(2)
  await page.getByLabel('Lease renewal and job check interval (seconds; 0 disables)').fill('0')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByRole('status').first()).toBeVisible()
  // The import handler bails while the save still owns the form; wait for it to finish.
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled()
  const stoppedScans = scans,
    stoppedLeases = leaseTtls.length
  await page.clock.fastForward(35_000)
  expect(scans).toBe(stoppedScans)
  expect(leaseTtls.length).toBe(stoppedLeases)
  await page.locator('input[type="file"]').setInputFiles(path!)
  await expect(
    page.getByLabel('Lease renewal and job check interval (seconds; 0 disables)')
  ).toHaveValue('2')
  await expect.poll(() => leaseTtls.length).toBeGreaterThan(stoppedLeases)
})

test('disabling while registration is pending prevents its later lease or worker', async ({
  page,
}) => {
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let patches = 0,
    leases = 0,
    scans = 0,
    firstPatchFinished = false
  await page.route('**/peers?**', async (route) => {
    if (route.request().method() !== 'PATCH' || ++patches > 1) {
      await route.continue()
      return
    }
    await gate
    const response = await route.fetch()
    await route.fulfill({ response })
    firstPatchFinished = true
  })
  await page.route('**/rpc/renew_peer_lease', async (route) => {
    leases++
    await route.continue()
  })
  await page.route('**/jobs?**', async (route) => {
    scans++
    await route.continue()
  })
  try {
    await page.goto('/sources')
    await expect(page.getByRole('main')).toBeVisible()
    await openSettings(page)
    await page.getByLabel('Lease renewal and job check interval (seconds; 0 disables)').fill('0')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByRole('status').first()).toBeVisible()
    release()
    await expect.poll(() => firstPatchFinished).toBe(true)
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        )
    )
    expect(leases).toBe(0)
    expect(scans).toBe(0)
  } finally {
    release()
    await page.unrouteAll({ behavior: 'ignoreErrors' })
  }
})

test('disabling participation drains a dispatched claim before saving configuration', async ({
  page,
}) => {
  const authorization = `Bearer ${await token()}`
  const headers = { Authorization: authorization, 'Content-Type': 'application/json' }
  const type = `e2e.claim-drain.${crypto.randomUUID()}`
  const createdType = await fetch(`${postgrestUrl}job_types`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      id: type,
      description: 'Claim drain regression',
      parameters_schema: {},
      default_timeout_seconds: 3600,
    }),
  })
  expect(createdType.status).toBe(201)
  let id: number | undefined, release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let claimStored = false
  try {
    await page.goto('/sources')
    await expect(page.getByRole('main')).toBeVisible()
    await expect(
      page.getByText(
        'Connecting this Web Peer; database pages are available, local jobs are not running yet.'
      )
    ).toHaveCount(0)
    const created = await fetch(`${postgrestUrl}jobs`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=representation' },
      body: JSON.stringify({ type, parameters: {}, timeout_seconds: 3600 }),
    })
    expect(created.status).toBe(201)
    id = (await created.json())[0].id
    await page.route('**/jobs?**', async (route) => {
      if (
        route.request().method() !== 'PATCH' ||
        route.request().postDataJSON().status !== 'running' ||
        new URL(route.request().url()).searchParams.get('id') !== `eq.${id}`
      ) {
        await route.continue()
        return
      }
      const response = await route.fetch()
      expect(response.ok()).toBe(true)
      claimStored = true
      await gate
      await route.fulfill({ response })
    })
    // Native extensions use this same shared SDK; the fixture adds no production test hook.
    await page.evaluate(
      async ({ id, type }) => {
        type Sdk = typeof import('../../packages/core/src/index')
        const globals = globalThis as typeof globalThis & {
          __FEDERATION__: {
            __INSTANCES__: Array<{
              options: { name: string }
              loadShare(name: string): Promise<() => Sdk>
            }>
          }
          __claimDrain: { stop(): Promise<void>; handlerRuns: number; stopCompleted: boolean }
        }
        const host = globals.__FEDERATION__.__INSTANCES__.find(
          (instance) => instance.options.name === 'host'
        )!
        const sdk = (await host.loadShare('@inkcre/core'))()
        globals.__claimDrain = {
          stop: () => sdk.JobManager.stopWorker(),
          handlerRuns: 0,
          stopCompleted: false,
        }
        sdk.JobManager.registerHandler(type, {
          parameters: sdk.MetaConfigSchema,
          canHandle: () => true,
          handle: async () => {
            globals.__claimDrain.handlerRuns++
          },
        })
        void sdk.JobManager.run(id!)
      },
      { id, type }
    )
    await expect.poll(() => claimStored).toBe(true)
    const stoppedBeforeClaimReturned = await page.evaluate(async () => {
      const fixture = (
        globalThis as typeof globalThis & {
          __claimDrain: { stop(): Promise<void>; handlerRuns: number; stopCompleted: boolean }
        }
      ).__claimDrain
      void fixture.stop().then(() => {
        fixture.stopCompleted = true
      })
      await Promise.resolve()
      await Promise.resolve()
      return fixture.stopCompleted
    })
    expect(stoppedBeforeClaimReturned).toBe(false)
    await openSettings(page)
    await page.getByLabel('Lease renewal and job check interval (seconds; 0 disables)').fill('0')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
    expect(
      await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem('inkcre_app_config')!).peer_lease_renew_interval_seconds
      )
    ).toBe(30)
    release()
    await expect(page.getByRole('status').first()).toBeVisible()
    await expect
      .poll(async () => {
        const closed = await fetch(`${postgrestUrl}jobs?id=eq.${id}&select=status`, { headers })
        return (await closed.json())[0].status
      })
      .toBe('aborted')
    expect(
      await page.evaluate(
        () =>
          (globalThis as typeof globalThis & { __claimDrain: { handlerRuns: number } }).__claimDrain
            .handlerRuns
      )
    ).toBe(0)
  } finally {
    release()
    await page.unrouteAll({ behavior: 'ignoreErrors' })
    if (id !== undefined)
      await fetch(`${postgrestUrl}jobs?id=eq.${id}`, { method: 'DELETE', headers })
    await fetch(`${postgrestUrl}job_types?id=eq.${type}`, { method: 'DELETE', headers })
  }
})

test('Registry confirmation selects one Peer and offline enablement preserves other native pins', async ({
  page,
}) => {
  const extensionName = 'e2e/handoff'
  const endpoint = `${postgrestUrl}extensions?name=eq.${encodeURIComponent(extensionName)}`
  const selections = `${postgrestUrl}extension_peer_participations?name=eq.${encodeURIComponent(extensionName)}`
  const authorization = `Bearer ${await token()}`
  const headers = { Authorization: authorization, 'Content-Type': 'application/json' }
  const peerIds = [crypto.randomUUID(), crypto.randomUUID()]
  await page.route(
    '**/v2/extensions/e2e/handoff/distributions/module_federation/releases/1.0.0',
    (route) =>
      route.fulfill({
        headers: { 'Access-Control-Allow-Origin': '*' },
        json: {
          name: extensionName,
          nickname: 'Handoff check',
          version: '1.0.0',
          distribution: 'module_federation',
          state: 'published',
          python: null,
          module_federation: {
            host_sdk: '@inkcre/core',
            host_sdk_version: '>=0.2.0 <1.0.0',
            manifest_url: '/extensions/e2e/handoff/1.0.0/module-federation/mf-manifest.json',
          },
        },
      })
  )
  const readPins = async () => {
    const response = await fetch(
      `${selections}&select=peer_id,distribution,version,enabled&order=peer_id`,
      { headers }
    )
    const body = await response.json()
    expect(response.ok, JSON.stringify({ status: response.status, body })).toBe(true)
    return body
  }
  try {
    await page.goto(
      '/extensions?install=e2e%2Fhandoff&distribution=module_federation&version=1.0.0'
    )
    await expect(page.getByRole('heading', { name: 'Handoff check' })).toBeVisible()
    expect(await readPins()).toEqual([])
    await page.getByRole('button', { name: 'Install', exact: true }).click()
    await expect(page).toHaveURL(/\/extensions$/)
    await expect.poll(readPins).toEqual([
      {
        peer_id: '00000000-0000-4000-8000-000000000001',
        distribution: 'module_federation',
        version: '1.0.0',
        enabled: false,
      },
    ])
    const seeded = await fetch(endpoint, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        config: { mailbox: 'preserved' },
        state: { account: { id: 'saved-account' }, cursor: 'saved-cursor' },
      }),
    })
    expect(seeded.status).toBe(204)
    const createdPeers = await fetch(`${postgrestUrl}peers`, {
      method: 'POST',
      headers,
      body: JSON.stringify(
        peerIds.map((id, index) => ({
          id,
          name: `E2E Peer ${index + 1}`,
          labels: ['e2e'],
          config: {},
          config_schema: {},
          capabilities: [],
          lease_expires_at: null,
        }))
      ),
    })
    expect(createdPeers.status).toBe(201)
    const pins = await fetch(`${postgrestUrl}extension_peer_participations`, {
      method: 'POST',
      headers,
      body: JSON.stringify(
        peerIds.map((peer_id, index) => ({
          name: extensionName,
          peer_id,
          distribution: 'python',
          version: index ? '2.0.0' : '1.0.0',
          enabled: false,
          config_schema: null,
        }))
      ),
    })
    expect(pins.status).toBe(201)
    await page.reload()
    const first = page
      .getByRole('article', { name: 'Handoff check' })
      .getByRole('region', { name: 'E2E Peer 1' })
    // Each row is its explicit target; one mutation cannot move the other Peer’s pin.
    await first.getByRole('button', { name: 'Enable', exact: true }).click()
    await expect
      .poll(
        async () =>
          (await readPins())?.find((row: { peer_id: string }) => row.peer_id === peerIds[0])
            ?.enabled
      )
      .toBe(true)
    expect(
      (await readPins())?.find((row: { peer_id: string }) => row.peer_id === peerIds[1])
    ).toMatchObject({ distribution: 'python', version: '2.0.0', enabled: false })
    await first.getByRole('button', { name: 'Disable', exact: true }).click()
    await expect
      .poll(
        async () =>
          (await readPins())?.find((row: { peer_id: string }) => row.peer_id === peerIds[0])
            ?.enabled
      )
      .toBe(false)
    await first.getByRole('button', { name: 'Remove', exact: true }).click()
    await expect
      .poll(async () =>
        (await readPins())?.some((row: { peer_id: string }) => row.peer_id === peerIds[0])
      )
      .toBe(false)
    const shared = await fetch(`${endpoint}&select=name,config,state`, { headers })
    expect(await shared.json()).toEqual([
      {
        name: extensionName,
        config: { mailbox: 'preserved' },
        state: { account: { id: 'saved-account' }, cursor: 'saved-cursor' },
      },
    ])
    expect(
      (await readPins())?.find((row: { peer_id: string }) => row.peer_id === peerIds[1])
    ).toMatchObject({ version: '2.0.0', enabled: false })
  } finally {
    await fetch(selections, { method: 'DELETE', headers })
    await fetch(endpoint, { method: 'DELETE', headers })
    await fetch(`${postgrestUrl}peers?id=in.(${peerIds.join(',')})`, { method: 'DELETE', headers })
  }
})

test('Python-only availability is explicit and Registry read failures remain unknown', async ({
  page,
}) => {
  const localName = `python-only-${Date.now()}`
  const name = `e2e/${localName}`
  const headers = { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' }
  let catalogReads = 0
  let fail = false
  await page.route(`**/v2/extensions/e2e/${localName}/distributions/*`, async (route) => {
    catalogReads++
    if (route.request().url().endsWith('/module_federation')) {
      await route.fulfill({
        status: fail ? 503 : 404,
        headers: { 'Access-Control-Allow-Origin': '*' },
        json: { detail: fail ? 'Registry unavailable' : 'Native distribution not found' },
      })
    } else {
      await route.fulfill({
        headers: { 'Access-Control-Allow-Origin': '*' },
        json: {
          name,
          nickname: 'Python-only fixture',
          releases: [
            {
              name,
              nickname: 'Python-only fixture',
              distribution: 'python',
              version: '1.0.0',
              state: 'published',
              module_federation: null,
              python: {
                host_sdk: 'core-py',
                host_sdk_version: '>=0.3.0',
                project: 'inkcre-python-fixture',
                simple_url: 'https://registry.example.invalid/simple/',
                entry_point: {
                  group: 'inkcre.extensions',
                  name: 'fixture',
                  object: 'fixture:Extension',
                },
              },
            },
          ],
        },
      })
    }
  })
  try {
    expect(
      (
        await fetch(`${postgrestUrl}extensions`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ name, nickname: 'Python-only fixture', config: {}, state: {} }),
        })
      ).status
    ).toBe(201)
    await page.goto('/extensions')
    const card = page.getByRole('article', { name: 'Python-only fixture', exact: true })
    const browser = card.locator('.extension-card__peer-row').filter({ hasText: 'This browser' })
    await expect(browser).toBeVisible()
    expect(catalogReads).toBe(0)
    await browser.getByRole('button', { name: 'Install', exact: true }).click()
    const unavailable = page.getByRole('dialog', { name: 'Unavailable on this Peer', exact: true })
    await expect(unavailable).toContainText('Distribution: Module Federation')
    await expect(unavailable).toContainText('Published distributions: Python')
    await expect(unavailable.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
    await expect(unavailable.getByText('Version', { exact: true })).toHaveCount(0)
    await unavailable.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(
      browser.getByRole('button', { name: 'Unavailable on this Peer', exact: true })
    ).toBeDisabled()
    fail = true
    await card.getByRole('button', { name: 'Refresh', exact: true }).click()
    await browser.getByRole('button', { name: 'Install', exact: true }).click()
    const retry = page.getByRole('dialog', { name: 'Install', exact: true })
    await expect(retry.getByRole('alert')).toContainText('503')
    await expect(retry).not.toContainText('No published Module Federation releases.')
    await expect(retry.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
  } finally {
    await fetch(`${postgrestUrl}extensions?name=eq.${encodeURIComponent(name)}`, {
      method: 'DELETE',
      headers,
    })
  }
})

test('failed remote enablement reads back persisted intent without claiming a running module', async ({
  page,
}) => {
  const name = `e2e/failed-intent-${Date.now()}`
  const peerId = crypto.randomUUID()
  const authorization = `Bearer ${await token()}`
  const headers = { Authorization: authorization, 'Content-Type': 'application/json' }
  const managementUrl = `${coreUrl}e2e-extension-management/v2`
  const selectionUrl = `${postgrestUrl}extension_peer_participations?name=eq.${encodeURIComponent(name)}&peer_id=eq.${peerId}`
  let enabled = false
  let holdNextStatus = false
  let releaseStaleStatus!: () => void
  const staleGate = new Promise<void>((resolve) => {
    releaseStaleStatus = resolve
  })
  let markStaleRequested!: () => void
  const staleRequested = new Promise<void>((resolve) => {
    markStaleRequested = resolve
  })
  await page.route(managementUrl, async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
        },
      })
      return
    }
    const command = route.request().postDataJSON()
    if (command.action === 'enable') {
      const saved = await fetch(selectionUrl, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ enabled: true }),
      })
      expect(saved.status).toBe(204)
      enabled = true
      await route.fulfill({
        status: 500,
        headers: { 'Access-Control-Allow-Origin': '*' },
        json: { message: 'Native activation failed after saving intent.' },
      })
      return
    }
    expect(command.action).toBe('status')
    const stale = holdNextStatus
    if (stale) {
      holdNextStatus = false
      markStaleRequested()
      await staleGate
    }
    await route.fulfill({
      headers: { 'Access-Control-Allow-Origin': '*' },
      json: {
        peer_id: peerId,
        supported_distributions: ['python'],
        extensions: [
          {
            name,
            peer_id: peerId,
            supported_distributions: ['python'],
            distribution: 'python',
            version: '1.0.0',
            enabled,
            config_schema: null,
            loaded_version: stale ? '1.0.0' : null,
            running: stale,
            restart_required: false,
            operation: null,
            error: enabled ? 'Native activation failed.' : null,
          },
        ],
      },
    })
  })
  try {
    expect(
      (
        await fetch(`${postgrestUrl}peers`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            id: peerId,
            name: 'Intent failure Peer',
            labels: ['e2e'],
            config: {},
            config_schema: {},
            lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
            capabilities: [
              {
                id: 'core.extension.management.v2',
                inbound: {
                  protocol: 'core.peer.protocol.http.v1',
                  parameters: { method: 'POST', url: managementUrl },
                },
              },
            ],
          }),
        })
      ).status
    ).toBe(201)
    expect(
      (
        await fetch(`${postgrestUrl}extensions`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ name, nickname: 'Intent failure', config: {}, state: {} }),
        })
      ).status
    ).toBe(201)
    expect(
      (
        await fetch(`${postgrestUrl}extension_peer_participations`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            name,
            peer_id: peerId,
            distribution: 'python',
            version: '1.0.0',
            enabled: false,
            config_schema: null,
          }),
        })
      ).status
    ).toBe(201)
    await page.goto('/extensions')
    const card = page.getByRole('article', { name: 'Intent failure', exact: true })
    const peer = card
      .locator('.extension-card__peer-row')
      .filter({ hasText: 'Intent failure Peer' })
    await expect(peer.getByRole('button', { name: 'Enable', exact: true })).toBeEnabled()
    await expect(card.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled()
    holdNextStatus = true
    await card.getByRole('button', { name: 'Refresh', exact: true }).click()
    await staleRequested
    await peer.getByRole('button', { name: 'Enable', exact: true }).click()
    await expect(peer.getByRole('alert')).toBeVisible()
    await expect(peer.getByRole('button', { name: 'Disable', exact: true })).toBeEnabled()
    await expect(peer).not.toContainText('Running 1.0.0')
    const staleResponse = page.waitForResponse(managementUrl)
    releaseStaleStatus()
    await (await staleResponse).finished()
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        )
    )
    await expect(peer).not.toContainText('Running 1.0.0')
    const persisted = await fetch(selectionUrl, { headers })
    expect(persisted.status).toBe(200)
    expect((await persisted.json())[0].enabled).toBe(true)
  } finally {
    releaseStaleStatus()
    await fetch(selectionUrl, { method: 'DELETE', headers })
    await fetch(`${postgrestUrl}extensions?name=eq.${encodeURIComponent(name)}`, {
      method: 'DELETE',
      headers,
    })
    await fetch(`${postgrestUrl}peers?id=eq.${peerId}`, { method: 'DELETE', headers })
  }
})

test('wrong and absent credentials are rejected', async ({ page }) => {
  const wrongAuthorization = `Bearer ${await token(
    'wrong-client-web-jwt-secret-at-least-32-bytes'
  )}`
  const statuses = await page.evaluate(
    async ({ postgrestUrl, wrongAuthorization }) => {
      const wrong = await fetch(`${postgrestUrl}peers?select=id`, {
        headers: { Authorization: wrongAuthorization },
      })
      const anonymous = await fetch(`${postgrestUrl}peers?select=id`)
      return [wrong.status, anonymous.status]
    },
    { postgrestUrl, wrongAuthorization }
  )

  expect(statuses).toEqual([401, 401])
})

test('Web Peer publishes its app identity and preserves a user name', async ({ page }) => {
  const id = crypto.randomUUID()
  const authorization = `Bearer ${await token()}`
  const endpoint = `${postgrestUrl}peers?id=eq.${id}`

  await page.goto('/settings')
  await page.evaluate(
    ({ postgrestUrl, jwtSecret, id }) => {
      localStorage.setItem(
        'inkcre_app_config',
        JSON.stringify({
          INKCRE_PGREST_URL: postgrestUrl,
          INKCRE_JWT_SECRET: jwtSecret,
          INKCRE_PEER_ID: id,
        })
      )
    },
    { postgrestUrl, jwtSecret, id }
  )

  try {
    await page.reload()
    await expect
      .poll(async () => {
        const response = await fetch(`${endpoint}&select=name,application_version`, {
          headers: { Authorization: authorization },
        })
        return response.ok ? (await response.json())[0] : null
      })
      .toEqual({
        name: expect.stringMatching(/^Chrome \d+ · (Linux|macOS|Windows)$/),
        application_version: clientVersion,
      })

    const renamed = await fetch(endpoint, {
      method: 'PATCH',
      headers: { Authorization: authorization, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'My browser Peer' }),
    })
    expect(renamed.status).toBe(204)
    await page.reload()
    await expect
      .poll(async () => {
        const response = await fetch(`${endpoint}&select=name,application_version`, {
          headers: { Authorization: authorization },
        })
        return response.ok ? (await response.json())[0] : null
      })
      .toEqual({ name: 'My browser Peer', application_version: clientVersion })
    await page.goto('/')
    await expect(page).toHaveTitle(/My browser Peer/)
  } finally {
    const cleanup = await fetch(endpoint, {
      method: 'DELETE',
      headers: { Authorization: authorization },
    })
    expect(cleanup.status).toBe(204)
  }
})

test('Settings export restores the complete browser experience', async ({ page }) => {
  const alternateId = crypto.randomUUID()
  const authorization = `Bearer ${await token()}`
  const endpoint = `${postgrestUrl}peers?id=eq.${alternateId}`
  const extensionName = `e2e/switch-${crypto.randomUUID()}`
  const headers = { Authorization: authorization, 'Content-Type': 'application/json' }
  const created = await fetch(`${postgrestUrl}extensions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name: extensionName,
      nickname: 'Host identity switch',
      config: {},
      state: {},
    }),
  })
  expect(created.status).toBe(201)
  try {
    await page.goto('/settings')
    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Export', exact: true }).click()
    const download = await downloadPromise
    const path = await download.path()
    expect(path).not.toBeNull()
    const exported = JSON.parse(readFileSync(path!, 'utf8'))
    expect(exported).toEqual({
      version: 2,
      metaConfig: {
        INKCRE_PGREST_URL: postgrestUrl,
        INKCRE_JWT_SECRET: jwtSecret,
        INKCRE_PEER_ID: '00000000-0000-4000-8000-000000000001',
        peer_readiness_timeout_seconds: 5,
        peer_lease_renew_interval_seconds: 30,
        telemetry_enabled: false,
        telemetry_peer_relay_url: '',
      },
      locale: 'en',
    })

    await page.evaluate(
      ({ postgrestUrl, jwtSecret, alternateId }) => {
        localStorage.setItem(
          'inkcre_app_config',
          JSON.stringify({
            INKCRE_PGREST_URL: postgrestUrl,
            INKCRE_JWT_SECRET: jwtSecret,
            INKCRE_PEER_ID: alternateId,
          })
        )
        localStorage.setItem('inkcre-locale', 'zh-CN')
      },
      { postgrestUrl, jwtSecret, alternateId }
    )
    await page.reload()
    page.once('dialog', (dialog) => dialog.accept())
    await page.locator('input[type="file"]').setInputFiles(path!)
    await expect
      .poll(() =>
        page.evaluate(() => ({
          metaConfig: JSON.parse(localStorage.getItem('inkcre_app_config') || 'null'),
          locale: localStorage.getItem('inkcre-locale'),
        }))
      )
      .toEqual({ metaConfig: exported.metaConfig, locale: 'en' })
    await expect(
      page.getByRole('switch', { name: 'Enable telemetry', exact: true })
    ).not.toBeChecked()
    // Import changes Peer identity without reloading this document: the Host must bind the new ID.
    await page.goto('/extensions')
    const row = page
      .getByRole('article', { name: 'Host identity switch', exact: true })
      .getByRole('region')
      .filter({ hasText: 'This browser' })
    await expect(row.getByRole('button', { name: 'Install', exact: true })).toBeEnabled()
    await expect(row.getByRole('alert')).toHaveCount(0)
  } finally {
    await fetch(`${postgrestUrl}extensions?name=eq.${extensionName}`, { method: 'DELETE', headers })
    const cleanup = await fetch(endpoint, {
      method: 'DELETE',
      headers: { Authorization: authorization },
    })
    expect(cleanup.status).toBe(204)
  }
})

test('Peer config keeps invalid and failed drafts and saves only once while pending', async ({
  page,
}) => {
  const id = crypto.randomUUID()
  const authorization = `Bearer ${await token()}`
  const wrongAuthorization = `Bearer ${await token('ui-migration-wrong-secret-at-least-32-bytes')}`
  const endpoint = `${postgrestUrl}peers?id=eq.${id}`
  const created = await fetch(`${postgrestUrl}peers`, {
    method: 'POST',
    headers: { Authorization: authorization, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id,
      name: 'UI migration config',
      config: { limit: 1 },
      config_schema: {
        type: 'object',
        required: ['limit'],
        properties: { limit: { type: 'integer', minimum: 1 } },
      },
    }),
  })
  expect(created.status).toBe(201)

  try {
    await page.goto('/peers')
    const peer = page.locator('.peer-card', { hasText: 'UI migration config' })
    await expect(peer.getByText('Unknown', { exact: true })).toBeVisible()
    const renewed = await fetch(endpoint, {
      method: 'PATCH',
      headers: { Authorization: authorization, 'Content-Type': 'application/json' },
      body: JSON.stringify({ lease_expires_at: new Date(Date.now() + 60_000).toISOString() }),
    })
    expect(renewed.status).toBe(204)
    await page.getByRole('button', { name: 'Refresh', exact: true }).click()
    await expect(peer.getByText('Online', { exact: true })).toBeVisible()
    await expect(peer.getByRole('button', { name: 'Delete device' })).toBeDisabled()
    await expect(peer.getByText('UI migration config', { exact: true })).toBeVisible()
    await page.route('**/peers?**', (route) =>
      route.continue({
        headers: { ...route.request().headers(), authorization: wrongAuthorization },
      })
    )
    await page.getByRole('button', { name: 'Refresh', exact: true }).click()
    await expect(page.getByRole('alert').first()).toBeVisible()
    await expect(peer).toBeVisible()
    await expect(peer.getByText('UI migration config', { exact: true })).toBeVisible()
    await page.unroute('**/peers?**')
    await page.getByRole('button', { name: 'Retry', exact: true }).click()
    await expect(page.getByRole('alert')).toHaveCount(0)
    await expect(peer.getByText('UI migration config', { exact: true })).toBeVisible()
    await peer.getByRole('button', { name: 'Edit Config' }).click()
    const dialog = page.getByRole('dialog', { name: 'Edit Config' })
    await dialog.getByRole('tab', { name: 'JSON' }).click()
    const editor = dialog.locator('.cm-content')
    const save = dialog.getByRole('button', { name: 'Save', exact: true })
    await expect(save).toBeEnabled()
    await editor.fill('{')
    await expect(save).toBeDisabled()
    await expect(editor).toHaveAttribute('aria-invalid', 'true')
    await editor.fill('{"limit":"invalid"}')
    await expect(save).toBeDisabled()
    await expect(editor).toHaveAttribute('aria-invalid', 'true')
    await editor.fill('{"limit":2}')
    await expect(save).toBeEnabled()

    let releaseRequest!: () => void
    const pending = new Promise<void>((resolve) => {
      releaseRequest = resolve
    })
    let writes = 0
    await page.route(endpoint, async (route) => {
      if (route.request().method() !== 'PATCH') return route.continue()
      writes += 1
      await pending
      // Exercise the real database rejection without changing the user's draft or auth store.
      await route.continue({
        headers: { ...route.request().headers(), authorization: wrongAuthorization },
      })
    })
    await save.click()
    try {
      await expect(save).toBeDisabled()
      await expect(save).toHaveAttribute('aria-busy', 'true')
      const cancel = dialog.getByRole('button', { name: 'Cancel' })
      await expect(cancel).toBeDisabled()
      await expect(cancel).not.toHaveAttribute('aria-busy', 'true')
      await expect(cancel.locator('.ink-button__loading')).toHaveCount(0)
      await page.keyboard.press('Escape')
      await expect(dialog).toBeVisible()
      await expect(editor).toHaveAttribute('contenteditable', 'false')
      expect(writes).toBe(1)
    } finally {
      releaseRequest()
    }
    await expect(dialog.getByRole('alert')).toBeVisible()
    await expect(editor).toHaveText('{"limit":2}')
    await expect(save).toBeEnabled()
    await page.unroute(endpoint)
    await save.click()
    await expect(dialog).not.toBeVisible()

    const stored = await fetch(`${endpoint}&select=config`, {
      headers: { Authorization: authorization },
    })
    expect(stored.status).toBe(200)
    expect((await stored.json())[0].config).toEqual({ limit: 2 })
    await peer.getByRole('button', { name: 'Edit Config' }).click()
    await dialog.getByRole('tab', { name: 'JSON' }).click()
    await expect(editor).toContainText('2')
  } finally {
    await page.unroute('**/peers?**')
    await page.unroute(endpoint)
    const cleanup = await fetch(endpoint, {
      method: 'DELETE',
      headers: { Authorization: authorization },
    })
    expect(cleanup.status).toBe(204)
  }
})

test('core Peer publishes and serves its exact capability inbounds', async ({ page }) => {
  await page.goto('/')
  const authorization = `Bearer ${await token()}`
  const result = await page.evaluate(
    async ({ postgrestUrl, authorization }) => {
      const peersResponse = await fetch(
        `${postgrestUrl}peers?select=capabilities,lease_expires_at&id=eq.00000000-0000-4000-8000-000000000002`,
        { headers: { Authorization: authorization } }
      )
      const peers = await peersResponse.json()
      const management = peers[0]?.capabilities?.find(
        (capability: { id: string }) => capability.id === 'core.extension.management.v2'
      )
      const execution = await fetch(management.inbound.parameters.url, {
        method: management.inbound.parameters.method,
        headers: { Authorization: authorization, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'status', extension: 'e2e/not-installed' }),
      })
      return {
        peersStatus: peersResponse.status,
        capabilities: peers[0]?.capabilities,
        leaseExpiresAt: peers[0]?.lease_expires_at,
        executionStatus: execution.status,
        executionBody: await execution.json(),
      }
    },
    { postgrestUrl, authorization }
  )

  expect(result.peersStatus).toBe(200)
  expect(Date.parse(result.leaseExpiresAt)).toBeGreaterThan(Date.now())
  expect(result.capabilities).toEqual([
    {
      id: 'core.extension.management.v2',
      inbound: {
        protocol: 'core.peer.protocol.http.v1',
        parameters: { method: 'POST', url: `${coreUrl}extension-management/v2` },
      },
    },
    {
      id: 'core.feature_retrieval.lexical.v1',
      inbound: {
        protocol: 'core.peer.protocol.http.v1',
        parameters: { method: 'POST', url: `${coreUrl}lexical-retrieval` },
      },
    },
    {
      id: 'core.organization.rumination.v1',
      inbound: {
        protocol: 'core.peer.protocol.http.v1',
        parameters: { method: 'POST', url: `${coreUrl}organization/ruminate` },
      },
    },
    {
      id: 'core.semantic_retrieval.v1',
      inbound: {
        protocol: 'core.peer.protocol.http.v1',
        parameters: { method: 'POST', url: `${coreUrl}semantic-retrieval` },
      },
    },
  ])
  expect(result.executionStatus).toBe(200)
  expect(result.executionBody).toEqual({
    peer_id: '00000000-0000-4000-8000-000000000002',
    supported_distributions: ['python'],
    extensions: [],
  })
})

test('Block Inspector delegates rumination through the discovered Peer', async ({ page }) => {
  const authorization = `Bearer ${await token()}`
  const content = `E2E rumination focal block ${Date.now()}`
  const created = await fetch(`${postgrestUrl}blocks`, {
    method: 'POST',
    headers: {
      Authorization: authorization,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({ content, resolver: 'core.text.v1', storage: null }),
  })
  expect(created.status).toBe(201)
  const [block] = await created.json()

  try {
    await page.goto(`/info-base/graph/blocks/${block.id}`)
    await expect(page.getByRole('button', { name: 'Reunderstand' })).toBeVisible()

    const requestPromise = page.waitForRequest(
      (request) =>
        request.url() === `${coreUrl}organization/ruminate` && request.method() === 'POST'
    )
    await page.getByRole('button', { name: 'Reunderstand' }).click()
    const request = await requestPromise

    expect(request.postDataJSON()).toEqual({ block: block.id })
    await expect(page.locator('.info-base-side-panel').getByRole('alert')).toBeVisible()
  } finally {
    const cleanup = await fetch(`${postgrestUrl}blocks?id=eq.${block.id}`, {
      method: 'DELETE',
      headers: { Authorization: authorization },
    })
    expect(cleanup.status).toBe(204)
  }
})

test('Recall delegates one read to its destination and discards stale path searches', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page.getByRole('searchbox')).toBeVisible()
  await page.keyboard.press('Control+k')
  const dialog = page.getByRole('dialog', { name: 'Recall information' })
  const input = dialog.getByRole('searchbox')
  await expect(input).toBeFocused()
  const query = `recall-e2e-${Date.now()}`
  let requests = 0
  let release!: () => void
  let pending = new Promise<void>((resolve) => {
    release = resolve
  })
  let fail = false
  await page.route(`${coreUrl}lexical-retrieval`, async (route) => {
    requests++
    await pending
    if (fail) await route.fulfill({ status: 503, json: { message: 'Unavailable' } })
    else await route.continue()
  })
  await input.fill(query)
  await input.press('Enter')
  try {
    // The destination owns the pending request; Recall must already be closed.
    await expect(page).toHaveURL(new RegExp(`q=${query}`))
    await expect(dialog).toBeHidden()
    await expect.poll(() => requests).toBe(1)
  } finally {
    release()
  }
  await expect(page.getByRole('main')).toBeVisible()
  expect(requests).toBe(1)

  await page.keyboard.press('Control+k')
  await dialog.getByRole('tab', { name: 'Find path' }).click()
  await input.fill('stale path')
  pending = new Promise<void>((resolve) => {
    release = resolve
  })
  fail = true
  const staleResponse = page.waitForResponse(
    (response) => response.url() === `${coreUrl}lexical-retrieval` && response.status() === 503
  )
  await input.press('Enter')
  try {
    await expect.poll(() => requests).toBe(2)
    await expect(dialog.getByRole('button', { name: 'Search', exact: true })).toHaveAttribute(
      'aria-busy',
      'true'
    )
    await dialog.getByRole('tab', { name: 'Recall', exact: true }).click()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await page.keyboard.press('Control+k')
    await dialog.getByRole('tab', { name: 'Find path' }).click()
  } finally {
    release()
  }
  await (await staleResponse).finished()
  await expect(dialog.getByRole('alert')).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: 'Search', exact: true })).toBeEnabled()
  await input.fill('retry path')
  await input.press('Enter')
  await expect(dialog.getByRole('alert')).toBeVisible()
  await expect(input).toHaveValue('retry path')
  fail = false
  await dialog.getByRole('button', { name: 'Retry', exact: true }).click()
  // Path mode keeps the dialog open; a successful retry renders the empty result state.
  await expect(dialog.getByRole('status')).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`q=${query}`))
})

test('an empty browser saves its connection across refresh and reads Peers', async ({
  browser,
}) => {
  const context = await browser.newContext({ baseURL: process.env.INKCRE_E2E_WEB_URL })
  const page = await context.newPage()
  const authorization = `Bearer ${await token()}`
  let id: string | undefined
  try {
    await page.addInitScript(() => {
      const observer = new MutationObserver(() => {
        const text = document.querySelector('main')?.textContent
        if (!text) return
        sessionStorage.setItem('first-app-text', text)
        observer.disconnect()
      })
      observer.observe(document, { childList: true, subtree: true })
    })
    await page.goto('/settings')
    const firstText = await page.evaluate(() => sessionStorage.getItem('first-app-text'))
    expect(firstText).toBeTruthy()
    expect(firstText).not.toContain('settings.')
    expect(firstText).not.toContain('startup.')
    await page.getByLabel('PostgREST URL').fill(postgrestUrl)
    await page.getByLabel('JWT signing secret').fill(jwtSecret)
    await expect(page.getByLabel('Device readiness wait timeout (seconds)')).toHaveValue('5')
    await page.getByLabel('Device readiness wait timeout (seconds)').fill('45')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            JSON.parse(globalThis.localStorage.getItem('inkcre_app_config') || '{}')
              .INKCRE_PGREST_URL ?? ''
        )
      )
      .toBe(postgrestUrl)
    id = await page.evaluate(
      () => JSON.parse(localStorage.getItem('inkcre_app_config')!).INKCRE_PEER_ID
    )
    await page.reload()
    await expect(page.getByLabel('PostgREST URL')).toHaveValue(postgrestUrl)
    await expect(page.getByLabel('Device readiness wait timeout (seconds)')).toHaveValue('45')
    await expect(page.getByRole('main')).not.toContainText(id!)
    await expect(page.getByRole('main')).not.toContainText('Peer ID')
    await page.goto('/peers')
    await expect(page.locator('.peer-card', { hasText: 'This browser' })).toBeVisible()
    await expect(page.getByRole('main')).toBeVisible()
  } finally {
    await context.close()
    if (id)
      await fetch(`${postgrestUrl}peers?id=eq.${id}`, {
        method: 'DELETE',
        headers: { Authorization: authorization },
      })
  }
})

test('Job preserves readable errors and logs and distinguishes failed and missing reads', async ({
  page,
}) => {
  const authorization = `Bearer ${await token()}`
  const headers = { Authorization: authorization, 'Content-Type': 'application/json' }
  const type = `e2e.feedback.${crypto.randomUUID()}`
  const createdType = await fetch(`${postgrestUrl}job_types`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      id: type,
      description: 'Feedback regression',
      default_timeout_seconds: 3600,
    }),
  })
  expect(createdType.status).toBe(201)
  let jobId: number | undefined
  let releaseLogs: (() => void) | undefined
  try {
    const createdJob = await fetch(`${postgrestUrl}jobs`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=representation' },
      body: JSON.stringify({
        type,
        status: 'running',
        started_at: new Date().toISOString(),
        timeout_seconds: 3600,
      }),
    })
    expect(createdJob.status).toBe(201)
    const [job] = await createdJob.json()
    jobId = job.id
    const initialLog = await fetch(`${postgrestUrl}logs`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        trace_id: `job.${jobId}`,
        severity_number: 9,
        severity_text: 'INFO',
        body: 'Existing log survives failure',
      }),
    })
    expect(initialLog.status).toBe(201)
    const wrongAuthorization = `Bearer ${await token('feedback-wrong-secret-at-least-32-bytes')}`
    await page.route('**/jobs?**', (route) =>
      route.continue({
        headers: { ...route.request().headers(), authorization: wrongAuthorization },
      })
    )
    await page.goto(`/jobs/${jobId}`)
    await expect(page.getByText('Unable to load this job.', { exact: true })).toBeVisible()
    await expect(page.getByRole('status', { name: 'Loading...' })).toHaveCount(0)
    await page.unroute('**/jobs?**')

    const pendingLogs = new Promise<void>((resolve) => {
      releaseLogs = resolve
    })
    let logReads = 0
    let rejectLogs = true
    await page.route('**/logs?**', async (route) => {
      logReads++
      if (logReads > 1 && rejectLogs) {
        await pendingLogs
        await route.continue({
          headers: { ...route.request().headers(), authorization: wrongAuthorization },
        })
      } else await route.continue()
    })
    await page.getByRole('button', { name: 'Retry', exact: true }).click()
    const logs = page.locator('.logs-viewer')
    await expect(logs.getByText('Existing log survives failure')).toBeVisible()
    await expect(logs.getByText('Updating automatically')).toBeVisible()
    await expect(logs.getByRole('status')).toHaveCount(0)
    await expect.poll(() => logReads).toBe(2)
    await expect(logs.getByRole('status', { name: 'Loading logs…' })).toBeVisible()
    releaseLogs()
    await expect(logs.getByText('Unable to load logs.')).toBeVisible()
    await expect(logs.getByText('Existing log survives failure')).toBeVisible()
    await expect(logs.getByRole('status')).toHaveCount(0)
    rejectLogs = false
    await logs.getByRole('button', { name: 'Retry', exact: true }).click()
    await expect(logs.getByText('Updating automatically')).toBeVisible()
    await expect(logs.getByText('Existing log survives failure')).toHaveCount(1)

    const longUrl = `https://example.invalid/${'long-path-'.repeat(30)}`
    const failureDetails = `Validation failed\n${longUrl}\nLiteral escape: \\n\nEnd of error`
    const failedState = { error: failureDetails, attempt: 1 }
    const failedJob = await fetch(`${postgrestUrl}jobs?id=eq.${jobId}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        status: 'failed',
        closed_at: new Date().toISOString(),
        state: failedState,
      }),
    })
    expect(failedJob.status).toBe(204)
    await page.reload()
    const errorDetails = page.getByLabel('Error details', { exact: true })
    const state = page.getByLabel('State', { exact: true })
    await expect(errorDetails).toHaveJSProperty('textContent', failureDetails)
    await expect(state).toHaveJSProperty('textContent', JSON.stringify(failedState, null, 2))
    await page.setViewportSize({ width: 375, height: 812 })
    await expect(errorDetails).toBeVisible()
    expect(await errorDetails.evaluate((element) => getComputedStyle(element).whiteSpace)).toBe(
      'pre-wrap'
    )
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBe(true)
    await expect(errorDetails).toHaveJSProperty('textContent', failureDetails)

    const structuredFailure = { error: { message: failureDetails } }
    const updatedState = await fetch(`${postgrestUrl}jobs?id=eq.${jobId}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ state: structuredFailure }),
    })
    expect(updatedState.status).toBe(204)
    await page.reload()
    await expect(errorDetails).toHaveCount(0)
    await expect(state).toHaveJSProperty('textContent', JSON.stringify(structuredFailure, null, 2))

    await page.goto('/jobs/-1')
    await expect(page.getByText('Job not found', { exact: true })).toBeVisible()
    await expect(page.getByRole('status', { name: 'Loading...' })).toHaveCount(0)
  } finally {
    releaseLogs?.()
    if (jobId !== undefined) {
      await fetch(`${postgrestUrl}logs?trace_id=eq.job.${jobId}`, { method: 'DELETE', headers })
      await fetch(`${postgrestUrl}jobs?id=eq.${jobId}`, { method: 'DELETE', headers })
    }
    await fetch(`${postgrestUrl}job_types?id=eq.${type}`, { method: 'DELETE', headers })
  }
})

test('Source titles follow saved names across navigation and refresh', async ({ page }) => {
  const authorization = `Bearer ${await token()}`
  const headers = { Authorization: authorization, 'Content-Type': 'application/json' }
  const type = `e2e.title.${crypto.randomUUID()}`
  const initialName = 'Title history source'
  const savedName = 'Renamed title history source'
  const createdType = await fetch(`${postgrestUrl}sources_types`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      id: type,
      description: 'Source title regression',
      config_schema: { type: 'object', properties: {} },
      collect_config_schema: { type: 'object', properties: {} },
    }),
  })
  expect(createdType.status).toBe(201)
  let sourceId: number | undefined
  try {
    const created = await fetch(`${postgrestUrl}sources`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=representation' },
      body: JSON.stringify({ type, nickname: initialName, config: {} }),
    })
    expect(created.status).toBe(201)
    const [source] = await created.json()
    sourceId = source.id
    await page.goto('/sources')
    await expect(page).toHaveTitle('Sources - InKCre')
    await page.getByRole('link', { name: initialName, exact: true }).click()
    await expect(page).toHaveTitle(`${initialName} - Sources - InKCre`)
    await page.getByRole('tab', { name: 'Config' }).click()
    await page.getByLabel('Nickname', { exact: true }).fill(savedName)
    const save = page.getByRole('button', { name: 'Save', exact: true })
    await expect(save).toBeEnabled()
    await expect(page).toHaveTitle(`${initialName} - Sources - InKCre`)
    await save.click()
    await expect(page).toHaveTitle(`${savedName} - Sources - InKCre`)
    await page.getByRole('link', { name: 'Back to Sources', exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/sources#source-${sourceId}$`))
    await expect(page).toHaveTitle('Sources - InKCre')
    await page.goBack()
    await expect(page).toHaveURL(new RegExp(`/sources/${sourceId}$`))
    await expect(page).toHaveTitle(`${savedName} - Sources - InKCre`)
    await page.reload()
    await expect(page).toHaveTitle(`${savedName} - Sources - InKCre`)
    await page.getByRole('tab', { name: 'Config' }).click()
    await expect(page.getByLabel('Nickname', { exact: true })).toHaveValue(savedName)
  } finally {
    if (sourceId !== undefined) {
      const removedSource = await fetch(`${postgrestUrl}sources?id=eq.${sourceId}`, {
        method: 'DELETE',
        headers,
      })
      expect(removedSource.status).toBe(204)
    }
    const removedType = await fetch(`${postgrestUrl}sources_types?id=eq.${type}`, {
      method: 'DELETE',
      headers,
    })
    expect(removedType.status).toBe(204)
  }
})

registerGitHubNativeTests()
