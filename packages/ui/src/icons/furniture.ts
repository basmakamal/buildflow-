import { defineIcons } from './types'

/**
 * Furniture & soft furnishings — العفش والمفروشات.
 *
 * Furniture sits at the end of the finishing lifecycle and is usually a
 * separate contract line ("supply & install"), so it needs its own icon family
 * rather than being folded into joinery.
 *
 * These are also the icons the 3D viewer's asset library and the AI design
 * assistant's furniture-direction output map onto, so the set intentionally
 * covers the room programme: reception, majlis, bedrooms, dining.
 *
 * Drawn in elevation with a visible floor line where it aids recognition.
 * None are mirrored in RTL — a sofa does not change shape with the language.
 */
export const furnitureIcons = defineIcons({
  sofa: {
    name: 'furn-sofa',
    labelEn: 'Sofa',
    labelAr: 'كنبة',
    keywords: ['couch', 'seating', 'كنبة', 'أنتريه', 'صالون'],
    body: `
      <path d="M4.6 11.4V8a2.2 2.2 0 0 1 2.2-2.2h10.4A2.2 2.2 0 0 1 19.4 8v3.4"/>
      <path d="M2.4 12.2a2.2 2.2 0 0 1 4.4 0v3h10.4v-3a2.2 2.2 0 0 1 4.4 0v6H2.4z"/>
      <path d="M6.8 15.2h10.4"/>
      <path d="M4.8 18.2v1.8M19.2 18.2v1.8"/>`,
  },

  majlisSeating: {
    name: 'furn-majlis',
    labelEn: 'Majlis seating',
    labelAr: 'مجلس',
    keywords: ['floor seating', 'arabic', 'مجلس', 'جلسة أرضية'],
    // Low continuous floor seating with cushions — a room type the Gulf market
    // specifies constantly and that no Western furniture icon set covers.
    body: `
      <path d="M2.4 19.4h19.2"/>
      <path d="M2.4 19.4v-3.6h19.2v3.6"/>
      <path d="M4.6 15.8v-4a1.4 1.4 0 0 1 1.4-1.4h1.8a1.4 1.4 0 0 1 1.4 1.4v4"/>
      <path d="M10.8 15.8v-4a1.4 1.4 0 0 1 1.4-1.4H14a1.4 1.4 0 0 1 1.4 1.4v4"/>
      <path d="M17 15.8v-4a1.4 1.4 0 0 1 1.4-1.4h1.8"/>`,
  },

  bed: {
    name: 'furn-bed',
    labelEn: 'Bed',
    labelAr: 'سرير',
    keywords: ['bedroom', 'سرير', 'غرفة نوم'],
    body: `
      <path d="M2.4 20v-8.6a2 2 0 0 1 2-2h15.2a2 2 0 0 1 2 2V20"/>
      <path d="M2.4 15.6h19.2"/>
      <rect x="5" y="11.2" width="5.2" height="3.4" rx="1.2"/>
      <path d="M2.4 20v1.6M21.6 20v1.6"/>
      <path d="M2.4 11.4V7.6a1.6 1.6 0 0 1 1.6-1.6"/>`,
  },

  wardrobe: {
    name: 'furn-wardrobe',
    labelEn: 'Wardrobe',
    labelAr: 'دولاب',
    keywords: ['closet', 'دولاب', 'خزانة ملابس'],
    body: `
      <rect x="4.2" y="2.6" width="15.6" height="18.8" rx="1.8"/>
      <path d="M12 2.6v18.8"/>
      <path d="M10.4 11.2v2.6M13.6 11.2v2.6"/>
      <path d="M4.2 7.4h15.6"/>`,
  },

  diningTable: {
    name: 'furn-dining-table',
    labelEn: 'Dining table',
    labelAr: 'طاولة سفرة',
    keywords: ['dining', 'سفرة', 'طاولة طعام'],
    body: `
      <path d="M2.4 11.6h19.2"/>
      <path d="M5.4 11.6V20M18.6 11.6V20"/>
      <path d="M8.6 11.6V6.4a1.2 1.2 0 0 1 1.2-1.2"/>
      <path d="M15.4 11.6V6.4a1.2 1.2 0 0 0-1.2-1.2"/>
      <path d="M8.6 6.6h2.4M13 6.6h2.4"/>`,
  },

  chair: {
    name: 'furn-chair',
    labelEn: 'Chair',
    labelAr: 'كرسي',
    keywords: ['seat', 'كرسي'],
    body: `
      <path d="M7.4 13.6V5.6a1.6 1.6 0 0 1 1.6-1.6h6a1.6 1.6 0 0 1 1.6 1.6v8"/>
      <rect x="5.6" y="13.6" width="12.8" height="3.6" rx="1.2"/>
      <path d="M7.4 17.2V21M16.6 17.2V21"/>`,
  },

  coffeeTable: {
    name: 'furn-coffee-table',
    labelEn: 'Coffee table',
    labelAr: 'طاولة قهوة',
    keywords: ['side table', 'طاولة', 'ترابيزة'],
    body: `
      <rect x="2.4" y="8.4" width="19.2" height="3" rx="1.2"/>
      <path d="M5.6 11.4V18M18.4 11.4V18"/>
      <path d="M5.6 14.8h12.8"/>`,
  },

  tvUnit: {
    name: 'furn-tv-unit',
    labelEn: 'TV unit',
    labelAr: 'وحدة تلفزيون',
    keywords: ['media', 'وحدة تلفزيون', 'مكتبة تلفزيون'],
    body: `
      <rect x="3.6" y="2.8" width="16.8" height="10.4" rx="1.6"/>
      <path d="M12 13.2v2.4"/>
      <path d="M9.2 15.6h5.6"/>
      <rect x="2.4" y="17.6" width="19.2" height="3.8" rx="1.2"/>
      <path d="M12 17.6v3.8"/>`,
  },

  curtain: {
    name: 'furn-curtain',
    labelEn: 'Curtains',
    labelAr: 'ستائر',
    keywords: ['drapes', 'blinds', 'ستارة', 'ستائر'],
    body: `
      <path d="M2.4 3.4h19.2"/>
      <path d="M6 3.4v17.2c2.6-1.2 3.2-4.4 3.2-8.6S8.6 4.6 6 3.4"/>
      <path d="M18 3.4v17.2c-2.6-1.2-3.2-4.4-3.2-8.6s.6-7.4 3.2-8.6"/>
      <path d="M11.4 3.4v17.2M12.6 3.4v17.2"/>`,
  },

  carpet: {
    name: 'furn-carpet',
    labelEn: 'Carpet / rug',
    labelAr: 'سجاد',
    keywords: ['rug', 'سجادة', 'سجاد', 'موكيت'],
    body: `
      <rect x="4.2" y="6.2" width="15.6" height="11.6" rx="1.2"/>
      <rect x="7" y="9" width="10" height="6" rx="0.8"/>
      <path d="M2.4 7.4v9.2M21.6 7.4v9.2"/>`,
  },

  mirror: {
    name: 'furn-mirror',
    labelEn: 'Mirror',
    labelAr: 'مرآة',
    keywords: ['glass', 'مراية', 'مرآة'],
    body: `
      <rect x="6.2" y="2.4" width="11.6" height="15.6" rx="5.8"/>
      <path d="M12 18v2.4"/>
      <path d="M9.2 21.4h5.6"/>
      <path d="M9.6 8.2 12.6 5"/>`,
  },

  artwork: {
    name: 'furn-artwork',
    labelEn: 'Artwork',
    labelAr: 'لوحة فنية',
    keywords: ['painting', 'frame', 'لوحة', 'برواز'],
    body: `
      <rect x="3.2" y="3.8" width="17.6" height="16.4" rx="1.6"/>
      <circle cx="8.6" cy="9.4" r="1.5"/>
      <path d="M3.2 17.2 8.4 12.6l3.8 3.2 3.2-2.6 5.4 4.6"/>`,
  },

  plant: {
    name: 'furn-plant',
    labelEn: 'Plant',
    labelAr: 'نبات زينة',
    keywords: ['greenery', 'نباتات', 'زرع', 'نبات'],
    body: `
      <path d="M12 21v-8.4"/>
      <path d="M12 12.6c0-3-2.2-5-5.2-5 0 3 2.2 5 5.2 5z"/>
      <path d="M12 12.6c0-3.6 2.6-6.2 6.2-6.2 0 3.6-2.6 6.2-6.2 6.2z"/>
      <path d="M8.4 21.4h7.2l-.8-4.4H9.2z"/>`,
  },

  cushion: {
    name: 'furn-cushion',
    labelEn: 'Cushion',
    labelAr: 'وسادة',
    keywords: ['pillow', 'soft furnishing', 'وسادة', 'خدادية'],
    body: `
      <path d="M4.6 6.2h14.8a2 2 0 0 1 2 2v7.6a2 2 0 0 1-2 2H4.6a2 2 0 0 1-2-2V8.2a2 2 0 0 1 2-2z"/>
      <path d="M2.6 8.2c3.4 1.4 4.6 2.6 4.6 3.8s-1.2 2.4-4.6 3.8"/>
      <path d="M21.4 8.2c-3.4 1.4-4.6 2.6-4.6 3.8s1.2 2.4 4.6 3.8"/>`,
  },
})
