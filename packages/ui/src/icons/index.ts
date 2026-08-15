import type { IconDef, IconGroup } from './types'
import { stageIcons } from './stages'
import { electricalIcons } from './electrical'
import { lightingIcons } from './lighting'
import { ceilingIcons } from './ceiling'
import { furnitureIcons } from './furniture'

export type { IconDef, IconGroup, IconCategory } from './types'
export { default as BfIcon } from './BfIcon.vue'
export { toneFor, toneColorVar, toneTintVar, type IconTone } from './tones'
export { stageIcons, electricalIcons, lightingIcons, ceilingIcons, furnitureIcons }

/**
 * Grouped registry — drives the icon picker and the design-review gallery.
 *
 * Each group carries bilingual labels because the picker is used by Arabic-
 * speaking estimators choosing an icon for a BOQ line, not only by developers.
 */
export const iconGroups: IconGroup[] = [
  {
    category: 'stage',
    labelEn: 'Finishing stages',
    labelAr: 'مراحل التشطيب',
    icons: Object.values(stageIcons),
  },
  {
    category: 'electrical',
    labelEn: 'Electrical',
    labelAr: 'الكهرباء',
    icons: Object.values(electricalIcons),
  },
  {
    category: 'lighting',
    labelEn: 'Lighting',
    labelAr: 'الإنارة',
    icons: Object.values(lightingIcons),
  },
  {
    category: 'ceiling',
    labelEn: 'Ceilings & gypsum',
    labelAr: 'الأسقف والجبس',
    icons: Object.values(ceilingIcons),
  },
  {
    category: 'furniture',
    labelEn: 'Furniture & furnishings',
    labelAr: 'العفش والمفروشات',
    icons: Object.values(furnitureIcons),
  },
]

/**
 * Flat lookup by stable name. Catalogue rows, BOQ lines, and workflow stage
 * templates persist the icon NAME, so this map is the resolution point and the
 * names in it must never change once shipped.
 */
export const iconRegistry: ReadonlyMap<string, IconDef> = new Map(
  iconGroups.flatMap((g) => g.icons.map((i) => [i.name, i] as const)),
)

/** Resolve by persisted name. Returns undefined rather than throwing so a
 *  renamed or removed icon degrades to a fallback instead of blanking a screen. */
export const getIcon = (name: string): IconDef | undefined => iconRegistry.get(name)

/** Bilingual search for the icon picker. Matches name, both labels, and keywords. */
export function searchIcons(query: string): IconDef[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...iconRegistry.values()]
  return [...iconRegistry.values()].filter(
    (i) =>
      i.name.includes(q) ||
      i.labelEn.toLowerCase().includes(q) ||
      i.labelAr.includes(q) ||
      (i.keywords?.some((k) => k.toLowerCase().includes(q)) ?? false),
  )
}

export const iconCount = iconRegistry.size
