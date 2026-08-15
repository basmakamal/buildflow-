/**
 * Icon tone resolution.
 *
 * Colour here is SEMANTIC, never decorative. A socket is amber because
 * electrical is amber — the same amber it has on the kanban column, the Gantt
 * bar, the BOQ section header, and the mobile stage card. A user scanning a
 * 147-line bill of quantities finds the electrical section by colour before
 * they read a single word, in either language.
 *
 * Tone is derived from the icon's stable name prefix rather than stored on
 * each definition. That keeps the icon files purely about geometry, and means
 * a new icon is correctly coloured the moment it is named correctly — there is
 * no second place to remember to update.
 */
export type IconTone =
  | 'electrical'
  | 'lighting'
  | 'plumbing'
  | 'hvac'
  | 'ceiling'
  | 'flooring'
  | 'wall'
  | 'joinery'
  | 'furniture'
  | 'neutral'
  | `stage-${string}`

/** Prefix → tone. Order matters only in that prefixes must be unambiguous. */
const PREFIX_TONES: ReadonlyArray<readonly [string, IconTone]> = [
  ['elec-', 'electrical'],
  ['light-', 'lighting'],
  ['plumb-', 'plumbing'],
  ['hvac-', 'hvac'],
  ['ceiling-', 'ceiling'],
  ['floor-', 'flooring'],
  ['wall-', 'wall'],
  ['join-', 'joinery'],
  ['furn-', 'furniture'],
]

/**
 * Stage icons carry the stage's own colour so a stage reads identically
 * everywhere. Mapped explicitly rather than derived, because two stage names
 * do not match their token names (`unit-received` → `received`) and a silent
 * miss would fall back to grey without anyone noticing.
 */
const STAGE_TONES: Readonly<Record<string, string>> = {
  'stage-unit-received': 'received',
  'stage-demolition': 'demolition',
  'stage-plumbing': 'plumbing',
  'stage-electrical': 'electrical',
  'stage-hvac': 'hvac',
  'stage-waterproofing': 'waterproofing',
  'stage-plastering': 'plastering',
  'stage-gypsum': 'gypsum',
  'stage-flooring': 'flooring',
  'stage-painting': 'painting',
  'stage-carpentry': 'carpentry',
  'stage-lighting': 'lighting',
  'stage-cleaning': 'cleaning',
  'stage-delivery': 'delivery',
}

export function toneFor(iconName: string): IconTone {
  const stage = STAGE_TONES[iconName]
  if (stage) return `stage-${stage}`
  for (const [prefix, tone] of PREFIX_TONES) {
    if (iconName.startsWith(prefix)) return tone
  }
  return 'neutral'
}

/**
 * CSS custom property holding the stroke colour for a tone.
 *
 * Stage tones resolve to their `-ink` variant, not the base. The base palette
 * is tuned for filled areas (kanban headers, Gantt bars); at 1.5px stroke width
 * several of those values fall under 2:1 against white and vanish. Ink keeps
 * the same identity above the 3:1 WCAG 1.4.11 threshold. See tokens.css.
 */
export function toneColorVar(tone: IconTone): string {
  return tone.startsWith('stage-') ? `var(--bf-${tone}-ink)` : `var(--bf-tone-${tone})`
}

/**
 * CSS value for the tinted chip backdrop.
 *
 * Stage tints derive from the BASE colour (not the ink) via `color-mix`: the
 * base is the brighter, more recognisable hue and a wash of it reads as the
 * stage's identity, while the darker ink sits on top of it as the stroke.
 *
 * Deriving rather than hand-authoring 14 more values is deliberate — the two
 * places this palette was duplicated had already drifted apart once.
 */
export function toneTintVar(tone: IconTone): string {
  return tone.startsWith('stage-')
    ? `color-mix(in srgb, var(--bf-${tone}) 16%, transparent)`
    : `var(--bf-tone-${tone}-tint)`
}
