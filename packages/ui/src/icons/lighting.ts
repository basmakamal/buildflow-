import { defineIcons } from './types'

/**
 * Lighting fixtures — وحدات الإنارة.
 *
 * Distinct from the electrical family on purpose: electrical icons are square
 * face plates (the point in the wall), lighting icons are the fixture itself
 * seen in elevation. A BOQ separates "lighting point" (electrician) from
 * "pendant fixture" (supply & install), and the icons must not be confusable.
 *
 * Every fixture is drawn hanging from or fixed to a surface, so the mounting
 * type — ceiling, wall, floor, recessed — is readable without the label.
 */
export const lightingIcons = defineIcons({
  bulb: {
    name: 'light-bulb',
    labelEn: 'Lamp / bulb',
    labelAr: 'لمبة',
    keywords: ['bulb', 'lamp', 'led', 'لمبة', 'مصباح'],
    body: `
      <path d="M12 2.8a5.9 5.9 0 0 0-3.5 10.7c.6.5 1 1.3 1 2.1h5c0-.8.4-1.6 1-2.1A5.9 5.9 0 0 0 12 2.8z"/>
      <path d="M9.5 18.4h5"/>
      <path d="M10.6 21.2h2.8"/>`,
  },

  pendant: {
    name: 'light-pendant',
    labelEn: 'Pendant light',
    labelAr: 'إنارة معلقة',
    keywords: ['hanging', 'drop', 'معلقة', 'دلاية'],
    body: `
      <path d="M12 2.4v5.2"/>
      <path d="M4.6 15.2 12 7.6l7.4 7.6z"/>
      <path d="M4.6 15.2h14.8"/>
      <path d="M9.4 18.4a2.6 2.6 0 0 0 5.2 0"/>`,
  },

  chandelier: {
    name: 'light-chandelier',
    labelEn: 'Chandelier',
    labelAr: 'نجفة',
    keywords: ['chandelier', 'feature light', 'نجفة', 'ثريا'],
    body: `
      <path d="M12 2.4v3.4"/>
      <path d="M4.4 7.2h15.2"/>
      <path d="M12 5.8v1.4"/>
      <path d="M5 7.2v2.6M12 7.2v2.6M19 7.2v2.6"/>
      <circle cx="5" cy="12.4" r="2.4"/>
      <circle cx="12" cy="12.4" r="2.4"/>
      <circle cx="19" cy="12.4" r="2.4"/>`,
  },

  spotlight: {
    name: 'light-spot',
    labelEn: 'Spotlight / downlight',
    labelAr: 'سبوت لايت',
    keywords: ['downlight', 'recessed', 'سبوت', 'إنارة غاطسة'],
    body: `
      <path d="M2.6 5.4h18.8"/>
      <path d="M7.6 5.4a4.4 4.4 0 0 0 8.8 0"/>
      <path d="M9.4 12.6 6.6 20M14.6 12.6 17.4 20"/>
      <path d="M6.6 20h10.8"/>`,
  },

  coveLight: {
    name: 'light-cove',
    labelEn: 'Cove / hidden lighting',
    labelAr: 'إضاءة مخفية',
    keywords: ['indirect', 'strip', 'إضاءة مخفية', 'كرنيش إنارة'],
    // The gypsum recess with light washing down the wall — the single most
    // commonly specified feature in Gulf residential finishing.
    body: `
      <path d="M2.2 3.4h19.6"/>
      <path d="M2.2 3.4v4.2h5.4"/>
      <path d="M21.8 3.4v4.2h-5.4"/>
      <path d="M8.6 9.4c.6 3.4 2 6 4 8M15.4 9.4c-.6 3.4-2 6-4 8"/>
      <path d="M12 9.6v10"/>`,
  },

  ledStrip: {
    name: 'light-led-strip',
    labelEn: 'LED strip',
    labelAr: 'شريط ليد',
    keywords: ['tape', 'linear', 'شريط ليد', 'ليد'],
    body: `
      <rect x="1.8" y="8.6" width="20.4" height="4.4" rx="1.6"/>
      <circle cx="6" cy="10.8" r="0.9" fill="currentColor" stroke="none"/>
      <circle cx="10" cy="10.8" r="0.9" fill="currentColor" stroke="none"/>
      <circle cx="14" cy="10.8" r="0.9" fill="currentColor" stroke="none"/>
      <circle cx="18" cy="10.8" r="0.9" fill="currentColor" stroke="none"/>
      <path d="M6 15.6v2.6M10 15.6v2.6M14 15.6v2.6M18 15.6v2.6"/>`,
  },

  wallSconce: {
    name: 'light-wall-sconce',
    labelEn: 'Wall sconce',
    labelAr: 'أبليك',
    keywords: ['wall light', 'أبليك', 'إنارة جدارية'],
    body: `
      <path d="M3.4 2.6v18.8"/>
      <path d="M3.4 12h3.2"/>
      <path d="M6.6 7.6a5.2 5.2 0 0 1 0 8.8z"/>
      <path d="M13.4 8.4 16.6 6M13.4 15.6l3.2 2.4M14.4 12h3.2"/>`,
  },

  trackLight: {
    name: 'light-track',
    labelEn: 'Track light',
    labelAr: 'إنارة سبوت متحركة',
    keywords: ['rail', 'gallery', 'تراك', 'سكة إنارة'],
    body: `
      <rect x="2.2" y="3.6" width="19.6" height="2.6" rx="1.3"/>
      <path d="M7.4 6.2v2.8M16.6 6.2v2.8"/>
      <path d="M4.8 9 7.4 15.4 10 9z"/>
      <path d="M14 9l2.6 6.4L19.2 9z"/>`,
  },

  floorLamp: {
    name: 'light-floor-lamp',
    labelEn: 'Floor lamp',
    labelAr: 'أباجورة أرضية',
    keywords: ['standing lamp', 'أباجورة', 'إنارة أرضية'],
    body: `
      <path d="M7.4 9.2 12 2.8l4.6 6.4z"/>
      <path d="M7.4 9.2h9.2"/>
      <path d="M12 9.2v10.4"/>
      <path d="M8.6 21.2h6.8"/>`,
  },

  emergencyLight: {
    name: 'light-emergency',
    labelEn: 'Emergency light',
    labelAr: 'إنارة طوارئ',
    keywords: ['exit', 'safety', 'طوارئ', 'مخرج'],
    body: `
      <rect x="2.4" y="6.6" width="19.2" height="7.2" rx="1.6"/>
      <path d="M7.6 10.2h8.8"/>
      <path d="M6.4 16.6 7.8 20M12 16.6V20M17.6 16.6 16.2 20"/>`,
  },

  ceilingFanLight: {
    name: 'light-ceiling-fan',
    labelEn: 'Ceiling fan with light',
    labelAr: 'مروحة سقف بإنارة',
    keywords: ['fan', 'مروحة', 'مروحة سقف'],
    body: `
      <path d="M12 2.6v3"/>
      <circle cx="12" cy="8" r="2.4"/>
      <path d="M9.6 8c-2.6 0-6.4-.8-6.4-2.4S6.2 3.6 9.6 5.8"/>
      <path d="M14.4 8c2.6 0 6.4-.8 6.4-2.4s-3-2-6.4.2"/>
      <path d="M12 10.4v2.4"/>
      <path d="M9.4 17a2.6 2.6 0 0 1 5.2 0z"/>`,
  },
})
