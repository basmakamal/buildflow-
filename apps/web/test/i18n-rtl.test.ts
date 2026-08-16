import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import { BfIcon, stageIcons, electricalIcons } from '@buildflow/ui'
import { applyLocale, isRtl, SUPPORTED_LOCALES } from '../src/i18n'
import enCommon from '../src/locales/en/common.json'
import arCommon from '../src/locales/ar/common.json'
import enAuth from '../src/locales/en/auth.json'
import arAuth from '../src/locales/ar/auth.json'

/**
 * Direction and translation behaviour.
 *
 * Every assertion here exists because the corresponding bug is invisible to a
 * developer working in English: the layout looks fine, the tests pass, and the
 * Arabic build is broken. docs/12 §8
 */

const i18n = createI18n({
  legacy: false,
  locale: 'ar',
  fallbackLocale: 'en',
  messages: {
    en: { common: enCommon, auth: enAuth },
    ar: { common: arCommon, auth: arAuth },
  },
})

beforeEach(() => {
  setActivePinia(createPinia())
  document.documentElement.removeAttribute('dir')
  document.documentElement.removeAttribute('lang')
})

describe('locale direction', () => {
  it('marks Arabic as RTL and English as LTR', () => {
    expect(isRtl('ar')).toBe(true)
    expect(isRtl('en')).toBe(false)
  })

  it('sets dir and lang on the document root', () => {
    // Direction lives on <html> so CSS logical properties handle layout —
    // no component needs to know which way the page runs. docs/12 §4.1
    applyLocale('ar')
    expect(document.documentElement.getAttribute('dir')).toBe('rtl')
    expect(document.documentElement.getAttribute('lang')).toBe('ar')

    applyLocale('en')
    expect(document.documentElement.getAttribute('dir')).toBe('ltr')
    expect(document.documentElement.getAttribute('lang')).toBe('en')
  })

  it('switches without a reload', () => {
    applyLocale('ar')
    applyLocale('en')
    applyLocale('ar')
    expect(document.documentElement.getAttribute('dir')).toBe('rtl')
  })

  it('defaults to Arabic', () => {
    // Building English-first and translating later produces layouts that only
    // ever looked right in one direction.
    expect(SUPPORTED_LOCALES[0]).toBe('ar')
  })
})

describe('translation catalogues', () => {
  it('renders Arabic by default', () => {
    expect(i18n.global.t('common.actions.signIn')).toBe('تسجيل الدخول')
  })

  it('renders English when switched', () => {
    i18n.global.locale.value = 'en'
    expect(i18n.global.t('common.actions.signIn')).toBe('Sign in')
    i18n.global.locale.value = 'ar'
  })

  it('maps every server error code to a translated message', () => {
    // The API returns a stable `code` precisely so the client can render the
    // message in the user's language rather than echoing English from the
    // server. A missing mapping shows a raw code to a customer.
    const codes = ['INVALID_CREDENTIALS', 'ACCOUNT_LOCKED', 'ACCOUNT_DISABLED', 'VALIDATION_FAILED']
    for (const locale of ['ar', 'en'] as const) {
      i18n.global.locale.value = locale
      for (const code of codes) {
        const key = `auth.errors.${code}`
        expect(i18n.global.t(key), `${locale}/${code}`).not.toBe(key)
      }
    }
    i18n.global.locale.value = 'ar'
  })

  it('compiles every message without vue-i18n syntax errors', () => {
    /**
     * vue-i18n treats `@` as linked-message syntax (`@:some.key`), so a literal
     * `you@company.com` fails to COMPILE — it still renders, but throws on every
     * evaluation. Nothing caught it: not typecheck, not the key-parity gate, not
     * the other tests, because none of them rendered this particular key. Only
     * opening the page in a browser surfaced it, as six console errors.
     *
     * Rendering every leaf turns that into a test failure instead.
     */
    const walk = (obj: Record<string, unknown>, prefix: string): string[] =>
      Object.entries(obj).flatMap(([key, value]) =>
        value !== null && typeof value === 'object'
          ? walk(value as Record<string, unknown>, `${prefix}.${key}`)
          : [`${prefix}.${key}`],
      )

    const keys = [...walk(enCommon, 'common'), ...walk(enAuth, 'auth')]

    for (const locale of ['ar', 'en'] as const) {
      i18n.global.locale.value = locale
      for (const key of keys) {
        expect(() => i18n.global.t(key, { email: 'x', count: 1 }), `${locale}:${key}`).not.toThrow()
      }
    }
    i18n.global.locale.value = 'ar'
  })

  it('renders the email placeholder literally, with @ escaped', () => {
    for (const locale of ['ar', 'en'] as const) {
      i18n.global.locale.value = locale
      expect(i18n.global.t('auth.placeholders.email')).toBe('you@company.com')
    }
    i18n.global.locale.value = 'ar'
  })

  it('keeps interpolation placeholders in both languages', () => {
    for (const locale of ['ar', 'en'] as const) {
      i18n.global.locale.value = locale
      expect(i18n.global.t('auth.signedInAs', { email: 'a@b.com' })).toContain('a@b.com')
    }
    i18n.global.locale.value = 'ar'
  })
})

describe('BfIcon rendering', () => {
  const mountIcon = (icon: (typeof stageIcons)['plumbing'], props = {}) =>
    mount(BfIcon, { props: { icon, ...props }, global: { plugins: [i18n] } })

  it('renders an inline SVG', () => {
    const wrapper = mountIcon(stageIcons.plumbing)
    expect(wrapper.find('svg').exists()).toBe(true)
    expect(wrapper.attributes('data-icon')).toBe('stage-plumbing')
  })

  it('colours by trade rather than inheriting text colour', () => {
    const wrapper = mountIcon(electricalIcons.socket)
    expect(wrapper.attributes('style')).toContain('--icon-color')
  })

  it('wraps in a tinted chip when asked', () => {
    const wrapper = mountIcon(stageIcons.painting, { variant: 'chip' })
    expect(wrapper.classes()).toContain('bf-icon-chip')
    expect(wrapper.find('svg').exists()).toBe(true)
  })

  it('inherits currentColor in mono variant', () => {
    const wrapper = mountIcon(stageIcons.painting, { variant: 'mono' })
    expect(wrapper.attributes('style') ?? '').not.toContain('--icon-color')
  })

  it('is hidden from assistive technology when decorative', () => {
    // The default: an icon beside a visible label must not be announced twice.
    expect(mountIcon(stageIcons.flooring).attributes('aria-hidden')).toBe('true')
  })

  it('is announced when it carries meaning', () => {
    const wrapper = mountIcon(stageIcons.flooring, { label: 'الأرضيات' })
    expect(wrapper.attributes('aria-hidden')).toBeUndefined()
    expect(wrapper.attributes('role')).toBe('img')
    expect(wrapper.attributes('aria-label')).toBe('الأرضيات')
  })

  it('does not mirror physical objects in RTL', () => {
    // A socket, a suspended ceiling and a sofa look the same in Arabic — only
    // direction-encoding icons flip. docs/12 §4.3
    const wrapper = mountIcon(electricalIcons.socket)
    expect(wrapper.classes()).not.toContain('bf-icon--mirror')
  })

  it('carries an Arabic label for every icon', () => {
    for (const icon of [...Object.values(stageIcons), ...Object.values(electricalIcons)]) {
      expect(icon.labelAr, icon.name).toBeTruthy()
      expect(icon.labelAr, icon.name).not.toBe(icon.labelEn)
    }
  })
})
