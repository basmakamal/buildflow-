<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useUiStore } from '@/stores/ui'
import type { Analysis, Finding, RuleType } from '@/api/knowledge'

/**
 * One room's analysis result.
 *
 * Exists as its own component so `Analysis` arrives already narrowed as a prop.
 * The parent holds a per-room union — loading, ready, uncovered, failed — and
 * Vue's template checker cannot carry a `kind === 'ready'` guard through an
 * indexed lookup on a ref, so inlining this meant a non-null cast at every use.
 *
 * Coverage renders unconditionally and on purpose: "nothing flagged" only means
 * something next to how many rules actually ran.
 */

const props = defineProps<{ analysis: Analysis; filter: 'all' | RuleType }>()

const { t } = useI18n()
const ui = useUiStore()

const visible = computed<Finding[]>(() =>
  props.filter === 'all'
    ? props.analysis.findings
    : props.analysis.findings.filter((finding) => finding.ruleType === props.filter),
)

const message = (finding: Finding): string =>
  ui.locale === 'ar' ? finding.message.ar : finding.message.en
</script>

<template>
  <ul v-if="visible.length > 0" class="findings">
    <li
      v-for="finding in visible"
      :key="finding.code"
      class="finding"
      :data-severity="finding.severity"
    >
      <span class="finding__severity" :data-severity="finding.severity">
        {{ t(`knowledge.severity.${finding.severity}`) }}
      </span>
      <span class="finding__body">
        <span class="finding__message">{{ message(finding) }}</span>
        <span class="finding__meta muted">
          {{ t(`knowledge.domain.${finding.domain}`) }} · {{ finding.code }}
        </span>
      </span>
    </li>
  </ul>

  <p v-else class="note note--ok">{{ t('knowledge.clean') }}</p>

  <details v-if="analysis.coverage.skipped > 0" class="coverage">
    <summary>
      {{ t('knowledge.coverage.evaluated', { count: analysis.coverage.evaluated }) }} ·
      {{ t('knowledge.coverage.skipped', { count: analysis.coverage.skipped }) }}
    </summary>
    <p class="muted coverage__why">{{ t('knowledge.coverage.why') }}</p>
    <ul class="unlocks">
      <li v-for="unlock in analysis.coverage.unlocks.slice(0, 5)" :key="unlock.fact">
        {{ t('knowledge.coverage.unlock', { fact: unlock.fact, count: unlock.rules }) }}
      </li>
    </ul>
  </details>

  <p v-else class="muted coverage__complete">
    {{ t('knowledge.coverage.evaluated', { count: analysis.coverage.evaluated }) }} ·
    {{ t('knowledge.coverage.complete') }}
  </p>
</template>

<style scoped>
.findings {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: var(--bf-space-1);
}

.finding {
  display: flex;
  align-items: flex-start;
  gap: var(--bf-space-3);
  padding: var(--bf-space-2) var(--bf-space-3);
  border-radius: var(--bf-radius-md);
  background: var(--bf-surface-sunken);
  /* Severity is carried by a text label as well as the border — never colour
     alone, which is invisible to a colour-blind site engineer. */
  border-inline-start: 3px solid var(--bf-border);
}

.finding[data-severity='critical'],
.finding[data-severity='error'] {
  border-inline-start-color: var(--bf-danger);
}

.finding[data-severity='warning'] {
  border-inline-start-color: var(--bf-warning);
}

.finding[data-severity='info'] {
  border-inline-start-color: var(--bf-info);
}

.finding__severity {
  flex: none;
  min-width: 5.5rem;
  font-size: var(--bf-text-2xs);
  font-weight: var(--bf-weight-semibold);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--bf-text-muted);
  padding-block-start: 0.15rem;
}

.finding__severity[data-severity='critical'],
.finding__severity[data-severity='error'] {
  color: var(--bf-danger);
}

.finding__severity[data-severity='warning'] {
  color: var(--bf-warning);
}

.finding__severity[data-severity='info'] {
  color: var(--bf-info);
}

.finding__body {
  display: grid;
  gap: 0.15rem;
  min-width: 0;
}

.finding__message {
  font-size: var(--bf-text-sm);
}

.finding__meta {
  font-size: var(--bf-text-2xs);
}

.note {
  margin: 0;
  font-size: var(--bf-text-sm);
  color: var(--bf-text-muted);
}

.note--ok {
  color: var(--bf-success);
}

.coverage {
  margin-top: var(--bf-space-3);
  font-size: var(--bf-text-xs);
  color: var(--bf-text-muted);
}

.coverage summary {
  cursor: pointer;
}

.coverage__why {
  margin: var(--bf-space-2) 0 var(--bf-space-1);
}

.coverage__complete {
  margin: var(--bf-space-3) 0 0;
  font-size: var(--bf-text-xs);
}

.unlocks {
  margin: 0;
  padding-inline-start: var(--bf-space-4);
  display: grid;
  gap: 0.15rem;
}

.muted {
  color: var(--bf-text-muted);
}
</style>
