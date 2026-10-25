#!/usr/bin/env node
/**
 * Locale key coverage check.
 *
 * Every literal `t('a.b.c')` call in the client source must resolve in BOTH
 * locale catalogs (en and zh-CN). The overhaul batch that reorganized the
 * locale files dropped a few keys whose usages survived (sidePanel.managing,
 * sidePanel.infoBase, source.saveFailed), which rendered raw i18n keys in
 * production. This check makes that class of mistake fail CI.
 *
 * Dynamic keys (template literals, variables) are skipped — they cannot be
 * verified statically.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(fileURLToPath(import.meta.url), '..', '..')
const srcDir = join(root, 'apps/client-web/src')
const catalogs = ['en', 'zh-CN'].map((name) => ({
  name,
  messages: JSON.parse(readFileSync(join(srcDir, 'locales/messages', `${name}.json`), 'utf8')),
}))

function flatten(node, path = '') {
  const keys = new Set()
  if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      const full = path ? `${path}.${key}` : key
      keys.add(full)
      for (const sub of flatten(value, full)) keys.add(sub)
    }
  }
  return keys
}

const catalogKeys = catalogs.map((c) => ({ name: c.name, keys: flatten(c.messages) }))

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) yield* walk(full)
    else if (/\.(vue|ts)$/.test(entry)) yield full
  }
}

// Literal t('...') calls only; template literals and dynamic keys are skipped.
const T_CALL = /\bt\(\s*'([a-zA-Z][\w.]*)'/g
const missing = []
for (const file of walk(srcDir)) {
  const text = readFileSync(file, 'utf8')
  for (const match of text.matchAll(T_CALL)) {
    const key = match[1]
    for (const { name, keys } of catalogKeys) {
      if (!keys.has(key)) {
        missing.push(`${relative(root, file)}: '${key}' missing from ${name}.json`)
      }
    }
  }
}

if (missing.length > 0) {
  console.error('[FAIL] locale key coverage:')
  for (const line of missing) console.error(`  ${line}`)
  process.exit(1)
}
console.log('[OK] every literal t() key resolves in en and zh-CN catalogs')
