<script setup lang="ts">
import { computed } from 'vue'
import type { IconDef } from './types'

const props = withDefaults(
  defineProps<{
    /** Icon definition from the registry, or a raw name resolved by the caller. */
    icon: IconDef
    /** Token size, or any CSS length for one-off cases. */
    size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | (string & {})
    /** Overrides the default 1.5 — use 2 for large hero icons so weight reads evenly. */
    strokeWidth?: number
    /**
     * Decorative icons sit next to a visible text label and are hidden from
     * assistive technology. Meaningful icons (an icon-only button) must pass a
     * label. Defaults to decorative because that is the common, safe case.
     */
    label?: string
  }>(),
  { size: 'md', strokeWidth: 1.5 },
)

const SIZE_TOKENS: Record<string, string> = {
  sm: 'var(--bf-icon-sm)',
  md: 'var(--bf-icon-md)',
  lg: 'var(--bf-icon-lg)',
  xl: 'var(--bf-icon-xl)',
  '2xl': 'var(--bf-icon-2xl)',
}

const resolvedSize = computed(() => SIZE_TOKENS[props.size] ?? props.size)
const isDecorative = computed(() => !props.label)
</script>

<template>
  <svg
    class="bf-icon"
    :class="{ 'bf-icon--mirror': icon.mirrorInRtl }"
    :style="{ width: resolvedSize, height: resolvedSize }"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    :stroke-width="strokeWidth"
    stroke-linecap="round"
    stroke-linejoin="round"
    :aria-hidden="isDecorative ? 'true' : undefined"
    :role="isDecorative ? undefined : 'img'"
    :aria-label="label"
    :data-icon="icon.name"
    v-html="icon.body"
  />
</template>

<style scoped>
.bf-icon {
  display: inline-block;
  flex: none;
  vertical-align: -0.125em;
  /* Keeps stroke weight optically constant as the icon scales. */
  vector-effect: non-scaling-stroke;
}

/*
 * Only icons explicitly flagged mirrorInRtl flip. Directional affordances
 * (back, next, trend) follow reading order; physical objects never do — a
 * socket or a suspended ceiling looks the same in Arabic. docs/12 §4.3
 */
[dir='rtl'] .bf-icon--mirror {
  transform: scaleX(-1);
}
</style>
