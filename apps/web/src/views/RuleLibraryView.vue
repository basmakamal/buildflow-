<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  SEVERITIES,
  fetchRules,
  revertOverride,
  saveOverride,
  type EffectiveRule,
  type RuleOverridePayload,
} from '@/api/knowledge'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'
import AppShell from '@/components/AppShell.vue'

/**
 * Rule library — the admin surface over the AI knowledge base.
 *
 * A tenant never edits a shipped rule. It saves an override keyed by the same
 * code, and the server merges the two, so a product update to a rule still
 * reaches a tenant that only changed its severity, and "undo" is a delete
 * rather than restoring a copy from somewhere.
 *
 * Disabled rules stay in the list, flagged. A screen that hides what you have
 * switched off gives you no way to switch it back on, and no way to notice that
 * a check you assumed was running is not.
 */

const { t } = useI18n()
const auth = useAuthStore()
const ui = useUiStore()

const rules = ref<EffectiveRule[]>([])
const loading = ref(true)
const search = ref('')
const editing = ref<string | null>(null)
const draft = ref<RuleOverridePayload>({})
const busy = ref<string | null>(null)
const error = ref<string | null>(null)

const canManage = computed(() => auth.can('knowledge.manage'))

const message = (rule: EffectiveRule): string =>
  ui.locale === 'ar' ? rule.messageAr : rule.messageEn

const visible = computed(() => {
  const term = search.value.trim().toLowerCase()
  if (!term) return rules.value
  return rules.value.filter(
    (rule) =>
      rule.code.toLowerCase().includes(term) ||
      rule.domain.toLowerCase().includes(term) ||
      rule.messageEn.toLowerCase().includes(term) ||
      rule.messageAr.includes(term),
  )
})

async function load(): Promise<void> {
  loading.value = true
  const result = await fetchRules()
  if (result.ok) rules.value = result.data.data
  loading.value = false
}

/** Re-reads the list after every write so the screen never drifts from the server. */
async function commit(code: string, action: () => Promise<{ ok: boolean }>): Promise<void> {
  busy.value = code
  error.value = null
  const result = await action()
  if (!result.ok) error.value = code
  busy.value = null
  await load()
}

async function toggleDisabled(rule: EffectiveRule): Promise<void> {
  // Re-enabling is safe and needs no confirmation; switching a check OFF for
  // every room in the company is the direction that deserves friction.
  if (!rule.disabled && !window.confirm(t('knowledge.admin.disableWarning'))) return

  await commit(rule.code, () =>
    rule.disabled
      ? // Re-enabling a shipped rule means dropping the override entirely
        // rather than writing isDisabled:false, which would leave a no-op row
        // behind and mark the rule "Edited" forever.
        revertOverride(rule.code)
      : saveOverride(rule.code, { isDisabled: true }),
  )
}

function startEdit(rule: EffectiveRule): void {
  editing.value = rule.code
  draft.value = {
    severity: rule.severity,
    priority: rule.priority,
    messageEn: rule.messageEn,
    messageAr: rule.messageAr,
  }
}

async function saveEdit(rule: EffectiveRule): Promise<void> {
  await commit(rule.code, () => saveOverride(rule.code, draft.value))
  editing.value = null
}

async function revert(rule: EffectiveRule): Promise<void> {
  if (!window.confirm(t('knowledge.admin.revertConfirm'))) return
  await commit(rule.code, () => revertOverride(rule.code))
}

onMounted(load)
</script>

<template>
  <AppShell>
    <div class="library">
      <header class="library__head">
        <div>
          <h1>{{ t('knowledge.admin.title') }}</h1>
          <p class="muted">{{ t('knowledge.admin.subtitle') }}</p>
        </div>
        <input
          v-model="search"
          class="input"
          type="search"
          :placeholder="t('knowledge.admin.search')"
          :aria-label="t('knowledge.admin.search')"
        />
      </header>

      <p v-if="!canManage" class="notice">{{ t('knowledge.admin.readOnly') }}</p>

      <p v-if="loading" class="muted">{{ t('common.state.loading') }}</p>

      <template v-else>
        <p class="muted count">
          {{ t('knowledge.admin.count', { shown: visible.length, total: rules.length }) }}
        </p>

        <p v-if="visible.length === 0" class="muted">{{ t('knowledge.admin.empty') }}</p>

        <ul class="rules">
          <li
            v-for="rule in visible"
            :key="rule.code"
            class="rule"
            :data-disabled="rule.disabled"
            :aria-busy="busy === rule.code"
          >
            <div class="rule__main">
              <div class="rule__title">
                <code class="rule__code">{{ rule.code }}</code>
                <span class="badge" :data-severity="rule.severity">
                  {{ t(`knowledge.severity.${rule.severity}`) }}
                </span>
                <span class="badge">{{ t(`knowledge.domain.${rule.domain}`) }}</span>
                <span class="badge" :data-source="rule.source">
                  {{ t(`knowledge.admin.source.${rule.source}`) }}
                </span>
                <span v-if="rule.disabled" class="badge badge--off">
                  {{ t('knowledge.admin.disabled') }}
                </span>
              </div>

              <p v-if="editing !== rule.code" class="rule__message">{{ message(rule) }}</p>

              <form v-else class="editor" @submit.prevent="saveEdit(rule)">
                <label class="field">
                  <span class="field__label">{{ t('knowledge.admin.fields.severity') }}</span>
                  <select v-model="draft.severity" class="input">
                    <option v-for="severity in SEVERITIES" :key="severity" :value="severity">
                      {{ t(`knowledge.severity.${severity}`) }}
                    </option>
                  </select>
                </label>

                <label class="field">
                  <span class="field__label">{{ t('knowledge.admin.fields.priority') }}</span>
                  <input
                    v-model.number="draft.priority"
                    class="input numeric"
                    type="number"
                    min="0"
                    max="32767"
                  />
                </label>

                <label class="field field--wide">
                  <span class="field__label">{{ t('knowledge.admin.fields.messageEn') }}</span>
                  <input v-model="draft.messageEn" class="input" dir="ltr" maxlength="500" />
                </label>

                <label class="field field--wide">
                  <span class="field__label">{{ t('knowledge.admin.fields.messageAr') }}</span>
                  <input v-model="draft.messageAr" class="input" dir="rtl" maxlength="500" />
                </label>

                <div class="editor__actions">
                  <button class="btn btn--small btn--primary" type="submit">
                    {{ t('knowledge.admin.actions.save') }}
                  </button>
                  <button class="btn btn--small" type="button" @click="editing = null">
                    {{ t('knowledge.admin.actions.cancel') }}
                  </button>
                </div>
              </form>

              <p v-if="error === rule.code" class="rule__error">
                {{ t('knowledge.admin.saveFailed') }}
              </p>
            </div>

            <div v-if="canManage && editing !== rule.code" class="rule__actions">
              <button
                v-if="!rule.disabled"
                class="btn btn--small"
                type="button"
                @click="startEdit(rule)"
              >
                {{ t('knowledge.admin.actions.edit') }}
              </button>

              <!-- No `title` here. A tooltip becomes the button's ACCESSIBLE
                   NAME, so a screen reader announced the warning sentence
                   instead of "Disable". The consequence is stated in the
                   confirm instead, where it also stops an accidental click. -->
              <button
                class="btn btn--small"
                :class="{ 'btn--danger': !rule.disabled }"
                type="button"
                @click="toggleDisabled(rule)"
              >
                {{
                  rule.disabled
                    ? t('knowledge.admin.actions.enable')
                    : t('knowledge.admin.actions.disable')
                }}
              </button>

              <button
                v-if="rule.source === 'tenant_override' && !rule.disabled"
                class="btn btn--small"
                type="button"
                @click="revert(rule)"
              >
                {{ t('knowledge.admin.actions.revert') }}
              </button>
            </div>
          </li>
        </ul>
      </template>
    </div>
  </AppShell>
</template>

<style scoped>
.library {
  padding: var(--bf-space-6);
  max-width: 1000px;
  margin-inline: auto;
}

.library__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--bf-space-4);
  flex-wrap: wrap;
  margin-bottom: var(--bf-space-4);
}

.library__head h1 {
  margin: 0;
  font-size: var(--bf-text-2xl);
  font-weight: var(--bf-weight-semibold);
}

.notice {
  margin: 0 0 var(--bf-space-3);
  padding: var(--bf-space-2) var(--bf-space-3);
  border-radius: var(--bf-radius-md);
  background: var(--bf-surface-sunken);
  color: var(--bf-text-muted);
  font-size: var(--bf-text-sm);
}

.count {
  margin: 0 0 var(--bf-space-2);
  font-size: var(--bf-text-xs);
}

.rules {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: var(--bf-space-2);
}

.rule {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--bf-space-4);
  padding: var(--bf-space-3) var(--bf-space-4);
  background: var(--bf-surface);
  border: 1px solid var(--bf-border);
  border-radius: var(--bf-radius-lg);
}

/* A disabled rule is dimmed AND labelled — opacity alone reads as a loading
   state rather than a deliberate switch-off. */
.rule[data-disabled='true'] {
  opacity: 0.62;
}

.rule__main {
  min-width: 0;
  flex: 1;
}

.rule__title {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--bf-space-2);
  margin-bottom: var(--bf-space-2);
}

.rule__code {
  font-family: var(--bf-font-mono, monospace);
  font-size: var(--bf-text-xs);
  direction: ltr;
  unicode-bidi: isolate;
}

.rule__message {
  margin: 0;
  font-size: var(--bf-text-sm);
}

.rule__error {
  margin: var(--bf-space-2) 0 0;
  color: var(--bf-danger);
  font-size: var(--bf-text-xs);
}

.rule__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--bf-space-1);
  justify-content: flex-end;
}

.editor {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: var(--bf-space-2);
  align-items: end;
}

.field {
  display: grid;
  gap: 0.2rem;
}

.field--wide {
  grid-column: 1 / -1;
}

.field__label {
  font-size: var(--bf-text-2xs);
  color: var(--bf-text-muted);
}

.editor__actions {
  grid-column: 1 / -1;
  display: flex;
  gap: var(--bf-space-1);
}

.input {
  padding-block: 0.4rem;
  padding-inline: 0.6rem;
  border: 1px solid var(--bf-border);
  border-radius: var(--bf-radius-sm);
  background: var(--bf-bg);
  color: var(--bf-text);
  font: inherit;
  font-size: var(--bf-text-sm);
  min-width: 0;
}

.btn {
  border: 1px solid var(--bf-border);
  border-radius: var(--bf-radius-md);
  background: var(--bf-surface);
  color: var(--bf-text);
  font: inherit;
  cursor: pointer;
  padding-block: 0.55rem;
  padding-inline: 1rem;
}

.btn--small {
  font-size: var(--bf-text-xs);
  padding-block: 0.3rem;
  padding-inline: 0.6rem;
}

.btn--primary {
  background: var(--bf-primary-600);
  border-color: var(--bf-primary-600);
  color: #fff;
}

.btn--danger {
  color: var(--bf-danger);
  border-color: var(--bf-danger);
}

.badge {
  font-size: var(--bf-text-2xs);
  padding-block: 0.1rem;
  padding-inline: 0.5rem;
  border-radius: var(--bf-radius-full);
  border: 1px solid var(--bf-border);
  color: var(--bf-text-muted);
  white-space: nowrap;
}

.badge[data-severity='critical'],
.badge[data-severity='error'] {
  color: var(--bf-danger);
  border-color: var(--bf-danger);
}

.badge[data-severity='warning'] {
  color: var(--bf-warning);
  border-color: var(--bf-warning);
}

.badge[data-source='tenant_override'],
.badge[data-source='tenant_custom'] {
  color: var(--bf-info);
  border-color: var(--bf-info);
}

.badge--off {
  color: var(--bf-danger);
  border-color: var(--bf-danger);
}

.muted {
  color: var(--bf-text-muted);
}
</style>
