/**
 * Shared Tailwind preset.
 *
 * Two non-negotiables encoded here:
 *
 * 1. Colours reference CSS custom properties, never literals. That is what lets
 *    the theme switch (light/dark) and lets a tenant re-brand without a rebuild.
 *
 * 2. LOGICAL properties only. `ps-4` not `pl-4`, `me-2` not `mr-2`, `start-0`
 *    not `left-0`. One class works in both Arabic RTL and English LTR, so there
 *    is a single layout implementation instead of two that drift apart.
 *    docs/12 §4.2
 */

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        primary: {
          50: 'var(--bf-primary-50)',
          100: 'var(--bf-primary-100)',
          200: 'var(--bf-primary-200)',
          300: 'var(--bf-primary-300)',
          400: 'var(--bf-primary-400)',
          500: 'var(--bf-primary-500)',
          600: 'var(--bf-primary-600)',
          700: 'var(--bf-primary-700)',
          800: 'var(--bf-primary-800)',
          900: 'var(--bf-primary-900)',
          DEFAULT: 'var(--bf-primary-600)',
        },
        accent: {
          100: 'var(--bf-accent-100)',
          200: 'var(--bf-accent-200)',
          300: 'var(--bf-accent-300)',
          400: 'var(--bf-accent-400)',
          500: 'var(--bf-accent-500)',
          DEFAULT: 'var(--bf-accent-400)',
        },
        success: { DEFAULT: 'var(--bf-success)', bg: 'var(--bf-success-bg)' },
        warning: { DEFAULT: 'var(--bf-warning)', bg: 'var(--bf-warning-bg)' },
        danger: { DEFAULT: 'var(--bf-danger)', bg: 'var(--bf-danger-bg)' },
        info: { DEFAULT: 'var(--bf-info)', bg: 'var(--bf-info-bg)' },

        bg: 'var(--bf-bg)',
        surface: {
          DEFAULT: 'var(--bf-surface)',
          raised: 'var(--bf-surface-raised)',
          sunken: 'var(--bf-surface-sunken)',
        },
        border: { DEFAULT: 'var(--bf-border)', strong: 'var(--bf-border-strong)' },
        content: {
          DEFAULT: 'var(--bf-text)',
          muted: 'var(--bf-text-muted)',
          inverse: 'var(--bf-text-inverse)',
        },

        // Stage colours are tokens, not per-chart choices.
        stage: {
          received: 'var(--bf-stage-received)',
          demolition: 'var(--bf-stage-demolition)',
          plumbing: 'var(--bf-stage-plumbing)',
          electrical: 'var(--bf-stage-electrical)',
          hvac: 'var(--bf-stage-hvac)',
          waterproofing: 'var(--bf-stage-waterproofing)',
          plastering: 'var(--bf-stage-plastering)',
          gypsum: 'var(--bf-stage-gypsum)',
          flooring: 'var(--bf-stage-flooring)',
          painting: 'var(--bf-stage-painting)',
          carpentry: 'var(--bf-stage-carpentry)',
          lighting: 'var(--bf-stage-lighting)',
          cleaning: 'var(--bf-stage-cleaning)',
          delivery: 'var(--bf-stage-delivery)',
        },
      },

      fontFamily: {
        sans: 'var(--bf-font)',
        ar: 'var(--bf-font-ar)',
        en: 'var(--bf-font-en)',
        mono: 'var(--bf-font-mono)',
      },

      fontSize: {
        '2xs': ['var(--bf-text-2xs)', { lineHeight: '1.4' }],
        xs: ['var(--bf-text-xs)', { lineHeight: '1.45' }],
        sm: ['var(--bf-text-sm)', { lineHeight: 'var(--bf-leading-normal)' }],
        base: ['var(--bf-text-base)', { lineHeight: 'var(--bf-leading-normal)' }],
        lg: ['var(--bf-text-lg)', { lineHeight: 'var(--bf-leading-normal)' }],
        xl: ['var(--bf-text-xl)', { lineHeight: 'var(--bf-leading-tight)' }],
        '2xl': ['var(--bf-text-2xl)', { lineHeight: 'var(--bf-leading-tight)' }],
        '3xl': ['var(--bf-text-3xl)', { lineHeight: 'var(--bf-leading-tight)' }],
      },

      borderRadius: {
        sm: 'var(--bf-radius-sm)',
        DEFAULT: 'var(--bf-radius)',
        md: 'var(--bf-radius-md)',
        lg: 'var(--bf-radius-lg)',
        xl: 'var(--bf-radius-xl)',
      },

      boxShadow: {
        card: 'var(--bf-shadow-card)',
        overlay: 'var(--bf-shadow-overlay)',
        ring: 'var(--bf-ring)',
      },

      transitionTimingFunction: { DEFAULT: 'var(--bf-ease)' },
      transitionDuration: { micro: 'var(--bf-duration-micro)', DEFAULT: 'var(--bf-duration)' },

      zIndex: {
        dropdown: 'var(--bf-z-dropdown)',
        sticky: 'var(--bf-z-sticky)',
        overlay: 'var(--bf-z-overlay)',
        modal: 'var(--bf-z-modal)',
        toast: 'var(--bf-z-toast)',
      },
    },
  },

  plugins: [
    // Logical-property utilities. Using `pl-*`/`mr-*`/`left-*` in application
    // code is blocked by stylelint — these are the sanctioned replacements.
    ({ addUtilities, theme }) => {
      const space = theme('spacing')
      const utils = {}
      for (const [key, value] of Object.entries(space)) {
        utils[`.ps-${key}`] = { paddingInlineStart: value }
        utils[`.pe-${key}`] = { paddingInlineEnd: value }
        utils[`.ms-${key}`] = { marginInlineStart: value }
        utils[`.me-${key}`] = { marginInlineEnd: value }
        utils[`.start-${key}`] = { insetInlineStart: value }
        utils[`.end-${key}`] = { insetInlineEnd: value }
      }
      addUtilities({
        ...utils,
        '.text-start': { textAlign: 'start' },
        '.text-end': { textAlign: 'end' },
        '.border-s': { borderInlineStartWidth: '1px' },
        '.border-e': { borderInlineEndWidth: '1px' },
        '.rounded-s': {
          borderStartStartRadius: 'var(--bf-radius)',
          borderEndStartRadius: 'var(--bf-radius)',
        },
        '.rounded-e': {
          borderStartEndRadius: 'var(--bf-radius)',
          borderEndEndRadius: 'var(--bf-radius)',
        },
        // Numbers, phone numbers, emails and URLs never flip in RTL.
        // docs/12 §4.3
        '.numeric': { direction: 'ltr', unicodeBidi: 'isolate', fontVariantNumeric: 'tabular-nums' },
      })
    },
  ],
}
