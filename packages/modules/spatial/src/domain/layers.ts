/**
 * Plan layers. docs/08 §7.1
 *
 * Not the Konva layers — those are a rendering concern. These are the plan's
 * own organisation: the ground floor's walls, the structure the client's
 * engineer supplied, the setting-out lines that must be visible while drawing
 * and invisible when printing.
 *
 * Two switches, and the difference between them matters:
 *   · HIDDEN means the user cannot see it, so they must not be able to select
 *     it either — a click that selects an invisible thing is indistinguishable
 *     from the planner malfunctioning;
 *   · LOCKED means visible but untouchable, which is exactly what a traced
 *     survey needs to be while somebody draws on top of it.
 */

export interface PlanLayer {
  /** Matches the `layer` an entity carries. */
  id: string
  /** User-authored, so never translated — it is their word, not ours. */
  name: string
  visible: boolean
  locked: boolean
  /** Overrides the default entity colour when set. */
  colour: string | null
}

export const STRUCTURE_LAYER = 'structure'
export const EXISTING_LAYER = 'existing'

/**
 * The layers a new plan opens with.
 *
 * `default` first, because every wall drawn before anyone thinks about layers
 * lands there — and it must already exist for that to be true.
 */
export const defaultLayers = (): PlanLayer[] => [
  { id: 'default', name: 'Walls', visible: true, locked: false, colour: null },
  { id: STRUCTURE_LAYER, name: 'Structure', visible: true, locked: false, colour: '#7c3aed' },
  { id: EXISTING_LAYER, name: 'Existing', visible: true, locked: true, colour: '#94a3b8' },
]

export const findLayer = (layers: readonly PlanLayer[], id: string): PlanLayer | null =>
  layers.find((layer) => layer.id === id) ?? null

/**
 * Unknown layers are VISIBLE and UNLOCKED.
 *
 * An entity referencing a layer that no longer exists must not vanish — a plan
 * silently missing walls is unrecoverable, while an unexpectedly visible wall
 * is a nuisance the user fixes in a click.
 */
export const isVisible = (layers: readonly PlanLayer[], id: string): boolean =>
  findLayer(layers, id)?.visible ?? true

export const isLocked = (layers: readonly PlanLayer[], id: string): boolean =>
  findLayer(layers, id)?.locked ?? false

/** Visible and unlocked — the only combination a click may select. */
export const isSelectable = (layers: readonly PlanLayer[], id: string): boolean =>
  isVisible(layers, id) && !isLocked(layers, id)

export interface Layered {
  layer: string
}

export const onVisibleLayers = <T extends Layered>(
  layers: readonly PlanLayer[],
  items: readonly T[],
): T[] => items.filter((item) => isVisible(layers, item.layer))

export const onSelectableLayers = <T extends Layered>(
  layers: readonly PlanLayer[],
  items: readonly T[],
): T[] => items.filter((item) => isSelectable(layers, item.layer))

export function setLayer(
  layers: readonly PlanLayer[],
  id: string,
  patch: Partial<Omit<PlanLayer, 'id'>>,
): PlanLayer[] {
  return layers.map((layer) => (layer.id === id ? { ...layer, ...patch } : layer))
}

export const toggleVisible = (layers: readonly PlanLayer[], id: string): PlanLayer[] =>
  setLayer(layers, id, { visible: !isVisible(layers, id) })

export const toggleLocked = (layers: readonly PlanLayer[], id: string): PlanLayer[] =>
  setLayer(layers, id, { locked: !isLocked(layers, id) })

/** Appends a layer, or returns the list unchanged if the id is taken. */
export function addLayer(layers: readonly PlanLayer[], layer: PlanLayer): PlanLayer[] {
  return findLayer(layers, layer.id) ? [...layers] : [...layers, layer]
}
