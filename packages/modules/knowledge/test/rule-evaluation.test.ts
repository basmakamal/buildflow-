import { describe, expect, it } from 'vitest'
import { type Facts, type Rule, evaluate, parseCondition } from '../src/domain/rule'
import { ROOM_TYPE_TO_KB, deriveRoomFacts, mergeFacts } from '../src/domain/room-facts'

const rule = (over: Partial<Rule> & Pick<Rule, 'code' | 'conditions'>): Rule => ({
  ruleType: 'validation',
  domain: 'general',
  roomTypeCode: null,
  severity: 'warning',
  messageEn: 'en',
  messageAr: 'ar',
  action: null,
  priority: 100,
  ...over,
})

describe('evaluate', () => {
  it('fires a rule whose conditions all match', () => {
    const rules = [
      rule({
        code: 'R1',
        conditions: { all: [{ fact: 'area', operator: 'greaterThan', value: 20 }] },
      }),
    ]
    expect(evaluate(rules, { area: 24 }).findings.map((f) => f.code)).toEqual(['R1'])
    expect(evaluate(rules, { area: 18 }).findings).toEqual([])
  })

  /**
   * The central behaviour: a room with no socket data must not be reported as
   * having too few sockets. Absent ≠ zero.
   */
  it('skips a rule instead of firing it when a fact is absent', () => {
    const rules = [
      rule({
        code: 'SOCKETS',
        conditions: { all: [{ fact: 'socketCount', operator: 'lessThan', value: 4 }] },
      }),
    ]
    const result = evaluate(rules, { area: 20 })

    expect(result.findings).toEqual([])
    expect(result.skipped).toEqual([{ code: 'SOCKETS', missingFact: 'socketCount' }])
  })

  it('treats a zero fact as present, not absent', () => {
    const rules = [
      rule({
        code: 'ZERO',
        conditions: { all: [{ fact: 'socketCount', operator: 'lessThan', value: 4 }] },
      }),
    ]
    const result = evaluate(rules, { socketCount: 0 })

    expect(result.findings.map((f) => f.code)).toEqual(['ZERO'])
    expect(result.skipped).toEqual([])
  })

  it('treats a false fact as present, not absent', () => {
    const rules = [
      rule({
        code: 'FLAG',
        conditions: { all: [{ fact: 'hasRcd', operator: 'equal', value: false }] },
      }),
    ]
    expect(evaluate(rules, { hasRcd: false }).findings).toHaveLength(1)
  })

  /**
   * `all` short-circuits, so a rule gated on room type never reports a missing
   * fact that only matters for a different room. Without this, analysing a
   * bedroom would list every kitchen fact as "missing".
   */
  it('does not report missing facts from branches it never reached', () => {
    const rules = [
      rule({
        code: 'KITCHEN_ONLY',
        conditions: {
          all: [
            { fact: 'roomType', operator: 'equal', value: 'kitchen' },
            { fact: 'counterLengthM', operator: 'greaterThan', value: 2 },
          ],
        },
      }),
    ]
    const result = evaluate(rules, { roomType: 'bedroom' })

    expect(result.findings).toEqual([])
    expect(result.skipped).toEqual([])
  })

  it('resolves an any-branch when one alternative matches despite a missing fact', () => {
    const rules = [
      rule({
        code: 'EITHER',
        conditions: {
          any: [
            { fact: 'missingOne', operator: 'lessThan', value: 5 },
            { fact: 'area', operator: 'greaterThan', value: 10 },
          ],
        },
      }),
    ]
    const result = evaluate(rules, { area: 20 })

    expect(result.findings.map((f) => f.code)).toEqual(['EITHER'])
    expect(result.skipped).toEqual([])
  })

  it('reports the missing fact when no any-branch alternative matches', () => {
    const rules = [
      rule({
        code: 'EITHER',
        conditions: {
          any: [
            { fact: 'missingOne', operator: 'lessThan', value: 5 },
            { fact: 'area', operator: 'greaterThan', value: 100 },
          ],
        },
      }),
    ]
    expect(evaluate(rules, { area: 20 }).skipped).toEqual([
      { code: 'EITHER', missingFact: 'missingOne' },
    ])
  })

  it('orders findings by severity, then priority, then code', () => {
    const always: Rule['conditions'] = {
      all: [{ fact: 'area', operator: 'greaterThan', value: 1 }],
    }
    const rules = [
      rule({ code: 'C', conditions: always, severity: 'suggestion' }),
      rule({ code: 'A', conditions: always, severity: 'critical' }),
      rule({ code: 'B', conditions: always, severity: 'warning', priority: 10 }),
      rule({ code: 'B2', conditions: always, severity: 'warning', priority: 5 }),
    ]
    expect(evaluate(rules, { area: 5 }).findings.map((f) => f.code)).toEqual(['A', 'B2', 'B', 'C'])
  })

  it('filters by domain and rule type', () => {
    const always: Rule['conditions'] = {
      all: [{ fact: 'area', operator: 'greaterThan', value: 1 }],
    }
    const rules = [
      rule({ code: 'L', conditions: always, domain: 'lighting', ruleType: 'validation' }),
      rule({ code: 'E', conditions: always, domain: 'electrical', ruleType: 'recommendation' }),
    ]
    expect(
      evaluate(rules, { area: 5 }, { domains: ['lighting'] }).findings.map((f) => f.code),
    ).toEqual(['L'])
    expect(
      evaluate(rules, { area: 5 }, { ruleTypes: ['recommendation'] }).findings.map((f) => f.code),
    ).toEqual(['E'])
  })

  it('counts only the rules a filter actually let through', () => {
    // `total - skipped` would report 2 evaluated here and overstate coverage
    // exactly when the caller narrowed the request.
    const always: Rule['conditions'] = {
      all: [{ fact: 'area', operator: 'greaterThan', value: 1 }],
    }
    const rules = [
      rule({ code: 'L', conditions: always, domain: 'lighting' }),
      rule({ code: 'E', conditions: always, domain: 'electrical' }),
    ]
    expect(evaluate(rules, { area: 5 }, { domains: ['lighting'] }).considered).toBe(1)
    expect(evaluate(rules, { area: 5 }).considered).toBe(2)
  })

  it('counts a skipped rule as considered', () => {
    const rules = [
      rule({
        code: 'S',
        conditions: { all: [{ fact: 'absent', operator: 'equal', value: 1 }] },
      }),
    ]
    const result = evaluate(rules, { area: 5 })
    expect(result.considered).toBe(1)
    expect(result.skipped).toHaveLength(1)
  })

  it('refuses to compare a string against a numeric threshold', () => {
    // JS would coerce '30' < 4 into a silent false and 'x' > 1 into false too,
    // but only by accident. An ordered comparison on a non-number is a data
    // error, and must not be reported as a satisfied or violated rule.
    const rules = [
      rule({
        code: 'ORD',
        conditions: { all: [{ fact: 'area', operator: 'lessThan', value: 10 }] },
      }),
    ]
    expect(evaluate(rules, { area: 'small' }).findings).toEqual([])
  })

  it('applies the room pre-filter without changing outcomes', () => {
    const conditions: Rule['conditions'] = {
      all: [{ fact: 'roomType', operator: 'equal', value: 'kitchen' }],
    }
    const filtered = [rule({ code: 'K', conditions, roomTypeCode: 'kitchen' })]
    const unfiltered = [rule({ code: 'K', conditions, roomTypeCode: null })]
    const facts: Facts = { roomType: 'kitchen' }

    expect(evaluate(filtered, facts).findings).toEqual(evaluate(unfiltered, facts).findings)
    expect(evaluate(filtered, { roomType: 'bedroom' }).findings).toEqual([])
  })
})

describe('parseCondition', () => {
  it('rejects an unknown operator', () => {
    const result = parseCondition({ fact: 'area', operator: 'sortaEquals', value: 1 })
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.code).toBe('RULE_OPERATOR_UNKNOWN')
  })

  it('rejects in/notIn without an array value', () => {
    expect(parseCondition({ fact: 'roomType', operator: 'in', value: 'kitchen' }).isErr()).toBe(
      true,
    )
  })

  it('rejects an empty branch', () => {
    expect(parseCondition({ all: [] }).isErr()).toBe(true)
  })

  it('parses a nested tree', () => {
    const result = parseCondition({
      all: [
        { fact: 'roomType', operator: 'in', value: ['kitchen', 'laundry'] },
        { any: [{ fact: 'area', operator: 'greaterThan', value: 5 }] },
      ],
    })
    expect(result.isOk()).toBe(true)
  })
})

describe('deriveRoomFacts', () => {
  it('derives geometry facts in metres', () => {
    const { facts } = deriveRoomFacts({
      typeCode: 'master_bedroom',
      widthMm: 4200,
      lengthMm: 5700,
      heightMm: 3000,
    })
    expect(facts).toEqual({
      roomType: 'master_bedroom',
      area: 23.94,
      width: 4.2,
      length: 5.7,
      ceilingHeight: 3,
      isWetArea: false,
    })
  })

  it('normalises width to the shorter side regardless of input order', () => {
    const wide = deriveRoomFacts({
      typeCode: 'bedroom',
      widthMm: 5000,
      lengthMm: 3000,
      heightMm: 3000,
    })
    const tall = deriveRoomFacts({
      typeCode: 'bedroom',
      widthMm: 3000,
      lengthMm: 5000,
      heightMm: 3000,
    })
    expect(wide.facts).toEqual(tall.facts)
    expect(wide.facts?.['width']).toBe(3)
  })

  it('flags wet areas', () => {
    for (const type of ['bathroom', 'guest_bathroom', 'kitchen', 'laundry']) {
      const { facts } = deriveRoomFacts({
        typeCode: type,
        widthMm: 2000,
        lengthMm: 2500,
        heightMm: 2800,
      })
      expect(facts?.['isWetArea'], type).toBe(true)
    }
    const { facts } = deriveRoomFacts({
      typeCode: 'bedroom',
      widthMm: 3000,
      lengthMm: 4000,
      heightMm: 2800,
    })
    expect(facts?.['isWetArea']).toBe(false)
  })

  it('maps reception onto the majlis standards', () => {
    expect(
      deriveRoomFacts({ typeCode: 'reception', widthMm: 5000, lengthMm: 6000, heightMm: 3000 })
        .kbRoomCode,
    ).toBe('majlis')
  })

  it('reports no coverage for an unmappable room type', () => {
    const result = deriveRoomFacts({
      typeCode: 'other',
      widthMm: 3000,
      lengthMm: 3000,
      heightMm: 3000,
    })
    expect(result.facts).toBeNull()
    expect(result.kbRoomCode).toBeNull()
  })

  /**
   * Guards the seam between two independently-authored vocabularies. If someone
   * adds a room type to the project domain, this fails until the knowledge base
   * either covers it or explicitly declares it uncovered.
   */
  it('has an entry for every project-domain room type', () => {
    const domainRoomTypes = [
      'bedroom',
      'master_bedroom',
      'bathroom',
      'guest_bathroom',
      'kitchen',
      'living_room',
      'dining_room',
      'reception',
      'majlis',
      'balcony',
      'laundry',
      'storage',
      'corridor',
      'staircase',
      'maid_room',
      'driver_room',
      'other',
    ]
    for (const type of domainRoomTypes) {
      expect(Object.hasOwn(ROOM_TYPE_TO_KB, type), `no mapping for "${type}"`).toBe(true)
    }
  })
})

describe('mergeFacts', () => {
  it('overlays supplied facts onto derived ones', () => {
    const derived: Facts = { roomType: 'kitchen', area: 14, isWetArea: true }
    expect(mergeFacts(derived, { socketCount: 4 })).toEqual({
      roomType: 'kitchen',
      area: 14,
      isWetArea: true,
      socketCount: 4,
    })
  })

  it('refuses to let a request override roomType or isWetArea', () => {
    // Otherwise a caller could declare a bathroom dry and silence every
    // critical wet-area rule.
    const derived: Facts = { roomType: 'bathroom', isWetArea: true }
    expect(mergeFacts(derived, { roomType: 'bedroom', isWetArea: false })).toEqual({
      roomType: 'bathroom',
      isWetArea: true,
    })
  })
})

describe('unit programme facts', () => {
  it('carries finish level, unit type and occupants down to the room', () => {
    const { facts } = deriveRoomFacts(
      { typeCode: 'master_bedroom', widthMm: 4000, lengthMm: 5000, heightMm: 3000 },
      { unitType: 'villa', finishLevel: 'luxury', occupantType: 'family' },
    )
    expect(facts?.['unitType']).toBe('villa')
    expect(facts?.['finishLevel']).toBe('luxury')
    expect(facts?.['occupantType']).toBe('family')
  })

  /**
   * The distinction the nullable columns exist for. A rule asking
   * `finishLevel === 'luxury'` must SKIP for a unit nobody has classified, not
   * answer "no" — otherwise unrecorded data silently reads as a decision.
   */
  it('omits unrecorded programme facts rather than passing null', () => {
    const { facts } = deriveRoomFacts(
      { typeCode: 'bedroom', widthMm: 3000, lengthMm: 4000, heightMm: 3000 },
      { unitType: null, finishLevel: null, occupantType: null },
    )
    expect('finishLevel' in (facts ?? {})).toBe(false)
    expect('unitType' in (facts ?? {})).toBe(false)

    const rules = [
      rule({
        code: 'LUX',
        conditions: { all: [{ fact: 'finishLevel', operator: 'equal', value: 'luxury' }] },
      }),
    ]
    const result = evaluate(rules, facts!)
    expect(result.findings).toEqual([])
    expect(result.skipped).toEqual([{ code: 'LUX', missingFact: 'finishLevel' }])
  })

  it('lets a recorded programme fact satisfy a rule', () => {
    const { facts } = deriveRoomFacts(
      { typeCode: 'bedroom', widthMm: 3000, lengthMm: 4000, heightMm: 3000 },
      { finishLevel: 'luxury' },
    )
    const rules = [
      rule({
        code: 'LUX',
        conditions: { all: [{ fact: 'finishLevel', operator: 'equal', value: 'luxury' }] },
      }),
    ]
    expect(evaluate(rules, facts!).findings.map((f) => f.code)).toEqual(['LUX'])
  })

  it('never lets the programme shadow a derived room fact', () => {
    // roomType and isWetArea describe the room as recorded, not the unit.
    const { facts } = deriveRoomFacts(
      { typeCode: 'bathroom', widthMm: 2000, lengthMm: 2000, heightMm: 2800 },
      { unitType: 'villa' },
    )
    expect(facts?.['roomType']).toBe('bathroom')
    expect(facts?.['isWetArea']).toBe(true)
  })
})
