import { boundsContain, boundsOverlap, type Bounds } from './geometry'

/**
 * Selection — the set, and the marquee that fills it. docs/08 §7.2
 *
 * Pure set arithmetic over entity ids. Every operation returns a NEW set:
 * the store swaps the reference so Vue's reactivity sees a change, and a
 * mutated set would leave the canvas showing the previous selection.
 */

export type SelectionMode = 'replace' | 'add' | 'toggle'

export function applySelection(
  current: ReadonlySet<string>,
  ids: readonly string[],
  mode: SelectionMode,
): Set<string> {
  if (mode === 'replace') return new Set(ids)

  const next = new Set(current)
  for (const id of ids) {
    if (mode === 'toggle' && next.has(id)) next.delete(id)
    else next.add(id)
  }
  return next
}

export interface Selectable {
  id: string
  bounds: Bounds
}

/**
 * Marquee hit test, with the direction convention every CAD tool shares:
 *
 *   dragging RIGHT (a "window") selects only what is fully inside;
 *   dragging LEFT  (a "crossing") selects anything it touches.
 *
 * Users arrive expecting this, and a planner that ignores it feels broken in
 * a way people struggle to articulate.
 */
export function marqueeHits(
  candidates: readonly Selectable[],
  marquee: Bounds,
  direction: 'right' | 'left',
): string[] {
  const hit = direction === 'right' ? boundsContain : boundsOverlap
  return candidates
    .filter((candidate) =>
      direction === 'right'
        ? hit(marquee, candidate.bounds)
        : boundsOverlap(marquee, candidate.bounds),
    )
    .map((candidate) => candidate.id)
}

/** The union of the selected entities' bounds — what "zoom to selection" frames. */
export function selectionBounds(
  candidates: readonly Selectable[],
  selection: ReadonlySet<string>,
): Bounds | null {
  let result: Bounds | null = null
  for (const candidate of candidates) {
    if (!selection.has(candidate.id)) continue
    result = result
      ? {
          minX: Math.min(result.minX, candidate.bounds.minX),
          minY: Math.min(result.minY, candidate.bounds.minY),
          maxX: Math.max(result.maxX, candidate.bounds.maxX),
          maxY: Math.max(result.maxY, candidate.bounds.maxY),
        }
      : { ...candidate.bounds }
  }
  return result
}

/**
 * Topmost entity under a point, given a pixel tolerance already converted to
 * millimetres. Later entities win, because they are drawn on top — clicking
 * where two walls overlap should select the one you can see.
 */
export function hitTest(
  candidates: readonly Selectable[],
  target: { x: number; y: number },
  toleranceMm: number,
): string | null {
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const candidate = candidates[index]
    if (!candidate) continue
    const { bounds } = candidate
    if (
      target.x >= bounds.minX - toleranceMm &&
      target.x <= bounds.maxX + toleranceMm &&
      target.y >= bounds.minY - toleranceMm &&
      target.y <= bounds.maxY + toleranceMm
    ) {
      return candidate.id
    }
  }
  return null
}
