import type { BoqSnapshot } from './boq'

/**
 * Version diff — what changed between two BOQs of the same unit, in the terms
 * a reviewer argues about: lines that appeared, vanished, or moved in
 * quantity/rate/total, plus the headline totals delta. docs/04 §2.7
 *
 * Lines are matched by IDENTITY-IN-THE-DOCUMENT: section code + work item +
 * room. Ids are useless across versions (a new version mints new ids), and
 * descriptions are prose. Duplicate identities within one version are
 * disambiguated by occurrence order, so a diff never silently drops a line.
 */

export interface LineRef {
  sectionCode: string
  workItemCode: string
  roomId: string | null
}

export interface LineDelta extends LineRef {
  before: { quantityWithWaste: string; lineTotal: string; isOverridden: boolean }
  after: { quantityWithWaste: string; lineTotal: string; isOverridden: boolean }
}

export interface LineFact extends LineRef {
  quantityWithWaste: string
  lineTotal: string
}

export interface BoqDiff {
  from: { boqId: string; versionNumber: number }
  to: { boqId: string; versionNumber: number }
  added: LineFact[]
  removed: LineFact[]
  changed: LineDelta[]
  totals: {
    before: { subtotal: string; grandTotal: string }
    after: { subtotal: string; grandTotal: string }
  }
}

interface Keyed {
  ref: LineRef
  quantityWithWaste: string
  lineTotal: string
  materialRate: string
  labourRate: string
  equipmentRate: string
  isOverridden: boolean
}

function keyedLines(snapshot: BoqSnapshot): Map<string, Keyed> {
  const sectionCodes = new Map(snapshot.sections.map((section) => [section.id, section.code]))
  const occurrences = new Map<string, number>()
  const result = new Map<string, Keyed>()
  for (const line of snapshot.lines) {
    const ref: LineRef = {
      sectionCode: sectionCodes.get(line.sectionId) ?? line.sectionId,
      workItemCode: line.workItemCode,
      roomId: line.roomId,
    }
    const base = `${ref.sectionCode}|${ref.workItemCode}|${ref.roomId ?? ''}`
    const occurrence = occurrences.get(base) ?? 0
    occurrences.set(base, occurrence + 1)
    result.set(`${base}|${String(occurrence)}`, {
      ref,
      quantityWithWaste: line.quantityWithWaste,
      lineTotal: line.lineTotal,
      materialRate: line.materialRate,
      labourRate: line.labourRate,
      equipmentRate: line.equipmentRate,
      isOverridden: line.isOverridden,
    })
  }
  return result
}

export function diffBoqs(from: BoqSnapshot, to: BoqSnapshot): BoqDiff {
  const before = keyedLines(from)
  const after = keyedLines(to)

  const added: LineFact[] = []
  const removed: LineFact[] = []
  const changed: LineDelta[] = []

  for (const [key, line] of after) {
    const counterpart = before.get(key)
    if (!counterpart) {
      added.push({
        ...line.ref,
        quantityWithWaste: line.quantityWithWaste,
        lineTotal: line.lineTotal,
      })
      continue
    }
    const moved =
      counterpart.quantityWithWaste !== line.quantityWithWaste ||
      counterpart.lineTotal !== line.lineTotal ||
      counterpart.materialRate !== line.materialRate ||
      counterpart.labourRate !== line.labourRate ||
      counterpart.equipmentRate !== line.equipmentRate ||
      counterpart.isOverridden !== line.isOverridden
    if (moved) {
      changed.push({
        ...line.ref,
        before: {
          quantityWithWaste: counterpart.quantityWithWaste,
          lineTotal: counterpart.lineTotal,
          isOverridden: counterpart.isOverridden,
        },
        after: {
          quantityWithWaste: line.quantityWithWaste,
          lineTotal: line.lineTotal,
          isOverridden: line.isOverridden,
        },
      })
    }
  }
  for (const [key, line] of before) {
    if (!after.has(key)) {
      removed.push({
        ...line.ref,
        quantityWithWaste: line.quantityWithWaste,
        lineTotal: line.lineTotal,
      })
    }
  }

  return {
    from: { boqId: String(from.id), versionNumber: from.versionNumber },
    to: { boqId: String(to.id), versionNumber: to.versionNumber },
    added,
    removed,
    changed,
    totals: {
      before: { subtotal: from.subtotal, grandTotal: from.grandTotal },
      after: { subtotal: to.subtotal, grandTotal: to.grandTotal },
    },
  }
}
