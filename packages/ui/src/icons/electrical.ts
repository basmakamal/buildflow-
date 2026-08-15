import { defineIcons } from './types'

/**
 * Electrical بنود — الأعمال الكهربائية.
 *
 * These are the line items an electrician is actually counted and paid on:
 * points (نقاط), switches, sockets, the distribution board. A BOQ says
 * "24 × single socket point" and this is the icon beside it.
 *
 * Face plates are drawn square with a generous corner radius — that is the
 * modern flush-plate profile used across the Gulf, and it distinguishes the
 * whole family at a glance from the round/rectangular fixture icons.
 */
export const electricalIcons = defineIcons({
  switch1Gang: {
    name: 'elec-switch-1g',
    labelEn: 'Switch — 1 gang',
    labelAr: 'مفتاح مفرد',
    keywords: ['switch', 'rocker', 'زرار', 'مفتاح', 'مفتاح نور'],
    body: `
      <rect x="3.6" y="2.6" width="16.8" height="18.8" rx="2.8"/>
      <rect x="8.4" y="6.8" width="7.2" height="10.4" rx="1.4"/>
      <path d="M8.4 12h7.2"/>`,
  },

  switch2Gang: {
    name: 'elec-switch-2g',
    labelEn: 'Switch — 2 gang',
    labelAr: 'مفتاح مزدوج',
    keywords: ['switch', 'double', 'زرار مزدوج', 'مفتاح مزدوج'],
    body: `
      <rect x="2.6" y="2.6" width="18.8" height="18.8" rx="2.8"/>
      <rect x="5.8" y="6.8" width="5.4" height="10.4" rx="1.3"/>
      <rect x="12.8" y="6.8" width="5.4" height="10.4" rx="1.3"/>
      <path d="M5.8 12h5.4M12.8 12h5.4"/>`,
  },

  switchDimmer: {
    name: 'elec-dimmer',
    labelEn: 'Dimmer switch',
    labelAr: 'مفتاح ديمر',
    keywords: ['dimmer', 'regulator', 'ديمر', 'مخفض إضاءة'],
    body: `
      <rect x="3.6" y="2.6" width="16.8" height="18.8" rx="2.8"/>
      <circle cx="12" cy="12" r="4.2"/>
      <path d="M12 9.2V12"/>
      <path d="M7.6 17.4h8.8"/>`,
  },

  socket: {
    name: 'elec-socket',
    labelEn: 'Socket outlet',
    labelAr: 'فيشة كهرباء',
    keywords: ['socket', 'outlet', 'power point', 'فيشة', 'بريزة', 'مخرج كهرباء'],
    // The two round pin holes are the recognition cue — keep them solid.
    body: `
      <rect x="2.8" y="2.8" width="18.4" height="18.4" rx="3.2"/>
      <circle cx="9" cy="10.4" r="1.35" fill="currentColor" stroke="none"/>
      <circle cx="15" cy="10.4" r="1.35" fill="currentColor" stroke="none"/>
      <path d="M9.2 16.2h5.6"/>`,
  },

  socketUsb: {
    name: 'elec-socket-usb',
    labelEn: 'Socket with USB',
    labelAr: 'فيشة مع يو إس بي',
    keywords: ['usb', 'charging', 'فيشة يو اس بي', 'شاحن'],
    body: `
      <rect x="2.8" y="2.8" width="18.4" height="18.4" rx="3.2"/>
      <circle cx="8.6" cy="8.6" r="1.25" fill="currentColor" stroke="none"/>
      <circle cx="15.4" cy="8.6" r="1.25" fill="currentColor" stroke="none"/>
      <rect x="7.6" y="14" width="8.8" height="2.8" rx="1.4"/>`,
  },

  socketWaterproof: {
    name: 'elec-socket-ip',
    labelEn: 'Weatherproof socket',
    labelAr: 'فيشة مقاومة للماء',
    keywords: ['ip65', 'outdoor', 'فيشة خارجية', 'ضد الماء'],
    body: `
      <rect x="2.8" y="2.8" width="18.4" height="18.4" rx="3.2"/>
      <path d="M6.6 8.4h10.8"/>
      <circle cx="9.4" cy="13.4" r="1.25" fill="currentColor" stroke="none"/>
      <circle cx="14.6" cy="13.4" r="1.25" fill="currentColor" stroke="none"/>
      <path d="M6.6 8.4a5.4 5.4 0 0 1 10.8 0"/>`,
  },

  distributionBoard: {
    name: 'elec-distribution-board',
    labelEn: 'Distribution board',
    labelAr: 'لوحة توزيع',
    keywords: ['db', 'panel', 'consumer unit', 'لوحة توزيع', 'طبلون'],
    body: `
      <rect x="2.8" y="3.4" width="18.4" height="17.2" rx="2"/>
      <path d="M2.8 8.2h18.4"/>
      <rect x="5.8" y="11" width="3" height="6.4" rx="0.9"/>
      <rect x="10.5" y="11" width="3" height="6.4" rx="0.9"/>
      <rect x="15.2" y="11" width="3" height="6.4" rx="0.9"/>`,
  },

  breaker: {
    name: 'elec-breaker',
    labelEn: 'Circuit breaker',
    labelAr: 'قاطع كهربائي',
    keywords: ['mcb', 'trip', 'قاطع', 'بريكر'],
    body: `
      <rect x="6.8" y="2.6" width="10.4" height="18.8" rx="1.8"/>
      <path d="M6.8 9h10.4"/>
      <rect x="9.8" y="11.2" width="4.4" height="6.4" rx="1.2"/>
      <path d="M10.4 5.8h3.2"/>`,
  },

  wire: {
    name: 'elec-wire',
    labelEn: 'Wire / cable',
    labelAr: 'سلك كهرباء',
    keywords: ['cable', 'copper', 'سلك', 'كابل', 'نحاس'],
    body: `
      <path d="M2.6 15.6c0-5.4 3.6-9 8.2-9s6.4 2.6 6.4 5.2-1.8 4-3.8 4-3.4-1.4-3.4-3"/>
      <path d="M17.4 6.6h4M19.4 4.6v4"/>
      <path d="M2.6 15.6h3"/>`,
  },

  conduit: {
    name: 'elec-conduit',
    labelEn: 'Conduit',
    labelAr: 'مواسير كهرباء',
    keywords: ['pipe', 'trunking', 'خرطوم', 'مواسير', 'تأسيس'],
    body: `
      <rect x="1.8" y="8.6" width="20.4" height="6.8" rx="3.4"/>
      <path d="M6.6 8.6v6.8M11.4 8.6v6.8M16.2 8.6v6.8"/>`,
  },

  junctionBox: {
    name: 'elec-junction-box',
    labelEn: 'Junction box',
    labelAr: 'علبة كهرباء',
    keywords: ['back box', 'علبة', 'علبة تفريع'],
    body: `
      <rect x="4.4" y="4.4" width="15.2" height="15.2" rx="2"/>
      <circle cx="12" cy="12" r="3"/>
      <path d="M12 4.4v2.6M12 17v2.6M4.4 12H7M17 12h2.6"/>`,
  },

  lightPoint: {
    name: 'elec-light-point',
    labelEn: 'Lighting point',
    labelAr: 'نقطة إنارة',
    keywords: ['point', 'ceiling outlet', 'نقطة إنارة', 'نقطة نور'],
    body: `
      <circle cx="12" cy="12" r="5.4"/>
      <path d="m8.2 8.2 7.6 7.6M15.8 8.2l-7.6 7.6"/>
      <path d="M12 2.6v3.2M12 18.2v3.2M2.6 12h3.2M18.2 12h3.2"/>`,
  },

  dataOutlet: {
    name: 'elec-data-outlet',
    labelEn: 'Data / TV outlet',
    labelAr: 'مخرج داتا / تلفزيون',
    keywords: ['rj45', 'network', 'tv', 'داتا', 'انترنت', 'تلفزيون'],
    body: `
      <rect x="2.8" y="2.8" width="18.4" height="18.4" rx="3.2"/>
      <path d="M8.4 8.6h7.2v4.2l-1.6 2.4h-4l-1.6-2.4z"/>
      <path d="M10.2 8.6v2M12 8.6v2M13.8 8.6v2"/>`,
  },

  doorbell: {
    name: 'elec-doorbell',
    labelEn: 'Doorbell',
    labelAr: 'جرس الباب',
    keywords: ['bell', 'chime', 'جرس'],
    body: `
      <rect x="6.8" y="2.6" width="10.4" height="18.8" rx="2.4"/>
      <circle cx="12" cy="7.8" r="2.3"/>
      <path d="M9 13.6h6M9 16.8h6"/>`,
  },

  earthing: {
    name: 'elec-earthing',
    labelEn: 'Earthing',
    labelAr: 'تأريض',
    keywords: ['ground', 'bonding', 'تأريض', 'أرضي'],
    body: `
      <path d="M12 3v9.6"/>
      <path d="M4.6 12.6h14.8"/>
      <path d="M7.2 16.2h9.6"/>
      <path d="M9.8 19.8h4.4"/>`,
  },

  waterHeaterElectric: {
    name: 'elec-water-heater',
    labelEn: 'Water heater',
    labelAr: 'سخان كهربائي',
    keywords: ['boiler', 'geyser', 'سخان', 'سخان كهرباء'],
    body: `
      <rect x="5.6" y="2.8" width="12.8" height="15.6" rx="4"/>
      <path d="M8.6 21.2v-2.8M15.4 21.2v-2.8"/>
      <path d="M9.6 8.2h4.8"/>
      <path d="M13.2 11.4 11 14.6h2.6l-1 2.4"/>`,
  },
})
