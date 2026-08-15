import { describe, it, expect } from 'vitest'
import { Uuid7Generator, SequentialIdGenerator, isUuid, toId } from '../src/ids'

describe('Uuid7Generator', () => {
  it('produces valid UUIDs with version 7 and the RFC variant', () => {
    const id = new Uuid7Generator().next()
    expect(isUuid(id)).toBe(true)
    expect(id[14]).toBe('7')
    expect(['8', '9', 'a', 'b']).toContain(id[19])
  })

  it('sorts lexicographically in creation order', () => {
    // This is the property that preserves InnoDB insert locality. UUIDv4 has it
    // by accident never; auto-increment has it but cannot be generated offline.
    let ms = 1_700_000_000_000
    const gen = new Uuid7Generator(() => (ms += 1))
    const ids = Array.from({ length: 50 }, () => gen.next<'UnitId'>())
    expect([...ids].sort()).toEqual(ids)
  })

  it('stays ordered within a single millisecond', () => {
    // A stage set of 14, or a BOQ of 147 lines, is created inside one tick.
    // Without the sequence counter these would sort arbitrarily.
    const gen = new Uuid7Generator(() => 1_700_000_000_000)
    const ids = Array.from({ length: 100 }, () => gen.next<'UnitStageId'>())
    expect([...ids].sort()).toEqual(ids)
  })

  it('does not collide across many generations', () => {
    const gen = new Uuid7Generator()
    const ids = new Set(Array.from({ length: 10_000 }, () => gen.next()))
    expect(ids.size).toBe(10_000)
  })

  it('encodes the generation timestamp in the high bits', () => {
    const at = 1_735_689_600_000 // 2025-01-01T00:00:00Z
    const id = new Uuid7Generator(() => at).next()
    const encoded = parseInt(id.replace(/-/g, '').slice(0, 12), 16)
    expect(encoded).toBe(at)
  })
})

describe('SequentialIdGenerator', () => {
  it('is deterministic across runs', () => {
    const a = Array.from({ length: 5 }, () => new SequentialIdGenerator().next())
    const b = Array.from({ length: 5 }, () => new SequentialIdGenerator().next())
    expect(a).toEqual(b)
  })

  it('produces ids that pass UUID validation', () => {
    expect(isUuid(new SequentialIdGenerator().next())).toBe(true)
  })
})

describe('toId', () => {
  it('accepts a valid UUID', () => {
    const gen = new Uuid7Generator()
    const raw: string = gen.next()
    expect(toId<'UnitId'>(raw)).toBe(raw)
  })

  it('rejects malformed input rather than letting it reach a query', () => {
    // Ids arrive from URLs, mobile clients, and sync payloads.
    expect(() => toId<'UnitId'>("'; DROP TABLE units;--")).toThrow(TypeError)
    expect(() => toId<'UnitId'>('1841')).toThrow(TypeError)
    expect(() => toId<'UnitId'>('')).toThrow(TypeError)
  })
})
