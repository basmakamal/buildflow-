/**
 * Knowledge-base integrity checker.
 *
 * MariaDB 10.4 has no JSON_TABLE, so cross-references that live inside JSON
 * (rule facts, stage dependencies, material room codes) cannot be enforced by
 * a foreign key or checked in SQL. This script is that enforcement — run it in
 * CI after any seed change, and after a business user edits rules in the admin
 * panel.
 *
 * Usage: node scripts/verify.mjs "mysql://root@127.0.0.1:3306/buildflow_dev"
 */
import mysql from 'mysql2/promise'

const url = process.argv[2] ?? process.env.DATABASE_URL
if (!url) {
  console.error('usage: node scripts/verify.mjs <mysql-url>')
  process.exit(2)
}

const problems = []
const fail = (kind, detail) => problems.push({ kind, detail })

const db = await mysql.createConnection(url)

const rows = async (sql) => (await db.query(sql))[0]
const setOf = (list, key) => new Set(list.map((r) => r[key]))

const roomTypes = setOf(await rows('SELECT code FROM kb_room_types'), 'code')
const facts = setOf(await rows('SELECT fact_code FROM kb_facts'), 'fact_code')
const stages = setOf(await rows('SELECT code FROM kb_construction_stages'), 'code')
// NOTE: kb_construction_stages.required_materials is deliberately NOT checked
// against kb_material_catalog. Those entries ("pvc_drainage_pipe", "cement")
// are procurement hints naming a class of material, while the catalogue holds
// specifiable finish products ("flr_porcelain_60"). They are different
// vocabularies serving different readers, so a cross-check here would fail on
// correct data. Link them properly when procurement needs it — with a join
// table, not by overloading one of the two lists.

/**
 * A table that imported almost nothing, reported first.
 *
 * `prisma db push` once stripped `DEFAULT (UUID())` from the tables Prisma also
 * models, because Prisma's `uuid()` is generated client-side. The importer
 * omits `id`, so its `INSERT IGNORE` substituted '' for the first row and
 * rejected all 92 others as duplicate primary keys. What surfaced was
 * `unknown_fact: VAL_ELE_001 references "socketCount"` — a message that sends
 * you reading rule definitions when the actual answer is "this table has one
 * row in it". These thresholds are floors, not counts, so ordinary seed growth
 * never touches them.
 */
for (const [table, floor] of [
  ['kb_room_types', 15],
  ['kb_lighting_standards', 15],
  ['kb_electrical_standards', 15],
  ['kb_plumbing_standards', 10],
  ['kb_furniture_standards', 20],
  ['kb_material_catalog', 30],
  ['kb_construction_stages', 20],
  ['kb_estimation_standards', 20],
  ['kb_facts', 50],
  ['kb_rules', 100],
]) {
  const [{ n }] = await rows(`SELECT COUNT(*) AS n FROM ${table}`)
  if (n < floor) fail('table_underfilled', `${table} holds ${n} rows, expected at least ${floor}`)
}

/** Walks a json-rules-engine condition tree collecting every referenced fact. */
function collectFacts(node, out = []) {
  if (!node || typeof node !== 'object') return out
  if (Array.isArray(node)) {
    for (const child of node) collectFacts(child, out)
    return out
  }
  if (typeof node.fact === 'string') out.push(node.fact)
  for (const key of ['all', 'any', 'not']) {
    if (node[key]) collectFacts(node[key], out)
  }
  return out
}

const parse = (value) => (typeof value === 'string' ? JSON.parse(value) : value)

// --- rules: facts must exist, room_type_code must resolve, operators known ---
const KNOWN_OPERATORS = new Set([
  'equal',
  'notEqual',
  'lessThan',
  'lessThanInclusive',
  'greaterThan',
  'greaterThanInclusive',
  'in',
  'notIn',
  'contains',
])

function collectOperators(node, out = []) {
  if (!node || typeof node !== 'object') return out
  if (Array.isArray(node)) {
    for (const child of node) collectOperators(child, out)
    return out
  }
  if (typeof node.operator === 'string') out.push(node.operator)
  for (const key of ['all', 'any', 'not']) {
    if (node[key]) collectOperators(node[key], out)
  }
  return out
}

for (const rule of await rows('SELECT code, room_type_code, conditions FROM kb_rules')) {
  const conditions = parse(rule.conditions)
  for (const fact of collectFacts(conditions)) {
    if (!facts.has(fact)) fail('unknown_fact', `${rule.code} references fact "${fact}"`)
  }
  for (const op of collectOperators(conditions)) {
    if (!KNOWN_OPERATORS.has(op)) fail('unknown_operator', `${rule.code} uses operator "${op}"`)
  }
  if (rule.room_type_code && !roomTypes.has(rule.room_type_code)) {
    fail('unknown_room_type', `${rule.code} targets room "${rule.room_type_code}"`)
  }
}

// --- enum facts: every literal compared against an enum fact must be allowed ---
const enumFacts = new Map(
  (await rows("SELECT fact_code, allowed_values FROM kb_facts WHERE data_type = 'enum'")).map(
    (r) => [r.fact_code, new Set(parse(r.allowed_values) ?? [])],
  ),
)

function checkEnumLiterals(node, ruleCode) {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const child of node) checkEnumLiterals(child, ruleCode)
    return
  }
  if (typeof node.fact === 'string' && enumFacts.has(node.fact)) {
    const allowed = enumFacts.get(node.fact)
    const values = Array.isArray(node.value) ? node.value : [node.value]
    for (const value of values) {
      if (typeof value === 'string' && !allowed.has(value)) {
        fail('bad_enum_value', `${ruleCode}: "${value}" is not valid for fact ${node.fact}`)
      }
    }
  }
  for (const key of ['all', 'any', 'not']) {
    if (node[key]) checkEnumLiterals(node[key], ruleCode)
  }
}

for (const rule of await rows('SELECT code, conditions FROM kb_rules')) {
  checkEnumLiterals(parse(rule.conditions), rule.code)
}

// --- room_type_code is a pre-filter, not a second opinion. If it disagrees
// with the rule's own roomType condition the rule silently never fires, which
// is the worst failure mode a rule can have: invisible. ---
function collectRoomValues(node, out = []) {
  if (!node || typeof node !== 'object') return out
  if (Array.isArray(node)) {
    for (const child of node) collectRoomValues(child, out)
    return out
  }
  if (node.fact === 'roomType' && (node.operator === 'equal' || node.operator === 'in')) {
    out.push(...(Array.isArray(node.value) ? node.value : [node.value]))
  }
  for (const key of ['all', 'any', 'not']) {
    if (node[key]) collectRoomValues(node[key], out)
  }
  return out
}

for (const rule of await rows(
  'SELECT code, room_type_code, conditions FROM kb_rules WHERE room_type_code IS NOT NULL',
)) {
  const targeted = collectRoomValues(parse(rule.conditions))
  if (targeted.length === 0) continue
  if (!targeted.includes(rule.room_type_code)) {
    fail(
      'filter_contradicts_condition',
      `${rule.code}: room_type_code="${rule.room_type_code}" but conditions match [${targeted.join(', ')}] — rule can never fire`,
    )
  } else if (targeted.length > 1) {
    fail(
      'filter_too_narrow',
      `${rule.code}: conditions match [${targeted.join(', ')}] but room_type_code pins it to "${rule.room_type_code}" — set it NULL`,
    )
  }
}

// --- the roomType fact drives the admin panel's room dropdown. If it drifts
// from kb_room_types, a business user cannot author a rule for a room that
// exists, or can author one for a room that does not. ---
{
  const [factRow] = await rows("SELECT allowed_values FROM kb_facts WHERE fact_code = 'roomType'")
  if (!factRow) {
    fail('missing_fact_row', 'kb_facts has no roomType row')
  } else {
    const allowed = new Set(parse(factRow.allowed_values) ?? [])
    for (const room of roomTypes) {
      if (!allowed.has(room))
        fail('room_missing_from_fact', `"${room}" is absent from roomType.allowed_values`)
    }
    for (const value of allowed) {
      if (!roomTypes.has(value))
        fail('fact_value_orphaned', `roomType allows "${value}" with no kb_room_types row`)
    }
  }
}

// --- stages: dependencies must resolve, weights must total 100 per trade ---
const weightByTrade = new Map()
for (const stage of await rows(
  'SELECT code, trade, weight_pct, dependencies, required_photos, checklist FROM kb_construction_stages',
)) {
  for (const dep of parse(stage.dependencies)) {
    if (!stages.has(dep)) fail('unknown_dependency', `${stage.code} depends on "${dep}"`)
  }
  if (parse(stage.required_photos).length === 0) {
    fail('no_photos', `${stage.code} requires no photographic evidence`)
  }
  if (parse(stage.checklist).length === 0)
    fail('no_checklist', `${stage.code} has an empty checklist`)
  weightByTrade.set(stage.trade, (weightByTrade.get(stage.trade) ?? 0) + Number(stage.weight_pct))
}
for (const [trade, total] of weightByTrade) {
  if (Math.abs(total - 100) > 0.01)
    fail('bad_weights', `trade ${trade} weights total ${total}, expected 100`)
}

// --- cyclic dependency detection across the stage graph ---
const depGraph = new Map(
  (await rows('SELECT code, dependencies FROM kb_construction_stages')).map((s) => [
    s.code,
    parse(s.dependencies).filter((d) => stages.has(d)),
  ]),
)
const state = new Map()
function visit(node, trail) {
  if (state.get(node) === 'done') return
  if (state.get(node) === 'open') {
    fail('dependency_cycle', [...trail, node].join(' -> '))
    return
  }
  state.set(node, 'open')
  for (const next of depGraph.get(node) ?? []) visit(next, [...trail, node])
  state.set(node, 'done')
}
for (const node of depGraph.keys()) visit(node, [])

// --- standards must cover every room type ---
for (const [table, label] of [
  ['kb_lighting_standards', 'lighting'],
  ['kb_electrical_standards', 'electrical'],
]) {
  const covered = setOf(await rows(`SELECT room_type_code FROM ${table}`), 'room_type_code')
  for (const room of roomTypes) {
    if (!covered.has(room)) fail('missing_standard', `${label} has no row for room "${room}"`)
  }
  for (const room of covered) {
    if (!roomTypes.has(room)) fail('orphan_standard', `${label} row targets unknown room "${room}"`)
  }
}

// --- furniture / materials must reference real rooms ---
for (const row of await rows('SELECT room_type_code, item_code FROM kb_furniture_standards')) {
  if (!roomTypes.has(row.room_type_code)) {
    fail('orphan_furniture', `${row.item_code} targets unknown room "${row.room_type_code}"`)
  }
}
for (const row of await rows('SELECT code, suitable_rooms FROM kb_material_catalog')) {
  for (const room of parse(row.suitable_rooms)) {
    if (room !== '*' && !roomTypes.has(room)) {
      fail('orphan_material_room', `${row.code} lists unknown room "${room}"`)
    }
  }
}

// --- estimation formulas must only use their declared inputs ---
const RESERVED = new Set(['ceil', 'floor', 'round', 'abs', 'min', 'max', 'sqrt', 'pow'])
for (const row of await rows('SELECT code, inputs, formula FROM kb_estimation_standards')) {
  const declared = new Set(parse(row.inputs).map((i) => i.var))
  const used = row.formula.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []
  for (const token of used) {
    if (!declared.has(token) && !RESERVED.has(token)) {
      fail(
        'undeclared_variable',
        `${row.code} formula uses "${token}" which is not a declared input`,
      )
    }
  }
}

// --- lighting sanity: min <= recommended <= max ---
for (const row of await rows(
  'SELECT room_type_code, min_lux, recommended_lux, max_lux, spotlight_spacing_min_cm, spotlight_spacing_max_cm FROM kb_lighting_standards',
)) {
  if (!(row.min_lux <= row.recommended_lux && row.recommended_lux <= row.max_lux)) {
    fail(
      'bad_lux_band',
      `${row.room_type_code}: ${row.min_lux}/${row.recommended_lux}/${row.max_lux}`,
    )
  }
  if (row.spotlight_spacing_min_cm > row.spotlight_spacing_max_cm) {
    fail('bad_spacing_band', row.room_type_code)
  }
}

// --- electrical sanity: min <= recommended <= luxury ---
for (const row of await rows(
  'SELECT room_type_code, min_sockets, recommended_sockets, luxury_sockets FROM kb_electrical_standards',
)) {
  if (!(
    row.min_sockets <= row.recommended_sockets && row.recommended_sockets <= row.luxury_sockets
  )) {
    fail(
      'bad_socket_band',
      `${row.room_type_code}: ${row.min_sockets}/${row.recommended_sockets}/${row.luxury_sockets}`,
    )
  }
}

await db.end()

if (problems.length === 0) {
  console.log('knowledge base OK — no integrity problems found')
  process.exit(0)
}

const grouped = new Map()
for (const p of problems) grouped.set(p.kind, [...(grouped.get(p.kind) ?? []), p.detail])
for (const [kind, details] of grouped) {
  console.error(`\n${kind} (${details.length})`)
  for (const detail of details) console.error(`  - ${detail}`)
}
console.error(`\n${problems.length} problem(s)`)
process.exit(1)
