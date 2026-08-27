<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { metresToMm, mmToMetres } from '@buildflow/spatial'
import PlannerCanvas from '@/components/planner/PlannerCanvas.vue'
import PlannerLayerPanel from '@/components/planner/PlannerLayerPanel.vue'
import PlannerBackgroundControls from '@/components/planner/PlannerBackgroundControls.vue'
import PlannerRoomPanel from '@/components/planner/PlannerRoomPanel.vue'
import PlannerRevisions from '@/components/planner/PlannerRevisions.vue'
import PlannerExport from '@/components/planner/PlannerExport.vue'
import type { SheetRenderer } from '@/components/planner/sheet-renderer'

/**
 * Six hundred kilobytes of Three.js, fetched the first time somebody asks for
 * it and never on the way to drawing a wall. docs/08 §8.4
 */
const PlanViewer3D = defineAsyncComponent(() => import('@/components/viewer/PlanViewer3D.vue'))
import { usePlannerStore, type PlannerTool } from '@/stores/planner'
import { useAuthStore } from '@/stores/auth'

/**
 * The planner shell. Phase 5 sprints 1–6 — the Konva foundation, wall drawing,
 * the snapping pipeline and R-tree, live editable dimensions, openings,
 * structure, layers, a calibrated background, and detected rooms. docs/08 §7
 *
 * The toolbar owns no geometry. It sets a tool, toggles a snap, or hands a
 * length to the store; everything else is the store's and the spatial core's.
 */

const { t } = useI18n()
const route = useRoute()
const store = usePlannerStore()
const auth = useAuthStore()

/**
 * Persistence, on three timers. docs/08 §7.5, §7.6
 *
 * AUTOSAVE is debounced two seconds after the last edit — drawing produces
 * dozens of commits a minute and a save per commit would be a request per
 * stroke. The HEARTBEAT refreshes the advisory lock at half its TTL, so one
 * dropped request does not hand the plan to somebody else mid-sentence. And
 * the lock is RELEASED on unmount, so closing the tab frees the plan
 * immediately rather than after the TTL runs out.
 */
/**
 * The canvas is the only thing that can render a sheet — it owns the stage —
 * so the export control is handed its renderer rather than reaching for a
 * second copy of every drawing rule.
 */
const canvas = ref<{ exportImage: SheetRenderer } | null>(null)
const renderSheet: SheetRenderer = (layout, block) =>
  canvas.value?.exportImage(layout, block) ?? null

const AUTOSAVE_MS = 2000
const HEARTBEAT_MS = 60_000

let autosave: ReturnType<typeof setTimeout> | null = null
let heartbeat: ReturnType<typeof setInterval> | null = null

onMounted(async () => {
  const unitId = String(route.params['unitId'] ?? '')
  if (!unitId || !auth.userId) return

  await store.loadPlan(unitId, auth.userId)
  await store.heartbeat()
  await store.loadRevisions()
  heartbeat = setInterval(() => {
    void store.heartbeat()
  }, HEARTBEAT_MS)
})

watch(
  () => store.dirty,
  (dirty) => {
    if (!dirty) return
    if (autosave) clearTimeout(autosave)
    autosave = setTimeout(() => {
      void store.savePlan()
    }, AUTOSAVE_MS)
  },
)

onBeforeUnmount(() => {
  if (autosave) clearTimeout(autosave)
  if (heartbeat) clearInterval(heartbeat)
  // Save what is outstanding BEFORE handing the lock back, or the next editor
  // opens a plan that is missing the last few seconds of work.
  void store.savePlan().finally(() => store.releaseLock())
})

const saveState = computed(() => {
  if (store.saving) return t('planner.saving')
  if (store.dirty) return t('planner.unsaved')
  if (store.lastSavedAt) {
    return t('planner.savedAt', { time: store.lastSavedAt.toLocaleTimeString() })
  }
  return null
})

const TOOLS: PlannerTool[] = ['select', 'wall', 'door', 'window', 'column', 'beam', 'pan']

/** The thicknesses a regional contractor actually builds in, in millimetres. */
const THICKNESSES = [100, 150, 200, 250, 300]

/**
 * The live dimension.
 *
 * It MIRRORS the plan while the user is elsewhere and stops mirroring the
 * moment they start typing — a field that rewrites itself under the cursor
 * cannot be typed into, and this one is typed into constantly.
 */
/** Which representation is on screen. The plan stays loaded behind the 3D. */
const showViewer = ref(false)

const lengthField = ref('')
const editing = ref(false)

const displayLength = computed(() =>
  store.dimensionMm === null ? '' : Number(mmToMetres(store.dimensionMm)).toFixed(3),
)

watch(
  displayLength,
  (value) => {
    if (!editing.value) lengthField.value = value
  },
  { immediate: true },
)

/** Null when there is nothing to dimension — the field disables rather than lies. */
const canDimension = computed(() => store.dimensionMm !== null)

function commitLength() {
  const metres = Number.parseFloat(lengthField.value)
  if (!Number.isFinite(metres)) return
  store.commitDimension(metresToMm(metres))
  editing.value = false
  lengthField.value = displayLength.value
}

function cancelLength() {
  editing.value = false
  lengthField.value = displayLength.value
}

const bearing = computed(() =>
  store.dimensionAngleDeg === null ? null : Math.round(store.dimensionAngleDeg),
)

/**
 * The rejected edit, in the user's language.
 *
 * Keyed by the domain's own stable `code` rather than by a sentence, so a
 * reworded message never silently becomes an untranslated one. docs/06 §9
 */
const errorMessage = computed(() =>
  store.lastError ? t(`planner.errors.${store.lastError.code}`) : null,
)

const isEmpty = computed(
  () => store.walls.length === 0 && store.structural.length === 0 && !store.background,
)
</script>

<template>
  <section class="planner">
    <header class="planner__bar">
      <div class="planner__group" role="group" :aria-label="t('planner.tools')">
        <button
          v-for="tool in TOOLS"
          :key="tool"
          type="button"
          class="planner__button"
          :class="{ 'planner__button--active': store.tool === tool }"
          :aria-pressed="store.tool === tool"
          @click="store.setTool(tool)"
        >
          {{ t(`planner.tool.${tool}`) }}
        </button>
      </div>

      <div class="planner__group">
        <button
          type="button"
          class="planner__button"
          :class="{ 'planner__button--active': showViewer }"
          :aria-pressed="showViewer"
          @click="showViewer = !showViewer"
        >
          {{ showViewer ? t('viewer.close') : t('viewer.open') }}
        </button>
        <button type="button" class="planner__button" @click="store.zoomToFit()">
          {{ t('planner.fit') }}
        </button>
        <button
          type="button"
          class="planner__button"
          :disabled="!store.canUndo"
          :title="store.undoLabel ?? ''"
          @click="store.undo()"
        >
          {{ t('planner.undo') }}
        </button>
        <button
          type="button"
          class="planner__button"
          :disabled="!store.canRedo"
          :title="store.redoLabel ?? ''"
          @click="store.redo()"
        >
          {{ t('planner.redo') }}
        </button>
      </div>

      <label class="planner__field">
        {{ t('planner.thickness') }}
        <select
          class="planner__input"
          :value="store.wallDefaults.thicknessMm"
          @change="store.setWallThickness(Number(($event.target as HTMLSelectElement).value))"
        >
          <option v-for="value in THICKNESSES" :key="value" :value="value">{{ value }}</option>
        </select>
      </label>

      <label class="planner__field">
        {{ t('planner.length') }}
        <input
          v-model="lengthField"
          class="planner__input planner__input--length"
          type="text"
          inputmode="decimal"
          :disabled="!canDimension"
          :aria-label="t('planner.lengthHint')"
          @focus="editing = true"
          @blur="cancelLength"
          @keydown.enter.prevent="commitLength"
          @keydown.esc.prevent="cancelLength"
        />
      </label>

      <p v-if="bearing !== null" class="planner__readout">
        {{ t('planner.bearing', { degrees: bearing }) }}
      </p>

      <label class="planner__toggle">
        <input
          type="checkbox"
          :checked="store.snapConfig.grid"
          @change="store.setSnapConfig({ grid: ($event.target as HTMLInputElement).checked })"
        />
        {{ t('planner.snapGrid') }}
      </label>
      <label class="planner__toggle">
        <input
          type="checkbox"
          :checked="store.snapConfig.ortho"
          @change="store.setSnapConfig({ ortho: ($event.target as HTMLInputElement).checked })"
        />
        {{ t('planner.snapOrtho') }}
      </label>
      <label class="planner__toggle">
        <input
          type="checkbox"
          :checked="store.snapConfig.endpoint"
          @change="store.setSnapConfig({ endpoint: ($event.target as HTMLInputElement).checked })"
        />
        {{ t('planner.snapObject') }}
      </label>

      <p class="planner__status">
        {{ t('planner.walls', { count: store.walls.length }) }} ·
        {{ t('planner.openings', { count: store.openings.length }) }} ·
        {{ t('planner.roomCount', { count: store.rooms.length }) }} ·
        {{ t('planner.selected', { count: store.selection.size }) }} ·
        {{ Math.round(store.viewport.scale * 1000) / 10 }}%
      </p>
    </header>

    <div class="planner__underlay">
      <PlannerBackgroundControls />
      <PlannerRevisions />
      <PlannerExport :render="renderSheet" />
      <p v-if="saveState" class="planner__save">{{ saveState }}</p>
    </div>

    <p v-if="store.readOnly" class="planner__banner" role="status">
      {{ t('planner.lockedBy', { name: store.lockedByName ?? '' }) }}
    </p>

    <p v-if="store.conflicted" class="planner__banner planner__banner--warning" role="alert">
      {{ t('planner.conflict') }}
    </p>

    <p v-if="errorMessage" class="planner__error" role="status">
      {{ errorMessage }}
      <button type="button" class="planner__dismiss" @click="store.clearError()">
        {{ t('planner.dismiss') }}
      </button>
    </p>

    <div class="planner__body">
      <div class="planner__stage">
        <PlannerCanvas ref="canvas" />
        <p v-if="isEmpty" class="planner__hint">{{ t('planner.empty') }}</p>
        <PlanViewer3D v-if="showViewer" />
      </div>
      <PlannerRoomPanel />
      <PlannerLayerPanel />
    </div>
  </section>
</template>

<style scoped>
.planner {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.planner__bar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: center;
  padding: 0.625rem 1rem;
  border-bottom: 1px solid var(--color-border, #e2e8f0);
  background: var(--color-surface, #fff);
}

.planner__save {
  margin: 0;
  margin-inline-start: auto;
  font-size: 0.8125rem;
  color: var(--color-text-muted, #64748b);
}

.planner__banner {
  margin: 0;
  padding: 0.5rem 1rem;
  background: #eff6ff;
  color: #1e40af;
  font-size: 0.875rem;
}

.planner__banner--warning {
  background: #fffbeb;
  color: #92400e;
}

.planner__underlay {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 1rem;
  padding: 0.5rem 1rem;
  border-bottom: 1px solid var(--color-border, #e2e8f0);
  background: var(--color-surface, #fff);
}

.planner__group {
  display: flex;
  gap: 0.25rem;
}

.planner__button {
  padding: 0.35rem 0.75rem;
  border: 1px solid var(--color-border, #e2e8f0);
  border-radius: 0.375rem;
  background: var(--color-surface, #fff);
  font: inherit;
  cursor: pointer;
}

.planner__button--active {
  background: var(--color-primary, #2563eb);
  border-color: var(--color-primary, #2563eb);
  color: #fff;
}

.planner__button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.planner__field {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.875rem;
}

.planner__input {
  padding: 0.3rem 0.4rem;
  border: 1px solid var(--color-border, #e2e8f0);
  border-radius: 0.375rem;
  background: var(--color-surface, #fff);
  font: inherit;
  font-variant-numeric: tabular-nums;
}

.planner__input--length {
  inline-size: 6rem;
  /* Lengths are numbers: they read left-to-right even in an RTL layout. */
  direction: ltr;
  text-align: end;
}

.planner__input:disabled {
  opacity: 0.45;
}

.planner__readout {
  margin: 0;
  font-size: 0.875rem;
  color: var(--color-text-muted, #64748b);
  font-variant-numeric: tabular-nums;
  direction: ltr;
}

.planner__toggle {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.875rem;
}

.planner__status {
  margin: 0;
  margin-inline-start: auto;
  font-size: 0.875rem;
  color: var(--color-text-muted, #64748b);
  font-variant-numeric: tabular-nums;
}

.planner__error {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0;
  padding: 0.5rem 1rem;
  background: #fef2f2;
  color: #991b1b;
  font-size: 0.875rem;
}

.planner__dismiss {
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  text-decoration: underline;
  cursor: pointer;
}

.planner__body {
  display: flex;
  flex: 1;
  min-height: 0;
}

.planner__stage {
  position: relative;
  flex: 1;
  min-height: 0;
  min-width: 0;
}

.planner__hint {
  position: absolute;
  inset-block-start: 1.5rem;
  inset-inline: 0;
  margin: 0;
  text-align: center;
  color: var(--color-text-muted, #64748b);
  font-size: 0.875rem;
  pointer-events: none;
}
</style>
