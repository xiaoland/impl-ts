import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseCollection, parseResource, safeHttpUrl } from '../../src/content.ts'

const resource = (text: string) => JSON.stringify({ href: 'test.ics', text })
const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')

void test('the phone calendar retains the master, offline exception and all-day date boundaries', () => {
  const result = parseResource(resource(fixture('calendar.ics')), 'calendar')
  assert.equal(result.kind, 'calendar')
  if (result.kind !== 'calendar') return
  assert.equal(result.items.length, 3)
  const master = result.items.find((item) => item.title === 'InKCre Preview Event')!
  assert.ok(master.recurrence.some((rule) => rule.includes('COUNT=3')))
  assert.ok(master.alarms.some((alarm) => alarm.includes('-PT15M')))
  const exception = result.items.find((item) => item.title === 'InKCre Preview Offline Edit')!
  assert.ok(exception.recurrenceId)
  assert.equal(exception.uid, master.uid)
  const allDay = result.items.find((item) => item.title === 'InKCre Preview All Day')!
  assert.deepEqual(allDay.start, { value: '2026-10-20', zone: '', dateOnly: true })
  assert.deepEqual(allDay.end, { value: '2026-10-21', zone: '', dateOnly: true })
})

void test('Tasks.org parent references and completion state remain readable', () => {
  const result = parseResource(resource(fixture('tasks.ics')), 'calendar')
  assert.equal(result.kind, 'calendar')
  if (result.kind !== 'calendar') return
  const parent = result.items.find((item) => item.title === 'InKCre Preview Parent')!
  const child = result.items.find((item) => item.title === 'InKCre Preview Child')!
  assert.equal(child.kind, 'vtodo')
  assert.deepEqual(child.parents, [parent.uid])
  assert.equal(child.status, 'NEEDS-ACTION')
})

void test('a real Android vCard retains its two phones and embedded raster photo', () => {
  const result = parseResource(resource(fixture('contact.vcf')), 'contact')
  assert.equal(result.kind, 'contact')
  if (result.kind !== 'contact') return
  assert.equal(result.title, 'InKCre Preview Photo Contact')
  assert.equal(result.fields.find((field) => field.name === 'tel')?.values.length, 2)
  assert.match(result.photo ?? '', /^data:image\/jpeg;base64,/)
  assert.equal(result.photoLink, null)
})

void test('floating and unknown TZID wall times are not converted; folded text and recurrence dates survive', () => {
  const text = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'BEGIN:VEVENT',
    'UID:folded',
    'SUMMARY:Folded\\, title',
    ' continuation',
    'DTSTART;TZID=Custom/Zone:20261020T103000',
    'DTEND:20261020T113000',
    'EXDATE;VALUE=DATE:20261021',
    'RDATE;TZID=America/New_York:20261022T103000',
    'DESCRIPTION:<script>alert(1)</script>\\nSecond line',
    'X-EXTRA:preserved',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n')
  const result = parseResource(resource(text), 'calendar')
  assert.equal(result.kind, 'calendar')
  if (result.kind !== 'calendar') return
  const item = result.items[0]!
  assert.equal(item.title, 'Folded, titlecontinuation')
  assert.deepEqual(item.start, {
    value: '2026-10-20 10:30:00',
    zone: 'Custom/Zone',
    dateOnly: false,
  })
  assert.equal(item.end?.zone, 'floating')
  assert.deepEqual(item.excluded, ['EXDATE;VALUE=DATE:20261021'])
  assert.deepEqual(item.added, ['RDATE;TZID=America/New_York:20261022T103000'])
  assert.equal(item.description, '<script>alert(1)</script>\nSecond line')
  assert.equal(result.text, text)
})

void test('unsafe photos and links cannot become active content; remote photos remain explicit links', () => {
  assert.equal(safeHttpUrl('javascript:alert(1)'), null)
  assert.equal(safeHttpUrl('https://user:secret@example.com/'), null)
  for (const [photo, embedded, link] of [
    ['data:image/svg+xml;base64,PHN2Zz4=', null, null],
    ['https://example.com/photo.png', null, 'https://example.com/photo.png'],
    ['data:image/png;base64,aGVsbG8=', 'data:image/png;base64,aGVsbG8=', null],
  ]) {
    const result = parseResource(
      resource(`BEGIN:VCARD\r\nVERSION:4.0\r\nFN:Test\r\nPHOTO:${photo}\r\nEND:VCARD`),
      'contact'
    )
    assert.equal(result.kind, 'contact')
    if (result.kind !== 'contact') continue
    assert.equal(result.photo, embedded)
    assert.equal(result.photoLink, link)
  }
})

void test('malformed records preserve original content and the principal is not mislabeled as a calendar', () => {
  const invalid = parseResource(resource('not a calendar'), 'calendar')
  assert.deepEqual(invalid, { kind: 'invalid', text: 'not a calendar' })
  const principal = parseCollection(JSON.stringify({ path: 'inkcre', props: {} }))
  assert.equal(principal.kind, 'collection')
  if (principal.kind === 'collection') assert.equal(principal.tag, '')
})
