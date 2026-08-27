import {
  type DomainError,
  type Result,
  err,
  forbiddenError,
  ok,
  validationError,
} from '@buildflow/core'
import type { PlanGeometry } from './plan'
import type { RoomBoundary } from './room'

/**
 * Client share links. docs/04 §2.5, docs/16 Phase 5 sprint 10
 *
 * A link a contractor sends a client so they can walk through their own flat
 * on a phone, without an account and without seeing anything they should not.
 *
 * Three rules make that safe, and all three live here rather than in a route
 * handler, because a share link is the one URL in this product that anyone on
 * the internet can hold:
 *
 *   1. Only a HASH of the token is stored. A leaked database row does not
 *      grant access to the plan it points at — the same reasoning as refresh
 *      tokens in docs/11 §2.2.
 *   2. Every link EXPIRES. A share with no end is an access grant nobody
 *      remembers issuing.
 *   3. The public payload is built by REDACTION, not by omission at the call
 *      site: `publicScene` decides what a stranger may see, so a route cannot
 *      accidentally hand over costs by returning the wrong object.
 *
 * Deviation from docs/04 §2.5, recorded rather than hidden: the document names
 * this table `scene_shares`, keyed to a `SceneConfig` that carries materials,
 * lighting and camera bookmarks. SceneConfig is not modelled yet, so a share
 * points at the FLOOR PLAN. When SceneConfig lands the link gains a scene, and
 * nothing here changes shape.
 */

export interface PlanShare {
  id: string
  floorPlanId: string
  /** SHA-256 of the token. The token itself is shown once and never stored. */
  tokenHash: string
  label: string
  expiresAt: Date
  viewCount: number
  createdBy: string
  createdAt: Date
  revokedAt: Date | null
}

/** A fortnight: long enough to decide on a kitchen, short enough to forget safely. */
export const DEFAULT_SHARE_DAYS = 14
export const MAX_SHARE_DAYS = 90

export interface ShareRequest {
  id: string
  floorPlanId: string
  tokenHash: string
  label: string
  days?: number
  createdBy: string
  now: Date
}

export function createShare(request: ShareRequest): Result<PlanShare, DomainError> {
  const days = request.days ?? DEFAULT_SHARE_DAYS
  if (!Number.isInteger(days) || days < 1 || days > MAX_SHARE_DAYS) {
    return err(
      validationError(
        'SHARE_INVALID_DURATION',
        `A link lasts between 1 and ${MAX_SHARE_DAYS} days`,
        {
          maximumDays: MAX_SHARE_DAYS,
        },
      ),
    )
  }
  if (request.tokenHash.length < 32) {
    // A short hash means somebody passed the raw token, or something worse.
    return err(validationError('SHARE_WEAK_TOKEN', 'The share token is not a usable hash'))
  }

  return ok({
    id: request.id,
    floorPlanId: request.floorPlanId,
    tokenHash: request.tokenHash,
    label: request.label.trim() || 'Client link',
    expiresAt: new Date(request.now.getTime() + days * 86_400_000),
    viewCount: 0,
    createdBy: request.createdBy,
    createdAt: request.now,
    revokedAt: null,
  })
}

export type ShareRefusal = 'expired' | 'revoked'

/**
 * Whether a link still opens.
 *
 * Returns WHY it does not, because "this link expired on the 4th" and "the
 * contractor withdrew this link" are different things to tell a client, and a
 * bare 404 tells them neither.
 */
export function shareRefusal(share: PlanShare, now: Date): ShareRefusal | null {
  if (share.revokedAt !== null) return 'revoked'
  if (share.expiresAt.getTime() <= now.getTime()) return 'expired'
  return null
}

export const shareIsOpen = (share: PlanShare, now: Date): boolean =>
  shareRefusal(share, now) === null

export function revokeShare(share: PlanShare, now: Date): Result<PlanShare, DomainError> {
  if (share.revokedAt !== null) {
    return err(forbiddenError('SHARE_ALREADY_REVOKED', 'That link was already withdrawn'))
  }
  return ok({ ...share, revokedAt: now })
}

/** A room as a visitor sees it: a shape, a name, an area. No ids, no money. */
export interface PublicRoom {
  name: string
  typeCode: string | null
  areaMm2: number
  polygon: { x: number; y: number }[]
  ceilingHeightMm: number
}

export interface PublicScene {
  planName: string
  geometry: Pick<PlanGeometry, 'walls' | 'openings' | 'structural'>
  rooms: PublicRoom[]
  totalAreaMm2: number
}

/**
 * What a stranger holding the link may see.
 *
 * REDACTION, not selection. The layers, the background image, the room
 * assignments and every internal id stay behind — a survey photo is somebody
 * else's drawing, a layer named "client thinks this is load-bearing" is not
 * for them, and an id is a probe against the rest of the API.
 *
 * Nothing priced crosses this boundary at all. The 3D viewer knows how to
 * price a finish; a shared viewer must not be given the numbers to do it with.
 */
export function publicScene(
  planName: string,
  geometry: PlanGeometry,
  rooms: readonly RoomBoundary[],
): PublicScene {
  return {
    planName,
    geometry: {
      walls: geometry.walls,
      openings: geometry.openings,
      structural: geometry.structural,
    },
    rooms: rooms.map((room) => ({
      name: room.name,
      typeCode: room.typeCode,
      areaMm2: room.areaMm2,
      polygon: room.polygon,
      ceilingHeightMm: room.ceilingHeightMm,
    })),
    totalAreaMm2: rooms.reduce((total, room) => total + room.areaMm2, 0),
  }
}

/** Counts a visit. Separate from opening the link, so a refusal is not a view. */
export const recordView = (share: PlanShare): PlanShare => ({
  ...share,
  viewCount: share.viewCount + 1,
})
