import { Readability } from '@mozilla/readability'
import { discourseText } from './discourse'

export function parsePublicHTML(html: string, url: string) {
  const document = new DOMParser().parseFromString(html, 'text/html')
  const title = document.title
  const canonical = document
    .querySelector<HTMLLinkElement>('link[rel="canonical"]')
    ?.getAttribute('href')
  for (const element of document.querySelectorAll(
    'script,style,noscript,template,form,input,textarea,select,[contenteditable]'
  ))
    element.remove()
  const structured = discourseText(document, url)
  const readable = structured ? null : new Readability(document.cloneNode(true) as Document).parse()
  const text = (structured || readable?.textContent || document.body.textContent || '').trim()
  if (!text) throw new Error('未取得可读正文，需要打开原页补采。')
  if (/sign\s?in|log\s?in|登录|验证码|captcha/i.test(title) && text.length < 2000)
    throw new Error('该页可能需要登录或交互，请在浏览器中打开后保存。')
  return { text, title, canonical: canonical ? new URL(canonical, url).href : undefined }
}
