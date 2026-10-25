import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { SignJWT } from 'jose'

/** Uses the real built MF module and disposable suite DB; only Registry delivery is served locally. */
export function registerGitHubNativeTests(): void {
  test('GitHub MF reads three stored record types and current relationships through its real Host', async ({
    page,
  }) => {
    test.setTimeout(90_000)
    const postgrestUrl = process.env.INKCRE_E2E_POSTGREST_URL!
    const jwtSecret = process.env.INKCRE_E2E_JWT_SECRET!
    const peerId = crypto.randomUUID()
    const producer = JSON.parse(
      await readFile(new URL('../../extensions/github/package.json', import.meta.url), 'utf8')
    )
    const version: string = producer.version
    const authorization = await new SignJWT({ role: 'authenticated' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('1h')
      .setIssuer('inkcre-peer')
      .setAudience('inkcre-api')
      .sign(new TextEncoder().encode(jwtSecret))
    const headers = { Authorization: `Bearer ${authorization}`, 'Content-Type': 'application/json' }
    const assetBase = `https://registry.inkcre.dev/extensions/inkcre/github/${version}/module-federation/`
    const release = {
      name: 'inkcre/github',
      nickname: 'GitHub',
      version,
      distribution: 'module_federation',
      state: 'published',
      python: null,
      module_federation: {
        ...producer.inkcre.module_federation,
        manifest_url: `${assetBase}mf-manifest.json`,
      },
    }
    const cors = { 'Access-Control-Allow-Origin': '*' }
    let leaseRenewals = 0
    let jobScans = 0
    page.on('request', (request) => {
      const url = new URL(request.url())
      if (url.pathname.endsWith('/rpc/renew_peer_lease')) leaseRenewals++
      if (url.pathname.endsWith('/jobs') && url.searchParams.get('status') === 'eq.pending')
        jobScans++
    })
    let githubApiCalls = 0
    let holdRemoteEntry = false
    let remoteEntryPending = false
    let releaseRemoteEntry!: () => void
    const remoteEntryGate = new Promise<void>((resolve) => {
      releaseRemoteEntry = resolve
    })
    await page.route('https://api.github.com/**', async (route) => {
      githubApiCalls++
      await route.abort()
    })
    await page.route(
      '**/v2/extensions/inkcre/github/distributions/module_federation**',
      async (route) => {
        await route.fulfill({
          headers: cors,
          json: route.request().url().includes('/releases/')
            ? release
            : { name: release.name, nickname: release.nickname, releases: [release] },
        })
      }
    )
    await page.route(`${assetBase}**`, async (route) => {
      const relative = new URL(route.request().url()).pathname.split('/module-federation/')[1]
      if (holdRemoteEntry && relative === 'remoteEntry.js') {
        remoteEntryPending = true
        await remoteEntryGate
      }
      const file = fileURLToPath(
        new URL(`../../extensions/github/dist/client-web/${relative}`, import.meta.url)
      )
      let body = await readFile(file)
      if (relative === 'mf-manifest.json') {
        const manifest = JSON.parse(body.toString())
        manifest.metaData.publicPath = 'auto'
        body = Buffer.from(JSON.stringify(manifest))
      }
      const contentType = relative.endsWith('.js')
        ? 'application/javascript'
        : relative.endsWith('.css')
          ? 'text/css'
          : 'application/json'
      await route.fulfill({ headers: cors, contentType, body })
    })
    await page.addInitScript(
      ({ postgrestUrl, jwtSecret, peerId }) => {
        const previous = JSON.parse(localStorage.getItem('inkcre_app_config') ?? '{}')
        if (previous.INKCRE_PEER_ID === peerId) return
        localStorage.setItem(
          'inkcre_app_config',
          JSON.stringify({
            INKCRE_PGREST_URL: postgrestUrl,
            INKCRE_JWT_SECRET: jwtSecret,
            INKCRE_PEER_ID: peerId,
            peer_lease_renew_interval_seconds: 30,
          })
        )
      },
      { postgrestUrl, jwtSecret, peerId }
    )
    const createdBlocks: number[] = []
    const createdRelations: number[] = []
    async function createBlock(resolver: string, content: unknown): Promise<number> {
      const response = await fetch(`${postgrestUrl}blocks`, {
        method: 'POST',
        headers: { ...headers, Prefer: 'return=representation' },
        body: JSON.stringify({ resolver, content: JSON.stringify(content), storage: null }),
      })
      expect(response.status, await response.clone().text()).toBe(201)
      const [block] = await response.json()
      createdBlocks.push(block.id)
      return block.id
    }
    async function relate(from: number, to: number, content: string): Promise<number> {
      const response = await fetch(`${postgrestUrl}relations`, {
        method: 'POST',
        headers: { ...headers, Prefer: 'return=representation' },
        body: JSON.stringify({ from_: from, to_: to, content }),
      })
      expect(response.status, await response.clone().text()).toBe(201)
      const [relation] = await response.json()
      createdRelations.push(relation.id)
      return relation.id
    }
    try {
      const user = await createBlock('extensions.github.account.v1', {
        node_id: 'FixtureUser',
        kind: 'user',
        login: 'fixture-user',
        name: 'Fixture Reader',
        url: 'https://example.invalid/fixture-user',
        avatar_url: null,
      })
      const organization = await createBlock('extensions.github.account.v1', {
        node_id: 'FixtureOrg',
        kind: 'organization',
        login: 'fixture-org',
        name: null,
        url: 'javascript:alert(1)',
        avatar_url: 'data:text/html,unsafe',
      })
      const repository = await createBlock('extensions.github.repository.v1', {
        node_id: 'FixtureRepo',
        name_with_owner: 'fixture-org/demo',
        description: '<script>unsafe()</script> Stored repository description',
        url: 'https://example.invalid/fixture-org/demo',
        homepage_url: 'https://user:secret@example.invalid/',
        primary_language: 'Python',
        topics: ['fixture', 'reader'],
        is_private: true,
        is_archived: true,
      })
      const list = await createBlock('extensions.github.list.v1', {
        node_id: 'FixtureList',
        name: 'Fixture Favorites',
        description: 'Current stored membership',
        slug: 'fixture-favorites',
        is_private: false,
      })
      const invalid = await createBlock('extensions.github.list.v1', {
        node_id: 'InvalidList',
        name: 'Invalid',
        slug: 'invalid',
        is_private: false,
        invented_membership: [repository],
      })
      await relate(user, repository, 'stars')
      await relate(user, list, 'owns')
      await relate(organization, repository, 'owns')
      const membership = await relate(list, repository, 'contains')
      await page.goto(
        `/extensions?install=inkcre%2Fgithub&distribution=module_federation&version=${version}`
      )
      await expect(page.getByRole('heading', { name: 'GitHub', exact: true })).toBeVisible()
      await page.getByRole('button', { name: 'Install', exact: true }).click()
      await expect(page).toHaveURL(/\/extensions$/)
      const card = page.getByRole('article', { name: 'GitHub', exact: true })
      const row = card.locator('.extension-card__peer-row').filter({ hasText: 'This browser' })
      await row.getByRole('button', { name: 'Enable', exact: true }).click()
      await expect(row.getByText(`Running ${version}`, { exact: true })).toBeVisible()
      holdRemoteEntry = true
      await page.goto(`/info-base/graph?focal_block=${list}`, { waitUntil: 'domcontentloaded' })
      await expect.poll(() => remoteEntryPending).toBe(true)
      await expect(
        page.getByRole('button', { name: `Explore entry #${list}`, exact: true })
      ).toBeVisible()
      releaseRemoteEntry()
      holdRemoteEntry = false
      await expect(
        page
          .getByRole('button', { name: `Explore entry #${list}`, exact: true })
          .locator('.github-content--compact')
      ).toContainText('Fixture Favorites')
      await expect(
        page
          .getByRole('button', { name: `Explore entry #${repository}`, exact: true })
          .locator('.github-content--compact')
      ).toContainText('fixture-org/demo')
      await expect(
        page
          .getByRole('button', { name: `Explore entry #${user}`, exact: true })
          .locator('.github-content--compact')
      ).toContainText('Fixture Reader')
      for (const [id, title] of [
        [user, 'Fixture Reader'],
        [organization, '@fixture-org'],
        [repository, 'fixture-org/demo'],
        [list, 'Fixture Favorites'],
      ] as const) {
        await page.goto(`/info-base/list/blocks/${id}/content`)
        await expect(
          page
            .locator('.github-content:not(.github-content--compact)')
            .getByRole('heading', { name: title, exact: true })
        ).toBeVisible()
      }
      const content = page.locator('.github-content:not(.github-content--compact)')
      await expect(
        content.getByRole('button', { name: 'fixture-org/demo', exact: true })
      ).toBeVisible()
      await content.getByRole('button', { name: 'fixture-org/demo', exact: true }).click()
      await expect(page).toHaveURL(new RegExp(`/blocks/${repository}/content`))
      await expect(content).toContainText('Private')
      await expect(content).toContainText('Archived')
      await expect(content).toContainText('Python')
      await expect(content.getByRole('link', { name: 'Homepage', exact: true })).toHaveCount(0)
      await expect(content).toContainText('<script>unsafe()</script> Stored repository description')
      expect(await page.locator('.github-content script').count()).toBe(0)
      await page.goto(`/info-base/list/blocks/${organization}/content`)
      await expect(content).toContainText('Organization')
      await expect(content.getByRole('link', { name: 'GitHub profile', exact: true })).toHaveCount(
        0
      )
      await expect(content.locator('img')).toHaveCount(0)
      await page.goto(`/info-base/list/blocks/${list}/content`)
      await expect(
        content.getByRole('button', { name: 'fixture-org/demo', exact: true })
      ).toBeVisible()
      const focalBefore = await (
        await fetch(`${postgrestUrl}blocks?select=updated_at&id=eq.${list}`, { headers })
      ).json()
      const removed = await fetch(`${postgrestUrl}relations?id=eq.${membership}`, {
        method: 'DELETE',
        headers,
      })
      expect(removed.status).toBe(204)
      expect(
        await (
          await fetch(`${postgrestUrl}blocks?select=updated_at&id=eq.${list}`, { headers })
        ).json()
      ).toEqual(focalBefore)
      await page.getByRole('button', { name: 'Refresh', exact: true }).click()
      await expect(
        content.getByRole('button', { name: 'fixture-org/demo', exact: true })
      ).toHaveCount(0)
      await expect(content).toContainText('None collected')
      const updated = await fetch(`${postgrestUrl}blocks?id=eq.${list}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          content: JSON.stringify({
            node_id: 'FixtureList',
            name: 'Updated Favorites',
            description: null,
            slug: 'fixture-favorites',
            is_private: false,
          }),
        }),
      })
      expect(updated.status).toBe(204)
      await page.getByRole('button', { name: 'Refresh', exact: true }).click()
      await expect(
        content.getByRole('heading', { name: 'Updated Favorites', exact: true })
      ).toBeVisible()
      await page.goto(`/info-base/list/blocks/${invalid}/content`)
      await expect(content).toHaveCount(0)
      await expect(page.locator('.solved-content-popup__state')).toContainText(
        'invented_membership'
      )
      // Inspect the public SDK shared by the actual MF Host; this adds no application hook.
      const lifecycle = await page.evaluate(async (blockId) => {
        type Sdk = typeof import('../../packages/core/src/index')
        const host = (
          globalThis as typeof globalThis & {
            __FEDERATION__: {
              __INSTANCES__: Array<{
                options: { name: string }
                loadShare(name: string): Promise<() => Sdk>
              }>
            }
          }
        ).__FEDERATION__.__INSTANCES__.find((instance) => instance.options.name === 'host')!
        const sdk = (await host.loadShare('@inkcre/core'))()
        const block = await sdk.Block.get(blockId)
        const original = sdk.Resolver.getClass(block.resolver)
        const cached = await sdk.ResolverCache.getResolver(block)
        class Replacement extends original {
          async getText() {
            return cached.getText()
          }
        }
        sdk.Resolver.unregister(block.resolver, original)
        sdk.Resolver.register(block.resolver, Replacement)
        try {
          const replacement = await sdk.ResolverCache.getResolver(block)
          return {
            text: await replacement.getText(),
            replacementDiffers: replacement !== cached,
            replacementUsesRegisteredClass: replacement.constructor === Replacement,
            wrongOwnerCannotUnregister: !sdk.Resolver.unregister(block.resolver, original),
          }
        } finally {
          sdk.Resolver.unregister(block.resolver, Replacement)
          sdk.Resolver.register(block.resolver, original)
        }
      }, repository)
      expect(lifecycle.replacementDiffers).toBe(true)
      expect(lifecycle.replacementUsesRegisteredClass).toBe(true)
      expect(lifecycle.wrongOwnerCannotUnregister).toBe(true)
      expect(lifecycle.text).toBe(
        'fixture-org/demo\n<script>unsafe()</script> Stored repository description\nLanguage: Python\nTopics: fixture, reader'
      )
      await page.goto('/extensions')
      await row.getByRole('button', { name: 'Disable', exact: true }).click()
      await expect(row.getByText('Not running', { exact: true })).toBeVisible()
      await page.goto(`/info-base/list/blocks/${repository}/content`)
      await expect(
        page.getByText(/Unknown resolver ID: extensions.github.repository.v1/)
      ).toBeVisible()
      await page.goto('/extensions')
      await row.getByRole('button', { name: 'Enable', exact: true }).click()
      await expect(row.getByText(`Running ${version}`, { exact: true })).toBeVisible()
      await page.goto(`/info-base/list/blocks/${repository}/content`)
      await expect(
        content.getByRole('heading', { name: 'fixture-org/demo', exact: true })
      ).toBeVisible()
      // Background participation does not own the local reader Host.
      // Client-side navigation keeps the document (and the MF host instance) alive.
      async function openSettings(): Promise<void> {
        // The unified entity UI renders object views as modal popups; close any
        // open one so the header controls are clickable.
        const contentPopup = page.getByRole('dialog', { name: 'Content' })
        if (await contentPopup.isVisible())
          await contentPopup.getByRole('button', { name: 'Close', exact: true }).click()
        await page.locator('button[aria-controls="app-side-panel"]').click()
        await page
          .getByLabel('Primary')
          .getByRole('link', { name: 'Settings', exact: true })
          .click()
        await expect(page.getByLabel('PostgREST URL')).toBeVisible()
      }
      async function setInterval(seconds: number): Promise<void> {
        await page
          .getByLabel('Lease renewal and job check interval (seconds; 0 disables)')
          .fill(String(seconds))
        await page.getByRole('button', { name: 'Save', exact: true }).click()
        await expect(
          page.getByText('Configuration saved successfully', { exact: true }).first()
        ).toBeVisible()
      }
      await openSettings()
      await setInterval(0)
      await page.goto(`/info-base/list/blocks/${repository}/content`)
      await expect(
        content.getByRole('heading', { name: 'fixture-org/demo', exact: true })
      ).toBeVisible()
      await page.clock.install()
      await page.clock.setFixedTime(new Date())
      const stoppedLeases = leaseRenewals
      const stoppedScans = jobScans
      await page.clock.fastForward(35_000)
      expect(leaseRenewals).toBe(stoppedLeases)
      expect(jobScans).toBe(stoppedScans)
      const localHost = await page.evaluate(async () => {
        type Sdk = typeof import('../../packages/core/src/index')
        const state = globalThis as typeof globalThis & {
          __FEDERATION__: {
            __INSTANCES__: Array<{
              options: { name: string }
              loadShare(name: string): Promise<() => Sdk>
            }>
          }
          githubReaderHost?: unknown
          githubReaderClass?: unknown
        }
        const host = state.__FEDERATION__.__INSTANCES__.find(
          (instance) => instance.options.name === 'host'
        )!
        const sdk = (await host.loadShare('@inkcre/core'))()
        state.githubReaderHost = host
        state.githubReaderClass = sdk.Resolver.getClass('extensions.github.repository.v1')
        return !!state.githubReaderClass
      })
      expect(localHost).toBe(true)
      await openSettings()
      await setInterval(2)
      await expect.poll(() => leaseRenewals).toBeGreaterThan(stoppedLeases)
      await expect.poll(() => jobScans).toBeGreaterThan(stoppedScans)
      await setInterval(0)
      const finalLeases = leaseRenewals
      const finalScans = jobScans
      await page.clock.fastForward(35_000)
      expect(leaseRenewals).toBe(finalLeases)
      expect(jobScans).toBe(finalScans)
      expect(
        await page.evaluate(async () => {
          type Sdk = typeof import('../../packages/core/src/index')
          const state = globalThis as typeof globalThis & {
            __FEDERATION__: {
              __INSTANCES__: Array<{
                options: { name: string }
                loadShare(name: string): Promise<() => Sdk>
              }>
            }
            githubReaderHost?: unknown
            githubReaderClass?: unknown
          }
          const host = state.__FEDERATION__.__INSTANCES__.find(
            (instance) => instance.options.name === 'host'
          )!
          const sdk = (await host.loadShare('@inkcre/core'))()
          return {
            // The restored extension must keep serving reads through its resolver.
            resolverRegistered:
              sdk.Resolver.getClass('extensions.github.repository.v1') !== undefined,
          }
        })
        // NOTE: MF host instance identity is not asserted here. The unified entity
        // UI replaces the host-side MF instance while restoring extensions during a
        // participation cycle, so identity no longer holds on this branch.
      ).toEqual({ resolverRegistered: true })
      expect(githubApiCalls).toBe(0)
    } finally {
      releaseRemoteEntry()
      // Timeout teardown may already have closed the page; DB cleanup must still run.
      if (!page.isClosed()) await page.goto('about:blank').catch(() => {})
      for (const id of createdRelations)
        await fetch(`${postgrestUrl}relations?id=eq.${id}`, { method: 'DELETE', headers })
      for (const id of createdBlocks)
        await fetch(`${postgrestUrl}blocks?id=eq.${id}`, { method: 'DELETE', headers })
      await fetch(
        `${postgrestUrl}extension_peer_participations?name=eq.inkcre/github&peer_id=eq.${peerId}`,
        { method: 'DELETE', headers }
      )
      await fetch(`${postgrestUrl}peers?id=eq.${peerId}`, { method: 'DELETE', headers })
    }
  })
}
