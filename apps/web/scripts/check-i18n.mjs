/**
 * Translation completeness gate.
 *
 * No feature ships English-only. A missing Arabic key is a BUILD FAILURE, not a
 * backlog item — because a backlog item is exactly what it becomes otherwise,
 * and two years later the Arabic UI is 30% English. Catching it at the commit
 * that introduced it costs seconds; catching it later costs a translation
 * project nobody funds. docs/12 §7
 *
 * Run: node scripts/check-i18n.mjs
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const localesDir = join(here, '..', 'src', 'locales')

const BASE = 'en'
const REQUIRED = ['ar']

/** Flattens nested objects to dot paths so a missing leaf is reported precisely. */
function flatten(value, prefix = '') {
  const out = {}
  for (const [key, entry] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (entry !== null && typeof entry === 'object' && !Array.isArray(entry)) {
      Object.assign(out, flatten(entry, path))
    } else {
      out[path] = entry
    }
  }
  return out
}

const readNamespace = (locale, file) =>
  flatten(JSON.parse(readFileSync(join(localesDir, locale, file), 'utf8')))

const namespaces = readdirSync(join(localesDir, BASE)).filter((f) => f.endsWith('.json'))

let failures = 0

for (const namespace of namespaces) {
  const base = readNamespace(BASE, namespace)

  for (const locale of REQUIRED) {
    let target
    try {
      target = readNamespace(locale, namespace)
    } catch {
      console.error(`✖ ${locale}/${namespace} is missing entirely`)
      failures++
      continue
    }

    const missing = Object.keys(base).filter((key) => !(key in target))
    const extra = Object.keys(target).filter((key) => !(key in base))
    // An empty string passes a key-presence check but renders as nothing —
    // which looks like a broken screen rather than an untranslated one.
    const blank = Object.entries(target).filter(([, v]) => typeof v === 'string' && !v.trim())

    if (missing.length) {
      console.error(`✖ ${locale}/${namespace} missing ${missing.length} key(s):`)
      for (const key of missing) console.error(`    ${key}`)
      failures += missing.length
    }
    if (extra.length) {
      console.error(`✖ ${locale}/${namespace} has ${extra.length} key(s) not in ${BASE}:`)
      for (const key of extra) console.error(`    ${key}`)
      failures += extra.length
    }
    if (blank.length) {
      console.error(`✖ ${locale}/${namespace} has ${blank.length} empty value(s):`)
      for (const [key] of blank) console.error(`    ${key}`)
      failures += blank.length
    }

    /**
     * Interpolation placeholders must match.
     *
     * `"Signed in as {email}"` translated without `{email}` renders a sentence
     * with a hole in it. Key presence alone would not catch that.
     */
    for (const [key, value] of Object.entries(base)) {
      if (typeof value !== 'string' || !(key in target)) continue
      const expected = [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
      const actual = [...String(target[key]).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
      if (expected.join(',') !== actual.join(',')) {
        console.error(
          `✖ ${locale}/${namespace} ${key}: placeholders differ ` +
            `(expected {${expected.join('}, {')}}, found {${actual.join('}, {')}})`,
        )
        failures++
      }
    }
  }
}

const total = namespaces.reduce((n, ns) => n + Object.keys(readNamespace(BASE, ns)).length, 0)

if (failures > 0) {
  console.error(`\n${failures} translation problem(s) across ${namespaces.length} namespace(s).`)
  process.exit(1)
}

console.warn(
  `✔ ${total} keys complete across ${namespaces.length} namespaces in: ${[BASE, ...REQUIRED].join(', ')}`,
)
