import { defineIcons } from './types'

/**
 * Ceiling & gypsum decor — الأسقف وديكورات الجبس.
 *
 * This family is where finishing contractors in the Gulf make their margin and
 * where clients make their choices, so it earns fine-grained icons rather than
 * one generic "ceiling" glyph.
 *
 * All are drawn in SECTION (cut through, viewed from the side) — the same way
 * they appear on a shop drawing. A ceiling seen in plan is an empty rectangle
 * and communicates nothing; in section, the drop, the recess, and the profile
 * are immediately readable.
 */
export const ceilingIcons = defineIcons({
  suspendedCeiling: {
    name: 'ceiling-suspended',
    labelEn: 'Suspended ceiling',
    labelAr: 'سقف معلق',
    keywords: ['false ceiling', 'grid', 'سقف معلق', 'سقف جبس', 'أسقف مستعارة'],
    // Structural slab on top, drop rods, then the suspended plane below with a
    // tile joint. The hangers are the recognition cue — without them this is
    // just two lines.
    body: `
      <path d="M2.4 2.6h19.2"/>
      <path d="M6.8 2.6v3.6M12 2.6v3.6M17.2 2.6v3.6"/>
      <rect x="2.4" y="6.2" width="19.2" height="6.2" rx="1"/>
      <path d="M8.8 6.2v6.2M15.2 6.2v6.2"/>
      <path d="M2.4 9.3h19.2"/>`,
  },

  gypsumDecor: {
    name: 'ceiling-gypsum-decor',
    labelEn: 'Gypsum decor',
    labelAr: 'ديكور جبس',
    keywords: ['decor', 'bulkhead', 'ديكور جبس', 'ديكورات', 'جبسون'],
    // A stepped dropped section with recessed spots — the classic reception
    // ceiling every client asks for.
    body: `
      <path d="M2.4 3h19.2"/>
      <path d="M2.4 3v3.8h3.6v3.4h12v-3.4h3.6V3"/>
      <circle cx="9" cy="12.6" r="1.1"/>
      <circle cx="15" cy="12.6" r="1.1"/>
      <path d="M6 10.2v2M18 10.2v2"/>`,
  },

  cornice: {
    name: 'ceiling-cornice',
    labelEn: 'Cornice',
    labelAr: 'كرنيش',
    keywords: ['coving', 'moulding', 'كرنيش', 'كرانيش', 'زخرفة سقف'],
    body: `
      <path d="M2.6 3h18.8"/>
      <path d="M2.6 3v3.4c4.4 0 7.4 3 7.4 7.4v7.2"/>
      <path d="M21.4 3v3.4c-4.4 0-7.4 3-7.4 7.4v7.2"/>
      <path d="M10 17.6h4"/>`,
  },

  ceilingRose: {
    name: 'ceiling-rose',
    labelEn: 'Ceiling rose',
    labelAr: 'وردة سقف',
    keywords: ['medallion', 'centre piece', 'وردة', 'زخرفة'],
    body: `
      <circle cx="12" cy="12" r="2.8"/>
      <circle cx="12" cy="12" r="6.8"/>
      <path d="M12 2.6v2.6M12 18.8v2.6M2.6 12h2.6M18.8 12h2.6"/>
      <path d="m5.4 5.4 1.8 1.8M18.6 5.4l-1.8 1.8M5.4 18.6l1.8-1.8M18.6 18.6l-1.8-1.8"/>`,
  },

  exposedCeiling: {
    name: 'ceiling-exposed',
    labelEn: 'Painted / exposed ceiling',
    labelAr: 'سقف مدهون',
    keywords: ['flat ceiling', 'skim', 'سقف عادي', 'سقف مدهون'],
    body: `
      <path d="M2.4 4h19.2"/>
      <path d="M2.4 4v3.4h19.2V4"/>
      <path d="M6.4 11v2.4M12 10.2v3.2M17.6 11v2.4"/>`,
  },

  acousticPanel: {
    name: 'ceiling-acoustic',
    labelEn: 'Acoustic panel',
    labelAr: 'ألواح عازلة للصوت',
    keywords: ['sound', 'perforated', 'عزل صوت', 'ألواح صوتية'],
    body: `
      <rect x="2.4" y="4.8" width="19.2" height="14.4" rx="2"/>
      <circle cx="7.2" cy="9.6" r="0.95" fill="currentColor" stroke="none"/>
      <circle cx="12" cy="9.6" r="0.95" fill="currentColor" stroke="none"/>
      <circle cx="16.8" cy="9.6" r="0.95" fill="currentColor" stroke="none"/>
      <circle cx="7.2" cy="14.4" r="0.95" fill="currentColor" stroke="none"/>
      <circle cx="12" cy="14.4" r="0.95" fill="currentColor" stroke="none"/>
      <circle cx="16.8" cy="14.4" r="0.95" fill="currentColor" stroke="none"/>`,
  },

  ceilingAccessPanel: {
    name: 'ceiling-access-panel',
    labelEn: 'Access panel',
    labelAr: 'فتحة تفتيش',
    keywords: ['hatch', 'inspection', 'فتحة تفتيش', 'باب تفتيش'],
    body: `
      <path d="M2.4 4.2h19.2"/>
      <rect x="2.4" y="4.2" width="19.2" height="5.4" rx="0.8"/>
      <rect x="8.4" y="4.2" width="7.2" height="5.4" rx="0.8"/>
      <path d="M10 12.6v3.6M14 12.6v3.6"/>
      <path d="M8.4 16.2h7.2"/>`,
  },

  bulkhead: {
    name: 'ceiling-bulkhead',
    labelEn: 'Bulkhead / drop',
    labelAr: 'نزلة جبس',
    keywords: ['drop', 'soffit', 'نزلة', 'كتف جبس'],
    body: `
      <path d="M2.4 3.2h19.2"/>
      <path d="M2.4 3.2v7.4h7.6V3.2"/>
      <path d="M10 10.6h11.6"/>
      <path d="M5 13.6v2.4M13.6 13.6v2.4M18.6 13.6v2.4"/>`,
  },
})
