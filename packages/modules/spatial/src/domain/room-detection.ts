import {
  angleDegrees,
  boundsOfSegment,
  boundsOverlap,
  distance,
  distanceToSegment,
  growBounds,
  lineIntersection,
  pointInPolygon,
  signedArea,
  type Point,
  type Segment,
} from './geometry'
import { wallLengthMm, wallSegment, type Wall } from './wall'

/**
 * Room detection — closed loops from a wall graph. docs/08 §7.4
 *
 * Walls are treated as an undirected planar graph: endpoints become nodes,
 * walls become edges, and the minimal cycles are the rooms. The traversal is
 * the classic planar-face walk — arrive at a node, leave by the next edge
 * CLOCKWISE from the one you came in on — which enumerates every bounded face
 * exactly once, and the unbounded outside exactly once too.
 *
 * Why a graph and not a geometric search: integer millimetres (docs/18
 * ADR-016) make two walls that meet share an EXACTLY equal endpoint, so "is
 * this loop closed" is a question about node identity rather than about
 * tolerances. That is the whole reason the coordinate decision was made, and
 * this file is where it pays.
 *
 * Everything here is pure and synchronous. The Web Worker that docs/08 §7.5
 * requires wraps it; it does not live inside it, because a worker boundary in
 * the middle of an algorithm is untestable.
 */

export interface DetectedRoom {
  /**
   * Stable across geometry edits: the WALLS that bound the room, sorted.
   *
   * Deliberately not the coordinates. Dragging a corner changes every vertex
   * but not which walls enclose the space, so a room keeps its name and type
   * through an edit that merely moves it.
   */
  signature: string
  polygon: Point[]
  /** Always positive — the sign is a traversal artefact, not information. */
  areaMm2: number
  perimeterMm: number
  wallIds: string[]
  /** Rooms enclosed by this one — a shaft or a lightwell in a floor plate. */
  holeIds: string[]
}

export interface DetectionOptions {
  /**
   * How near two endpoints must be to count as the same corner.
   *
   * Five millimetres, which is site tolerance (docs/18 ADR-016). Snapping
   * makes most corners exact; this catches the ones traced from a survey by
   * hand, where a corner drawn twice lands a millimetre or two apart and would
   * otherwise leave the loop open — and an open loop is a room that silently
   * vanishes from the BOQ.
   */
  toleranceMm?: number
  /** Faces smaller than this are traversal noise, not rooms. 0.1 m² default. */
  minAreaMm2?: number
}

const DEFAULT_TOLERANCE_MM = 5
const DEFAULT_MIN_AREA_MM2 = 100_000

interface RoomGraph {
  nodes: Point[]
  edges: { a: number; b: number; wallIds: string[] }[]
}

/**
 * Merges near-coincident endpoints into single nodes.
 *
 * Union-find over a grid of buckets rather than a straight rounding to a grid:
 * rounding puts two points 1 mm apart into different cells whenever they
 * straddle a cell boundary, which is precisely the case this exists to fix.
 * Checking the nine neighbouring buckets keeps it near-linear while staying
 * correct at the seams.
 */
function mergeNodes(
  points: readonly Point[],
  toleranceMm: number,
): { owner: number[]; nodes: Point[] } {
  const parent = points.map((_unused, index) => index)

  const find = (index: number): number => {
    let root = index
    while (parent[root] !== root) root = parent[root] as number
    let walk = index
    while (parent[walk] !== root) {
      const next = parent[walk] as number
      parent[walk] = root
      walk = next
    }
    return root
  }

  const union = (a: number, b: number) => {
    const rootA = find(a)
    const rootB = find(b)
    if (rootA !== rootB) parent[Math.max(rootA, rootB)] = Math.min(rootA, rootB)
  }

  const cell = Math.max(1, toleranceMm)
  const buckets = new Map<string, number[]>()
  const keyOf = (x: number, y: number) => `${Math.floor(x / cell)}:${Math.floor(y / cell)}`

  for (const [index, candidate] of points.entries()) {
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        const neighbours = buckets.get(keyOf(candidate.x + dx * cell, candidate.y + dy * cell))
        if (!neighbours) continue
        for (const other of neighbours) {
          const point = points[other]
          if (point && distance(point, candidate) <= toleranceMm) union(index, other)
        }
      }
    }

    const key = keyOf(candidate.x, candidate.y)
    const bucket = buckets.get(key)
    if (bucket) bucket.push(index)
    else buckets.set(key, [index])
  }

  // The representative's own coordinate becomes the node, so a merged corner
  // sits exactly where one of the walls actually ends rather than at an
  // average that belongs to neither.
  const nodeOf = new Map<number, number>()
  const nodes: Point[] = []
  const owner = points.map((_unused, index) => {
    const root = find(index)
    const existing = nodeOf.get(root)
    if (existing !== undefined) return existing

    const created = nodes.length
    nodes.push(points[root] as Point)
    nodeOf.set(root, created)
    return created
  })

  return { owner, nodes }
}

/**
 * Where two wall segments genuinely cross, as opposed to meeting at an end.
 *
 * `lineIntersection` answers for the infinite lines, so the point is then
 * checked against both segments — a clamped distance of zero means it lies
 * between the ends rather than off in the extension.
 */
function segmentCrossing(a: Segment, b: Segment, toleranceMm: number): Point | null {
  if (!boundsOverlap(growBounds(boundsOfSegment(a), toleranceMm), boundsOfSegment(b))) return null

  const crossing = lineIntersection(a, b)
  if (!crossing) return null
  if (distanceToSegment(a, crossing) > toleranceMm) return null
  if (distanceToSegment(b, crossing) > toleranceMm) return null
  return crossing
}

/**
 * Every point that must become a node: the wall ends, plus wherever two walls
 * cross away from their ends.
 *
 * Without the crossings, an X-junction is invisible to the walk — the two
 * walls pass through each other without sharing a node, and four rooms come
 * back as none.
 */
function nodePoints(walls: readonly Wall[], toleranceMm: number): Point[] {
  const points = walls.flatMap((wall) => [wall.start, wall.end])

  for (let i = 0; i < walls.length; i += 1) {
    for (let j = i + 1; j < walls.length; j += 1) {
      const first = walls[i]
      const second = walls[j]
      if (!first || !second) continue

      const crossing = segmentCrossing(wallSegment(first), wallSegment(second), toleranceMm)
      if (crossing) points.push(crossing)
    }
  }
  return points
}

/**
 * The planar graph of a plan.
 *
 * The step that matters is SPLITTING: a partition drawn to the middle of a
 * wall shares no endpoint with it, so without splitting that wall at the
 * junction the two sides of the partition are not enclosed by anything and the
 * plan detects no rooms at all. A T-junction is how people actually draw, so
 * this is not an edge case — it is the common case, and getting it wrong
 * produces no error anywhere, just a missing room on a document a client signs.
 */
function buildGraph(walls: readonly Wall[], toleranceMm: number): RoomGraph {
  const points = nodePoints(walls, toleranceMm)
  const { owner, nodes } = mergeNodes(points, toleranceMm)

  const edges = new Map<string, { a: number; b: number; wallIds: string[] }>()
  const add = (a: number, b: number, wallId: string) => {
    // A wall whose ends merged is shorter than the tolerance: it is a corner,
    // not an edge, and keeping it would create a self-loop the walk cannot
    // leave.
    if (a === b) return

    const key = a < b ? `${a}:${b}` : `${b}:${a}`
    const existing = edges.get(key)
    // Two walls between the same corners are one edge topologically. Both ids
    // are kept, so deleting either still points at the right room.
    if (existing) {
      if (!existing.wallIds.includes(wallId)) existing.wallIds.push(wallId)
      return
    }
    edges.set(key, { a: Math.min(a, b), b: Math.max(a, b), wallIds: [wallId] })
  }

  for (const [index, wall] of walls.entries()) {
    const segment = wallSegment(wall)
    const start = owner[index * 2] as number
    const end = owner[index * 2 + 1] as number

    // Every node ON this wall becomes a break in it, ordered from its start.
    const along = nodes
      .map((node, id) => ({ id, node }))
      .filter(
        (candidate) =>
          candidate.id !== start &&
          candidate.id !== end &&
          distanceToSegment(segment, candidate.node) <= toleranceMm,
      )
      .map((candidate) => ({ id: candidate.id, at: distance(wall.start, candidate.node) }))
      .sort((left, right) => left.at - right.at)

    let previous = start
    for (const split of along) {
      add(previous, split.id, wall.id)
      previous = split.id
    }
    add(previous, end, wall.id)
  }

  return { nodes, edges: [...edges.values()] }
}

const halfEdgeKey = (from: number, to: number) => `${from}>${to}`

/**
 * Enumerates every face of the graph, bounded and unbounded alike.
 *
 * At each node the walk takes the edge immediately CLOCKWISE from the reverse
 * of the one it arrived on, which is what keeps a face minimal — the greedy
 * turn never cuts across the interior. Dangling walls are traversed in both
 * directions within the same face and contribute nothing to its area, so a
 * stub sticking into a room neither breaks detection nor changes the answer.
 */
function traceFaces(graph: RoomGraph): { cycle: number[]; edges: number[] }[] {
  const incidents: { to: number; edge: number; angle: number }[][] = graph.nodes.map(() => [])

  for (const [index, edge] of graph.edges.entries()) {
    const a = graph.nodes[edge.a] as Point
    const b = graph.nodes[edge.b] as Point
    incidents[edge.a]?.push({ to: edge.b, edge: index, angle: angleDegrees(a, b) })
    incidents[edge.b]?.push({ to: edge.a, edge: index, angle: angleDegrees(b, a) })
  }
  for (const list of incidents) list.sort((left, right) => left.angle - right.angle)

  const slot = new Map<string, number>()
  for (const [node, list] of incidents.entries()) {
    for (const [position, incident] of list.entries()) {
      slot.set(halfEdgeKey(node, incident.to), position)
    }
  }

  const visited = new Set<string>()
  const faces: { cycle: number[]; edges: number[] }[] = []

  for (const [index, edge] of graph.edges.entries()) {
    for (const [from, to] of [
      [edge.a, edge.b],
      [edge.b, edge.a],
    ] as const) {
      if (visited.has(halfEdgeKey(from, to))) continue

      const cycle: number[] = []
      const edgeIds: number[] = []
      let current = from
      let next = to
      let guard = graph.edges.length * 2 + 1

      while (!visited.has(halfEdgeKey(current, next)) && guard > 0) {
        guard -= 1
        visited.add(halfEdgeKey(current, next))
        cycle.push(current)

        const list = incidents[next]
        const back = slot.get(halfEdgeKey(next, current))
        if (!list || back === undefined) break

        // One step anticlockwise in the sorted order is one step CLOCKWISE on
        // the drawing, because plan Y runs downward.
        const following = list[(back - 1 + list.length) % list.length]
        if (!following) break

        edgeIds.push(following.edge)
        current = next
        next = following.to
      }

      if (cycle.length >= 3) faces.push({ cycle, edges: [index, ...edgeIds] })
    }
  }

  return faces
}

/**
 * The rooms a set of walls encloses.
 *
 * The unbounded face is discarded by its SIGN: the clockwise walk traverses
 * bounded faces one way round and the outside the other, and with plan Y
 * running downward the bounded ones come out POSITIVE under the shoelace.
 *
 * Discarding by size instead would be wrong the moment a plan held a single
 * room, whose outer face has exactly the same area as its inside — which is
 * also why no test with one room can prove this line is right. The partition
 * and room-in-room cases are the ones that can.
 */
export function detectRooms(
  walls: readonly Wall[],
  options: DetectionOptions = {},
): DetectedRoom[] {
  const toleranceMm = options.toleranceMm ?? DEFAULT_TOLERANCE_MM
  const minAreaMm2 = options.minAreaMm2 ?? DEFAULT_MIN_AREA_MM2

  const graph = buildGraph(walls, toleranceMm)
  if (graph.edges.length < 3) return []

  const rooms: DetectedRoom[] = []
  for (const face of traceFaces(graph)) {
    const polygon = face.cycle.map((node) => graph.nodes[node] as Point)
    const area = signedArea(polygon)
    if (area <= 0 || area < minAreaMm2) continue

    const wallIds = [
      ...new Set(face.edges.flatMap((edge) => graph.edges[edge]?.wallIds ?? [])),
    ].sort()

    rooms.push({
      signature: wallIds.join('|'),
      polygon,
      areaMm2: Math.abs(area),
      perimeterMm: perimeterOf(polygon),
      wallIds,
      holeIds: [],
    })
  }

  // Largest first: the biggest space is the one a user looks for in a list,
  // and `subtractHoles` needs containers before the things they contain.
  return subtractHoles(rooms.sort((left, right) => right.areaMm2 - left.areaMm2))
}

/**
 * Takes enclosed rooms out of the rooms that enclose them.
 *
 * A shaft standing in the middle of a floor plate is its own closed loop, and
 * the graph cannot see the nesting: the two loops share no wall, so they are
 * separate components and the plate comes back at its GROSS area. Left alone
 * that is a bill for floor tiles across a hole in the floor.
 *
 * The perimeter grows rather than shrinks, because skirting runs around the
 * shaft as well as around the room.
 *
 * Only rooms from different components can nest. Within one component the
 * bounded faces are disjoint by construction, so a partition never subtracts
 * itself from the space it divides.
 */
function subtractHoles(rooms: readonly DetectedRoom[]): DetectedRoom[] {
  return rooms.map((room, index) => {
    const holes = rooms.filter((candidate, other) => {
      if (other === index || candidate.areaMm2 >= room.areaMm2) return false
      // Sharing a wall means they are faces of one component, and siblings.
      if (candidate.wallIds.some((id) => room.wallIds.includes(id))) return false

      const vertex = candidate.polygon[0]
      return vertex ? pointInPolygon(room.polygon, vertex) : false
    })
    if (holes.length === 0) return room

    return {
      ...room,
      areaMm2: holes.reduce((net, hole) => net - hole.areaMm2, room.areaMm2),
      perimeterMm: holes.reduce((total, hole) => total + hole.perimeterMm, room.perimeterMm),
      holeIds: holes.map((hole) => hole.signature),
    }
  })
}

function perimeterOf(polygon: readonly Point[]): number {
  let total = 0
  for (const [index, current] of polygon.entries()) {
    const next = polygon[(index + 1) % polygon.length]
    if (next) total += distance(current, next)
  }
  return Math.round(total)
}

/** The total length of walls in a plan — a sanity figure beside the room areas. */
export const totalWallLengthMm = (walls: readonly Wall[]): number =>
  walls.reduce((total, wall) => total + wallLengthMm(wall), 0)
