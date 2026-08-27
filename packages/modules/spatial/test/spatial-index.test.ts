import { describe, expect, it } from 'vitest'
import { SpatialIndex, resolveHits } from '../src/domain/spatial-index'
import { point } from '../src/domain/geometry'
import { createWall, wallBounds, type Wall } from '../src/domain/wall'

/**
 * The index exists so snapping stays O(log n). What these tests protect is
 * that it answers the SAME question a linear scan would — an index that is
 * fast and subtly different from the document is worse than no index at all,
 * because it snaps to walls the user cannot see.
 */

const wall = (id: string, x1: number, y1: number, x2: number, y2: number): Wall =>
  createWall({ id, start: point(x1, y1), end: point(x2, y2) }).unwrap()

const indexable = (walls: readonly Wall[]) =>
  walls.map((item) => ({ id: item.id, bounds: wallBounds(item) }))

const room = [
  wall('north', 0, 0, 6000, 0),
  wall('east', 6000, 0, 6000, 4000),
  wall('south', 6000, 4000, 0, 4000),
  wall('west', 0, 4000, 0, 0),
]

describe('the R-tree index', () => {
  const index = SpatialIndex.of(indexable(room))

  it('finds exactly what a linear scan would', () => {
    const query = { minX: -500, minY: -500, maxX: 500, maxY: 500 }
    const scanned = indexable(room)
      .filter(
        (item) =>
          item.bounds.minX <= query.maxX &&
          item.bounds.maxX >= query.minX &&
          item.bounds.minY <= query.maxY &&
          item.bounds.maxY >= query.minY,
      )
      .map((item) => item.id)

    expect(index.search(query).sort()).toEqual(scanned.sort())
    expect(index.search(query).sort()).toEqual(['north', 'west'])
  })

  it('answers the pointer query — everything within a radius', () => {
    // The north-east corner: two walls meet, the others are metres away.
    expect(index.near(point(6000, 0), 150).sort()).toEqual(['east', 'north'])
    expect(index.near(point(3000, 2000), 100)).toEqual([])
  })

  it('reports collision without materialising the hits', () => {
    expect(index.collides({ minX: 2000, minY: -50, maxX: 2100, maxY: 50 })).toBe(true)
    expect(index.collides({ minX: 2000, minY: 1000, maxX: 2100, maxY: 3000 })).toBe(false)
  })

  it('handles an empty plan without special-casing at the call site', () => {
    expect(SpatialIndex.empty().near(point(0, 0), 10_000)).toEqual([])
    expect(SpatialIndex.empty().size).toBe(0)
  })

  it('stays exact across a thousand segments', () => {
    const many = Array.from({ length: 1000 }, (_unused, i) =>
      wall(`w${i}`, i * 1000, 0, i * 1000, 3000),
    )
    const big = SpatialIndex.of(indexable(many))

    expect(big.size).toBe(1000)
    expect(big.near(point(500_000, 1500), 50)).toEqual(['w500'])
  })
})

describe('resolveHits', () => {
  it('restores DOCUMENT order, which the tree does not preserve', () => {
    // Draw order decides which wall is on top; consuming the tree's arbitrary
    // order would make "topmost under the cursor" wrong exactly where walls
    // overlap.
    const items = indexable(room)
    const shuffled = ['south', 'north', 'west']

    expect(resolveHits(items, shuffled).map((item) => item.id)).toEqual(['north', 'south', 'west'])
  })
})
