/**
 * One-command import of the whole knowledge base.
 *
 * Every seed file uses INSERT IGNORE against a (company_key, code) unique key,
 * so re-running is safe and non-destructive: existing rows are left alone,
 * new ones are added. That is deliberate — a tenant may have edited a system
 * row's tenant override, and an import must never silently discard it.
 *
 * Pass --replace to force system rows back to the shipped values (tenant
 * overrides, which carry a company_id, are still untouched).
 *
 * Usage:
 *   node scripts/import.mjs "mysql://root@127.0.0.1:3306/buildflow_dev"
 *   node scripts/import.mjs "<url>" --replace
 */
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import mysql from 'mysql2/promise'

const here = dirname(fileURLToPath(import.meta.url))
const sqlDir = join(here, '..', 'sql')

const args = process.argv.slice(2)
const replace = args.includes('--replace')
const url = args.find((a) => !a.startsWith('--')) ?? process.env.DATABASE_URL

if (!url) {
  console.error('usage: node scripts/import.mjs <mysql-url> [--replace]')
  process.exit(2)
}

const files = (await readdir(sqlDir)).filter((f) => f.endsWith('.sql')).sort()

// multipleStatements is required: each seed file is one multi-row INSERT plus
// SET NAMES. It is safe here because the SQL is repo-controlled, never user input.
const db = await mysql.createConnection({ uri: url, multipleStatements: true })

if (replace) {
  console.log('--replace: clearing system rows (company_id IS NULL) before import')
  const tables = [
    'kb_rules',
    'kb_facts',
    'kb_estimation_standards',
    'kb_construction_stages',
    'kb_material_catalog',
    'kb_furniture_standards',
    'kb_plumbing_standards',
    'kb_electrical_standards',
    'kb_lighting_standards',
    'kb_room_types',
  ]
  for (const table of tables) {
    const [rows] = await db.query(`SHOW TABLES LIKE ${db.escape(table)}`)
    if (rows.length === 0) continue
    // kb_facts and kb_rules are global catalogues with no company_id column;
    // tenant rule customisation lives in kb_rule_overrides, which an import
    // must never touch.
    const global = table === 'kb_facts' || table === 'kb_rules'
    const where = global ? '' : ' WHERE company_id IS NULL'
    await db.query(`DELETE FROM ${table}${where}`)
  }
}

let total = 0
for (const file of files) {
  const sql = await readFile(join(sqlDir, file), 'utf8')
  const started = performance.now()
  try {
    const [results] = await db.query(sql)
    const affected = (Array.isArray(results) ? results : [results]).reduce(
      (sum, r) => sum + (r?.affectedRows ?? 0),
      0,
    )
    total += affected
    console.log(
      `  ${file.padEnd(34)} ${String(affected).padStart(4)} rows  ${(performance.now() - started).toFixed(0)}ms`,
    )
  } catch (error) {
    console.error(`\nFAILED in ${file}\n  ${error.message}`)
    await db.end()
    process.exit(1)
  }
}

const [[counts]] = await db.query(`
  SELECT
    (SELECT COUNT(*) FROM kb_room_types)           AS room_types,
    (SELECT COUNT(*) FROM kb_lighting_standards)   AS lighting,
    (SELECT COUNT(*) FROM kb_electrical_standards) AS electrical,
    (SELECT COUNT(*) FROM kb_plumbing_standards)   AS plumbing,
    (SELECT COUNT(*) FROM kb_furniture_standards)  AS furniture,
    (SELECT COUNT(*) FROM kb_material_catalog)     AS materials,
    (SELECT COUNT(*) FROM kb_construction_stages)  AS stages,
    (SELECT COUNT(*) FROM kb_estimation_standards) AS estimation,
    (SELECT COUNT(*) FROM kb_facts)                AS facts,
    (SELECT COUNT(*) FROM kb_rules)                AS rules
`)

await db.end()

console.log(`\nimported ${total} rows across ${files.length} files`)
console.table(counts)
console.log('next: node scripts/verify.mjs "<url>"')
