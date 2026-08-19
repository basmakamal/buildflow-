/**
 * End-to-end smoke test: loads the rules from MySQL, evaluates realistic room
 * payloads, and asserts the engine reaches the conclusions the knowledge base
 * was written to reach. Run after any seed edit.
 *
 * Usage: node scripts/smoke.mjs "mysql://root@127.0.0.1:3306/buildflow_dev"
 */
import mysql from 'mysql2/promise'
import { evaluate, estimate } from '../src/evaluate.mjs'

const url = process.argv[2] ?? process.env.DATABASE_URL
const db = await mysql.createConnection(url)
const [rules] = await db.query('SELECT * FROM kb_rules WHERE is_active = 1')
const [estimations] = await db.query('SELECT * FROM kb_estimation_standards')
await db.end()

let failures = 0
const check = (label, condition, detail = '') => {
  if (condition) {
    console.log(`  PASS  ${label}`)
  } else {
    failures++
    console.log(`  FAIL  ${label} ${detail}`)
  }
}
const codes = (result) => result.findings.map((f) => f.code)

// --- Case 1: a badly specified bathroom -------------------------------------
console.log('\ncase: bathroom with no waterproofing, no RCD, no drain')
const bathroom = evaluate(rules, {
  roomType: 'bathroom',
  area: 5,
  isWetArea: true,
  hasRcd: false,
  hasWaterproofing: false,
  floorDrainCount: 0,
  wcCount: 1,
  hasShattaf: false,
  hasVentFan: false,
  socketCount: 1,
  acPointCount: 0,
  finishLevel: 'standard',
})
const bathroomCodes = codes(bathroom)
check('flags missing waterproofing (critical)', bathroomCodes.includes('VAL_PLB_003'))
check('flags missing RCD (critical)', bathroomCodes.includes('VAL_ELE_004'))
check('flags missing floor drain', bathroomCodes.includes('VAL_PLB_001'))
check('flags missing shattaf', bathroomCodes.includes('VAL_PLB_008'))
check('flags missing exhaust fan', bathroomCodes.includes('VAL_ELE_015'))
check('critical findings sort first', bathroom.findings[0]?.severity === 'critical')
check(
  'does not flag AC point in a bathroom',
  !bathroomCodes.includes('VAL_ELE_009'),
  '(bathrooms are exhaust-only)',
)

// --- Case 2: a well specified master bedroom --------------------------------
console.log('\ncase: correctly specified large master bedroom')
const bedroom = evaluate(rules, {
  roomType: 'master_bedroom',
  area: 24,
  width: 4.2,
  length: 5.7,
  ceilingHeight: 3.0,
  isWetArea: false,
  socketCount: 6,
  acPointCount: 1,
  tvPointCount: 1,
  internetPointCount: 1,
  usbPointCount: 2,
  smartPointCount: 3,
  lightingLux: 150,
  lightingZones: 2,
  switchCount: 3,
  hasTwoWaySwitch: true,
  hasDimmer: true,
  hasHiddenLed: true,
  colorTempK: 2700,
  spotlightSpacing: 110,
  spotlightCount: 12,
  bedSize: 'king',
  bedSideClearance: 75,
  bedFootClearance: 95,
  wardrobeWidthCm: 240,
  wardrobeClearance: 70,
  circulationWidth: 95,
  furnitureAreaRatio: 0.42,
  windowCount: 2,
  finishLevel: 'premium',
})
const bedroomCodes = codes(bedroom)
check(
  'raises no errors or criticals',
  !bedroom.findings.some((f) => f.severity === 'error' || f.severity === 'critical'),
  JSON.stringify(
    bedroom.findings.filter((f) => ['error', 'critical'].includes(f.severity)).map((f) => f.code),
  ),
)
check('recommends a reading corner (area > 22)', bedroomCodes.includes('REC_FUR_001'))
check('recommends a secondary lighting zone (area > 20)', bedroomCodes.includes('REC_LGT_001'))
check('does not flag bed clearances', !bedroomCodes.includes('VAL_FUR_003'))

// --- Case 3: king bed in a room too small -----------------------------------
console.log('\ncase: king bed forced into a 12 m² room')
const cramped = evaluate(rules, {
  roomType: 'master_bedroom',
  area: 12,
  width: 3,
  bedSize: 'king',
  bedSideClearance: 40,
  bedFootClearance: 60,
  circulationWidth: 60,
  isWetArea: false,
})
const crampedCodes = codes(cramped)
check('rejects king bed under 14 m²', crampedCodes.includes('VAL_FUR_006'))
check('flags bed side clearance', crampedCodes.includes('VAL_FUR_003'))
check('flags impassable circulation', crampedCodes.includes('VAL_FUR_001'))

// --- Case 4: absent facts must skip, not fail -------------------------------
console.log('\ncase: sparse payload (user has not drawn sockets yet)')
const sparse = evaluate(rules, { roomType: 'kitchen', area: 14, isWetArea: true })
check('returns without throwing', Array.isArray(sparse.findings))
check('reports skipped rules', sparse.evaluated.skipped.length > 0)
check(
  'skipped entries name the missing fact',
  sparse.evaluated.skipped.every(
    (s) => typeof s.missingFact === 'string' && s.missingFact.length > 0,
  ),
)
check(
  'does not invent a socket warning with no socket data',
  !codes(sparse).includes('VAL_ELE_002'),
)

// --- Case 5: room pre-filter must not suppress matching rules ---------------
console.log('\ncase: room_type_code pre-filter correctness')
const kitchen = {
  roomType: 'kitchen',
  area: 14,
  isWetArea: true,
  socketCount: 4,
  counterLengthM: 4,
  lightingLux: 200,
  hasTaskLight: false,
}
const filtered = evaluate(rules, kitchen)
const unfiltered = evaluate(
  rules.map((r) => ({ ...r, room_type_code: null })),
  kitchen,
)
check(
  'pre-filter changes no outcome',
  JSON.stringify(codes(filtered)) === JSON.stringify(codes(unfiltered)),
  `${codes(filtered).length} vs ${codes(unfiltered).length}`,
)
check('flags under-6 socket kitchen', codes(filtered).includes('VAL_ELE_002'))
check('flags missing under-cabinet task light', codes(filtered).includes('VAL_LGT_018'))

// --- Case 6: estimation formulas --------------------------------------------
console.log('\ncase: estimation formulas')
const byCode = Object.fromEntries(estimations.map((e) => [e.code, e]))

const paintArea = estimate(byCode.est_paint_wall_area, {
  perimeter_m: 20,
  height_m: 3,
  openings_m2: 6,
})
check('wall area = 20*3 - 6 = 54', paintArea.quantity === 54, JSON.stringify(paintArea))

const paint = estimate(byCode.est_paint_quantity, {
  area_m2: 54,
  coats: 2,
  coverage_m2_per_l: 10,
})
check('paint = 54*2/10 = 10.8 L base', paint.base === 10.8, JSON.stringify(paint))
check('paint applies 10% waste -> 11.88 L', paint.quantity === 11.88, JSON.stringify(paint))

const tiles = estimate(byCode.est_tile_count, { area_m2: 30, tile_w_cm: 60, tile_h_cm: 60 })
check('tiles = ceil(30/0.36) = 84 base', tiles.base === 84, JSON.stringify(tiles))
check('tile count rounds up after waste (93)', tiles.quantity === 93, JSON.stringify(tiles))

const cement = estimate(byCode.est_plaster_cement, { area_m2: 100, thickness_mm: 20 })
check('cement bags are whole numbers', Number.isInteger(cement.quantity), JSON.stringify(cement))

let rejected = false
try {
  estimate({ ...byCode.est_tile_area, formula: 'process.exit(1)' }, { area_m2: 10 })
} catch {
  rejected = true
}
check('rejects a formula referencing an undeclared identifier', rejected)

let badInput = false
try {
  estimate(byCode.est_tile_area, { area_m2: 'ten' })
} catch {
  badInput = true
}
check('rejects a non-numeric input', badInput)

console.log(
  failures === 0
    ? `\nall smoke checks passed (${rules.length} rules loaded)`
    : `\n${failures} check(s) failed`,
)
process.exit(failures === 0 ? 0 : 1)
