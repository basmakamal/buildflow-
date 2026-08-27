import { describe, expect, it } from 'vitest'
import {
  addLayer,
  defaultLayers,
  isLocked,
  isSelectable,
  isVisible,
  onSelectableLayers,
  onVisibleLayers,
  setLayer,
  toggleLocked,
  toggleVisible,
} from '../src/domain/layers'

/**
 * Two switches, and the distinction between them is the whole feature: hidden
 * things cannot be selected (a click that selects the invisible reads as a
 * malfunction), while locked things are visible and untouchable — which is
 * exactly what a traced survey must be while somebody draws on top of it.
 */

const layers = defaultLayers()

const items = [
  { id: 'w1', layer: 'default' },
  { id: 's1', layer: 'structure' },
  { id: 'e1', layer: 'existing' },
  { id: 'x1', layer: 'a-layer-that-was-deleted' },
]

describe('visibility and locking', () => {
  it('opens a plan with walls drawable and the survey locked', () => {
    expect(isSelectable(layers, 'default')).toBe(true)
    expect(isVisible(layers, 'existing')).toBe(true)
    expect(isLocked(layers, 'existing')).toBe(true)
    expect(isSelectable(layers, 'existing')).toBe(false)
  })

  it('treats an unknown layer as visible and unlocked', () => {
    // A plan silently missing walls is unrecoverable; an unexpectedly visible
    // wall is a nuisance the user fixes in one click.
    expect(isVisible(layers, 'nonexistent')).toBe(true)
    expect(isLocked(layers, 'nonexistent')).toBe(false)
  })

  it('never lets a hidden layer be selectable, whatever its lock says', () => {
    const hidden = setLayer(layers, 'default', { visible: false, locked: false })

    expect(isSelectable(hidden, 'default')).toBe(false)
  })
})

describe('filtering entities', () => {
  it('draws what is visible', () => {
    const hidden = toggleVisible(layers, 'structure')

    expect(onVisibleLayers(hidden, items).map((item) => item.id)).toEqual(['w1', 'e1', 'x1'])
  })

  it('selects only what is visible AND unlocked', () => {
    expect(onSelectableLayers(layers, items).map((item) => item.id)).toEqual(['w1', 's1', 'x1'])
  })
})

describe('editing the list', () => {
  it('toggles without mutating the list it was given', () => {
    const next = toggleLocked(layers, 'default')

    expect(isLocked(next, 'default')).toBe(true)
    expect(isLocked(layers, 'default')).toBe(false)
  })

  it('refuses to add a second layer under an id already taken', () => {
    const next = addLayer(layers, {
      id: 'default',
      name: 'Something else',
      visible: true,
      locked: false,
      colour: null,
    })

    expect(next).toHaveLength(layers.length)
    expect(next.find((layer) => layer.id === 'default')?.name).toBe('Walls')
  })

  it('appends a genuinely new layer', () => {
    const next = addLayer(layers, {
      id: 'setting-out',
      name: 'Setting out',
      visible: true,
      locked: false,
      colour: '#ef4444',
    })

    expect(next).toHaveLength(layers.length + 1)
  })
})
