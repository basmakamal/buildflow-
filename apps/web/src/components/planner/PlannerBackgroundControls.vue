<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { metresToMm, mmToMetres } from '@buildflow/spatial'
import { usePlannerStore } from '@/stores/planner'

/**
 * The underlay, and the calibration that makes it worth tracing. docs/08 §7.1
 *
 * Almost every real plan starts as a photograph of somebody else's drawing.
 * Tracing it only produces a usable plan if the trace comes out at the right
 * SIZE, and an image carries no scale — so the user names one distance they
 * know and everything else follows from it.
 *
 * The flow is pick, pick, then type, in that order: they have to SEE the line
 * across the door before they can tell us it is nine hundred millimetres.
 */

const { t } = useI18n()
const store = usePlannerStore()

const knownLength = ref('')

/**
 * The object URL is deliberately not revoked when the background is cleared.
 *
 * Clearing is undoable, and an undo that restored a revoked URL would put a
 * broken image back on the plan. One leaked blob per image the user loads is
 * the cheaper mistake, and the page discards them all on navigation anyway.
 */
function onFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  const source = URL.createObjectURL(file)
  const probe = new Image()
  probe.onload = () => {
    store.setBackground({
      source,
      pixelWidth: probe.naturalWidth,
      pixelHeight: probe.naturalHeight,
    })
  }
  probe.src = source
  // Let the same file be chosen twice — a user who reloads a corrected export
  // would otherwise find the control silently inert.
  input.value = ''
}

const measured = computed(() =>
  store.calibrationLengthMm === null
    ? null
    : Number(mmToMetres(store.calibrationLengthMm)).toFixed(3),
)

const scaleLabel = computed(() =>
  store.background ? `${store.background.mmPerPixel.toFixed(2)} mm/px` : null,
)

function applyCalibration() {
  const metres = Number.parseFloat(knownLength.value)
  if (!Number.isFinite(metres)) return
  if (store.applyCalibration(metresToMm(metres))) knownLength.value = ''
}

function startCalibration() {
  store.cancelCalibration()
  store.setTool('calibrate')
}
</script>

<template>
  <div class="underlay">
    <label class="underlay__file">
      {{ t('planner.background') }}
      <input type="file" accept="image/*" class="underlay__input" @change="onFile" />
    </label>

    <template v-if="store.background">
      <label class="underlay__field">
        {{ t('planner.opacity') }}
        <input
          type="range"
          min="0"
          max="100"
          :value="Math.round(store.background.opacity * 100)"
          @input="
            store.setBackgroundOpacity(Number(($event.target as HTMLInputElement).value) / 100)
          "
        />
      </label>

      <button
        type="button"
        class="underlay__button"
        :class="{ 'underlay__button--active': store.tool === 'calibrate' }"
        :aria-pressed="store.tool === 'calibrate'"
        @click="startCalibration"
      >
        {{ t('planner.calibrate') }}
      </button>

      <p v-if="store.tool === 'calibrate' && measured === null" class="underlay__hint">
        {{ t('planner.calibrateHint') }}
      </p>

      <label v-if="measured !== null" class="underlay__field">
        {{ t('planner.knownLength') }}
        <input
          v-model="knownLength"
          class="underlay__number"
          type="text"
          inputmode="decimal"
          :placeholder="measured"
          :aria-label="t('planner.knownLengthHint')"
          @keydown.enter.prevent="applyCalibration"
        />
        <button type="button" class="underlay__button" @click="applyCalibration">
          {{ t('planner.apply') }}
        </button>
      </label>

      <p v-if="scaleLabel" class="underlay__scale">{{ scaleLabel }}</p>

      <button type="button" class="underlay__button" @click="store.clearBackground()">
        {{ t('planner.removeBackground') }}
      </button>
    </template>
  </div>
</template>

<style scoped>
.underlay {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.875rem;
}

.underlay__file,
.underlay__field {
  display: flex;
  align-items: center;
  gap: 0.35rem;
}

.underlay__input {
  font: inherit;
  font-size: 0.75rem;
  inline-size: 11rem;
}

.underlay__number {
  inline-size: 5rem;
  padding: 0.3rem 0.4rem;
  border: 1px solid var(--color-border, #e2e8f0);
  border-radius: 0.375rem;
  font: inherit;
  font-variant-numeric: tabular-nums;
  direction: ltr;
  text-align: end;
}

.underlay__button {
  padding: 0.3rem 0.6rem;
  border: 1px solid var(--color-border, #e2e8f0);
  border-radius: 0.375rem;
  background: var(--color-surface, #fff);
  font: inherit;
  font-size: 0.8125rem;
  cursor: pointer;
}

.underlay__button--active {
  background: #dc2626;
  border-color: #dc2626;
  color: #fff;
}

.underlay__hint,
.underlay__scale {
  margin: 0;
  color: var(--color-text-muted, #64748b);
  font-size: 0.8125rem;
}

.underlay__scale {
  font-variant-numeric: tabular-nums;
  direction: ltr;
}
</style>
