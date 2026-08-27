import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SHARE_DAYS,
  MAX_SHARE_DAYS,
  createShare,
  publicScene,
  recordView,
  revokeShare,
  shareIsOpen,
  shareRefusal,
  type PlanShare,
} from '../src/domain/share'
import { emptyGeometry } from '../src/domain/plan'
import { defaultLayers } from '../src/domain/layers'
import { createWall } from '../src/domain/wall'
import { createBackground } from '../src/domain/background'
import { point } from '../src/domain/geometry'
import type { RoomBoundary } from '../src/domain/room'

/**
 * The one URL in this product that anyone on the internet can hold.
 *
 * Two failures matter more than the rest, and both are silent: a link that
 * outlives the relationship it was made for, and a payload that carries
 * something the visitor was never meant to see. The redaction test below is
 * written so that ADDING a field to the plan cannot quietly leak it.
 */

const NOW = new Date('2026-08-27T09:00:00.000Z')
const HASH = 'a'.repeat(64)
const later = (days: number) => new Date(NOW.getTime() + days * 86_400_000)

const share = (overrides: Partial<PlanShare> = {}): PlanShare => ({
  ...createShare({
    id: 'share-1',
    floorPlanId: 'plan-1',
    tokenHash: HASH,
    label: 'For the client',
    createdBy: 'sara',
    now: NOW,
  }).unwrap(),
  ...overrides,
})

describe('creating a link', () => {
  it('expires by default rather than lasting for ever', () => {
    // A share with no end is an access grant nobody remembers issuing.
    expect(share().expiresAt.getTime()).toBe(later(DEFAULT_SHARE_DAYS).getTime())
  })

  it('honours a duration inside the cap', () => {
    const custom = createShare({
      id: 's',
      floorPlanId: 'plan-1',
      tokenHash: HASH,
      label: 'Short',
      days: 3,
      createdBy: 'sara',
      now: NOW,
    }).unwrap()

    expect(custom.expiresAt.getTime()).toBe(later(3).getTime())
  })

  it('refuses a duration beyond the cap, or none at all', () => {
    const forever = createShare({
      id: 's',
      floorPlanId: 'plan-1',
      tokenHash: HASH,
      label: 'Forever',
      days: MAX_SHARE_DAYS + 1,
      createdBy: 'sara',
      now: NOW,
    })

    expect(forever.isErr()).toBe(true)
    if (forever.isErr()) expect(forever.error.code).toBe('SHARE_INVALID_DURATION')
  })

  it('refuses anything that is not a hash', () => {
    // A short value means somebody passed the raw token — which would store
    // the key to the door beside the door.
    const raw = createShare({
      id: 's',
      floorPlanId: 'plan-1',
      tokenHash: 'token123',
      label: 'Oops',
      createdBy: 'sara',
      now: NOW,
    })

    expect(raw.isErr()).toBe(true)
    if (raw.isErr()) expect(raw.error.code).toBe('SHARE_WEAK_TOKEN')
  })

  it('names an unnamed link rather than leaving a blank row', () => {
    const blank = createShare({
      id: 's',
      floorPlanId: 'plan-1',
      tokenHash: HASH,
      label: '   ',
      createdBy: 'sara',
      now: NOW,
    }).unwrap()

    expect(blank.label).toBe('Client link')
  })
})

describe('opening a link', () => {
  it('opens while it is live', () => {
    expect(shareIsOpen(share(), later(1))).toBe(true)
    expect(shareRefusal(share(), later(1))).toBeNull()
  })

  it('says WHY it will not open', () => {
    // "This expired on the 4th" and "the contractor withdrew it" are different
    // things to tell a client; a bare 404 tells them neither.
    expect(shareRefusal(share(), later(DEFAULT_SHARE_DAYS + 1))).toBe('expired')
    expect(shareRefusal(share({ revokedAt: NOW }), later(1))).toBe('revoked')
  })

  it('treats revocation as final, whatever the expiry says', () => {
    expect(shareRefusal(share({ revokedAt: NOW }), NOW)).toBe('revoked')
  })

  it('closes exactly ON the expiry, not a moment after', () => {
    expect(shareIsOpen(share(), later(DEFAULT_SHARE_DAYS))).toBe(false)
  })

  it('counts a visit', () => {
    expect(recordView(share()).viewCount).toBe(1)
  })
})

describe('revoking', () => {
  it('withdraws a live link', () => {
    expect(revokeShare(share(), later(1)).unwrap().revokedAt).toEqual(later(1))
  })

  it('refuses to revoke twice', () => {
    const result = revokeShare(share({ revokedAt: NOW }), later(1))

    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.code).toBe('SHARE_ALREADY_REVOKED')
  })
})

describe('what a visitor is given', () => {
  const geometry = {
    ...emptyGeometry(defaultLayers()),
    walls: [createWall({ id: 'w1', start: point(0, 0), end: point(6000, 0) }).unwrap()],
    background: createBackground({
      source: 'blob:the-architect-survey',
      pixelWidth: 100,
      pixelHeight: 100,
    }).unwrap(),
    roomAssignments: { 'w1|w2': { name: 'Majlis', typeCode: 'majlis', ceilingHeightMm: 3000 } },
  }

  const rooms: RoomBoundary[] = [
    {
      id: 'room:w1|w2|w3|w4',
      signature: 'w1|w2|w3|w4',
      typeCode: 'majlis',
      name: 'Majlis',
      polygon: [point(0, 0), point(6000, 0), point(6000, 4000), point(0, 4000)],
      areaMm2: 24_000_000,
      perimeterMm: 20_000,
      wallIds: ['w1', 'w2', 'w3', 'w4'],
      ceilingHeightMm: 3000,
    },
  ]

  const scene = publicScene('Ground floor', geometry, rooms)

  it('gives them the drawing and the rooms', () => {
    expect(scene.geometry.walls).toHaveLength(1)
    expect(scene.rooms[0]?.name).toBe('Majlis')
    expect(scene.totalAreaMm2).toBe(24_000_000)
  })

  it('withholds the survey the contractor traced', () => {
    // Somebody else's drawing, licensed to the contractor and not to the world.
    expect(Object.keys(scene.geometry)).toEqual(['walls', 'openings', 'structural'])
    expect(JSON.stringify(scene)).not.toContain('the-architect-survey')
  })

  it('withholds the layers and the internal ids', () => {
    // A layer name is working shorthand, not client-facing; an id is a probe
    // against the rest of the API.
    const serialised = JSON.stringify(scene)

    expect(serialised).not.toContain('layers')
    expect(serialised).not.toContain('room:w1')
    expect(serialised).not.toContain('roomAssignments')
  })

  it('carries nothing priced', () => {
    // The viewer knows how to price a finish. A shared viewer must not be
    // handed the numbers to do it with.
    const serialised = JSON.stringify(scene).toLowerCase()

    for (const forbidden of ['rate', 'cost', 'currency', 'price', 'total_']) {
      expect(serialised).not.toContain(forbidden)
    }
  })
})
