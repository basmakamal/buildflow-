import { createI18n } from 'vue-i18n'

import enCommon from '../locales/en/common.json'
import enAuth from '../locales/en/auth.json'
import enNav from '../locales/en/nav.json'
import enIcons from '../locales/en/icons.json'
import enProjects from '../locales/en/projects.json'
import enStages from '../locales/en/stages.json'
import enKnowledge from '../locales/en/knowledge.json'
import arCommon from '../locales/ar/common.json'
import arAuth from '../locales/ar/auth.json'
import arNav from '../locales/ar/nav.json'
import arIcons from '../locales/ar/icons.json'
import arProjects from '../locales/ar/projects.json'
import arStages from '../locales/ar/stages.json'
import arKnowledge from '../locales/ar/knowledge.json'

/**
 * Internationalisation.
 *
 * Arabic is the DEFAULT, not a translation bolted on later. Building
 * English-first and translating afterwards produces layouts that only ever
 * looked right in one direction — the RTL bugs surface at the end, in bulk,
 * when they are expensive. Defaulting to Arabic means every screen is built
 * RTL-correct from the first render. docs/12
 */

export const SUPPORTED_LOCALES = ['ar', 'en'] as const
export type Locale = (typeof SUPPORTED_LOCALES)[number]

const RTL_LOCALES: ReadonlySet<string> = new Set(['ar', 'he', 'fa', 'ur'])

export const isRtl = (locale: string): boolean => RTL_LOCALES.has(locale)

export const i18n = createI18n({
  legacy: false,
  locale: 'ar',
  fallbackLocale: 'en',
  // Missing keys are loud in development and silent in production: a console
  // warning helps a developer, an exception in front of a customer does not.
  missingWarn: import.meta.env.DEV,
  fallbackWarn: import.meta.env.DEV,
  messages: {
    en: {
      common: enCommon,
      auth: enAuth,
      nav: enNav,
      icons: enIcons,
      projects: enProjects,
      stages: enStages,
      knowledge: enKnowledge,
    },
    ar: {
      common: arCommon,
      auth: arAuth,
      nav: arNav,
      icons: arIcons,
      projects: arProjects,
      stages: arStages,
      knowledge: arKnowledge,
    },
  },
  numberFormats: {
    en: { currency: { style: 'currency', currency: 'SAR', notation: 'standard' } },
    ar: { currency: { style: 'currency', currency: 'SAR', notation: 'standard' } },
  },
  datetimeFormats: {
    en: { short: { year: 'numeric', month: 'short', day: 'numeric' } },
    ar: { short: { year: 'numeric', month: 'short', day: 'numeric' } },
  },
})

/**
 * Applies a locale to the document.
 *
 * Direction is set on <html> so CSS logical properties do the layout work —
 * no re-render, no reload, no logout. The font swaps with it because Arabic
 * needs different metrics, not merely different glyphs. docs/12 §4
 */
export function applyLocale(locale: Locale): void {
  i18n.global.locale.value = locale
  const root = document.documentElement
  root.setAttribute('lang', locale)
  root.setAttribute('dir', isRtl(locale) ? 'rtl' : 'ltr')
}
