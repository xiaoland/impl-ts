import type { RichText } from '../../schema'

export function xUrl(path: string): string {
  return new URL(path, 'https://x.com').href
}

export function visibleText(value: RichText | undefined): string {
  if (!value) return ''
  // RichText 的区间按 Unicode 码点计数，不能改为字素或 UTF-16 索引。
  // oxlint-disable-next-line typescript/no-misused-spread
  return value.visible ? [...value.text].slice(...value.visible).join('') : value.text
}

export function legacyText(text: string): string {
  return text.replace(/\[(?:photo|video|link)\]/g, '').trim()
}

export function postDate(value: string, compact = false): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return value
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    ...(compact ? {} : { hour: 'numeric', minute: '2-digit' as const }),
  }).format(date)
}

export function compactCount(value: number): string {
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(
    value
  )
}

export function safeUrl(value: string | undefined): string | undefined {
  if (!value) return undefined
  try {
    const parsed = new URL(value)
    return ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password
      ? parsed.toString()
      : undefined
  } catch {
    return undefined
  }
}
