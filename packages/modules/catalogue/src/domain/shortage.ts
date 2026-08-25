/**
 * Shortage detection — the Phase 3 deliverable that had to wait for Phase 4.
 * docs/02 §3.9 (`StockShortageDetected`), docs/16 Phase 3 sprint 8
 *
 * The question a site actually asks is not "did we buy everything" but
 * "will we run out before we finish". Those differ whenever material has been
 * wasted, returned, or transferred, which is most of the time:
 *
 *   stillNeeded = planned − used      what the plan still expects to consume
 *   available   = remaining           what is physically on site
 *   shortfall   = stillNeeded − available     when positive, a shortage
 *
 * A shortage computed as planned − purchased would call a job short after
 * every breakage even though the replacement is already on site, and would
 * call it fine when half the delivery was returned. This formulation is the
 * one a foreman would recognise.
 *
 * Pure arithmetic over scaled integers, the same 4-dp discipline as the
 * ledger fold it reads from.
 */

export interface BalanceFacts {
  unitId: string
  unitStageId: string | null
  materialId: string
  uom: string
  /** 4-dp decimal strings, as the projection stores them. */
  plannedQuantity: string
  usedQuantity: string
  remainingQuantity: string
}

export interface Shortage {
  unitId: string
  unitStageId: string | null
  materialId: string
  uom: string
  stillNeeded: string
  available: string
  shortfall: string
}

const toScaled = (decimal: string): bigint => {
  const [whole = '0', fraction = ''] = decimal.split('.')
  const negative = whole.startsWith('-')
  const digits = (negative ? whole.slice(1) : whole) + fraction.padEnd(4, '0').slice(0, 4)
  const value = BigInt(digits)
  return negative ? -value : value
}

const fromScaled = (scaled: bigint): string => {
  const negative = scaled < 0n
  const digits = (negative ? -scaled : scaled).toString().padStart(5, '0')
  return `${negative ? '-' : ''}${digits.slice(0, -4)}.${digits.slice(-4)}`
}

/**
 * The shortfall for one balance row, or null when there is none.
 *
 * A scope with no plan returns null rather than a shortage: nobody promised
 * anything, so nothing is missing. Reporting unplanned material as "short"
 * would bury the real shortages under every ad-hoc purchase on site.
 */
export function shortageOf(balance: BalanceFacts): Shortage | null {
  const planned = toScaled(balance.plannedQuantity)
  if (planned <= 0n) return null

  const stillNeeded = planned - toScaled(balance.usedQuantity)
  // The plan is fully consumed — over-consumption is the ledger's business,
  // not a shortage of anything still to come.
  if (stillNeeded <= 0n) return null

  const available = toScaled(balance.remainingQuantity)
  const shortfall = stillNeeded - available
  if (shortfall <= 0n) return null

  return {
    unitId: balance.unitId,
    unitStageId: balance.unitStageId,
    materialId: balance.materialId,
    uom: balance.uom,
    stillNeeded: fromScaled(stillNeeded),
    available: fromScaled(available),
    shortfall: fromScaled(shortfall),
  }
}

/** Every shortage across a set of balances, worst shortfall first. */
export function detectShortages(balances: readonly BalanceFacts[]): Shortage[] {
  const shortages: Shortage[] = []
  for (const balance of balances) {
    const shortage = shortageOf(balance)
    if (shortage) shortages.push(shortage)
  }
  return shortages.sort((a, b) => (toScaled(b.shortfall) > toScaled(a.shortfall) ? 1 : -1))
}
