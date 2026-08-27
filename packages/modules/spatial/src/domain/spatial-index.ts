import RBush from 'rbush'
import { growBounds, type Bounds, type Point } from './geometry'

/**
 * The R-tree index. docs/08 §7.3, §7.5
 *
 * Snapping and hit-testing ask the same question hundreds of times a second —
 * "what is near this pointer?" — and a linear scan answers it in O(n). At a
 * thousand segments that is the difference between a planner that tracks the
 * cursor and one that lags behind it, so the query goes through rbush and
 * stays O(log n).
 *
 * The index is DERIVED and REBUILT on geometry change rather than mutated in
 * place. Incremental insert/remove is faster in principle, but it means the
 * index and the document can disagree — and an index that disagrees produces
 * snaps to walls that no longer exist, which is far worse than a rebuild that
 * costs a millisecond on a plan of realistic size. Bulk `load` is 2–3× faster
 * than inserting one by one, which is what makes that trade affordable.
 */

export interface Indexable {
  id: string
  bounds: Bounds
}

interface Entry {
  minX: number
  minY: number
  maxX: number
  maxY: number
  id: string
}

export class SpatialIndex {
  readonly #tree: RBush<Entry>
  readonly #count: number

  private constructor(entries: Entry[]) {
    this.#tree = new RBush<Entry>()
    this.#tree.load(entries)
    this.#count = entries.length
  }

  /** Bulk-loads an index. The only way to build one — see the note above. */
  static of(items: readonly Indexable[]): SpatialIndex {
    return new SpatialIndex(
      items.map((item) => ({
        minX: item.bounds.minX,
        minY: item.bounds.minY,
        maxX: item.bounds.maxX,
        maxY: item.bounds.maxY,
        id: item.id,
      })),
    )
  }

  static empty(): SpatialIndex {
    return new SpatialIndex([])
  }

  get size(): number {
    return this.#count
  }

  /** Ids whose bounds intersect `bounds`. Touching counts, as everywhere else. */
  search(bounds: Bounds): string[] {
    return this.#tree.search(bounds).map((entry) => entry.id)
  }

  /** Ids within `radiusMm` of a point — the pointer query, in one call. */
  near(target: Point, radiusMm: number): string[] {
    return this.search(
      growBounds({ minX: target.x, minY: target.y, maxX: target.x, maxY: target.y }, radiusMm),
    )
  }

  /** Whether anything at all lies in `bounds` — cheaper than counting. */
  collides(bounds: Bounds): boolean {
    return this.#tree.collides(bounds)
  }
}

/**
 * Resolves ids back to the items they came from, preserving DOCUMENT order.
 *
 * The R-tree returns hits in tree order, which is arbitrary. Anything that
 * depends on draw order — "the topmost wall under the cursor" — would be
 * subtly wrong if it consumed that order, and wrong in a way that only shows
 * up where walls overlap.
 */
export function resolveHits<T extends { id: string }>(
  items: readonly T[],
  ids: readonly string[],
): T[] {
  const wanted = new Set(ids)
  return items.filter((item) => wanted.has(item.id))
}
