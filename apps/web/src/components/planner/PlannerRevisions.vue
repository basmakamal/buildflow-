<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { usePlannerStore } from '@/stores/planner'

/**
 * Named, restorable snapshots. docs/04 §2.5
 *
 * The name is mandatory and the field says why: a list of numbered versions is
 * not a history anybody can navigate six months later. "Before the client
 * meeting" is.
 *
 * Restoring asks first. It replaces the drawing on screen AND drops the undo
 * history — the states either side of a restore are two different drawings —
 * so it is the one action here that cannot be taken back with Ctrl+Z.
 */

const { t } = useI18n()
const store = usePlannerStore()

const name = ref('')
const open = ref(false)

async function save() {
  const label = name.value.trim()
  if (label.length === 0) return
  if (await store.saveRevision(label)) name.value = ''
}

async function restore(revisionId: string, label: string) {
  if (!window.confirm(t('planner.restoreConfirm', { name: label }))) return
  await store.restoreRevision(revisionId)
}
</script>

<template>
  <div class="revisions">
    <button type="button" class="revisions__toggle" :aria-expanded="open" @click="open = !open">
      {{ t('planner.revisions', { count: store.revisions.length }) }}
    </button>

    <div v-if="open" class="revisions__panel">
      <div class="revisions__new">
        <input
          v-model="name"
          class="revisions__input"
          type="text"
          :placeholder="t('planner.revisionName')"
          :aria-label="t('planner.revisionName')"
          :disabled="store.readOnly"
          @keydown.enter.prevent="save"
        />
        <button
          type="button"
          class="revisions__button"
          :disabled="store.readOnly || name.trim().length === 0"
          @click="save"
        >
          {{ t('planner.saveRevision') }}
        </button>
      </div>

      <p v-if="store.revisions.length === 0" class="revisions__empty">
        {{ t('planner.noRevisions') }}
      </p>

      <ul v-else class="revisions__list">
        <li v-for="revision in store.revisions" :key="revision.id" class="revisions__row">
          <span class="revisions__name"> {{ revision.revisionNumber }}. {{ revision.name }} </span>
          <span class="revisions__meta">
            {{ t('planner.objectCount', { count: revision.objectCount }) }}
          </span>
          <button
            type="button"
            class="revisions__button"
            :disabled="store.readOnly"
            @click="restore(revision.id, revision.name)"
          >
            {{ t('planner.restore') }}
          </button>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.revisions {
  position: relative;
  font-size: 0.875rem;
}

.revisions__toggle,
.revisions__button {
  padding: 0.3rem 0.6rem;
  border: 1px solid var(--color-border, #e2e8f0);
  border-radius: 0.375rem;
  background: var(--color-surface, #fff);
  font: inherit;
  font-size: 0.8125rem;
  cursor: pointer;
}

.revisions__button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.revisions__panel {
  position: absolute;
  z-index: 10;
  inset-block-start: 2.2rem;
  inset-inline-start: 0;
  inline-size: 22rem;
  padding: 0.6rem;
  border: 1px solid var(--color-border, #e2e8f0);
  border-radius: 0.5rem;
  background: var(--color-surface, #fff);
  box-shadow: 0 8px 24px rgb(15 23 42 / 12%);
}

.revisions__new {
  display: flex;
  gap: 0.35rem;
  margin-block-end: 0.5rem;
}

.revisions__input {
  flex: 1;
  min-inline-size: 0;
  padding: 0.3rem 0.4rem;
  border: 1px solid var(--color-border, #e2e8f0);
  border-radius: 0.3rem;
  font: inherit;
  font-size: 0.8125rem;
}

.revisions__list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  max-block-size: 14rem;
  overflow-y: auto;
}

.revisions__row {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.revisions__name {
  flex: 1;
  min-inline-size: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.revisions__meta,
.revisions__empty {
  font-size: 0.75rem;
  color: var(--color-text-muted, #64748b);
  white-space: nowrap;
}
</style>
