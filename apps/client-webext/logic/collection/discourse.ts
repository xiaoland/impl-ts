/** Preserve facts explicitly present in loaded Discourse posts. */
export function discourseText(document: Document, url: string): string | null {
  const generator = document.querySelector('meta[name="generator"]')?.getAttribute('content')
  if (!generator || !/^Discourse(?:\s|$)/i.test(generator)) return null

  const selector = '.crawler-post, article[data-post-id]'
  const posts = [...document.querySelectorAll(selector)].filter(
    (post) => !post.parentElement?.closest(selector)
  )
  if (!posts.length) return null

  const sections = new Map<string, string>()
  for (const post of posts) {
    const body = post.querySelector(':scope > .post, .cooked')
    if (!body?.textContent?.trim()) return null
    const header = [...post.querySelectorAll('.crawler-post-meta, .topic-meta-data')].find(
      (element) => !body.contains(element)
    )
    const number =
      post.getAttribute('data-post-number') ??
      header?.querySelector('[itemprop="position"]')?.textContent?.trim() ??
      /^post_([1-9][0-9]*)$/.exec(post.id)?.[1]
    if (!number || !/^[1-9][0-9]*$/.test(number)) return null
    const author = header?.querySelector('.creator, .names .username')
    const name = author?.textContent?.replace(/\s+/g, ' ').trim()
    const date = header?.querySelector('time[datetime], .post-date')
    const time = date?.getAttribute('datetime') ?? date?.textContent?.replace(/\s+/g, ' ').trim()
    const heading = [`#${number}`, name, time].filter(Boolean).join(' · ')

    const copy = body.cloneNode(true) as Element
    const walker = document.createTreeWalker(copy, NodeFilter.SHOW_TEXT)
    const layout: Node[] = []
    while (walker.nextNode()) {
      const node = walker.currentNode
      if (
        node.textContent?.includes('\n') &&
        !node.textContent.trim() &&
        !node.parentElement?.closest('pre,code')
      )
        layout.push(node)
    }
    for (const node of layout) node.parentNode?.removeChild(node)
    for (const link of copy.querySelectorAll('a[href]')) {
      if (link.closest('pre,code')) continue
      const href = link.getAttribute('href')!
      try {
        const target = new URL(href, url)
        if (['http:', 'https:'].includes(target.protocol) && link.textContent !== target.href)
          link.append(` (${target.href})`)
      } catch {
        // An invalid source URL has no usable link target; retain its visible text.
      }
    }
    for (const br of copy.querySelectorAll('br')) br.replaceWith('\n')
    for (const block of copy.querySelectorAll('p,div,li,pre,blockquote,h1,h2,h3,h4,h5,h6'))
      block.append('\n\n')
    const section = `${heading}\n\n${copy.textContent?.replace(/^\n+|\n+$/g, '')}`
    // Responsive copies may repeat a post; conflicting copies need the generic path.
    if (sections.has(number) && sections.get(number) !== section) return null
    sections.set(number, section)
  }
  return [...sections.values()].join('\n\n')
}
