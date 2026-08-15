<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'
import { BfIcon, stageIcons } from '@buildflow/ui'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'

const { t } = useI18n()
const auth = useAuthStore()
const ui = useUiStore()

const stages = Object.values(stageIcons)
</script>

<template>
  <div class="dash">
    <header class="dash__bar">
      <strong>{{ t('common.app.name') }}</strong>
      <nav class="dash__nav">
        <RouterLink to="/icons">{{ t('nav.iconLibrary') }}</RouterLink>
        <button class="link" type="button" @click="ui.toggleLocale()">
          {{ t('common.language.switch') }}
        </button>
        <button class="link" type="button" @click="auth.logout()">
          {{ t('common.actions.signOut') }}
        </button>
      </nav>
    </header>

    <main class="dash__body">
      <h1>{{ t('nav.dashboard') }}</h1>
      <p class="dash__hint">{{ t('common.app.tagline') }}</p>

      <div class="stages">
        <div v-for="icon in stages" :key="icon.name" class="stage">
          <BfIcon :icon="icon" variant="chip" size="lg" />
          <span>{{ ui.locale === 'ar' ? icon.labelAr : icon.labelEn }}</span>
        </div>
      </div>
    </main>
  </div>
</template>

<style scoped>
.dash__bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--bf-space-4) var(--bf-space-6);
  border-bottom: 1px solid var(--bf-border);
  background: var(--bf-surface);
}

.dash__nav {
  display: flex;
  gap: var(--bf-space-4);
  align-items: center;
}

.dash__nav a,
.link {
  color: var(--bf-text-muted);
  text-decoration: none;
  background: none;
  border: none;
  font: inherit;
  font-size: var(--bf-text-sm);
  cursor: pointer;
}

.dash__nav a:hover,
.link:hover {
  color: var(--bf-primary-600);
}

.dash__body {
  padding: var(--bf-space-6);
  max-width: 1200px;
  margin-inline: auto;
}

h1 {
  font-size: var(--bf-text-2xl);
  font-weight: var(--bf-weight-semibold);
  margin: 0;
}

.dash__hint {
  margin: var(--bf-space-1) 0 var(--bf-space-6);
  color: var(--bf-text-muted);
  font-size: var(--bf-text-sm);
}

.stages {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  gap: var(--bf-space-3);
}

.stage {
  display: flex;
  align-items: center;
  gap: var(--bf-space-3);
  padding: var(--bf-space-3);
  background: var(--bf-surface);
  border: 1px solid var(--bf-border);
  border-radius: var(--bf-radius-lg);
  font-size: var(--bf-text-sm);
  font-weight: var(--bf-weight-medium);
}
</style>
