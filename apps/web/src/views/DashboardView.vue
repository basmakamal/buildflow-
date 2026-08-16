<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { BfIcon, stageIcons } from '@buildflow/ui'
import { useUiStore } from '@/stores/ui'
import AppShell from '@/components/AppShell.vue'

const { t } = useI18n()
const ui = useUiStore()

const stages = Object.values(stageIcons)
</script>

<template>
  <AppShell>
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
  </AppShell>
</template>

<style scoped>
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
