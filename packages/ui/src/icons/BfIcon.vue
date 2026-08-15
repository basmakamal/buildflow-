<script setup lang="ts">
import { computed } from 'vue'
import type { IconDef } from './types'
import { toneFor, toneColorVar, toneTintVar, type IconTone } from './tones'

const props = withDefaults(
  defineProps<{
    /** Icon definition from the registry. */
    icon: IconDef
    /** Token size, or any CSS length for one-off cases. */
    size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | (string & {})
    /**
     * How the icon is coloured.
     *  • `tone`  — stroked in its trade colour. The default: colour carries
     *              meaning, so a socket is amber everywhere it appears.
     *  • `chip`  — trade colour on a tinted rounded backdrop. For list rows,
     *              catalogue cards, and anywhere the icon is the leading element.
     *  • `mono`  — inherits `currentColor`. For inline use inside a button or a
     *              sentence, where a coloured glyph would fight the text.
     */
    variant?: 'tone' | 'chip' | 'mono'
    /** Override the derived trade colour. Rarely needed. */
    tone?: IconTone
    /** Overrides the default 1.5 — use 2 at 32px+ so weight reads evenly. */
    strokeWidth?: number
    /**
     * Decorative icons sit beside a visible text label and are hidden from
     * assistive technology. Icon-only controls MUST pass a label. Defaults to
     * decorative because that is the common, safe case.
     */
    label?: string
  }>(),
  { size: 'md', variant: 'tone', strokeWidth: 1.5 },
)

const SIZE_TOKENS: Record<string, string> = {
  sm: 'var(--bf-icon-sm)',
  md: 'var(--bf-icon-md)',
  lg: 'var(--bf-icon-lg)',
  xl: 'var(--bf-icon-xl)',
  '2xl': 'var(--bf-icon-2xl)',
}

const resolvedSize = computed(() => SIZE_TOKENS[props.size] ?? props.size)
const resolvedTone = computed(() => props.tone ?? toneFor(props.icon.name))
const isDecorative = computed(() => !props.label)

const styleVars = computed(() =>
  props.variant === 'mono'
    ? {}
    : {
        '--icon-color': toneColorVar(resolvedTone.value),
        '--icon-tint': toneTintVar(resolvedTone.value),
      },
)
</script>

<template>
  <!--
    AUDITED EXCEPTION to the project-wide v-html ban (docs/11 §5.2).

    `icon.body` is never user input. It is an SVG fragment defined as a
    compile-time constant in packages/ui/src/icons/*.ts, authored and reviewed
    in this repository. It cannot reach this component from the API, the
    database, or a tenant. Rendering it needs v-html because the markup is a
    variable set of SVG elements, not text.

    The ban stays enabled everywhere else; this is the single audited waiver.
    If icon bodies ever become tenant-supplied or database-backed, replace this
    with a parsed allow-list renderer — v-html would then be a stored-XSS vector.
  -->
  <!-- eslint-disable vue/no-v-html -->
  <span v-if="variant === 'chip'" class="bf-icon-chip" :style="styleVars" :data-tone="resolvedTone">
    <svg
      class="bf-icon bf-icon--tone"
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
  </span>

  <svg
    v-else
    class="bf-icon"
    :class="{ 'bf-icon--tone': variant === 'tone', 'bf-icon--mirror': icon.mirrorInRtl }"
    :style="{ width: resolvedSize, height: resolvedSize, ...styleVars }"
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
  <!-- eslint-enable vue/no-v-html -->
</template>

<style scoped>
.bf-icon {
  display: inline-block;
  flex: none;
  vertical-align: -0.125em;
  vector-effect: non-scaling-stroke;
}

/*
 * Solid shapes inside an icon (socket pin holes, LED dots, acoustic
 * perforations) are authored as fill="currentColor". Setting `color` rather
 * than `stroke` means one declaration tints both channels — so strokes and
 * fills can never drift out of sync.
 */
.bf-icon--tone {
  color: var(--icon-color);
}

.bf-icon-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.45em;
  border-radius: var(--bf-radius-md);
  background: var(--icon-tint);
  color: var(--icon-color);
  line-height: 0;
}

/*
 * Only icons explicitly flagged `mirrorInRtl` flip. Directional affordances
 * follow reading order; physical objects never do — a socket, a suspended
 * ceiling, and a sofa look the same in Arabic. docs/12 §4.3
 */
[dir='rtl'] .bf-icon--mirror {
  transform: scaleX(-1);
}

/* Forced-colours mode discards custom properties; fall back to system text. */
@media (forced-colors: active) {
  .bf-icon--tone,
  .bf-icon-chip {
    color: CanvasText;
    background: Canvas;
  }
}
</style>
