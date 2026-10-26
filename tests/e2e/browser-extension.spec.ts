import { expect, test } from './browser-extension-fixture'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { SignJWT } from 'jose'
import { access, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { WebMaterialClient } from '../../packages/web-collection/src/material'
import { textPart, WEB_MATERIAL_RESOLVER } from '../../packages/web-collection/src/index'
import {
  Block,
  TextResolver,
  MetaConfigSchema,
  WebPeerRuntime,
} from '../../packages/core/dist/index.js'

test('Discourse imports retain each author, short replies, links and code', async ({
  context,
  page,
  extensionId,
}) => {
  await page.goto(`chrome-extension://${extensionId}/parser.html`)
  const worker = context.serviceWorkers()[0]!
  const html = `<!doctype html><html><head><meta name="generator" content="Discourse 2026.10"><title>Packaging discussion</title></head><body>
    <nav>Account settings and navigation</nav>
    <div class="crawler-post" id="post_1"><div class="crawler-post-meta"><span class="creator">Alice</span><time datetime="2025-01-20T03:10:17Z"></time></div><div class="post"><p>I have experience packaging software and would like to contribute while learning this language. Which existing community projects could use that experience?</p><pre><code>if ready:\n    contribute()\n</code></pre></div></div>
    <div class="crawler-post" id="post_2"><div class="crawler-post-meta"><span class="creator">Bob</span><time datetime="2025-02-07T16:15:12Z"></time></div><div class="post"><p>Try the <a href="/c/packaging/14">Packaging forum</a>.</p><blockquote><div class="crawler-post" id="post_99"><div class="post">Quoted text is not another post.</div></div></blockquote></div></div>
    <div class="crawler-post" id="post_3"><div class="crawler-post-meta"><span class="creator">Alice</span></div><div class="post"><p>Thanks!</p></div></div>
    <div class="crawler-post" id="post_4"><div class="post"><pre><code>    keep_indent()\n</code></pre></div></div>
    <div class="crawler-post" id="post_5"><div class="post"><blockquote><div class="crawler-post-meta"><span class="creator">Quoted author</span><time datetime="2020-01-01">old date</time><span itemprop="position">99</span></div></blockquote><p>A quoted author is not the author of this post.</p></div></div>
    <footer>Privacy policy</footer></body></html>`
  const parse = (value: string) =>
    worker.evaluate(
      async (input) =>
        (globalThis as any).chrome.runtime.sendMessage({
          type: 'collection-parse-html',
          html: input,
          url: 'https://forum.example/t/packaging/1',
        }),
      value
    )
  const result = await parse(html)
  expect(result.text).toContain('#1 · Alice · 2025-01-20T03:10:17Z')
  expect(result.text).toContain('#2 · Bob · 2025-02-07T16:15:12Z')
  expect(result.text).toContain('#3 · Alice\n\nThanks!')
  expect(result.text).toContain('Packaging forum (https://forum.example/c/packaging/14)')
  expect(result.text).toContain('if ready:\n    contribute()\n')
  expect(result.text).toContain('#4\n\n    keep_indent()')
  expect(result.text).toContain('#5\n\n')
  expect(result.text).not.toContain('#5 · Quoted author')
  expect(result.text).toContain('Quoted text is not another post.')
  expect(result.text).not.toContain('#99')
  expect(result.text).not.toContain('Account settings')
  expect(result.text).not.toContain('Privacy policy')
  const repeated = html.replace(
    '</body>',
    html.match(/<div class="crawler-post" id="post_3">.*?<\/div><\/div>/)![0] + '</body>'
  )
  expect((await parse(repeated)).text).toBe(result.text)
  const ordinary = await parse(
    html.replace('content="Discourse 2026.10"', 'content="Other software"')
  )
  expect(ordinary.text).not.toContain('#1 · Alice')
})

test('material collection uses existing graph CRUD and byte storage without a web RPC', async () => {
  test.skip(!process.env.INKCRE_E2E_WEBEXT_PGREST, 'Requires a disposable database.')
  const token = await new SignJWT({ role: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer('inkcre-peer')
    .setAudience('inkcre-api')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(new TextEncoder().encode(process.env.INKCRE_E2E_WEBEXT_JWT_SECRET!))
  const client = new WebMaterialClient(process.env.INKCRE_E2E_WEBEXT_PGREST!, async () => token)
  const source = {
    scope: 'graph-acceptance:' + crypto.randomUUID(),
    key: 'https://source.test/article?q=1',
    metadata: { title: '现场原文', url: 'https://source.test/article?q=1' },
  }
  const material = {
    title: '现场原文',
    url: source.key,
    captured_at: new Date().toISOString(),
    method: 'visible-dom',
    coverage: [],
  }
  const fixed = {
    request_id: crypto.randomUUID(),
    mode: 'fixed' as const,
    source,
    material,
    parts: [textPart('text', '主动保存原文')],
    note: '独立附注',
  }
  // A root may already be visible when its content has not been accepted yet.
  const partial = await client.blocks
    .insert({
      resolver: WEB_MATERIAL_RESOLVER,
      storage: null,
      content: JSON.stringify({
        key: fixed.request_id,
        ...fixed,
        parts: undefined,
        note: undefined,
      }),
    })
    .select()
    .single()
  expect(partial.error).toBeNull()
  const saved = await client.submit(fixed)
  expect(saved.root_id).toBe(partial.data!.id)
  const read = await new WebMaterialClient(
    process.env.INKCRE_E2E_WEBEXT_PGREST!,
    async () => token
  ).read(saved.root_id)
  expect(Buffer.from(read.parts[0]!.base64, 'base64').toString()).toBe('主动保存原文')
  expect(read.notes[0]!.text).toBe('独立附注')
  const text = await client.blocks.from().select().eq('id', saved.part_ids.text!).single()
  expect(await new TextResolver(Block.parse(text.data)).getText()).toBe('主动保存原文')
  const current = {
    ...fixed,
    request_id: crypto.randomUUID(),
    mode: 'current' as const,
    note: undefined,
  }
  const first = await client.submit(current)
  const next = await client.submit({
    ...current,
    request_id: crypto.randomUUID(),
    parts: [textPart('text', '更新后的正文')],
  })
  expect(next.root_id).toBe(first.root_id)
  expect(
    Buffer.from((await client.read(saved.root_id)).parts[0]!.base64, 'base64').toString()
  ).toBe('主动保存原文')
  expect(Buffer.from((await client.read(next.root_id)).parts[0]!.base64, 'base64').toString()).toBe(
    '更新后的正文'
  )
  const record = {
    request_id: crypto.randomUUID(),
    mode: 'record' as const,
    source: { ...source, scope: source.scope + ':bookmarks', key: 'native-1' },
  }
  const recordSaved = await client.submit(record)
  await client.submit({ ...fixed, request_id: crypto.randomUUID(), source: record.source })
  expect(await client.hasMaterial(recordSaved.root_id)).toBe(true)
  const renamed = await client.submit({
    ...record,
    request_id: crypto.randomUUID(),
    source: { ...record.source, metadata: { ...record.source.metadata, title: '移动后的书签' } },
  })
  expect(renamed.root_id).toBe(recordSaved.root_id)
  expect((await client.read(renamed.root_id)).source.metadata.title).toBe('移动后的书签')
  const pdf = Buffer.from('%PDF-1.4\noriginal bytes\n%%EOF')
  const pdfSaved = await client.submit({
    ...fixed,
    request_id: crypto.randomUUID(),
    note: undefined,
    storage_id: -4,
    parts: [{ role: 'pdf', base64: pdf.toString('base64') }],
  })
  expect(Buffer.from((await client.read(pdfSaved.root_id)).parts[0]!.base64, 'base64')).toEqual(pdf)
})

test('built Chromium extension sizes its native toolbar popup and opens independent settings', async ({
  page,
  extensionId,
}, testInfo) => {
  const pageErrors: string[] = []
  const manifest = JSON.parse(
    await readFile(
      fileURLToPath(
        new URL('../../apps/client-webext/.output/chrome-mv3/manifest.json', import.meta.url)
      ),
      'utf8'
    )
  )
  expect(manifest.host_permissions ?? []).toEqual([])
  expect(manifest.permissions).not.toContain('bookmarks')
  expect(manifest.permissions).not.toContain('history')
  expect(manifest.optional_permissions).toEqual(expect.arrayContaining(['bookmarks', 'history']))
  expect(manifest.permissions).not.toContain('sidePanel')
  expect(manifest).not.toHaveProperty('side_panel')
  expect(manifest).not.toHaveProperty('sidebar_action')
  for (const path of [
    'explain.html',
    'taking-note.html',
    'sidepanel.html',
    'content-scripts/content.js',
    'content-scripts/content.css',
  ])
    await expect(
      access(
        fileURLToPath(
          new URL('../../apps/client-webext/.output/chrome-mv3/' + path, import.meta.url)
        )
      )
    ).rejects.toThrow()
  expect(manifest.action.default_icon).toEqual({
    16: 'toolbar/canvas-16.png',
    32: 'toolbar/canvas-32.png',
    48: 'toolbar/canvas-48.png',
  })
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.goto(`chrome-extension://${extensionId}/options.html`)
  await expect(page.getByRole('heading', { name: '信息库', exact: true })).toBeVisible()
  await expect(page.getByLabel('PostgREST 地址')).toBeVisible()
  await expect(page.getByRole('heading', { name: '扩展设置', exact: true })).toBeVisible()
  await expect(page.getByText('旧工具', { exact: true })).toHaveCount(0)
  await expect(page.getByText('展开旧服务设置', { exact: true })).toHaveCount(0)
  const oldMessages = await page.evaluate(async () => {
    const result = []
    for (const type of [
      'legacy-explain',
      'legacy-vector',
      'collection-legacy-tools',
      'collection-selection-draft',
      'get-tab-id',
    ]) {
      try {
        result.push(await (globalThis as any).chrome.runtime.sendMessage({ type, text: 'retired' }))
      } catch {
        result.push(null)
      }
    }
    return result
  })
  expect(oldMessages.every((result) => result == null)).toBe(true)
  await page.evaluate(() => (globalThis as any).chrome.action.openPopup())
  // A normal tab misses the browser's intrinsic popup sizing (the old width was 99px).
  const nativeLayout = () =>
    page.evaluate(() => {
      const popup = (globalThis as any).chrome.extension.getViews({ type: 'popup' })[0] as
        | Window
        | undefined
      if (!popup?.document.querySelector('.section')) return null
      const document = popup.document
      const buttons = [...document.querySelectorAll('button')]
      const save = buttons.find((button) => button.textContent?.trim() === '保存当前页')!
      const heading = document.querySelector('h1')!
      const settings = buttons.find((button) =>
        button.textContent?.includes('设置、导入与保存结果')
      )!
      settings.scrollIntoView({ block: 'end' })
      const settingsRect = settings.getBoundingClientRect()
      const settingsReachable = settingsRect.top >= 0 && settingsRect.bottom <= popup.innerHeight
      popup.scrollTo(0, 0)
      return {
        width: popup.innerWidth,
        horizontalOverflow: document.documentElement.scrollWidth > popup.innerWidth,
        headingHeight: heading.getBoundingClientRect().height,
        saveHeight: save.getBoundingClientRect().height,
        saveDisabled: save.disabled,
        saveVisible: save.getBoundingClientRect().bottom <= popup.innerHeight,
        settingsReachable,
      }
    })
  await expect.poll(nativeLayout).toEqual({
    width: expect.any(Number),
    horizontalOverflow: false,
    headingHeight: expect.any(Number),
    saveHeight: expect.any(Number),
    saveDisabled: true,
    saveVisible: true,
    settingsReachable: true,
  })
  const layout = (await nativeLayout())!
  expect(layout.width).toBeGreaterThanOrEqual(380)
  expect(layout.width).toBeLessThanOrEqual(400)
  expect(layout.headingHeight).toBeLessThan(30)
  expect(layout.saveHeight).toBeLessThan(48)
  await testInfo.attach('native-toolbar-layout', {
    body: JSON.stringify(layout, null, 2),
    contentType: 'application/json',
  })
  await page.evaluate(() => {
    for (const popup of (globalThis as any).chrome.extension.getViews({ type: 'popup' }))
      popup.close()
  })
  expect(
    await page.locator('.collection-page').evaluate((node) => node.clientWidth)
  ).toBeGreaterThan(700)
  // Supplemental content screenshot, not a screenshot of the native browser chrome.
  await page.setViewportSize({ width: layout.width, height: 600 })
  await page.goto(`chrome-extension://${extensionId}/popup.html`)
  await expect(page.getByRole('heading', { name: '保存浏览中的材料' })).toBeVisible()
  await expect(page.getByRole('button', { name: '保存当前页', exact: true })).toBeDisabled()
  await page.screenshot({ path: testInfo.outputPath('popup-content-at-native-size.png') })
  await expect(page.getByText('旧工具', { exact: true })).toHaveCount(0)
  expect(pageErrors).toEqual([])
})

test('local data survives an identity transfer and a relocated fixed-identity upgrade', async ({
  restartContext,
}) => {
  const connectionId = crypto.randomUUID()
  const requestId = crypto.randomUUID()
  const importId = crypto.randomUUID()
  const data = {
    format: 'inkcre-webext-local-v1',
    settings: {
      profileId: crypto.randomUUID(),
      activeConnectionId: connectionId,
      paused: true,
      origins: [],
      excluded: ['https://private.test'],
    },
    connections: [
      {
        id: connectionId,
        peerId: crypto.randomUUID(),
        name: '迁移测试',
        url: 'https://transfer.invalid/rest',
        secret: 'synthetic-transfer-secret-at-least-32-bytes',
        storageId: -4,
      },
    ],
    outbox: [
      {
        id: requestId,
        connectionId,
        importId,
        createdAt: 123,
        automatic: true,
        url: 'https://source.test/document.pdf',
        state: 'pending',
        command: {
          request_id: requestId,
          mode: 'fixed',
          source: { scope: 'transfer-test', key: requestId, metadata: {} },
          material: {
            url: 'https://source.test/document.pdf',
            title: 'PDF',
            captured_at: new Date().toISOString(),
            method: 'online-pdf',
            coverage: [],
          },
          storage_id: -4,
          parts: [{ role: 'pdf', base64: 'JVBERi0xLjcK' }],
        },
      },
    ],
    imports: [
      {
        id: importId,
        connectionId,
        kind: 'bookmarks',
        scope: 'transfer-test',
        state: 'paused',
        fetchContent: true,
        remaining: [
          {
            key: '1',
            url: 'https://source.test/document.pdf',
            title: 'PDF',
            metadata: {},
            recordAccepted: true,
          },
        ],
        failures: [],
        counts: { total: 1, records: 1, content: 0, existing: 0 },
        stage: 'content-wait',
        requestId,
      },
    ],
    legacy: [['llmProviders', [{ name: '封存测试', secret: 'synthetic-old-value' }]]],
  }
  async function open(context: Awaited<ReturnType<typeof restartContext>>) {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'))
    const id = new URL(worker.url()).hostname
    const page = await context.newPage()
    await page.goto(`chrome-extension://${id}/options.html`)
    await expect(page.getByRole('heading', { name: '信息库', exact: true })).toBeVisible()
    await page.getByText('本机数据迁移', { exact: true }).click()
    return { page, id }
  }
  async function restore(page: Awaited<ReturnType<typeof open>>['page'], value: unknown) {
    await page.getByLabel('本机数据文件').setInputFiles({
      name: 'local.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(value)),
    })
  }
  async function exported(page: Awaited<ReturnType<typeof open>>['page']) {
    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: '导出本机数据', exact: true }).click()
    const file = await (await download).path()
    return JSON.parse(await readFile(file!, 'utf8'))
  }
  const previous = await open(await restartContext({ legacyIdentity: true }))
  await restore(previous.page, { ...data, connections: [] })
  await expect(previous.page.getByRole('alert')).toContainText('缺少')
  await restore(previous.page, data)
  await expect(previous.page.getByRole('status')).toContainText('数据已迁入')
  const saved = await exported(previous.page)
  expect(saved).toEqual(data)
  const current = await open(await restartContext({ legacyIdentity: false }))
  expect(current.id).not.toBe(previous.id)
  await restore(current.page, saved)
  await expect(current.page.getByRole('status')).toContainText('数据已迁入')
  await restore(current.page, {
    ...saved,
    connections: saved.connections.map((entry: any) => ({ ...entry, name: '不能覆盖' })),
  })
  await expect(current.page.getByRole('alert')).toContainText('仅能迁入空')
  expect(await exported(current.page)).toEqual(saved)
  const installedVersion: string = await current.page.evaluate(
    () => (globalThis as any).chrome.runtime.getManifest().version
  )
  const nextVersion = installedVersion.replace(/\d+$/, (patch) => String(Number(patch) + 1))
  const upgraded = await open(await restartContext({ version: nextVersion, relocate: true }))
  expect(upgraded.id).toBe(current.id)
  await expect(
    upgraded.page.getByText(`InKCre / WebExt ${nextVersion}`, { exact: true })
  ).toBeVisible()
  expect(await exported(upgraded.page)).toEqual(saved)
})

test('settings preserve the WebExt card style across desktop, narrow and dark layouts', async ({
  page,
  extensionId,
}, testInfo) => {
  await page.goto(`chrome-extension://${extensionId}/options.html`)
  await expect(page.getByRole('heading', { name: '自动采集', exact: true })).toBeVisible()
  const nameId = await page.getByLabel('信息库名称').getAttribute('id')
  await expect(page.locator(`[id="${nameId}"]`)).toHaveCount(1)
  for (const variant of [
    { name: 'desktop', width: 1280, colorScheme: 'light' as const },
    { name: 'narrow', width: 390, colorScheme: 'light' as const },
    { name: 'dark', width: 1280, colorScheme: 'dark' as const },
  ]) {
    await page.setViewportSize({ width: variant.width, height: 900 })
    await page.emulateMedia({ colorScheme: variant.colorScheme })
    await expect
      .poll(() =>
        page.locator('.settings-header img').evaluate(async (img: HTMLImageElement) => {
          const svg = await (await fetch(img.currentSrc)).text()
          return { white: svg.includes('#FFFFFF'), black: svg.includes('#000000') }
        })
      )
      .toEqual(
        variant.colorScheme === 'dark'
          ? { white: true, black: false }
          : { white: false, black: true }
      )
    await expect(page.getByLabel('PostgREST 地址')).toBeVisible()
    const layout = await page.evaluate(() => {
      const card = document.querySelector('.collection-page > .section')!
      const input = card.querySelector('input')!
      const primary = card.querySelector('button[type="submit"]')!
      const toggle = document.querySelector('[role="switch"]')!
      const toggleRect = toggle.getBoundingClientRect()
      return {
        overflow: document.documentElement.scrollWidth > innerWidth,
        cardBackground: getComputedStyle(card).backgroundColor,
        inputBackground: getComputedStyle(input.parentElement!).backgroundColor,
        cardBorder: getComputedStyle(card).borderTopWidth,
        radius: getComputedStyle(card).borderRadius,
        primary: getComputedStyle(primary).backgroundColor,
        toggleWidth: toggleRect.width,
        toggleHeight: toggleRect.height,
      }
    })
    expect(layout.overflow).toBe(false)
    expect(layout.cardBackground).not.toBe(layout.inputBackground)
    expect(layout.cardBorder).toBe('1px')
    expect(layout.radius).toBe('0px')
    expect(layout.primary).toBe('rgb(20, 184, 166)')
    // ON/OFF font metrics differ across platforms; allow two pixels around 64px.
    expect(layout.toggleWidth).toBeLessThanOrEqual(66)
    expect(layout.toggleHeight).toBeLessThanOrEqual(24)
    await page.screenshot({
      path: testInfo.outputPath(`settings-${variant.name}.png`),
      fullPage: true,
    })
  }
  const pause = page.getByRole('switch', { name: '暂停自动采集', exact: true })
  await expect(pause).toHaveAttribute('aria-checked', 'false')
  await expect(pause.locator('[aria-hidden="false"]')).toHaveText('OFF')
  await pause.focus()
  await page.keyboard.press('Space')
  await expect(pause).toHaveAttribute('aria-checked', 'true')
  await expect(pause.locator('[aria-hidden="false"]')).toHaveText('ON')
  await page.reload()
  await expect(pause).toHaveAttribute('aria-checked', 'true')
  await pause.click()
  await expect(pause).toHaveAttribute('aria-checked', 'false')

  const secret = page.getByLabel('数据库 JWT 密钥')
  const syntheticSecret = 'synthetic-password-visibility-check-only'
  await secret.fill(syntheticSecret)
  await expect(secret).toHaveAttribute('type', 'password')
  await page.getByRole('button', { name: '显示密码', exact: true }).focus()
  await page.keyboard.press('Space')
  await expect(secret).toHaveAttribute('type', 'text')
  await expect(secret).toHaveValue(syntheticSecret)
  await secret.evaluate((input: HTMLInputElement) => {
    document.addEventListener(
      'copy',
      (event) => {
        event.preventDefault()
        input.dataset.copyTriggered = 'true'
      },
      { once: true }
    )
    input.focus()
    input.select()
  })
  await page.keyboard.press('ControlOrMeta+C')
  await expect(secret).toHaveAttribute('data-copy-triggered', 'true')
  await page.screenshot({ path: testInfo.outputPath('password-visible.png'), fullPage: true })
  await page.getByRole('button', { name: '隐藏密码', exact: true }).click()
  await expect(secret).toHaveAttribute('type', 'password')
  await expect(secret).toHaveValue(syntheticSecret)
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.getByRole('status')).toHaveCount(0)

  await page.evaluate(async () => {
    const api = (globalThis as any).chrome.runtime
    const { value } = await api.sendMessage({ type: 'collection-status' })
    await api.sendMessage({
      type: 'collection-settings',
      settings: { ...value.config, excluded: ['https://private.example'] },
    })
  })
  await page.reload()
  await page.getByText('排除页面或站点', { exact: true }).click()
  const exclusions = page.getByLabel('排除规则', { exact: true })
  await expect(exclusions).toHaveValue('https://private.example')
  await exclusions.fill('https://private.example\nhttps://additional.example')
  // Cross a status refresh without replacing the owner's unsaved draft.
  await page.waitForTimeout(3200)
  await expect(exclusions).toHaveValue('https://private.example\nhttps://additional.example')
  await page.getByRole('button', { name: '保存排除规则', exact: true }).click()
  await page.reload()
  await page.getByText('排除页面或站点', { exact: true }).click()
  await expect(exclusions).toHaveValue('https://private.example\nhttps://additional.example')
})

test('joining shares Web authentication and credential updates preserve this Peer', async ({
  page,
  extensionId,
}, testInfo) => {
  test.skip(!process.env.INKCRE_E2E_WEBEXT_PGREST, 'Requires a disposable database.')
  const meta = MetaConfigSchema.parse({
    INKCRE_PGREST_URL: process.env.INKCRE_E2E_WEBEXT_PGREST!,
    INKCRE_JWT_SECRET: process.env.INKCRE_E2E_WEBEXT_JWT_SECRET!,
    INKCRE_PEER_ID: crypto.randomUUID(),
  })
  const web = await WebPeerRuntime.connect(meta, {
    defaultName: 'Web authentication check',
    applicationVersion: 'test',
  })
  try {
    await page.goto(`chrome-extension://${extensionId}/options.html`)
    await expect(page.getByRole('heading', { name: '自动采集', exact: true })).toBeVisible()
    await page.getByLabel('信息库名称').fill('共同信息库')
    await page.getByLabel('PostgREST 地址').fill(meta.INKCRE_PGREST_URL + '/')
    await page.getByLabel('数据库 JWT 密钥').fill('synthetic-wrong-signing-key-not-a-real-secret')
    await page.getByRole('button', { name: '加入信息库', exact: true }).click()
    await expect(page.getByRole('status')).toHaveText('连接配置已保存。')
    await expect(page.getByRole('alert')).toContainText('PGRST301')
    const status = () =>
      page.evaluate(
        async () =>
          (await (globalThis as any).chrome.runtime.sendMessage({ type: 'collection-status' }))
            .value
      )
    expect((await status()).connections).toHaveLength(1)
    const joined = (await status()).connections[0]
    await page.getByRole('button', { name: '修改连接', exact: true }).click()
    await expect(page.getByLabel('数据库 JWT 密钥')).toHaveAttribute('type', 'password')
    await expect(page.getByLabel('数据库 JWT 密钥')).toHaveValue(
      'synthetic-wrong-signing-key-not-a-real-secret'
    )

    await page.getByLabel('数据库 JWT 密钥').fill(meta.INKCRE_JWT_SECRET)
    await page.getByRole('button', { name: '更新连接', exact: true }).click()
    await expect(page.getByRole('alert')).toHaveCount(0)
    await expect(page.getByLabel('本 Peer ID')).toBeVisible()
    expect((await status()).connections).toEqual([joined])
    expect(joined.peerId).not.toBe(meta.INKCRE_PEER_ID)
    expect(joined.url).toBe(meta.INKCRE_PGREST_URL)
    await expect(page.getByLabel('本 Peer ID')).toHaveText(joined.peerId)
    await page.setViewportSize({ width: 390, height: 900 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
    await page.screenshot({ path: testInfo.outputPath('joined-peer-narrow.png'), fullPage: true })

    await page.getByRole('button', { name: '修改连接', exact: true }).click()
    await expect(page.getByLabel('PostgREST 地址')).toBeEditable()
    await expect(page.getByLabel('数据库 JWT 密钥')).toHaveValue(meta.INKCRE_JWT_SECRET)
    await page.getByLabel('信息库名称').fill('更新后的信息库名称')
    await page.getByRole('button', { name: '更新连接', exact: true }).click()
    await expect(page.getByRole('status')).toHaveText('连接配置已保存。')
    const updated = (await status()).connections
    expect(updated).toHaveLength(1)
    expect(updated[0]).toMatchObject({
      id: joined.id,
      peerId: joined.peerId,
      name: '更新后的信息库名称',
    })
    await expect(page.getByLabel('本 Peer ID')).toHaveText(joined.peerId)
    await page.getByRole('button', { name: '修改连接', exact: true }).click()
    await expect(page.getByLabel('数据库 JWT 密钥')).toHaveValue(meta.INKCRE_JWT_SECRET)
    await page.getByLabel('PostgREST 地址').fill('http://127.0.0.1:1')
    await page.getByRole('button', { name: '更新连接', exact: true }).click()
    await expect(page.getByRole('status')).toHaveText('连接配置已保存。')
    expect((await status()).connections[0]).toMatchObject({
      id: joined.id,
      peerId: joined.peerId,
      url: 'http://127.0.0.1:1',
    })
    await page.getByRole('button', { name: '修改连接', exact: true }).click()
    await expect(page.getByLabel('数据库 JWT 密钥')).toHaveValue(meta.INKCRE_JWT_SECRET)
    await page.getByLabel('PostgREST 地址').fill(meta.INKCRE_PGREST_URL)
    await page.getByRole('button', { name: '更新连接', exact: true }).click()
    await expect(page.getByRole('alert')).toHaveCount(0)
  } finally {
    web.runtime.stop()
  }
})

test('native bookmarks, history and PDF import preserve content and partial progress', async ({
  page: initialPage,
  context,
  extensionId,
}) => {
  test.skip(!process.env.INKCRE_E2E_WEBEXT_PGREST, 'Requires a disposable database.')
  test.setTimeout(120_000)
  const articleText = '本次浏览的正文。'
  let page = initialPage
  let peerRequests = 0
  let broken = true
  let sourceAuthentication = 0
  let denyPDFUpload = false
  let forbidPDFRefetch = false
  let blockedPDFRequests = 0
  const pdf = '%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n'
  const server = createServer(async (request, response) => {
    if (request.url?.startsWith('/database')) {
      if (/\/peers\b|\/rpc\/(register|renew)/.test(request.url)) {
        peerRequests++
        response.writeHead(500).end('Peer presence temporarily unavailable')
        return
      }
      if (denyPDFUpload && request.url.endsWith('/rpc/create_storage_blob')) {
        response
          .writeHead(403, { 'Content-Type': 'application/json' })
          .end(JSON.stringify({ message: '测试存储暂不可写' }))
        return
      }
      const body: Buffer[] = []
      for await (const chunk of request) body.push(Buffer.from(chunk))
      const upstream = await fetch(
        process.env.INKCRE_E2E_WEBEXT_PGREST + request.url.slice('/database'.length),
        {
          method: request.method,
          headers: Object.fromEntries(
            Object.entries(request.headers).filter(
              ([name]) =>
                !['host', 'connection', 'content-length', 'accept-encoding'].includes(name)
            )
          ) as Record<string, string>,
          body: ['GET', 'HEAD'].includes(request.method!) ? undefined : Buffer.concat(body),
        }
      )
      const bytes = Buffer.from(await upstream.arrayBuffer())
      response.writeHead(
        upstream.status,
        Object.fromEntries(
          [...upstream.headers].filter(
            ([name]) =>
              !['connection', 'content-length', 'content-encoding', 'transfer-encoding'].includes(
                name
              )
          )
        )
      )
      response.end(bytes)
      return
    }
    if (request.headers.authorization) sourceAuthentication++
    if (request.url === '/redirect') {
      response.writeHead(302, { Location: '/article' }).end()
      return
    }
    if (request.url === '/document.pdf' || request.url === '/blocked.pdf') {
      if (request.url === '/blocked.pdf') {
        blockedPDFRequests++
        if (forbidPDFRefetch) {
          response.writeHead(410).end()
          return
        }
      }
      response.writeHead(200, { 'Content-Type': 'application/pdf' }).end(pdf)
      return
    }
    response.setHeader('Content-Type', 'text/html; charset=utf-8')
    if (request.url === '/broken' && broken) {
      response.writeHead(404).end('<p>not found</p>')
      return
    }
    if (request.url === '/login') {
      response.end('<title>登录</title><input type="password"><p>请登录后继续</p>')
      return
    }
    response.end(
      `<title>导入样本</title><form hidden><input type="password"></form><article><h1>阅读材料</h1><p>${articleText}</p><p>${'可重新解释的来源正文。'.repeat(80)}</p></article>`
    )
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  try {
    await page.goto(`chrome-extension://${extensionId}/options.html`)
    async function message(value: Record<string, unknown>) {
      const response = await page.evaluate(
        (input) => (globalThis as any).chrome.runtime.sendMessage(input),
        value
      )
      expect(response.ok, JSON.stringify(response)).toBe(true)
      return response.value
    }
    await message({
      type: 'collection-connect',
      connection: {
        name: '隔离验收库',
        url: origin + '/database',
        secret: process.env.INKCRE_E2E_WEBEXT_JWT_SECRET,
        storageId: -4,
      },
    })
    const target = (await message({ type: 'collection-status' })).config.activeConnectionId
    const folderId = await page.evaluate(async (url) => {
      const api = (globalThis as any).chrome.bookmarks
      const folder = await api.create({ title: 'InKCre synthetic import' })
      for (const path of ['/redirect', '/login', '/broken', '/document.pdf'])
        await api.create({ parentId: folder.id, title: path, url: url + path })
      return folder.id
    }, origin)
    async function preview(kind: 'bookmarks' | 'history', selectedFolder = folderId) {
      return message({
        type: 'collection-preview-import',
        options: {
          kind,
          folder: kind === 'bookmarks' ? selectedFolder : '',
          since: Date.now() - 60_000,
          until: Date.now() + 1000,
          site: '127.0.0.1',
          minVisits: 0,
          fetchContent: true,
        },
      })
    }
    async function finish(id: string, action: string | null = 'start') {
      if (action) await message({ type: 'collection-control-import', id, action })
      await expect
        .poll(
          async () => {
            return (await message({ type: 'collection-status' })).imports.find(
              (run: any) => run.id === id
            )?.state
          },
          { timeout: 25_000 }
        )
        .toBe('completed')
      return (await message({ type: 'collection-status' })).imports.find(
        (run: any) => run.id === id
      )
    }
    const batch = await preview('bookmarks')
    await message({ type: 'collection-control-import', id: batch.id, action: 'start' })
    await page.close()
    const worker = context.serviceWorkers()[0]!
    await expect
      .poll(
        () =>
          worker.evaluate(async (id) => {
            const db = await new Promise<IDBDatabase>((resolve) => {
              const request = indexedDB.open('inkcre-webext-collection')
              request.onsuccess = () => resolve(request.result)
            })
            try {
              return await new Promise<string>((resolve) => {
                const request = db.transaction('imports').objectStore('imports').get(id)
                request.onsuccess = () => resolve(request.result?.state)
              })
            } finally {
              db.close()
            }
          }, batch.id),
        { timeout: 25_000 }
      )
      .toBe('completed')
    expect(peerRequests).toBe(1)
    page = await context.newPage()
    await page.goto(`chrome-extension://${extensionId}/options.html`)
    const first = await finish(batch.id, null)
    expect(first.counts).toMatchObject({ records: 4, content: 2 })
    expect(first.failuresCount).toBe(2)
    broken = false
    const retried = await finish(batch.id, 'retry')
    expect(retried.counts).toMatchObject({ records: 4, content: 3 })
    expect(retried.failuresCount).toBe(1)
    const repeated = await finish((await preview('bookmarks')).id)
    expect(repeated.counts.existing).toBe(3)
    await page.evaluate(async (url) => {
      await (globalThis as any).chrome.history.deleteAll()
      await (globalThis as any).chrome.history.addUrl({ url: url + '/history' })
    }, origin)
    expect((await finish((await preview('history')).id)).counts.content).toBe(1)
    const pdfItem = (await message({ type: 'collection-status' })).items.find(
      (item: any) =>
        item.importId === batch.id && item.url === origin + '/document.pdf' && item.receipt
    )
    expect(pdfItem).toBeTruthy()
    const storedPdf = await message({
      type: 'collection-read',
      connectionId: target,
      blockId: pdfItem.receipt.root_id,
    })
    expect(Buffer.from(storedPdf.parts[0].base64, 'base64').toString()).toBe(pdf)
    const blockedFolder = await page.evaluate(async (url) => {
      const api = (globalThis as any).chrome.bookmarks
      const folder = await api.create({ title: 'PDF retry fixture' })
      await api.create({ parentId: folder.id, title: '已取得的 PDF', url: url + '/blocked.pdf' })
      return folder.id
    }, origin)
    denyPDFUpload = true
    const interrupted = await preview('bookmarks', blockedFolder)
    await message({ type: 'collection-control-import', id: interrupted.id, action: 'start' })
    await expect
      .poll(
        async () => {
          return (await message({ type: 'collection-status' })).imports.find(
            (run: any) => run.id === interrupted.id
          )?.state
        },
        { timeout: 25_000 }
      )
      .toBe('paused')
    const paused = await message({ type: 'collection-status' })
    const blocked = paused.items.find(
      (item: any) => item.importId === interrupted.id && item.state === 'blocked'
    )
    expect(blocked).toBeTruthy()
    expect(paused.imports.find((run: any) => run.id === interrupted.id)).toMatchObject({
      remainingCount: 1,
      counts: { records: 1, content: 0 },
      error: expect.stringContaining('403'),
    })
    denyPDFUpload = false
    forbidPDFRefetch = true
    await message({ type: 'collection-retry', id: blocked.id })
    const resumed = await finish(interrupted.id, null)
    expect(resumed.counts).toMatchObject({ records: 1, content: 1 })
    expect(resumed.failuresCount).toBe(0)
    expect(blockedPDFRequests).toBe(1)
    const recovered = (await message({ type: 'collection-status' })).items.find(
      (item: any) => item.id === blocked.id
    )
    expect(recovered.state).toBe('confirmed')
    expect(sourceAuthentication).toBe(0)
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('legacy configuration and pending notes survive the private-storage migration', async ({
  page,
  extensionId,
  restartContext,
}) => {
  await page.goto(`chrome-extension://${extensionId}/options.html`)
  await expect(page.getByRole('heading', { name: '自动采集', exact: true })).toBeVisible()
  const legacy = {
    inkcre_app_config: JSON.stringify({
      INKCRE_PGREST_URL: 'http://127.0.0.1:9',
      INKCRE_JWT_SECRET: 'test-only-secret-at-least-thirty-two-bytes',
    }),
    llmProviders: JSON.stringify([
      {
        id: 'old-provider',
        name: '原来的模型',
        type: 'openai',
        apiKey: 'test-only-key',
        models: ['old-model'],
      },
    ]),
    tasks: JSON.stringify([
      {
        id: 'old-note',
        type: 'taking-note',
        state: 'pending',
        parameters: { text: '尚未发送的旧摘录', url: 'https://source.test/old' },
      },
    ]),
    stopwords: JSON.stringify(['原有偏好']),
  }
  await page.evaluate(async (value) => {
    await (globalThis as any).chrome.storage.local.set(value)
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('inkcre-webext-collection')
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const db = request.result
        const tx = db.transaction('legacy', 'readwrite')
        tx.objectStore('legacy').clear()
        // Represent an upgrade interrupted after copying one protected key.
        tx.objectStore('legacy').put(value.inkcre_app_config, 'inkcre_app_config')
        tx.oncomplete = () => {
          db.close()
          resolve()
        }
      }
    })
  }, legacy)
  const restored = await restartContext()
  const options = await restored.newPage()
  await options.goto(`chrome-extension://${extensionId}/options.html`)
  const status = await options.evaluate(() =>
    (globalThis as any).chrome.runtime.sendMessage({ type: 'collection-status' })
  )
  expect(status.ok).toBe(true)
  expect(status.value.connections).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ name: '127.0.0.1:9', url: 'http://127.0.0.1:9' }),
    ])
  )
  expect(status.value.legacyTasks).toEqual([
    { id: 'old-note', state: 'pending', text: '尚未发送的旧摘录', url: 'https://source.test/old' },
  ])
  const stored = await options.evaluate(async () => {
    const local = await (globalThis as any).chrome.storage.local.get(null)
    const privateValues = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const request = indexedDB.open('inkcre-webext-collection')
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const db = request.result
        const tx = db.transaction('legacy')
        const result: Record<string, unknown> = {}
        for (const key of ['inkcre_app_config', 'llmProviders', 'tasks']) {
          const read = tx.objectStore('legacy').get(key)
          read.onsuccess = () => {
            result[key] = read.result
          }
        }
        tx.oncomplete = () => {
          db.close()
          resolve(result)
        }
      }
    })
    return { local, privateValues }
  })
  expect(stored.privateValues).toEqual({
    inkcre_app_config: legacy.inkcre_app_config,
    llmProviders: legacy.llmProviders,
    tasks: legacy.tasks,
  })
  expect(stored.local).toMatchObject({ stopwords: legacy.stopwords })
  for (const key of ['inkcre_app_config', 'llmProviders', 'tasks'])
    expect(stored.local).not.toHaveProperty(key)
})

test('automatic observation reuses current material and preserves manual saves', async ({
  context,
  page,
  extensionId,
}) => {
  test.skip(!process.env.INKCRE_E2E_WEBEXT_PGREST, 'Requires a disposable database.')
  test.setTimeout(120_000)
  let articleText = '本次浏览的正文。'
  let broken = true
  let sourceAuthentication = 0
  const pdf = '%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n'
  const server = createServer((request, response) => {
    if (request.headers.authorization) sourceAuthentication++
    if (request.url === '/redirect') {
      response.writeHead(302, { Location: '/article' }).end()
      return
    }
    if (request.url === '/document.pdf') {
      response.writeHead(200, { 'Content-Type': 'application/pdf' }).end(pdf)
      return
    }
    response.setHeader('Content-Type', 'text/html; charset=utf-8')
    if (request.url === '/broken' && broken) {
      response.writeHead(404).end('<p>not found</p>')
      return
    }
    if (request.url === '/login') {
      response.end('<title>登录</title><input type="password"><p>请登录后继续</p>')
      return
    }
    response.end(
      `<title>导入样本</title><article><h1>阅读材料</h1><p>${articleText}</p><p>${'可重新解释的来源正文。'.repeat(80)}</p></article>`
    )
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  try {
    const source = await context.newPage()
    await source.goto(origin + '/article')
    await page.goto(`chrome-extension://${extensionId}/options.html`)
    async function message(value: Record<string, unknown>) {
      const response = await page.evaluate(
        (input) => (globalThis as any).chrome.runtime.sendMessage(input),
        value
      )
      expect(response.ok, JSON.stringify(response)).toBe(true)
      return response.value
    }
    await message({
      type: 'collection-connect',
      connection: {
        name: '隔离验收库',
        url: process.env.INKCRE_E2E_WEBEXT_PGREST,
        secret: process.env.INKCRE_E2E_WEBEXT_JWT_SECRET,
        storageId: -4,
      },
    })
    const target = (await message({ type: 'collection-status' })).config.activeConnectionId
    await source.bringToFront()
    await message({ type: 'collection-enable-origin', origin })
    let currentId: number
    await expect
      .poll(
        async () => {
          const status = await message({ type: 'collection-status' })
          const item = status.items.find(
            (item: any) => item.automatic && item.state === 'confirmed'
          )
          currentId = item?.receipt.root_id
          return !!currentId
        },
        { timeout: 20_000 }
      )
      .toBe(true)
    const sourceTab = await page.evaluate(
      async (url) =>
        (await (globalThis as any).chrome.tabs.query({})).find((tab: any) => tab.url === url).id,
      origin + '/article'
    )
    const fixedId = await message({
      type: 'collection-save',
      kind: 'page',
      note: '主动留下的附注',
      tabId: sourceTab,
      expectedURL: origin + '/article',
    })
    await expect
      .poll(
        async () =>
          (await message({ type: 'collection-status' })).items.find(
            (item: any) => item.id === fixedId
          )?.state
      )
      .toBe('confirmed')
    const fixedRoot = (await message({ type: 'collection-status' })).items.find(
      (item: any) => item.id === fixedId
    ).receipt.root_id
    articleText = '重新访问后变化的正文。'
    await source
      .locator('article p')
      .first()
      .evaluate((node, value) => {
        node.textContent = value
      }, articleText)
    await page.bringToFront()
    await source.bringToFront()
    await expect
      .poll(
        async () => {
          const read = await message({
            type: 'collection-read',
            connectionId: target,
            blockId: currentId!,
          })
          return read.parts.some(
            (part: any) =>
              part.role === 'text' &&
              Buffer.from(part.base64, 'base64').toString().includes(articleText)
          )
        },
        { timeout: 40_000 }
      )
      .toBe(true)
    const fixed = await message({
      type: 'collection-read',
      connectionId: target,
      blockId: fixedRoot,
    })
    expect(
      Buffer.from(fixed.parts.find((part: any) => part.role === 'text').base64, 'base64').toString()
    ).toContain('本次浏览的正文。')
    expect(fixed.notes[0].text).toBe('主动留下的附注')
    await source.evaluate(() => {
      history.pushState({}, '', '/next')
      document.querySelector('article p')!.textContent = 'SPA 导航后的正文。'
    })
    await expect
      .poll(
        async () => {
          const status = await message({ type: 'collection-status' })
          if (
            status.items.some(
              (item: any) =>
                item.automatic && item.url === origin + '/next' && item.state === 'confirmed'
            )
          )
            return 'confirmed'
          return JSON.stringify({
            errors: status.tabErrors,
            items: status.items.map((item: any) => ({
              url: item.url,
              state: item.state,
              error: item.error,
            })),
            visibility: await source.evaluate(() => document.visibilityState),
          })
        },
        { timeout: 20_000 }
      )
      .toBe('confirmed')
    await source.evaluate(() => history.replaceState({}, '', '/article'))
    const settings = (await message({ type: 'collection-status' })).config
    await message({ type: 'collection-settings', settings: { ...settings, paused: true } })
    await source.evaluate(() => {
      const range = document.createRange()
      range.selectNodeContents(document.querySelector('article p')!)
      window.getSelection()!.removeAllRanges()
      window.getSelection()!.addRange(range)
    })
    const manual = await message({
      type: 'collection-save',
      kind: 'selection',
      note: '选区附注',
      tabId: sourceTab,
      expectedURL: origin + '/article',
    })
    await expect
      .poll(
        async () =>
          (await message({ type: 'collection-status' })).items.find(
            (item: any) => item.id === manual
          )?.state
      )
      .toBe('confirmed')
    expect(sourceAuthentication).toBe(0)
    const whilePaused = await message({
      type: 'collection-save',
      kind: 'page',
      note: '',
      tabId: sourceTab,
      expectedURL: origin + '/article',
    })
    await expect
      .poll(
        async () =>
          (await message({ type: 'collection-status' })).items.find(
            (item: any) => item.id === whilePaused
          )?.state
      )
      .toBe('confirmed')
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('restored automatic work can pause without blocking a manual excerpt', async ({
  page,
  extensionId,
}) => {
  test.skip(!process.env.INKCRE_E2E_WEBEXT_PGREST, 'Requires a disposable database.')
  await page.goto(`chrome-extension://${extensionId}/options.html`)
  async function message(value: Record<string, unknown>) {
    const result = await page.evaluate(
      (input) => (globalThis as any).chrome.runtime.sendMessage(input),
      value
    )
    expect(result.ok, result.error).toBe(true)
    return result.value
  }
  const target = await message({
    type: 'collection-connect',
    connection: {
      name: '隔离验收库',
      url: process.env.INKCRE_E2E_WEBEXT_PGREST,
      secret: process.env.INKCRE_E2E_WEBEXT_JWT_SECRET,
      storageId: -4,
    },
  })
  const config = (await message({ type: 'collection-status' })).config
  await message({
    type: 'collection-settings',
    settings: { ...config, paused: true, origins: ['http://127.0.0.1'] },
  })
  const pending = Array.from({ length: 4 }, (_, index) => {
    const id = crypto.randomUUID()
    const url = `http://127.0.0.1/restored-${index}`
    return {
      id,
      connectionId: target,
      createdAt: Date.now() - 10_000 + index,
      automatic: true,
      url,
      state: index ? 'pending' : 'sending',
      command: {
        request_id: id,
        mode: 'current',
        source: { scope: 'restored:' + config.profileId, key: url, metadata: { url } },
        material: {
          title: '已接纳的自动观察',
          url,
          method: 'visible-dom',
          captured_at: new Date().toISOString(),
          coverage: [],
        },
        parts: [textPart('text', '恢复后的当前材料')],
      },
    }
  })
  await page.evaluate(
    (items) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('inkcre-webext-collection')
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const db = request.result
          const tx = db.transaction('outbox', 'readwrite')
          for (const item of items) tx.objectStore('outbox').put(item, item.id)
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
        }
      }),
    pending
  )
  const manual = await message({
    type: 'collection-save-draft',
    draft: {
      text: '暂停时主动保存的摘录',
      url: 'https://source.test/manual',
      title: '手动摘录',
      captured_at: new Date().toISOString(),
    },
    note: '',
  })
  await expect
    .poll(
      async () =>
        (await message({ type: 'collection-status' })).items.find((item: any) => item.id === manual)
          ?.state
    )
    .toBe('confirmed')
  const held = (await message({ type: 'collection-status' })).items.filter((item: any) =>
    pending.some((entry) => entry.id === item.id)
  )
  expect(held).toHaveLength(4)
  expect(held.every((item: any) => item.state !== 'confirmed')).toBe(true)
  await message({
    type: 'collection-settings',
    settings: { ...config, paused: false, origins: ['http://127.0.0.1'] },
  })
  await expect
    .poll(async () => {
      await message({ type: 'collection-wake' })
      return (await message({ type: 'collection-status' })).items.filter(
        (item: any) => pending.some((entry) => entry.id === item.id) && item.state === 'confirmed'
      ).length
    })
    .toBe(4)
})

test('stalled registration and failed batches do not block local edits or other materials', async ({
  page,
  extensionId,
}) => {
  test.skip(!process.env.INKCRE_E2E_WEBEXT_PGREST, 'Requires a disposable database.')
  let registrationRequests = 0
  let failedRequests = 0
  const server = createServer((request, response) => {
    if (request.url?.startsWith('/peers')) {
      registrationRequests++
      return // Keep presence registration pending while the owner edits and submits.
    }
    failedRequests++
    response
      .writeHead(500, { 'Content-Type': 'application/json' })
      .end(JSON.stringify({ message: 'offline fixture' }))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const offline = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  try {
    await page.goto(`chrome-extension://${extensionId}/options.html`)
    async function message(value: Record<string, unknown>) {
      const result = await page.evaluate(
        (input) => (globalThis as any).chrome.runtime.sendMessage(input),
        value
      )
      expect(result.ok, result.error).toBe(true)
      return result.value
    }
    await page.getByLabel('PostgREST 地址').fill(offline)
    await page.getByLabel('数据库 JWT 密钥').fill(process.env.INKCRE_E2E_WEBEXT_JWT_SECRET!)
    await page.getByRole('button', { name: '加入信息库', exact: true }).click()
    await expect(page.getByRole('status')).toHaveText('连接配置已保存。')
    await expect.poll(() => registrationRequests).toBe(1)
    await page.reload()
    await page.getByRole('button', { name: '修改连接', exact: true }).click()
    await page.getByLabel('信息库名称').fill('离线时也可修改')
    await page.getByRole('button', { name: '更新连接', exact: true }).click()
    await expect(page.getByRole('status')).toHaveText('连接配置已保存。')
    const held = (await message({ type: 'collection-status' })).connections[0]
    expect(held.name).toBe('离线时也可修改')
    expect(registrationRequests).toBe(1)
    const online = await message({
      type: 'collection-connect',
      connection: {
        name: '可用连接',
        url: process.env.INKCRE_E2E_WEBEXT_PGREST,
        secret: process.env.INKCRE_E2E_WEBEXT_JWT_SECRET,
        storageId: -4,
      },
    })
    const pending = Array.from({ length: 4 }, (_, index) => {
      const id = crypto.randomUUID()
      const url = `https://source.test/queue-${index}`
      return {
        id,
        connectionId: index < 3 ? held.id : online,
        createdAt: Date.now() + index,
        automatic: false,
        url,
        state: 'pending',
        command: {
          request_id: id,
          mode: 'record',
          source: { scope: 'queue-failure-test', key: id, metadata: { url } },
        },
      }
    })
    await page.evaluate(
      (items) =>
        new Promise<void>((resolve, reject) => {
          const request = indexedDB.open('inkcre-webext-collection')
          request.onerror = () => reject(request.error)
          request.onsuccess = () => {
            const db = request.result
            const tx = db.transaction('outbox', 'readwrite')
            for (const item of items) tx.objectStore('outbox').put(item, item.id)
            tx.oncomplete = () => {
              db.close()
              resolve()
            }
            tx.onabort = () => reject(tx.error)
          }
        }),
      pending
    )
    await message({ type: 'collection-wake' })
    await expect
      .poll(
        async () =>
          (await message({ type: 'collection-status' })).items.find(
            (item: any) => item.id === pending[3]!.id
          )?.state
      )
      .toBe('confirmed')
    expect(failedRequests).toBe(3)
    // Updating this info-base's endpoint retains its identity and unsent queue.
    await message({
      type: 'collection-connect',
      connectionId: held.id,
      connection: {
        ...held,
        url: process.env.INKCRE_E2E_WEBEXT_PGREST,
        secret: process.env.INKCRE_E2E_WEBEXT_JWT_SECRET,
      },
    })
    await expect
      .poll(
        async () =>
          (await message({ type: 'collection-status' })).items.filter(
            (item: any) =>
              pending.some((entry) => entry.id === item.id) && item.state === 'confirmed'
          ).length
      )
      .toBe(4)
    const updated = (await message({ type: 'collection-status' })).connections.find(
      (item: any) => item.id === held.id
    )
    expect(updated.peerId).toBe(held.peerId)
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('extension retains an incomplete graph and continues after browser restart', async ({
  context,
  page,
  extensionId,
  restartContext,
}) => {
  test.skip(
    !process.env.INKCRE_E2E_WEBEXT_PGREST,
    'Run the task verification script with a disposable database runtime.'
  )
  test.setTimeout(120_000)
  const endpoint = process.env.INKCRE_E2E_WEBEXT_PGREST!
  const secret = process.env.INKCRE_E2E_WEBEXT_JWT_SECRET!
  let rejectAuthentication = false
  let dropAfterCommit = false
  let holdSubmissions = false
  let publicAuthHeaders = 0
  const sourceRequests: string[] = []
  const server = createServer(async (request, response) => {
    const url = request.url ?? '/'
    if (url.startsWith('/database')) {
      if (rejectAuthentication) {
        response
          .writeHead(401, { 'Content-Type': 'application/json' })
          .end(JSON.stringify({ code: 'PGRST301', message: 'No suitable key or wrong key type' }))
        return
      }
      if (holdSubmissions && request.method !== 'GET') {
        response.destroy()
        return
      }
      const body: Buffer[] = []
      for await (const chunk of request) body.push(Buffer.from(chunk))
      const upstream = await fetch(endpoint + url.slice('/database'.length), {
        method: request.method,
        headers: Object.fromEntries(
          Object.entries(request.headers).filter(
            ([name]) => !['host', 'connection', 'content-length', 'accept-encoding'].includes(name)
          )
        ) as Record<string, string>,
        body: ['GET', 'HEAD'].includes(request.method!) ? undefined : Buffer.concat(body),
      })
      const bytes = Buffer.from(await upstream.arrayBuffer())
      if (dropAfterCommit && upstream.ok && request.method === 'POST' && url.includes('/blocks')) {
        dropAfterCommit = false
        holdSubmissions = true
        response.destroy()
        return
      }
      response.writeHead(
        upstream.status,
        Object.fromEntries(
          [...upstream.headers].filter(
            ([name]) =>
              !['connection', 'content-length', 'content-encoding', 'transfer-encoding'].includes(
                name
              )
          )
        )
      )
      response.end(bytes)
      return
    }
    if (request.headers.authorization) publicAuthHeaders++
    sourceRequests.push(url)
    response.setHeader('Content-Type', 'text/html; charset=utf-8')
    if (url === '/frame') {
      response.end('<p>同源框架里的正文</p>')
      return
    }
    if (url === '/login') {
      response.end('<title>登录</title><input type="password"><p>请登录</p>')
      return
    }
    response.end(
      `<!doctype html><html><head><title>现场页面</title></head><body><main><h1>已加载的正文</h1><p id="quote">需要留下的原句。</p><div id="shadow"></div><iframe src="/frame"></iframe><textarea>未提交草稿不要保存</textarea><input type="password" value="private-password"><div contenteditable>编辑中的秘密</div></main><script>document.querySelector('#shadow').attachShadow({mode:'open'}).innerHTML='<p>Shadow DOM 正文</p>';window.fixtureExecuted=true;</script></body></html>`
    )
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address() as { port: number }
  const origin = `http://127.0.0.1:${address.port}`
  try {
    const source = await context.newPage()
    await source.goto(origin + '/article')
    await page.goto(`chrome-extension://${extensionId}/options.html`)
    await page.getByLabel('PostgREST 地址').fill(`${origin}/database`)
    await page.getByLabel('数据库 JWT 密钥').fill(secret)
    await page.getByRole('button', { name: '加入信息库', exact: true }).click()
    await expect(page.getByLabel('本 Peer ID')).toBeVisible({ timeout: 60_000 })
    const sourceTabId = await page.evaluate(async (url) => {
      const tabs = await (globalThis as any).chrome.tabs.query({})
      return tabs.find((tab: { url?: string }) => tab.url === url)?.id as number
    }, origin + '/article')
    expect(sourceTabId).toBeGreaterThan(0)
    rejectAuthentication = true
    const saved = await page.evaluate(
      async (input) =>
        (globalThis as any).chrome.runtime.sendMessage({
          type: 'collection-save',
          kind: 'page',
          note: '我的附注',
          tabId: input.id,
          expectedURL: input.url,
        }),
      { id: sourceTabId, url: origin + '/article' }
    )
    expect(saved.ok).toBe(true)
    const requestId = saved.value as string
    await expect
      .poll(() =>
        page.evaluate(async (id) => {
          const response = await (globalThis as any).chrome.runtime.sendMessage({
            type: 'collection-status',
          })
          return response.value.items.find((item: { id: string }) => item.id === id)
        }, requestId)
      )
      .toMatchObject({ state: 'blocked', error: expect.stringContaining('PGRST301') })
    rejectAuthentication = false
    dropAfterCommit = true
    await page.evaluate(
      async (id) =>
        (globalThis as any).chrome.runtime.sendMessage({ type: 'collection-retry', id }),
      requestId
    )
    await expect.poll(() => holdSubmissions, { timeout: 25_000 }).toBe(true)
    await expect
      .poll(() =>
        page.evaluate(async (id) => {
          const response = await (globalThis as any).chrome.runtime.sendMessage({
            type: 'collection-status',
          })
          return response.value.items.find((item: { id: string }) => item.id === id)?.state
        }, requestId)
      )
      .toBe('sending')
    const restored = await restartContext()
    // Ensures the extension service worker is up before reconnecting the page.
    let worker = restored.serviceWorkers()[0]
    worker ??= await restored.waitForEvent('serviceworker')
    expect(worker).toBeTruthy()
    const recovered = await restored.newPage()
    await recovered.goto(`chrome-extension://${extensionId}/options.html`)
    const held = await recovered.evaluate(async () =>
      (globalThis as any).chrome.runtime.sendMessage({ type: 'collection-status' })
    )
    expect(held.value.items.some((item: { id: string }) => item.id === requestId)).toBe(true)
    const originalTarget = held.value.items.find(
      (item: { id: string }) => item.id === requestId
    ).connectionId
    const switched = await recovered.evaluate(
      async (connection) =>
        (globalThis as any).chrome.runtime.sendMessage({ type: 'collection-connect', connection }),
      { name: '另一个信息库连接', url: endpoint, secret, storageId: -4 }
    )
    expect(switched.ok).toBe(true)
    expect(switched.value).not.toBe(originalTarget)
    holdSubmissions = false
    await recovered.evaluate(async () =>
      (globalThis as any).chrome.runtime.sendMessage({ type: 'collection-wake' })
    )
    await expect
      .poll(
        () =>
          recovered.evaluate(async (id) => {
            const response = await (globalThis as any).chrome.runtime.sendMessage({
              type: 'collection-status',
            })
            const item = response.value.items.find((item: { id: string }) => item.id === id)
            return item ? { state: item.state, error: item.error } : null
          }, requestId),
        { timeout: 25_000 }
      )
      .toMatchObject({ state: 'confirmed' })
    const afterSwitch = await recovered.evaluate(() =>
      (globalThis as any).chrome.runtime.sendMessage({ type: 'collection-status' })
    )
    expect(afterSwitch.value.config.activeConnectionId).toBe(switched.value)
    expect(
      afterSwitch.value.items.find((item: { id: string }) => item.id === requestId).connectionId
    ).toBe(originalTarget)
    await recovered.getByRole('button', { name: '读取已保存材料' }).click()
    const reader = recovered.getByRole('article', { name: '已保存材料' })
    await expect(reader).toContainText('需要留下的原句。')
    await expect(reader).toContainText('Shadow DOM 正文')
    await expect(reader).toContainText('同源框架里的正文')
    await expect(reader).toContainText('我的附注')
    await expect(reader).not.toContainText('未提交草稿不要保存')
    await expect(reader).not.toContainText('private-password')
    await expect(reader).not.toContainText('编辑中的秘密')
    expect(await recovered.evaluate(() => (globalThis as any).fixtureExecuted)).toBeUndefined()
    const jwt = await new SignJWT({ role: 'authenticated' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('inkcre-peer')
      .setAudience('inkcre-api')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode(secret))
    const roots = await fetch(
      `${endpoint}/blocks?resolver=eq.extensions.web-collection.material.v1`,
      {
        headers: { Authorization: `Bearer ${jwt}`, 'Accept-Profile': 'inkcre' },
      }
    ).then((response) => response.json())
    expect(
      roots.filter((row: { content: string }) => JSON.parse(row.content).request_id === requestId)
    ).toHaveLength(1)
    expect(publicAuthHeaders).toBe(0)
    await recovered.screenshot({ path: 'test-results/webext-material-reader.png', fullPage: true })
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('named connections migrate atomically and survive reload and cross-page switching', async ({
  context,
  extensionId,
  restartContext,
}) => {
  const first = { id: crypto.randomUUID(), peerId: crypto.randomUUID(), name: '个人' }
  const second = { id: crypto.randomUUID(), peerId: crypto.randomUUID(), name: '工作' }
  const secret = 'synthetic-migration-secret-not-for-real-use'
  const previous = {
    activeConnectionId: second.id,
    connections: [first, second].map((item, index) => ({
      id: item.id,
      name: item.name,
      config: {
        INKCRE_PGREST_URL: `https://database-${index}.example`,
        INKCRE_JWT_SECRET: secret,
        INKCRE_PEER_ID: item.peerId,
      },
    })),
  }
  const initial = await context.newPage()
  await initial.goto(`chrome-extension://${extensionId}/options.html`)
  await expect(initial.getByRole('heading', { name: '信息库', exact: true })).toBeVisible()
  const [worker] = context.serviceWorkers()
  await worker.evaluate(async (previous) => {
    const chrome = (globalThis as any).chrome
    await chrome.storage.local.set({
      inkcre_app_config: JSON.stringify(previous),
      inkcreApi: 'https://legacy-api.example',
      inkcreApiConnections: JSON.stringify({
        connections: [{ name: '旧 API', url: 'https://legacy-api.example' }],
      }),
    })
  }, previous)
  const restarted = await restartContext()
  const page = await restarted.newPage()
  await page.goto(`chrome-extension://${extensionId}/options.html`)
  await expect(page.getByRole('combobox', { name: '当前信息库' })).toHaveText('工作')
  await expect(page.getByLabel('本 Peer ID')).toHaveText(second.peerId)
  const other = await restarted.newPage()
  await other.goto(`chrome-extension://${extensionId}/options.html`)
  await expect(other.getByLabel('本 Peer ID')).toHaveText(second.peerId)
  // Exercise local connection persistence without requiring a native host-permission prompt.
  const added = await page.evaluate(
    async (secret) =>
      (globalThis as any).chrome.runtime.sendMessage({
        type: 'collection-connect',
        connection: { name: '新增', url: 'https://new-database.example', secret, storageId: -4 },
      }),
    secret
  )
  expect(added.ok).toBe(true)
  await expect(other.getByRole('combobox', { name: '当前信息库' })).toHaveText('新增')
  await page.getByRole('combobox', { name: '当前信息库' }).click()
  await page.getByRole('option', { name: /^个人/ }).click()
  await expect(other.getByLabel('本 Peer ID')).toHaveText(first.peerId)
  await other.reload()
  await expect(other.getByRole('combobox', { name: '当前信息库' })).toHaveText('个人')
  const again = await restartContext()
  const restored = await again.newPage()
  await restored.goto(`chrome-extension://${extensionId}/options.html`)
  await expect(restored.getByLabel('本 Peer ID')).toHaveText(first.peerId)
  const status = await restored.evaluate(
    async () =>
      (await (globalThis as any).chrome.runtime.sendMessage({ type: 'collection-status' })).value
  )
  expect(status.connections).toHaveLength(3)
  expect(status.connections).toEqual(
    expect.arrayContaining([expect.objectContaining(first), expect.objectContaining(second)])
  )
  const legacyUrl = await restored.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open('inkcre-webext-collection')
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const db = request.result
          const tx = db.transaction('legacy')
          const value = tx.objectStore('legacy').get('inkcreApi')
          value.onsuccess = () => resolve(value.result)
          tx.oncomplete = () => db.close()
        }
      })
  )
  expect(legacyUrl).toBe('https://legacy-api.example')
})
