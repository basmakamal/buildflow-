/**
 * Exports the knowledge base from MySQL to JSON under data/.
 *
 * WHY: the SQL files are the authoring format, but three consumers need JSON —
 * the Vue admin panel (renders rule builders without a round trip), the AI
 * engine when it runs against a cached snapshot, and any future non-MySQL
 * deployment. Regenerate after editing seeds so data/ never drifts from sql/.
 *
 * Only system rows (company_id IS NULL) are exported. Tenant overrides are
 * customer data and never belong in the repo.
 *
 * Usage: node scripts/export-json.mjs "mysql://root@127.0.0.1:3306/buildflow_dev"
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import mysql from 'mysql2/promise'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, '..', 'data')

const url = process.argv[2] ?? process.env.DATABASE_URL
if (!url) {
  console.error('usage: node scripts/export-json.mjs <mysql-url>')
  process.exit(2)
}

const db = await mysql.createConnection(url)
await mkdir(outDir, { recursive: true })

/** Columns that exist only to make the storage work; meaningless outside MySQL. */
const DROP = new Set(['id', 'company_id', 'company_key', 'created_at', 'updated_at'])

/** MariaDB returns JSON columns as strings — parse them so the export is real JSON. */
function reviveJson(row) {
  const out = {}
  for (const [key, value] of Object.entries(row)) {
    if (DROP.has(key)) continue
    if (typeof value === 'string' && /^[[{]/.test(value.trim())) {
      try {
        out[key] = JSON.parse(value)
        continue
      } catch {
        // not JSON after all — a message that happens to start with a brace
      }
    }
    out[key] = value
  }
  return out
}

const EXPORTS = [
  ['room-types', 'kb_room_types', 'code'],
  ['lighting-standards', 'kb_lighting_standards', 'room_type_code'],
  ['electrical-standards', 'kb_electrical_standards', 'room_type_code'],
  ['plumbing-standards', 'kb_plumbing_standards', 'space_code, fixture_code'],
  ['furniture-standards', 'kb_furniture_standards', 'room_type_code, item_code'],
  ['material-catalog', 'kb_material_catalog', 'category, code'],
  ['construction-stages', 'kb_construction_stages', 'trade, sequence'],
  ['estimation-standards', 'kb_estimation_standards', 'trade, code'],
  ['facts', 'kb_facts', 'domain, fact_code'],
  ['rules', 'kb_rules', 'rule_type, domain, code'],
]

const index = {}
for (const [name, table, orderBy] of EXPORTS) {
  const scope = table === 'kb_facts' || table === 'kb_rules' ? '' : 'WHERE company_id IS NULL'
  const [rows] = await db.query(`SELECT * FROM ${table} ${scope} ORDER BY ${orderBy}`)
  const data = rows.map(reviveJson)
  await writeFile(join(outDir, `${name}.json`), `${JSON.stringify(data, null, 2)}\n`, 'utf8')
  index[name] = { file: `./${name}.json`, table, count: data.length }
  console.log(`  ${name.padEnd(22)} ${String(data.length).padStart(4)} rows`)
}

await db.end()

await writeFile(
  join(outDir, 'index.json'),
  `${JSON.stringify(
    {
      name: '@buildflow/knowledge-base',
      description: 'System knowledge base for the BuildFlow AI engine. Generated from sql/ — do not edit by hand.',
      datasets: index,
    },
    null,
    2,
  )}\n`,
  'utf8',
)

console.log(`\nwrote ${EXPORTS.length + 1} files to data/`)
