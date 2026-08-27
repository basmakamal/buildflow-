/**
 * Spatial module — PUBLIC CONTRACT. docs/03 §6.1
 *
 * The planner's pure core: plan geometry in integer millimetres (docs/18
 * ADR-016), the viewport transform, the snapping pipeline, selection, and
 * patch-based history. No Konva, no Vue, no I/O — the canvas is a renderer
 * for what this computes, and every rule here is testable in milliseconds.
 *
 * Phase 5 sprints 1–4. docs/08 §7
 */
export {
  mm,
  point,
  samePoint,
  distance,
  distanceSquared,
  midpoint,
  angleDegrees,
  pointAtAngle,
  closestPointOnSegment,
  distanceToSegment,
  projectOntoLine,
  distanceToLine,
  lineIntersection,
  boundsOf,
  boundsOfSegment,
  boundsOverlap,
  boundsContain,
  boundsContainPoint,
  boundsFromCorners,
  growBounds,
  unionBounds,
  signedArea,
  pointInPolygon,
  polygonCentroid,
  polygonPerimeterMm,
  squareMmToSquareMetres,
  mmToMetres,
  metresToMm,
  type Point,
  type Segment,
  type Bounds,
} from './domain/geometry'

export {
  DEFAULT_VIEWPORT,
  MIN_SCALE,
  MAX_SCALE,
  clampScale,
  toScreen,
  toWorld,
  pan,
  zoomAt,
  fitToBounds,
  visibleBounds,
  pxToMm,
  gridStepMm,
  type Viewport,
  type ScreenSize,
} from './domain/viewport'

export {
  DEFAULT_SNAP_CONFIG,
  SNAP_KINDS,
  snap,
  snapToGrid,
  snapToAngle,
  snapLength,
  ambientCandidates,
  resolveSnap,
  type SnapConfig,
  type SnapCandidate,
  type SnapKind,
  type SnapResult,
} from './domain/snapping'

export {
  applySelection,
  marqueeHits,
  selectionBounds,
  hitTest,
  type SelectionMode,
  type Selectable,
} from './domain/selection'

export {
  HISTORY_LIMIT,
  emptyHistory,
  record,
  undo,
  redo,
  canUndo,
  canRedo,
  nextUndoLabel,
  nextRedoLabel,
  type History,
  type HistoryEntry,
  type Step,
} from './domain/history'

export {
  DEFAULT_LAYER,
  DEFAULT_WALL_HEIGHT_MM,
  DEFAULT_WALL_THICKNESS_MM,
  MIN_WALL_LENGTH_MM,
  createWall,
  hitTestWalls,
  moveWallEnd,
  reangleWall,
  resizeWall,
  translateWall,
  wallAngleDeg,
  wallBounds,
  wallEndpoints,
  wallHit,
  wallLengthMm,
  wallMidpoint,
  wallPolygon,
  wallSegment,
  type Wall,
  type WallEnd,
  type WallInput,
} from './domain/wall'

export { SpatialIndex, resolveHits, type Indexable } from './domain/spatial-index'

export { SNAP_TOLERANCE_PX, wallSnapCandidates, type WallSnapOptions } from './domain/wall-snapping'

/**
 * Re-exported so a consumer can type a wall edit's failure without depending
 * on the shared kernel directly. The Result these functions return is only
 * useful to someone who can name its error.
 */
export type { DomainError, Result } from '@buildflow/core'

export {
  DEFAULT_DOOR_HEIGHT_MM,
  DEFAULT_DOOR_WIDTH_MM,
  DEFAULT_WINDOW_HEIGHT_MM,
  DEFAULT_WINDOW_SILL_MM,
  DEFAULT_WINDOW_WIDTH_MM,
  MIN_OPENING_WIDTH_MM,
  centreOpeningAt,
  createOpening,
  moveOpening,
  openingBounds,
  openingCentre,
  openingCentreMm,
  openingHit,
  openingPolygon,
  openingRangeMm,
  openingSegment,
  openingsOn,
  openingsOverlap,
  resizeOpening,
  type Opening,
  type OpeningInput,
  type OpeningKind,
} from './domain/opening'

export {
  DEFAULT_BEAM_DEPTH_MM,
  DEFAULT_BEAM_WIDTH_MM,
  DEFAULT_COLUMN_HEIGHT_MM,
  DEFAULT_COLUMN_SIZE_MM,
  MIN_BEAM_LENGTH_MM,
  MIN_SECTION_MM,
  alignColumnTo,
  beamAngleDeg,
  beamEndAt,
  beamLengthMm,
  beamSegment,
  createBeam,
  createColumn,
  hitTestStructural,
  isBeam,
  rotateColumn,
  structuralBounds,
  structuralCentre,
  structuralHit,
  structuralPolygon,
  translateStructural,
  type BeamInput,
  type ColumnInput,
  type PointElement,
  type PointKind,
  type SpanElement,
  type StructuralElement,
  type StructuralKind,
} from './domain/structural'

export {
  EXISTING_LAYER,
  STRUCTURE_LAYER,
  addLayer,
  defaultLayers,
  findLayer,
  isLocked,
  isSelectable,
  isVisible,
  onSelectableLayers,
  onVisibleLayers,
  setLayer,
  toggleLocked,
  toggleVisible,
  type Layered,
  type PlanLayer,
} from './domain/layers'

export {
  DEFAULT_BACKGROUND_OPACITY,
  UNCALIBRATED_MM_PER_PIXEL,
  backgroundBounds,
  backgroundScaleLabel,
  calibrateBackground,
  createBackground,
  imageToPlan,
  moveBackground,
  planToImage,
  rotateBackground,
  setBackgroundLocked,
  setBackgroundOpacity,
  type Background,
  type BackgroundInput,
} from './domain/background'

export {
  detectRooms,
  totalWallLengthMm,
  type DetectedRoom,
  type DetectionOptions,
} from './domain/room-detection'

export {
  DEFAULT_CEILING_HEIGHT_MM,
  reconcileRooms,
  roomAt,
  roomMetrics,
  totalFloorAreaMm2,
  unassignedRooms,
  roomIdFor,
  type ReconcileOptions,
  type RoomAssignment,
  type RoomBoundary,
  type RoomMetrics,
} from './domain/room'

export {
  LOCK_TTL_MS,
  acquireLock,
  canEdit,
  createRevision,
  emptyGeometry,
  geometrySize,
  lockHolder,
  lockIsLive,
  noLock,
  releaseLock,
  restoreRevision,
  savePlan,
  type FloorPlan,
  type LockRequest,
  type PlanGeometry,
  type PlanLock,
  type PlanRevision,
  type PlanStatus,
  type RevisionRequest,
  type SaveRequest,
} from './domain/plan'

export {
  DEFAULT_DPI,
  DEFAULT_MARGIN_MM,
  SCALE_RATIOS,
  exportFileName,
  exportLayout,
  titleBlock,
  type ExportLayout,
  type ExportRequest,
  type Orientation,
  type PaperSize,
  type ScaleRatio,
  type TitleBlock,
} from './domain/plan-export'

export {
  extrudePlan,
  solidCount,
  wallPanels,
  type BoxSolid,
  type ExtrudeOptions,
  type SceneModel,
  type SlabKind,
  type SlabSolid,
  type SolidKind,
  type Vec2,
  type Vec3,
} from './domain/extrusion'

export {
  DEFAULT_SHARE_DAYS,
  MAX_SHARE_DAYS,
  createShare,
  publicScene,
  recordView,
  revokeShare,
  shareIsOpen,
  shareRefusal,
  type PlanShare,
  type PublicRoom,
  type PublicScene,
  type ShareRefusal,
  type ShareRequest,
} from './domain/share'
