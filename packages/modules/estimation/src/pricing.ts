/**
 * Estimation's PURE pricing surface — safe in a browser.
 *
 * The package root exports Prisma repositories alongside the domain, which
 * makes it unimportable from a front end. The 3D viewer needs to price a
 * finish change while somebody is looking at the room (docs/08 §8.3), so the
 * arithmetic gets its own entry point and the persistence stays behind the
 * one that already had it. Same split as `@buildflow/spatial/infrastructure`,
 * from the other direction.
 */
export {
  FINISH_SURFACES,
  finishDelta,
  quoteFinish,
  surfaceQuantity,
  type FinishDelta,
  type FinishQuote,
  type FinishSpec,
  type FinishSurface,
  type RoomSurfaces,
  type SurfaceLine,
} from './domain/finish-delta'

export { extendRate } from './domain/pricing-math'
