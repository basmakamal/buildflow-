import { detectRooms } from '@buildflow/spatial'
import type { DetectRequest, DetectResponse } from './room-detection-client'

/**
 * Room detection, off the main thread. docs/08 §7.4, §7.5
 *
 * "A 600-wall plan must not block the UI thread" — and it would: the face walk
 * is linear, but the crossing pass is quadratic, and a user dragging a wall
 * would feel every millisecond of it as a stutter in the drag.
 *
 * This file is deliberately three lines of logic. Everything worth testing
 * lives in @buildflow/spatial, on the other side of a boundary that cannot be
 * unit tested; putting a decision here would put it out of reach.
 */
self.onmessage = (event: MessageEvent<DetectRequest>) => {
  const { id, walls, toleranceMm } = event.data

  const rooms = detectRooms(walls, toleranceMm === undefined ? {} : { toleranceMm })
  const response: DetectResponse = { id, rooms }

  self.postMessage(response)
}
