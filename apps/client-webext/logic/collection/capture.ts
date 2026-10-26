import {
  MaterialMetadataSchema,
  MaterialPartSchema,
  textPart,
  MATERIAL_BYTE_LIMIT,
} from '@inkcre/web-collection'
import { z } from 'zod'
import { discourseText } from './discourse'

export const PageCaptureSchema = z.object({
  material: MaterialMetadataSchema,
  parts: z.array(MaterialPartSchema).min(1).max(3),
})
export type PageCapture = z.infer<typeof PageCaptureSchema>

const omitted = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'TEMPLATE',
  'INPUT',
  'TEXTAREA',
  'SELECT',
  'BUTTON',
  'OBJECT',
  'EMBED',
])
const blockElements = new Set([
  'ARTICLE',
  'SECTION',
  'MAIN',
  'HEADER',
  'FOOTER',
  'DIV',
  'P',
  'LI',
  'H1',
  'H2',
  'H3',
  'H4',
  'PRE',
  'TR',
  'BLOCKQUOTE',
  'BR',
])

/** Copy loaded structure without active code, editable drafts, or extension UI. */
export function capturePage(selectionOnly: boolean): PageCapture {
  const coverage: string[] = [
    '仅包含当前已加载的 DOM；不包含已卸载的虚拟列表、canvas 或封闭组件内部内容。',
  ]
  const output = document.implementation.createHTMLDocument(document.title)
  const text: string[] = []
  let size = 0
  const seenDocuments = new Set<Document>()
  function copy(node: Node, targetDocument: Document): Node | null {
    if (node.nodeType === Node.TEXT_NODE) {
      const value = node.textContent ?? ''
      size += value.length
      if (size > MATERIAL_BYTE_LIMIT) throw new Error('页面过大，请保存选区或仅保存链接。')
      text.push(value)
      return targetDocument.createTextNode(value)
    }
    if (!(node instanceof Element) && node.nodeType !== Node.ELEMENT_NODE) return null
    const element = node as Element
    if (
      omitted.has(element.tagName) ||
      element.hasAttribute('contenteditable') ||
      element.closest('[data-inkcre-ui]') ||
      element.getAttribute('aria-hidden') === 'true'
    )
      return null
    const view = element.ownerDocument.defaultView
    const style = view?.getComputedStyle(element)
    if (style?.display === 'none' || style?.visibility === 'hidden') return null
    if (element.tagName === 'IFRAME' || element.tagName === 'FRAME') {
      const wrapper = targetDocument.createElement('section')
      try {
        const frame = element as HTMLIFrameElement
        const inner = frame.contentDocument
        if (!inner?.body || seenDocuments.has(inner)) throw new Error('frame 不可读')
        seenDocuments.add(inner)
        wrapper.setAttribute('data-source-url', inner.URL)
        const body = copy(inner.body, targetDocument)
        if (body) wrapper.append(body)
      } catch {
        coverage.push(`未取得框架正文：${element.getAttribute('src') ?? '未知地址'}`)
      }
      return wrapper
    }
    const clone = targetDocument.createElement(element.localName)
    for (const attribute of element.attributes) {
      const name = attribute.name.toLowerCase()
      if (
        name.startsWith('on') ||
        ['srcdoc', 'nonce', 'value', 'style', 'autofocus'].includes(name)
      )
        continue
      if (['href', 'src', 'action', 'formaction', 'poster'].includes(name)) {
        try {
          const url = new URL(attribute.value, element.ownerDocument.URL)
          if (!['http:', 'https:'].includes(url.protocol)) continue
          clone.setAttribute(name, url.href)
        } catch {
          continue
        }
      } else clone.setAttribute(name, attribute.value)
    }
    if (blockElements.has(element.tagName)) text.push('\n')
    const children =
      element.shadowRoot?.mode === 'open' ? element.shadowRoot.childNodes : element.childNodes
    for (const child of children) {
      if (child instanceof HTMLSlotElement) {
        const assigned = child.assignedNodes({ flatten: true })
        for (const slotted of assigned.length ? assigned : child.childNodes) {
          const copied = copy(slotted, targetDocument)
          if (copied) clone.append(copied)
        }
      } else {
        const copied = copy(child, targetDocument)
        if (copied) clone.append(copied)
      }
    }
    if (blockElements.has(element.tagName)) text.push('\n')
    return clone
  }
  let parts
  if (selectionOnly) {
    const selected = window.getSelection()?.toString() ?? ''
    if (!selected.trim()) throw new Error('请先在网页中选中要保存的文字。')
    parts = [textPart('text', selected)]
  } else {
    if (!document.body) throw new Error('页面尚未加载正文。')
    seenDocuments.add(document)
    const body = copy(document.body, output)
    if (body) output.body.replaceWith(body)
    for (const meta of document.querySelectorAll('meta[name], meta[property]')) {
      const name = meta.getAttribute('name') ?? meta.getAttribute('property') ?? ''
      if (/^(description|author|keywords|date|generator|article:|og:|twitter:)/i.test(name))
        output.head.append(meta.cloneNode(true))
    }
    const readable =
      discourseText(output, document.URL) ??
      text
        .join('')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
    if (!readable) throw new Error('没有取得可读正文；可改为仅保存链接。')
    parts = [
      textPart('html', `<!doctype html>\n${output.documentElement.outerHTML}`),
      textPart('text', readable),
    ]
  }
  const navigation = performance.getEntriesByType('navigation')[0] as
    | PerformanceNavigationTiming
    | undefined
  const status =
    navigation && 'responseStatus' in navigation ? navigation.responseStatus : undefined
  const structured = [...document.querySelectorAll('script[type="application/ld+json"]')]
    .map((element) => element.textContent ?? '')
    .filter((value) => value.length <= 32_768)
    .slice(0, 8)
  return PageCaptureSchema.parse({
    parts,
    material: {
      captured_at: new Date().toISOString(),
      url: location.href,
      title: document.title,
      method: selectionOnly ? 'selected-text' : 'visible-dom',
      coverage,
      canonical: document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href,
      declared_metadata: [...document.querySelectorAll('meta[name], meta[property]')]
        .filter((element) =>
          /^(author|date|article:published_time|article:modified_time)$/i.test(
            element.getAttribute('name') ?? element.getAttribute('property') ?? ''
          )
        )
        .map((element) => ({
          name: element.getAttribute('name') ?? element.getAttribute('property'),
          content: element.getAttribute('content'),
        })),
      structured_data: structured,
      ...(typeof status === 'number' && status > 0 ? { http_status: status } : {}),
    },
  })
}
