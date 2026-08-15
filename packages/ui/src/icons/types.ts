/**
 * Domain icon library.
 *
 * WHY THIS EXISTS: no general-purpose icon set (Lucide, Heroicons, Phosphor)
 * contains a wall socket, a false ceiling, a gypsum cornice, or skirting. The
 * finishing trade has a vocabulary of physical items — بنود — and a BOQ line,
 * a material category, and a room finish spec each need to be recognisable at
 * 20px without reading the label.
 *
 * DRAWING RULES — every icon must obey these or it will not sit correctly
 * beside the others:
 *   • 24×24 viewBox, content within a 20×20 optical area (2px padding)
 *   • stroke-based, `currentColor`, 1.5 stroke width, round cap and join
 *   • no fills except where a solid mass is the point (a socket hole)
 *   • aligned to a 1px grid at 24px so lines stay crisp
 *   • ≤ 6 elements — an icon with more detail turns to mud at 16px
 *
 * Same geometry as Lucide, so domain icons and generic UI icons mix seamlessly.
 */
export interface IconDef {
  /** Stable kebab-case key. Never renamed — it is persisted on catalogue rows. */
  name: string
  /** Inner SVG markup. No <svg> wrapper — the Icon component supplies it. */
  body: string
  /** English label, for the gallery and for `aria-label` fallback. */
  labelEn: string
  /** Arabic label, using the term the trade actually says on site. */
  labelAr: string
  /** Search terms for the icon picker, both languages. */
  keywords?: string[]
  /**
   * Mirror horizontally in RTL. True only for icons that encode reading or
   * flow direction. Physical objects — a socket, a sofa, a ceiling — are NOT
   * mirrored: an apartment does not flip because the UI language changed.
   * docs/12 §4.3
   */
  mirrorInRtl?: boolean
}

export type IconCategory =
  | 'stage'
  | 'electrical'
  | 'lighting'
  | 'ceiling'
  | 'plumbing'
  | 'flooring'
  | 'wall'
  | 'joinery'
  | 'furniture'
  | 'hvac'
  | 'system'

export interface IconGroup {
  category: IconCategory
  labelEn: string
  labelAr: string
  icons: IconDef[]
}

/** Helper that keeps every definition literal-typed without repeating `satisfies`. */
export const defineIcons = <T extends Record<string, IconDef>>(icons: T): T => icons
