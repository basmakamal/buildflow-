import {
  type DomainError,
  type Result,
  type CurrencyCode,
  type UnitOfMeasure,
  Money,
  Quantity,
  err,
  ok,
  validationError,
} from '@buildflow/core'
import { extendRate } from './pricing-math'

/**
 * What a finish change costs. docs/16 Phase 5 sprint 10, docs/08 §8.3
 *
 * The point of the whole 3D module: "the viewer is a pricing interface wearing
 * a visualisation costume". A client picking a nicer tile is making a purchase
 * decision, and the only honest way to present it is to show what it does to
 * the number at the bottom — while they are still looking at the room.
 *
 * The quantities are docs/02 §3.7's rules, not new arithmetic:
 *
 *   floor    = floorArea   × (1 + waste)
 *   wall     = wallArea    × coats × (1 + waste)
 *   ceiling  = ceilingArea × (1 + waste)
 *   skirting = perimeter − Σ door widths, × (1 + waste)
 *
 * A DELTA and not a re-quote. Re-pricing the whole BOQ to show the effect of
 * one tile would take a second and hide the answer inside a total; the
 * difference between two finishes over the affected rooms is the same number,
 * arrives instantly, and is what the person is actually asking.
 */

export type FinishSurface = 'floor' | 'wall' | 'ceiling' | 'skirting'

export const FINISH_SURFACES: FinishSurface[] = ['floor', 'wall', 'ceiling', 'skirting']

/** The uom each surface is measured and priced in. */
const SURFACE_UOM: Record<FinishSurface, UnitOfMeasure> = {
  floor: 'm2',
  wall: 'm2',
  ceiling: 'm2',
  skirting: 'm',
}

/**
 * One room's measured surfaces, as 4-dp decimal strings.
 *
 * Strings rather than numbers, like everywhere else money is downstream: these
 * come from integer millimetres and end up multiplied by a rate, and a float
 * in the middle of that chain is how a total ends in `.9999999`.
 */
export interface RoomSurfaces {
  roomId: string
  name: string
  floorAreaM2: string
  wallAreaM2: string
  ceilingAreaM2: string
  skirtingM: string
}

export interface FinishSpec {
  materialId: string
  name: string
  /** Per-uom rate in the quote's currency, 4 dp. */
  rate: string
  /** Percent, as `Quantity.withWaste` reads it: '5' is five per cent. */
  wasteFactor: string
  /**
   * Coats, for a surface that is painted rather than covered. One by default —
   * a tile is not applied twice, and a rule that assumed otherwise would
   * double every floor in the building.
   */
  coats?: string
}

export interface SurfaceLine {
  roomId: string
  roomName: string
  quantity: string
  uom: UnitOfMeasure
  amount: Money
}

export interface FinishQuote {
  surface: FinishSurface
  finish: FinishSpec
  lines: SurfaceLine[]
  total: Money
}

export interface FinishDelta {
  surface: FinishSurface
  before: FinishQuote
  after: FinishQuote
  /** Positive means the change costs more. */
  delta: Money
  /** Signed, 2 dp, or null when the baseline is zero and a ratio is meaningless. */
  percent: string | null
}

const measurementOf = (room: RoomSurfaces, surface: FinishSurface): string => {
  if (surface === 'floor') return room.floorAreaM2
  if (surface === 'wall') return room.wallAreaM2
  if (surface === 'ceiling') return room.ceilingAreaM2
  return room.skirtingM
}

/**
 * The quantity one room contributes, waste and coats included.
 *
 * Coats multiply BEFORE waste, because waste is a proportion of what is
 * actually applied — two coats of paint waste twice as much as one.
 */
export function surfaceQuantity(
  room: RoomSurfaces,
  surface: FinishSurface,
  finish: FinishSpec,
): Result<Quantity, DomainError> {
  const measured = Quantity.from(measurementOf(room, surface), SURFACE_UOM[surface])
  if (measured.isErr()) return measured

  if (finish.coats === undefined) return measured.value.withWaste(finish.wasteFactor)

  const coated = measured.value.multiply(finish.coats)
  if (coated.isErr()) return coated
  return coated.value.withWaste(finish.wasteFactor)
}

/** Prices one finish across the rooms it applies to. */
export function quoteFinish(
  rooms: readonly RoomSurfaces[],
  surface: FinishSurface,
  finish: FinishSpec,
  currency: string,
): Result<FinishQuote, DomainError> {
  const code = currency as CurrencyCode
  const lines: SurfaceLine[] = []
  let total = Money.zero(code)

  for (const room of rooms) {
    const quantity = surfaceQuantity(room, surface, finish)
    if (quantity.isErr()) return err(quantity.error)

    const amount = extendRate(quantity.value.toDecimal(), finish.rate, currency)
    if (amount.isErr()) return err(amount.error)

    lines.push({
      roomId: room.roomId,
      roomName: room.name,
      quantity: quantity.value.toDecimal(),
      uom: SURFACE_UOM[surface],
      amount: amount.value,
    })
    total = total.add(amount.value)
  }

  return ok({ surface, finish, lines, total })
}

/**
 * The difference between two finishes over the same rooms.
 *
 * Both sides are quoted over the SAME room list, so the delta is genuinely
 * attributable to the material change and not to a difference in what was
 * counted — which is the failure that makes a client stop trusting the number.
 */
export function finishDelta(
  rooms: readonly RoomSurfaces[],
  surface: FinishSurface,
  current: FinishSpec,
  candidate: FinishSpec,
  currency: string,
): Result<FinishDelta, DomainError> {
  if (rooms.length === 0) {
    return err(validationError('FINISH_NO_ROOMS', 'There are no rooms to apply this finish to'))
  }

  const before = quoteFinish(rooms, surface, current, currency)
  // Re-wrapped rather than returned: an `Err` carries its value type, so an
  // `Err<FinishQuote>` is not an `Err<FinishDelta>` however identical it looks.
  if (before.isErr()) return err(before.error)

  const after = quoteFinish(rooms, surface, candidate, currency)
  if (after.isErr()) return err(after.error)

  const delta = after.value.total.subtract(before.value.total)

  return ok({
    surface,
    before: before.value,
    after: after.value,
    delta,
    percent: percentChange(before.value.total, delta),
  })
}

/**
 * The change as a percentage of what it replaces.
 *
 * Null rather than infinity when the baseline is zero: "+∞ %" against a finish
 * that cost nothing is not information, and a client reading it would assume a
 * fault rather than a free baseline.
 */
function percentChange(baseline: Money, delta: Money): string | null {
  const base = baseline.minor
  if (base === 0n) return null

  // Two decimal places, in integers: `10_000` is 100 for the percentage and
  // another 100 for the two places, so no float ever touches the figure.
  const numerator = delta.minor * 10_000n
  const negative = numerator < 0n !== base < 0n
  const magnitude = numerator < 0n ? -numerator : numerator
  const divisor = base < 0n ? -base : base

  // Rounded half AWAY FROM ZERO, like `mm`, `Money` and `Quantity` — a figure
  // a person can predict beats one that depends on which way the truncation
  // happened to fall.
  const rounded = (magnitude + divisor / 2n) / divisor

  const whole = rounded / 100n
  const fraction = rounded % 100n
  return `${negative ? '-' : ''}${whole}.${String(fraction).padStart(2, '0')}`
}
