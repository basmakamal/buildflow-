import { detectRooms, type DetectedRoom, type Wall } from '@buildflow/spatial'

/**
 * The main thread's side of room detection. docs/08 §7.5
 *
 * One worker for the tab, one promise per request, and — importantly — a
 * SYNCHRONOUS fallback wherever `Worker` does not exist. That is not defensive
 * padding: the test environment has no worker, and a detection path that only
 * runs in a browser is a detection path nobody ever asserts on.
 *
 * Requests carry an id and stale replies are dropped. A user drawing quickly
 * outruns detection constantly, and applying an older result over a newer one
 * would make rooms flicker between two answers.
 */

export interface DetectRequest {
  id: number
  walls: Wall[]
  toleranceMm?: number
}

export interface DetectResponse {
  id: number
  rooms: DetectedRoom[]
}

let worker: Worker | null = null
let sequence = 0
const pending = new Map<number, (rooms: DetectedRoom[]) => void>()

function ensureWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null
  if (worker) return worker

  try {
    worker = new Worker(new URL('./room-detection.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<DetectResponse>) => {
      const resolve = pending.get(event.data.id)
      if (!resolve) return
      pending.delete(event.data.id)
      resolve(event.data.rooms)
    }
    // A worker that fails to start must not take detection down with it: every
    // waiting caller falls back to the main thread rather than hanging.
    worker.onerror = () => {
      for (const [id, resolve] of pending) {
        pending.delete(id)
        resolve([])
      }
      worker = null
    }
  } catch {
    worker = null
  }
  return worker
}

export function detectRoomsInWorker(
  walls: readonly Wall[],
  options: { toleranceMm?: number } = {},
): Promise<DetectedRoom[]> {
  const active = ensureWorker()
  if (!active) {
    return Promise.resolve(
      detectRooms(
        walls,
        options.toleranceMm === undefined ? {} : { toleranceMm: options.toleranceMm },
      ),
    )
  }

  sequence += 1
  const id = sequence

  return new Promise<DetectedRoom[]>((resolve) => {
    pending.set(id, resolve)
    const request: DetectRequest = {
      id,
      // Structured-cloned across the boundary, so the walls must be plain data.
      // They are: a Wall is points and numbers, by design. docs/18 ADR-016
      walls: walls.map((wall) => ({ ...wall })),
      ...(options.toleranceMm === undefined ? {} : { toleranceMm: options.toleranceMm }),
    }
    active.postMessage(request)
  })
}

/** Tears the worker down — called when the planner unmounts. */
export function stopRoomDetection(): void {
  worker?.terminate()
  worker = null
  pending.clear()
}
