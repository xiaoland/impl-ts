import { createApp, h, markRaw, ref, shallowRef, watch } from 'vue'
import {
  Block,
  Relation,
  ResolverCache,
  Resolver,
  TextResolver,
  HtmlResolver,
  setInfoBaseRouter,
  presentLexicalMatches,
  type InfoBaseRoute,
  type LexicalRetrievalMatch,
} from '@inkcre/core'
import '@inkcre/ui-web/styles'
import MailExtension from '../src'

await MailExtension.initialize()
import BodyRenderer from '../src/components/contentNewsletterBody.vue'
import BodyPreview from '../src/components/contentNewsletterPreview.vue'

for (const resolver of [TextResolver, HtmlResolver]) {
  resolver.previewRenderer = markRaw(BodyPreview)
  resolver.solvedContentRenderer = markRaw(BodyRenderer)
  Resolver.register(resolver.type, resolver)
}

const raw = `<div style="display:none">Preview noise</div>
<script>parent.document.body.dataset.messageScript = 'executed'</script>
<img src="https://tracker.invalid/attack" onerror="parent.document.body.dataset.messageScript = 'executed'">
<table role="none" width="670" cellpadding="40"><tr><td nowrap><h1>Two useful articles</h1>
<p>Article one explains unsubscribe design.</p>
<a href="https://example.org/one?id=a%2Fb&utm_source=mail&edition=x%2By#section">Article one</a>
<h2>Article two</h2><p>A separate article must survive.</p>
<p>Public reference https://example.org/reference</p><pre>left | right</pre>
<a href="https://example.org/two?page=2&mc_cid=track">Article two</a>
<img src="https://tracker.invalid/open" width="1" height="1" alt="tracker">
<a href="https://example.org/remove?token=secret">Unsubscribe</a>
<p>Update your email preferences or unsubscribe <a href="https://example.org/remove">here</a></p>
<a href="https://example.org/issue">Read online</a>
<a href="https://example.org/share"><img src="https://tracker.invalid/share" alt="share on facebook"></a>
<h6>Small heading must stay readable</h6>
<a href="https://example.org/image-article"><img src="https://tracker.invalid/article" width="630"></a>
<a href="https://example.org/chart"><img src="https://tracker.invalid/chart" alt="Results chart"></a>
<table aria-label="Measurements" width="180"><tr><th colspan="2">Measurements</th></tr><tr><td rowspan="2">Median</td><td>42</td></tr><tr><td>43</td></tr></table>
</td></tr></table>`
const blocks = new Map<number, Block>()
function block(id: number, resolver: string, content: string): Block {
  const result = Block.parse({
    id,
    resolver,
    content,
    storage: null,
    updated_at: '2026-10-20T00:00:00Z',
  })
  blocks.set(id, result)
  return result
}
block(
  1,
  'extensions.mail.mailing_list.v1',
  JSON.stringify({
    list_id: 'weekly.example.org',
    name: 'Research Weekly',
  })
)
for (const id of [2, 3, 4]) {
  block(
    id,
    'extensions.mail.email.v1',
    JSON.stringify({
      message_id: id === 4 ? 'issue-2@example.org' : 'issue-1@example.org',
      subject: 'Weekly research',
      authored_at: '2026-10-20T00:00:00Z',
    })
  )
}
block(10, 'extensions.mail.newsletter_text.v1', 'Plain alternative should not appear twice')
block(
  11,
  'extensions.mail.newsletter_html.v1',
  raw +
    (new URLSearchParams(location.search).has('long')
      ? Array.from(
          { length: 20 },
          (_, index) =>
            `<h2>Long article ${index + 1}</h2>${'<p>Reading paragraphs with useful information.</p>'.repeat(12)}`
        ).join('')
      : '')
)
block(12, 'extensions.mail.newsletter_text.v1', 'Separate mixed section must remain.')
block(13, 'extensions.mail.newsletter_text.v1', 'Inner plain alternative should not appear twice')
block(14, 'core.text.v1', 'Legacy plain alternative')
block(15, 'core.html.v1', '<h1>Legacy HTML content</h1>')
block(5, 'extensions.mail.mailing_list.v1', blocks.get(1)!.content)
block(16, 'extensions.mail.newsletter_html.v1', '<h1>Shared body</h1>')
block(17, 'extensions.mail.newsletter_html.v1', '<h1>Orphan body</h1>')
block(18, 'uninstalled.type.v1', 'Unknown decoder')

const archive = new URLSearchParams(location.search).get('archive')
if (archive === 'long') {
  block(
    4,
    'extensions.mail.email.v1',
    JSON.stringify({
      message_id: 'issue-2@example.org',
      subject: 'A long newsletter title with useful research and articles '.repeat(4),
      authored_at: null,
    })
  )
}

const relations = [
  ...[2, 3].map((to_) => ({ from_: 1, to_, content: 'publishes' })),
  { from_: 5, to_: 4, content: 'publishes' },
  ...(new URLSearchParams(location.search).has('recall') ? [2, 4] : []).map((from_) => ({
    from_,
    to_: 16,
    content: JSON.stringify({ role: 'body', part_id: '3' }),
  })),
  { from_: 4, to_: 14, content: JSON.stringify({ role: 'body', part_id: '1' }) },
  { from_: 4, to_: 15, content: JSON.stringify({ role: 'body', part_id: '2' }) },
  ...[
    [10, '1.1', ['1']],
    [13, '1.2.1.1', ['1', '1.2.1']],
    [11, '1.2.1.2', ['1', '1.2.1']],
    [12, '2', []],
  ].map(([to_, part_id, alternative_groups]) => ({
    from_: 2,
    to_,
    content: JSON.stringify({ role: 'body', part_id, alternative_groups }),
  })),
].map((value, index) => Relation.parse({ id: index + 1, ...value }))

// Only persistence is replaced; resolvers, projections, routing and renderers are real.
Block.find = async (id) => blocks.get(id) ?? null
Block.getMany = async (ids) => [...ids].flatMap((id) => (blocks.has(id) ? [blocks.get(id)!] : []))
Block.dbApi.from = (() => ({
  select: () => ({
    eq: async (_column: string, value: string) => ({
      data: [...blocks.values()].filter((block) => block.resolver === value),
      error: null,
    }),
  }),
})) as typeof Block.dbApi.from
Relation.getByBlock = async (id) =>
  archive === 'empty' ? [] : relations.filter((item) => item.from_ === id || item.to_ === id)
Relation.dbApi.from = (() => {
  let rows = relations
  const query = {
    select: () => query,
    eq: (column: keyof Relation, value: unknown) => {
      rows = rows.filter((row) => row[column] === value)
      return query
    },
    // PostgREST query builders are deliberately awaitable after any filter.
    // oxlint-disable-next-line unicorn/no-thenable
    then: (resolve: (value: unknown) => unknown) => resolve({ data: rows, error: null }),
  }
  return query
}) as typeof Relation.dbApi.from

if (new URLSearchParams(location.search).has('recall')) {
  const matches: LexicalRetrievalMatch[] = [11, 2, 10, 4, 16, 17, 18, 15].map((id, index) => ({
    block: blocks.get(id)!,
    label: `Raw ${id}`,
    excerpt: `Article ${id} https://tracker.invalid/opaque-subscriber-token`,
    evidence: 'text_substring',
    rank: 10 - index,
  }))
  void presentLexicalMatches(matches).then((groups) => {
    createApp({
      render: () =>
        h(
          'pre',
          { id: 'recall-result' },
          JSON.stringify(
            groups.map((group) => ({
              id: group.block.id,
              label: group.label,
              excerpt: group.excerpt,
              readable: group.readable,
              evidence: group.matches.map((match) => ({
                id: match.block.id,
                excerpt: match.excerpt,
                rank: match.rank,
                unchanged: matches.includes(match),
              })),
            }))
          )
        ),
    }).mount('#app')
  })
}

const current = ref<InfoBaseRoute>({
  name: 'solved-content',
  block: archive !== null ? 1 : new URLSearchParams(location.search).has('legacy') ? 4 : 2,
})
setInfoBaseRouter({
  current,
  push: (route) => {
    current.value = route
  },
  back: () => {
    current.value = { name: 'solved-content', block: 2 }
  },
})
const view = shallowRef<ReturnType<typeof h>>()
watch(
  current,
  async (route) => {
    if (route.name !== 'solved-content') return
    const target = blocks.get(route.block)!
    const resolver = await ResolverCache.getResolver(target)
    const solvedContent = await resolver.getSolvedContent({ materializeMissing: false })
    const renderer = (
      resolver.constructor as {
        solvedContentRenderer: Parameters<typeof markRaw>[0]
      }
    ).solvedContentRenderer
    view.value = h(renderer, { resolver, solvedContent, block: target })
  },
  { immediate: true }
)
if (new URLSearchParams(location.search).has('projection')) {
  void (async () => {
    const resolver = await ResolverCache.getResolver(blocks.get(11)!)
    const projection = {
      lexical: await resolver.getText({ context: 'lexical' }),
      default: await resolver.getText(),
      raw: await resolver.getRawContent(),
      solved: await resolver.getSolvedContent(),
    }
    createApp({
      render: () => h('pre', { id: 'projection-result' }, JSON.stringify(projection)),
    }).mount('#app')
  })()
} else if (!new URLSearchParams(location.search).has('recall')) {
  if (archive !== null) {
    document.getElementById('app')!.style.cssText = 'width:860px;max-width:100%;margin:auto'
  }
  if (new URLSearchParams(location.search).has('long')) {
    document.getElementById('app')!.style.cssText =
      'width:900px;max-width:100%;height:650px;overflow:auto;margin:auto'
  }
  createApp({ render: () => view.value }).mount('#app')
}
