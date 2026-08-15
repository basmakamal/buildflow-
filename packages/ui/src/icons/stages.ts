import { defineIcons } from './types'

/**
 * The 14 finishing stages — مراحل التشطيب.
 *
 * These appear on the kanban, the Gantt, the mobile stage list, and every
 * exported report, so each one has to be legible at 16px and distinguishable
 * from its neighbours at a glance. Metaphors are the tool itself or the
 * finished result, never an abstract symbol — a site engineer should recognise
 * the icon before reading the Arabic label.
 */
export const stageIcons = defineIcons({
  unitReceived: {
    name: 'stage-unit-received',
    labelEn: 'Unit received',
    labelAr: 'استلام الوحدة',
    keywords: ['handover', 'start', 'استلام', 'تسليم'],
    body: `
      <path d="M3 10.5 12 3.2l9 7.3"/>
      <path d="M5.6 9.4V20a1 1 0 0 0 1 1h10.8a1 1 0 0 0 1-1V9.4"/>
      <path d="M12 10.8v5.4"/>
      <path d="m9.6 13.8 2.4 2.4 2.4-2.4"/>`,
  },

  demolition: {
    name: 'stage-demolition',
    labelEn: 'Demolition',
    labelAr: 'الهدم',
    keywords: ['break', 'strip out', 'هدم', 'تكسير'],
    // A cracked block wall reads faster than a hammer, and does not collide
    // with the carpentry tool icon.
    body: `
      <path d="M3 21h18"/>
      <path d="M4.5 21V8.5h15V21"/>
      <path d="M12 8.5v3.2l-2 1.9 2 1.9V21"/>
      <path d="M4.5 12.8h5.5M14 12.8h5.5"/>
      <path d="M4.5 17h4.2M15.4 17h4.1"/>`,
  },

  plumbing: {
    name: 'stage-plumbing',
    labelEn: 'Plumbing',
    labelAr: 'السباكة',
    keywords: ['pipe', 'water', 'سباكة', 'مواسير'],
    body: `
      <path d="M2.8 8.4h5.4a4 4 0 0 1 4 4v8.4"/>
      <rect x="1.2" y="6.2" width="3" height="4.4" rx="1"/>
      <rect x="10.4" y="19" width="3.6" height="3" rx="1"/>
      <path d="M12.2 12.4h4a4 4 0 0 0 4-4V3.4"/>
      <rect x="18.4" y="2" width="3.4" height="3" rx="1"/>`,
  },

  electrical: {
    name: 'stage-electrical',
    labelEn: 'Electrical',
    labelAr: 'الكهرباء',
    keywords: ['power', 'wiring', 'كهرباء', 'تأسيس كهرباء'],
    body: `
      <path d="M13.4 2.4 5.6 13.2h5.4l-1 8.4 7.8-10.8h-5.4z"/>`,
  },

  hvac: {
    name: 'stage-hvac',
    labelEn: 'HVAC',
    labelAr: 'التكييف',
    keywords: ['air conditioning', 'cooling', 'تكييف', 'تبريد'],
    body: `
      <rect x="2.6" y="4" width="18.8" height="7.6" rx="2"/>
      <path d="M5.6 8.4h12.8"/>
      <path d="M7 14.6c0 1.6 1.4 1.6 1.4 3.2S7 21 7 21"/>
      <path d="M12 14.6c0 1.6 1.4 1.6 1.4 3.2S12 21 12 21"/>
      <path d="M17 14.6c0 1.6 1.4 1.6 1.4 3.2S17 21 17 21"/>`,
  },

  waterproofing: {
    name: 'stage-waterproofing',
    labelEn: 'Waterproofing',
    labelAr: 'العزل',
    keywords: ['insulation', 'membrane', 'عزل', 'عزل مائي'],
    body: `
      <path d="M12 2.6c3.4 3 5.6 5.6 5.6 8.2a5.6 5.6 0 1 1-11.2 0c0-2.6 2.2-5.2 5.6-8.2z"/>
      <path d="M2.4 20.2c1.8 0 1.8 1.4 3.6 1.4s1.8-1.4 3.6-1.4 1.8 1.4 3.6 1.4 1.8-1.4 3.6-1.4 1.8 1.4 3.6 1.4"/>`,
  },

  plastering: {
    name: 'stage-plastering',
    labelEn: 'Plastering',
    labelAr: 'المحارة',
    keywords: ['render', 'trowel', 'محارة', 'بياض', 'لياسة'],
    // A rendering trowel — the single most recognisable tool of this trade.
    body: `
      <path d="M2.6 13.4 12.4 3.6a1.6 1.6 0 0 1 2.3 0l1.5 1.5a1.6 1.6 0 0 1 0 2.3l-9.8 9.8z"/>
      <path d="M16.6 9.4 20 12.8"/>
      <path d="M18.4 15.4a2 2 0 1 1 2.8 2.8l-2.4 2.4-2.8-2.8z"/>`,
  },

  gypsum: {
    name: 'stage-gypsum',
    labelEn: 'Gypsum',
    labelAr: 'الجبس',
    keywords: ['drywall', 'board', 'جبس', 'جبسوم بورد'],
    body: `
      <rect x="2.4" y="5.2" width="19.2" height="6" rx="1"/>
      <rect x="2.4" y="12.8" width="19.2" height="6" rx="1"/>
      <path d="M8.4 5.2v6M15.6 12.8v6"/>`,
  },

  flooring: {
    name: 'stage-flooring',
    labelEn: 'Flooring',
    labelAr: 'الأرضيات',
    keywords: ['tiles', 'floor', 'أرضيات', 'بلاط', 'سيراميك'],
    body: `
      <path d="M2.6 9.6h18.8"/>
      <path d="M1.4 19.4 4.6 9.6M22.6 19.4 19.4 9.6"/>
      <path d="M1.4 19.4h21.2"/>
      <path d="M9.6 9.6 8.4 19.4M14.4 9.6l1.2 9.8"/>
      <path d="M2.6 14.4h18.8"/>`,
  },

  painting: {
    name: 'stage-painting',
    labelEn: 'Painting',
    labelAr: 'الدهانات',
    keywords: ['paint', 'roller', 'دهان', 'بويه'],
    body: `
      <rect x="3" y="3.4" width="14" height="5.2" rx="1.4"/>
      <path d="M17 6h2.6a1.4 1.4 0 0 1 1.4 1.4v2.8a1.4 1.4 0 0 1-1.4 1.4H12"/>
      <path d="M12 11.6v2"/>
      <rect x="9.8" y="13.6" width="4.4" height="7.4" rx="1.4"/>`,
  },

  carpentry: {
    name: 'stage-carpentry',
    labelEn: 'Carpentry',
    labelAr: 'النجارة',
    keywords: ['joinery', 'wood', 'saw', 'نجارة', 'خشب'],
    body: `
      <path d="M2.6 6.2h12.8l5 5"/>
      <path d="M2.6 6.2v3.4l12.8 5"/>
      <path d="M4.6 9.4 4 11.4M7.4 10.5l-.6 2M10.2 11.6l-.6 2M13 12.7l-.6 2"/>
      <path d="M18.6 12.8a2.2 2.2 0 1 1 3.1 3.1l-2 2-3.1-3.1z"/>`,
  },

  lighting: {
    name: 'stage-lighting',
    labelEn: 'Lighting',
    labelAr: 'الإنارة',
    keywords: ['light', 'fixture', 'إنارة', 'إضاءة'],
    body: `
      <path d="M12 3a5.8 5.8 0 0 0-3.4 10.5c.6.5 1 1.3 1 2.1h4.8c0-.8.4-1.6 1-2.1A5.8 5.8 0 0 0 12 3z"/>
      <path d="M9.6 18.4h4.8"/>
      <path d="M10.6 21h2.8"/>`,
  },

  cleaning: {
    name: 'stage-cleaning',
    labelEn: 'Cleaning',
    labelAr: 'النظافة',
    keywords: ['clean', 'handover prep', 'نظافة', 'تنظيف'],
    body: `
      <path d="M9.6 2.6h4.2v3.8H9.6z"/>
      <path d="M8.2 6.4h7v4.2a1.4 1.4 0 0 1-1.4 1.4H9.6a1.4 1.4 0 0 1-1.4-1.4z"/>
      <path d="M11.7 12v3.4"/>
      <path d="M7.6 21.4 8.8 15.4h5.8l1.2 6z"/>
      <path d="M4.2 4.4h2M3.4 8h2"/>`,
  },

  delivery: {
    name: 'stage-delivery',
    labelEn: 'Delivery',
    labelAr: 'التسليم',
    keywords: ['handover', 'complete', 'تسليم', 'تسليم نهائي'],
    body: `
      <path d="M4.4 21V4.6a1.6 1.6 0 0 1 1.6-1.6h8.4a1.6 1.6 0 0 1 1.6 1.6v5"/>
      <path d="M3 21h11"/>
      <path d="M11.6 12.4v.01"/>
      <path d="m14.6 17.6 2.4 2.4 4.4-4.8"/>`,
  },
})
