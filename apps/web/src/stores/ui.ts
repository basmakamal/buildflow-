import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { applyLocale, isRtl, type Locale } from '@/i18n'

/** Interface preferences: language, direction, theme. */
export const useUiStore = defineStore('ui', () => {
  const locale = ref<Locale>('ar')
  const theme = ref<'light' | 'dark'>('light')
  const sidebarOpen = ref(true)

  const direction = computed(() => (isRtl(locale.value) ? 'rtl' : 'ltr'))

  /** Switches language with no reload and no logout. docs/12 §4.1 */
  function setLocale(next: Locale) {
    locale.value = next
    applyLocale(next)
  }

  function toggleLocale() {
    setLocale(locale.value === 'ar' ? 'en' : 'ar')
  }

  function setTheme(next: 'light' | 'dark') {
    theme.value = next
    document.documentElement.setAttribute('data-theme', next)
  }

  function toggleTheme() {
    setTheme(theme.value === 'light' ? 'dark' : 'light')
  }

  return { locale, theme, sidebarOpen, direction, setLocale, toggleLocale, setTheme, toggleTheme }
})
