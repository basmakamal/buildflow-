<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { BfIcon, iconGroups, iconCount, searchIcons } from '@buildflow/ui'
import { useUiStore } from '@/stores/ui'

/**
 * The icon library, rendered by the real BfIcon component.
 *
 * The generated HTML gallery proved the SVG paths; this proves the component —
 * tone resolution, the chip variant, and RTL behaviour inside an actual Vue
 * app rather than a static export.
 */
const { t } = useI18n()
const ui = useUiStore()
const query = ref('')

const matches = computed(() => new Set(searchIcons(query.value).map((i) => i.name)))

const groups = computed(() =>
  iconGroups
    .map((g) => ({ ...g, icons: g.icons.filter((i) => matches.value.has(i.name)) }))
    .filter((g) => g.icons.length > 0),
)

const groupLabel = (category: string): string => t('icons.groups.' + category)
</script>

<template>
  <div class="icons">
    <header class="icons__head">
      <div>
        <h1>{{ t('icons.title') }}</h1>
        <p>{{ t('icons.subtitle', { count: iconCount }) }}</p>
      </div>
      <div class="icons__tools">
        <input
          v-model="query"
          type="search"
          class="icons__search"
          :placeholder="t('icons.searchPlaceholder')"
          :aria-label="t('icons.searchPlaceholder')"
        />
        <button class="chip" type="button" @click="ui.toggleLocale()">
          {{ t('common.language.switch') }}
        </button>
        <button
          class="chip"
          type="button"
          :aria-label="t('common.theme.toggle')"
          @click="ui.toggleTheme()"
        >
          {{ ui.theme === 'light' ? t('common.theme.dark') : t('common.theme.light') }}
        </button>
      </div>
    </header>

    <p v-if="groups.length === 0" class="icons__empty">{{ t('icons.noResults') }}</p>

    <section v-for="group in groups" :key="group.category" class="group">
      <h2>
        <span>{{ groupLabel(group.category) }}</span>
        <em class="numeric">{{ group.icons.length }}</em>
      </h2>
      <div class="grid">
        <figure v-for="icon in group.icons" :key="icon.name" class="card">
          <div class="card__preview">
            <BfIcon :icon="icon" variant="chip" size="lg" />
            <BfIcon :icon="icon" size="lg" />
            <BfIcon :icon="icon" size="sm" />
          </div>
          <figcaption>
            <b>{{ ui.locale === 'ar' ? icon.labelAr : icon.labelEn }}</b>
            <code class="numeric">{{ icon.name }}</code>
          </figcaption>
        </figure>
      </div>
    </section>
  </div>
</template>

<style scoped>
.icons {
  padding: var(--bf-space-6);
  max-width: 1400px;
  margin-inline: auto;
}

.icons__head {
  display: flex;
  flex-wrap: wrap;
  gap: var(--bf-space-4);
  align-items: flex-end;
  justify-content: space-between;
  margin-bottom: var(--bf-space-6);
}

.icons__head h1 {
  margin: 0;
  font-size: var(--bf-text-2xl);
  font-weight: var(--bf-weight-semibold);
}

.icons__head p {
  margin: var(--bf-space-1) 0 0;
  color: var(--bf-text-muted);
  font-size: var(--bf-text-sm);
}

.icons__tools {
  display: flex;
  gap: var(--bf-space-2);
  align-items: center;
}

.icons__search {
  padding-block: 0.55rem;
  padding-inline: 0.85rem;
  border: 1px solid var(--bf-border);
  border-radius: var(--bf-radius-md);
  background: var(--bf-surface);
  color: var(--bf-text);
  font: inherit;
  font-size: var(--bf-text-sm);
  min-width: 220px;
}

.icons__search:focus {
  outline: none;
  border-color: var(--bf-primary-600);
  box-shadow: var(--bf-ring);
}

.chip {
  padding-block: 0.5rem;
  padding-inline: 0.8rem;
  border: 1px solid var(--bf-border);
  border-radius: var(--bf-radius-md);
  background: var(--bf-surface);
  color: var(--bf-text-muted);
  font: inherit;
  font-size: var(--bf-text-sm);
  cursor: pointer;
}

.chip:hover {
  color: var(--bf-primary-600);
  border-color: var(--bf-primary-600);
}

.group {
  margin-bottom: var(--bf-space-10);
}

.group h2 {
  display: flex;
  align-items: baseline;
  gap: var(--bf-space-3);
  font-size: var(--bf-text-lg);
  font-weight: var(--bf-weight-semibold);
  margin: 0 0 var(--bf-space-4);
  padding-bottom: var(--bf-space-3);
  border-bottom: 1px solid var(--bf-border);
}

.group h2 em {
  /* Logical margin: pushes to the right in LTR, to the left in RTL. */
  margin-inline-start: auto;
  font-style: normal;
  font-size: var(--bf-text-xs);
  color: var(--bf-text-muted);
  border: 1px solid var(--bf-border);
  border-radius: var(--bf-radius-full);
  padding-block: 0.1rem;
  padding-inline: 0.55rem;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
  gap: var(--bf-space-3);
}

.card {
  margin: 0;
  padding: var(--bf-space-4) var(--bf-space-3) var(--bf-space-3);
  background: var(--bf-surface);
  border: 1px solid var(--bf-border);
  border-radius: var(--bf-radius-lg);
  text-align: center;
  transition: all var(--bf-duration-micro) var(--bf-ease);
}

.card:hover {
  transform: translateY(-2px);
  box-shadow: var(--bf-shadow-card);
  border-color: var(--bf-border-strong);
}

.card__preview {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--bf-space-3);
  min-height: 46px;
  margin-bottom: var(--bf-space-3);
}

figcaption b {
  display: block;
  font-size: var(--bf-text-sm);
  font-weight: var(--bf-weight-semibold);
}

figcaption code {
  display: block;
  margin-top: var(--bf-space-1);
  font-size: 10px;
  color: var(--bf-text-muted);
  font-family: var(--bf-font-mono);
  word-break: break-all;
}

.icons__empty {
  text-align: center;
  color: var(--bf-text-muted);
  padding: var(--bf-space-12);
}
</style>
