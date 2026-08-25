import type { PackageElement, PackageItem } from './finishing-package'

/**
 * The pure planner: a package plus a unit's rooms → what should be quantified.
 * docs/16 Phase 4 — "a BOQ for a 250 m² unit in under 5 seconds, every line
 * showing its formula".
 *
 * This file decides WHAT to compute and with which inputs; evaluating the
 * rules and pricing the results happens in the application layer, which owns
 * the tenant's rule catalogue and rate card. Keeping the matching pure is what
 * makes "why did my BOQ get 14 skirting lines" answerable in a unit test.
 */

export interface RoomFacts {
  id: string
  typeCode: string
  nameEn: string
  /** m², 4 dp. */
  floorArea: string
  wallArea: string
  ceilingArea: string
  /** m, 4 dp. */
  perimeter: string
  /** mm — converted to metres for rule inputs. */
  heightMm: number
}

export interface LinePlan {
  item: PackageItem
  room: RoomFacts
  /**
   * The inputs the rule will read: room geometry keyed off the item's ELEMENT,
   * with the item's authored constants layered on top. An authored value wins,
   * so a package can override a geometry fact deliberately (a dropped ceiling
   * smaller than the floor) without a new element.
   */
  inputs: Record<string, string>
}

/**
 * Which geometry fact feeds `area_m2` for each element — the crux of
 * generation. A floor rule and a wall rule both declare `area_m2`; the ELEMENT
 * is what says which surface that means. Elements absent from this map are
 * count-based (doors, sanitary ware, lighting): they carry a fixed quantity or
 * a rule over authored constants, never a surface.
 */
const AREA_FOR_ELEMENT: Partial<Record<PackageElement, keyof RoomFacts>> = {
  floor: 'floorArea',
  wall: 'wallArea',
  ceiling: 'ceilingArea',
}

const mm4 = (mm: number): string => (mm / 1000).toFixed(4)

/** Every geometry fact a rule may name, before the item's constants. */
export function roomInputs(room: RoomFacts, element: PackageElement): Record<string, string> {
  const areaField = AREA_FOR_ELEMENT[element]
  return {
    // Always available by their specific names…
    floor_area_m2: room.floorArea,
    wall_area_m2: room.wallArea,
    ceiling_area_m2: room.ceilingArea,
    perimeter_m: room.perimeter,
    height_m: mm4(room.heightMm),
    // …plus the element's surface under the generic name the catalogue uses.
    ...(areaField ? { area_m2: room[areaField] as string } : {}),
    // Openings are not modelled until the planner lands (docs/01 ROM-02), and
    // a rule that deducts them must see zero rather than fail: a wall area
    // computed without opening deductions is the honest number today.
    openings_m2: '0',
    door_widths_m: '0',
  }
}

/**
 * Matches items to rooms. An item with a room type applies to every room of
 * that type; an item without one applies to every room in the unit.
 *
 * Ordering is deterministic — item order, then room order — because a BOQ
 * regenerated from the same inputs must produce the same document.
 */
export function planLines(
  items: readonly PackageItem[],
  rooms: readonly RoomFacts[],
  options: { includeOptional: boolean },
): LinePlan[] {
  const plans: LinePlan[] = []
  for (const item of [...items].sort((a, b) => a.sortOrder - b.sortOrder)) {
    if (item.isOptional && !options.includeOptional) continue
    const matching = rooms.filter(
      (room) => item.roomTypeCode === null || room.typeCode === item.roomTypeCode,
    )
    for (const room of matching) {
      plans.push({
        item,
        room,
        inputs: { ...roomInputs(room, item.element), ...(item.ruleInputs ?? {}) },
      })
    }
  }
  return plans
}

/** Section code per element — the BOQ's spine, one section per trade surface. */
export const SECTION_FOR_ELEMENT: Readonly<Record<PackageElement, string>> = {
  floor: 'flooring',
  wall: 'walls',
  ceiling: 'ceilings',
  skirting: 'flooring',
  door: 'joinery',
  window: 'joinery',
  sanitary: 'plumbing',
  kitchen: 'joinery',
  lighting: 'electrical',
  ironmongery: 'joinery',
}

export const SECTION_TITLES: Readonly<Record<string, { en: string; ar: string }>> = {
  flooring: { en: 'Flooring', ar: 'الأرضيات' },
  walls: { en: 'Walls', ar: 'الجدران' },
  ceilings: { en: 'Ceilings', ar: 'الأسقف' },
  joinery: { en: 'Joinery & fittings', ar: 'النجارة والتجهيزات' },
  plumbing: { en: 'Plumbing', ar: 'السباكة' },
  electrical: { en: 'Electrical', ar: 'الكهرباء' },
}
