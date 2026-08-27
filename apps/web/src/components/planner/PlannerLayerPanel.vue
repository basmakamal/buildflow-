<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { usePlannerStore } from '@/stores/planner'

/**
 * The layer panel. docs/08 §7.1
 *
 * Three controls per layer, and the difference between the last two is the
 * point of the feature: ACTIVE decides where the next wall lands, VISIBLE
 * decides whether it can be seen (and so whether it can be touched at all),
 * LOCKED decides whether it can be touched while still being seen — which is
 * exactly what a traced survey needs to be.
 */

const { t } = useI18n()
const store = usePlannerStore()
</script>

<template>
  <aside class="layers" :aria-label="t('planner.layers')">
    <h2 class="layers__title">{{ t('planner.layers') }}</h2>
    <ul class="layers__list">
      <li v-for="layer in store.layers" :key="layer.id" class="layers__row">
        <label class="layers__active">
          <input
            type="radio"
            name="active-layer"
            :value="layer.id"
            :checked="store.activeLayer === layer.id"
            :aria-label="t('planner.layerActive')"
            @change="store.setActiveLayer(layer.id)"
          />
          <span
            class="layers__swatch"
            :style="{ background: layer.colour ?? 'var(--color-text, #1e293b)' }"
          />
          <span class="layers__name">{{ layer.name }}</span>
        </label>

        <button
          type="button"
          class="layers__toggle"
          :aria-pressed="layer.visible"
          :title="t('planner.layerVisible')"
          @click="store.toggleLayerVisible(layer.id)"
        >
          {{ layer.visible ? t('planner.shown') : t('planner.hidden') }}
        </button>
        <button
          type="button"
          class="layers__toggle"
          :aria-pressed="layer.locked"
          :title="t('planner.layerLocked')"
          @click="store.toggleLayerLocked(layer.id)"
        >
          {{ layer.locked ? t('planner.locked') : t('planner.unlocked') }}
        </button>
      </li>
    </ul>
  </aside>
</template>

<style scoped>
.layers {
  padding: 0.75rem;
  border-inline-start: 1px solid var(--color-border, #e2e8f0);
  background: var(--color-surface, #fff);
  inline-size: 15rem;
  overflow-y: auto;
}

.layers__title {
  margin: 0 0 0.5rem;
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--color-text-muted, #64748b);
}

.layers__list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.layers__row {
  display: flex;
  align-items: center;
  gap: 0.35rem;
}

.layers__active {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  flex: 1;
  min-inline-size: 0;
  font-size: 0.875rem;
  cursor: pointer;
}

.layers__swatch {
  inline-size: 0.75rem;
  block-size: 0.75rem;
  border-radius: 0.2rem;
  flex: none;
}

.layers__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.layers__toggle {
  padding: 0.15rem 0.4rem;
  border: 1px solid var(--color-border, #e2e8f0);
  border-radius: 0.3rem;
  background: var(--color-surface, #fff);
  font: inherit;
  font-size: 0.75rem;
  cursor: pointer;
}

.layers__toggle[aria-pressed='false'] {
  color: var(--color-text-muted, #94a3b8);
}
</style>
