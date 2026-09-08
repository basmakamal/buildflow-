<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { RouterLink, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'

const { t } = useI18n()
const auth = useAuthStore()
const ui = useUiStore()
const router = useRouter()

async function signOut() {
  await auth.logout()
  await router.push('/login')
}
</script>

<template>
  <div class="shell">
    <header class="shell__bar">
      <RouterLink to="/dashboard" class="shell__brand">{{ t('common.app.name') }}</RouterLink>
      <nav class="shell__nav">
        <RouterLink to="/projects">{{ t('nav.projects') }}</RouterLink>
        <!-- Hidden rather than disabled: a link most roles may not follow is
             noise in their navigation, and the server rejects it regardless. -->
        <RouterLink v-if="auth.can('knowledge.view')" to="/knowledge/rules">
          {{ t('nav.ruleLibrary') }}
        </RouterLink>
        <RouterLink to="/icons">{{ t('nav.iconLibrary') }}</RouterLink>
        <RouterLink v-if="auth.can('company.view_settings')" to="/settings/tax-identity">
          {{ t('nav.settings') }}
        </RouterLink>
        <button class="shell__link" type="button" @click="ui.toggleLocale()">
          {{ t('common.language.switch') }}
        </button>
        <button
          class="shell__link"
          type="button"
          :aria-label="t('common.theme.toggle')"
          @click="ui.toggleTheme()"
        >
          {{ ui.theme === 'light' ? t('common.theme.dark') : t('common.theme.light') }}
        </button>
        <button class="shell__link" type="button" @click="signOut">
          {{ t('common.actions.signOut') }}
        </button>
      </nav>
    </header>
    <main class="shell__body">
      <slot />
    </main>
  </div>
</template>

<style scoped>
.shell {
  min-height: 100%;
  display: flex;
  flex-direction: column;
}

.shell__bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--bf-space-4);
  padding: var(--bf-space-3) var(--bf-space-6);
  border-bottom: 1px solid var(--bf-border);
  background: var(--bf-surface);
  position: sticky;
  top: 0;
  z-index: var(--bf-z-sticky);
}

.shell__brand {
  font-weight: var(--bf-weight-bold);
  color: var(--bf-primary-600);
  text-decoration: none;
}

.shell__nav {
  display: flex;
  align-items: center;
  gap: var(--bf-space-4);
  /* The bar grows with every feature that earns a nav entry, and on a phone it
     ran past the viewport and scrolled the whole PAGE sideways — which drags
     the content with it, not just the bar. Wrapping keeps the overflow inside
     the header; the shrink pair stops flex from refusing to wrap. */
  flex-wrap: wrap;
  justify-content: flex-end;
  min-width: 0;
  row-gap: var(--bf-space-1);
}

.shell__nav a,
.shell__link {
  color: var(--bf-text-muted);
  text-decoration: none;
  background: none;
  border: none;
  font: inherit;
  font-size: var(--bf-text-sm);
  cursor: pointer;
  padding: 0;
}

.shell__nav a:hover,
.shell__nav a.router-link-active,
.shell__link:hover {
  color: var(--bf-primary-600);
}

.shell__body {
  flex: 1;
}
</style>
