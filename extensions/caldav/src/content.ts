import ICAL from 'ical.js'
import { z } from 'zod'

const resourceSchema = z.object({ href: z.string(), text: z.string() })
const collectionSchema = z.object({ path: z.string(), props: z.record(z.string(), z.string()) })

export interface CalendarDate {
  value: string
  zone: string
  dateOnly: boolean
}

export interface CalendarItem {
  kind: 'vevent' | 'vtodo'
  uid: string
  title: string
  description: string
  location: string
  status: string
  start: CalendarDate | null
  end: CalendarDate | null
  due: CalendarDate | null
  completed: CalendarDate | null
  recurrenceId: CalendarDate | null
  recurrence: string[]
  excluded: string[]
  added: string[]
  duration: string
  alarms: string[]
  parents: string[]
  priority: string
  progress: string
  url: string | null
}

export interface ContactField {
  value: string
  label: string
}

export type DAVContent = (
  | { kind: 'calendar'; href: string; text: string; items: CalendarItem[] }
  | {
      kind: 'contact'
      href: string
      text: string
      title: string
      fields: { name: string; values: ContactField[] }[]
      photo: string | null
      photoLink: string | null
    }
  | {
      kind: 'collection'
      title: string
      path: string
      tag: string
      components: string
      description: string
      text: string
      members: { id: number; title: string }[]
    }
  | { kind: 'invalid'; text: string }
) & { links?: { id: number; name: string; label: string; value: string }[] }

export function safeHttpUrl(value: string): string | null {
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : null
  } catch {
    return null
  }
}

type PropertyValue = ReturnType<ICAL.Component['getFirstPropertyValue']>

function valueText(value: PropertyValue | PropertyValue[]): string {
  if (value == null) return ''
  if (Array.isArray(value)) return value.map(valueText).filter(Boolean).join(' · ')
  return String(value)
}

function propertyText(component: ICAL.Component, name: string): string {
  return valueText(component.getFirstPropertyValue(name))
}

function date(component: ICAL.Component, name: string): CalendarDate | null {
  const property = component.getFirstProperty(name)
  if (!property) return null
  const value = property.getFirstValue()
  if (!(value instanceof ICAL.Time)) throw new Error('Expected an iCalendar date.')
  // Keep wall time and TZID together; unknown/custom zones must not silently become local time.
  return {
    value: value.toString().replace('T', ' ').replace(/Z$/, ''),
    zone: value.isDate
      ? ''
      : valueText(property.getParameter('tzid')) ||
        (value.zone.tzid === 'UTC' ? 'UTC' : 'floating'),
    dateOnly: value.isDate,
  }
}

function values(component: ICAL.Component, name: string): string[] {
  return component.getAllProperties(name).flatMap((property) => property.getValues().map(valueText))
}

function calendarItem(component: ICAL.Component): CalendarItem {
  return {
    kind: component.name as CalendarItem['kind'],
    uid: propertyText(component, 'uid'),
    title: propertyText(component, 'summary'),
    description: propertyText(component, 'description'),
    location: propertyText(component, 'location'),
    status: propertyText(component, 'status'),
    start: date(component, 'dtstart'),
    end: date(component, 'dtend'),
    due: date(component, 'due'),
    completed: date(component, 'completed'),
    recurrenceId: date(component, 'recurrence-id'),
    recurrence: values(component, 'rrule'),
    excluded: component.getAllProperties('exdate').map((property) => property.toICALString()),
    added: component.getAllProperties('rdate').map((property) => property.toICALString()),
    duration: propertyText(component, 'duration'),
    alarms: component.getAllSubcomponents('valarm').map((alarm) =>
      ['trigger', 'action', 'description']
        .map((name) => propertyText(alarm, name))
        .filter(Boolean)
        .join(' · ')
    ),
    parents: [...new Set(values(component, 'related-to'))],
    priority: propertyText(component, 'priority'),
    progress: propertyText(component, 'percent-complete'),
    url: safeHttpUrl(propertyText(component, 'url')),
  }
}

const rasterTypes = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

function photo(component: ICAL.Component): { photo: string | null; photoLink: string | null } {
  const property = component.getFirstProperty('photo')
  if (!property) return { photo: null, photoLink: null }
  const raw = property.getFirstValue()
  const value = valueText(raw)
  const embedded = /^data:(image\/[a-z]+);base64,([a-z0-9+/=\s]+)$/i.exec(value)
  if (embedded && rasterTypes.has(embedded[1]!.toLowerCase())) {
    return {
      photo: `data:${embedded[1]!.toLowerCase()};base64,${embedded[2]!.replace(/\s/g, '')}`,
      photoLink: null,
    }
  }
  if (
    property.type === 'binary' ||
    /^(b|base64)$/i.test(valueText(property.getParameter('encoding')))
  ) {
    const type = valueText(property.getParameter('type')).toLowerCase()
    const mediaType = type === 'jpg' ? 'image/jpeg' : `image/${type}`
    if (rasterTypes.has(mediaType) && /^[a-z0-9+/=\s]+$/i.test(value)) {
      return { photo: `data:${mediaType};base64,${value.replace(/\s/g, '')}`, photoLink: null }
    }
  }
  return { photo: null, photoLink: safeHttpUrl(value) }
}

export function parseResource(raw: string, expected: 'calendar' | 'contact'): DAVContent {
  let text = raw
  try {
    const resource = resourceSchema.parse(JSON.parse(raw))
    text = resource.text
    const component = new ICAL.Component(ICAL.parse(text))
    if (expected === 'calendar') {
      if (component.name !== 'vcalendar') throw new Error('Expected VCALENDAR.')
      const items = component
        .getAllSubcomponents()
        .filter((child) => child.name === 'vevent' || child.name === 'vtodo')
        .map(calendarItem)
      if (!items.length) throw new Error('No calendar components.')
      return { kind: 'calendar', href: resource.href, text, items }
    }
    if (component.name !== 'vcard') throw new Error('Expected VCARD.')
    for (const property of component.getAllProperties()) {
      if (property.name.includes('.')) property.jCal[0] = property.name.split('.').at(-1)!
    }
    const fields = ['tel', 'email', 'adr', 'org', 'title', 'bday', 'note', 'url']
      .map((name) => ({
        name,
        values: component
          .getAllProperties(name)
          .map((property) => ({
            value: valueText(property.getFirstValue()),
            label: valueText(property.getParameter('type')),
          }))
          .filter((field) => field.value),
      }))
      .filter((field) => field.values.length)
    return {
      kind: 'contact',
      href: resource.href,
      text,
      title: propertyText(component, 'fn') || propertyText(component, 'n'),
      fields,
      ...photo(component),
    }
  } catch {
    return { kind: 'invalid', text }
  }
}

export function parseCollection(raw: string): DAVContent {
  try {
    const { path, props } = collectionSchema.parse(JSON.parse(raw))
    return {
      kind: 'collection',
      title: props['D:displayname'] || path || 'inkcre',
      path,
      tag: props.tag ?? '',
      components: props['C:supported-calendar-component-set'] ?? '',
      members: [],
      description: props['C:calendar-description'] || props['CR:addressbook-description'] || '',
      text: raw,
    }
  } catch {
    return { kind: 'invalid', text: raw }
  }
}

export function contentTitle(content: DAVContent): string {
  if (content.kind === 'calendar') return content.items[0]?.title ?? ''
  if (content.kind === 'contact' || content.kind === 'collection') return content.title
  return ''
}
